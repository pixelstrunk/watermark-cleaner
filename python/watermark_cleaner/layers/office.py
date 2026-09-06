import io
import re
import struct
import zipfile
import zlib
from functools import lru_cache
from pathlib import Path

from ..findings import Finding, Report
from ..safeio import is_symlink, write_bytes_atomic

_DOCX_RULES = (
    {"part": "docProps/core.xml", "remove": ("creator", "lastModifiedBy")},
    {"part": "docProps/app.xml", "remove": ("Application", "AppVersion", "Company", "Manager", "Template", "TotalTime")},
    {"part": "word/people.xml", "remove": ("person",)},
    {"part": "word/*.xml", "blank_attributes": ("author", "initials")},
)
_ODT_RULES = (
    {"part": "meta.xml", "remove": ("creator", "initial-creator", "generator", "editing-duration", "printed-by")},
    {"part": "content.xml", "empty": ("creator",)},
)
_RULES = {".docx": _DOCX_RULES, ".odt": _ODT_RULES}

_SUPPORTED_SUFFIXES = tuple(_RULES)

_LOCAL_HEADER_SIZE = 30
_LOCAL_HEADER_SIGNATURE = b"PK\x03\x04"
_CENTRAL_SIGNATURE = b"PK\x01\x02"
_EOCD_SIGNATURE = b"PK\x05\x06"
_STREAMED_FLAG = 0x0008
_ENCRYPTED_FLAG = 0x0001
_MAX_METADATA_BYTES = 64 * 1024 * 1024


def _part_matches(pattern, name):
    if pattern.endswith("/*.xml"):
        directory = pattern[: -len("*.xml")]
        remainder = name[len(directory):]
        return name.startswith(directory) and remainder.endswith(".xml") and "/" not in remainder
    return pattern == name


def _rules_for(rules, name):
    return [rule for rule in rules if _part_matches(rule["part"], name)]


@lru_cache(maxsize=None)
def _remove_pattern(tag):
    name = re.escape(tag)
    return re.compile(
        rf"<([\w.]+:)?{name}\b[^>]*/>|<([\w.]+:)?{name}\b[^>]*>.*?</([\w.]+:)?{name}>",
        re.DOTALL,
    )


@lru_cache(maxsize=None)
def _empty_pattern(tag):
    name = re.escape(tag)
    return re.compile(rf"(<(?:[\w.]+:)?{name}\b[^>]*>)(.*?)(</(?:[\w.]+:)?{name}>)", re.DOTALL)


@lru_cache(maxsize=None)
def _attribute_pattern(attribute):
    name = re.escape(attribute)
    return re.compile(rf"(\s(?:[\w.]+:)?{name}=)([\"'])([^\"']*)\2")


def _scrub(text, rule):
    count = 0
    for tag in rule.get("remove", ()):
        text, n = _remove_pattern(tag).subn("", text)
        count += n
    for tag in rule.get("empty", ()):
        pattern = _empty_pattern(tag)
        count += sum(1 for match in pattern.finditer(text) if match.group(2))
        text = pattern.sub(_keep_open_and_close, text)
    for attribute in rule.get("blank_attributes", ()):
        pattern = _attribute_pattern(attribute)
        count += sum(1 for match in pattern.finditer(text) if match.group(3))
        text = pattern.sub(_blank_attribute_value, text)
    return text, count


def _keep_open_and_close(match):
    return match.group(1) + match.group(3)


def _blank_attribute_value(match):
    return match.group(1) + match.group(2) + match.group(2)


def inspect_file(path):
    return _process(path, write=False, backup=False)


def clean_file(path, write=True, backup=True):
    return _process(path, write=write, backup=backup)


def _process(path, write, backup):
    suffix = Path(path).suffix.lower()
    report = Report(path=str(path))
    rules = _RULES.get(suffix)
    if rules is None:
        return report
    data = Path(path).read_bytes()
    result = _clean_zip(data, rules)
    if result is None:
        report.findings.append(Finding("metadata", "office", "warn", "could not parse (file left untouched)", 1))
        return report
    new_data, stripped = result
    if not stripped:
        return report
    if not write:
        report.findings.append(Finding("metadata", "office", "warn", "embedded author/application metadata present", stripped))
        return report
    if is_symlink(path):
        report.findings.append(Finding("io", "write", "warn", "refused to write through symlink", 1))
        return report
    report.changed = True
    if backup:
        _backup_file(path)
    write_bytes_atomic(path, new_data)
    report.findings.append(
        Finding("metadata", "office", "fixed", "stripped author/application metadata (lossless, container-level)", stripped)
    )
    return report


def _clean_zip(data, rules):
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        infos = zf.infolist()
    except (zipfile.BadZipFile, OSError, NotImplementedError, ValueError, RuntimeError):
        return None

    records = []
    stripped_total = 0
    for info in infos:
        if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            return None
        if info.flag_bits & _ENCRYPTED_FLAG:
            return None
        if info.compress_size > 0xFFFFFFFF or info.file_size > 0xFFFFFFFF or info.header_offset > 0xFFFFFFFF:
            return None
        span = _local_data_span(data, info)
        if span is None:
            return None
        header_bytes, comp_data = span
        crc, csize, usize, method = info.CRC, info.compress_size, info.file_size, info.compress_type
        modified = False
        part_rules = _rules_for(rules, info.filename)
        if part_rules:
            if info.file_size > _MAX_METADATA_BYTES:
                return None
            content = _decompress(comp_data, info.compress_type)
            if content is None:
                return None
            try:
                text = content.decode("utf-8")
            except UnicodeDecodeError:
                text = None
            if text is not None:
                new_text = text
                n = 0
                for rule in part_rules:
                    new_text, rule_count = _scrub(new_text, rule)
                    n += rule_count
                if n:
                    stripped_total += n
                    modified = True
                    new_bytes = new_text.encode("utf-8")
                    comp_data = new_bytes
                    method = zipfile.ZIP_STORED
                    crc = zlib.crc32(new_bytes) & 0xFFFFFFFF
                    csize = len(comp_data)
                    usize = len(new_bytes)
        records.append((info, header_bytes, comp_data, crc, csize, usize, method, modified))

    if not stripped_total:
        return data, 0
    return _write_zip(records), stripped_total


def _local_data_span(data, info):
    offset = info.header_offset
    if offset < 0 or offset + _LOCAL_HEADER_SIZE > len(data):
        return None
    header = data[offset : offset + _LOCAL_HEADER_SIZE]
    if header[0:4] != _LOCAL_HEADER_SIGNATURE:
        return None
    name_len, extra_len = struct.unpack("<HH", header[26:30])
    data_start = offset + _LOCAL_HEADER_SIZE + name_len + extra_len
    data_end = data_start + info.compress_size
    if data_end > len(data):
        return None
    return data[offset:data_start], data[data_start:data_end]


def _decompress(data, method):
    if method == zipfile.ZIP_STORED:
        return data
    try:
        obj = zlib.decompressobj(-15)
        out = obj.decompress(data, _MAX_METADATA_BYTES + 1)
    except zlib.error:
        return None
    if len(out) > _MAX_METADATA_BYTES or obj.unconsumed_tail:
        return None
    return out


def _patch_header(header_bytes, crc, csize, usize, method):
    header = bytearray(header_bytes)
    flags = struct.unpack("<H", header[6:8])[0] & ~_STREAMED_FLAG
    header[6:8] = struct.pack("<H", flags)
    header[8:10] = struct.pack("<H", method)
    header[14:18] = struct.pack("<I", crc)
    header[18:22] = struct.pack("<I", csize)
    header[22:26] = struct.pack("<I", usize)
    return bytes(header)


def _dos_datetime(date_time):
    year, month, day, hour, minute, second = date_time
    dosdate = ((max(year, 1980) - 1980) << 9) | (month << 5) | day
    dostime = (hour << 11) | (minute << 5) | (second // 2)
    return dostime, dosdate


def _central_record(info, crc, csize, usize, method, local_offset):
    name = info.filename.encode("utf-8")
    extra = info.extra or b""
    comment = info.comment or b""
    dostime, dosdate = _dos_datetime(info.date_time)
    flags = info.flag_bits & ~_STREAMED_FLAG
    version_made_by = (info.create_system << 8) | info.create_version
    return (
        _CENTRAL_SIGNATURE
        + struct.pack(
            "<HHHHHHIIIHHHHHII",
            version_made_by,
            info.extract_version,
            flags,
            method,
            dostime,
            dosdate,
            crc,
            csize,
            usize,
            len(name),
            len(extra),
            len(comment),
            0,
            info.internal_attr,
            info.external_attr,
            local_offset,
        )
        + name
        + extra
        + comment
    )


def _eocd(count, cd_size, cd_offset):
    return _EOCD_SIGNATURE + struct.pack("<HHHHIIH", 0, 0, count, count, cd_size, cd_offset, 0)


def _write_zip(records):
    ordered = sorted(records, key=lambda r: r[0].header_offset)
    out = bytearray()
    offsets = []
    for info, header_bytes, comp_data, crc, csize, usize, method, modified in ordered:
        offsets.append(len(out))
        out += _patch_header(header_bytes, crc, csize, usize, method) if modified else header_bytes
        out += comp_data
    central = bytearray()
    for (info, header_bytes, comp_data, crc, csize, usize, method, modified), offset in zip(ordered, offsets):
        central += _central_record(info, crc, csize, usize, method, offset)
    cd_offset = len(out)
    out += central
    out += _eocd(len(ordered), len(central), cd_offset)
    return bytes(out)


def _backup_file(path):
    p = Path(path)
    backup = p.with_suffix(p.suffix + ".bak")
    if not backup.exists():
        backup.write_bytes(p.read_bytes())
