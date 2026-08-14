import re
from pathlib import Path

from ..findings import Finding, Report
from ..safeio import is_symlink, write_bytes_atomic, write_text_atomic

_SVG_METADATA = re.compile(r"<metadata\b[^>]*>.*?</metadata>", re.DOTALL | re.IGNORECASE)
_SVG_XMP = re.compile(r"<x:xmpmeta\b.*?</x:xmpmeta>", re.DOTALL | re.IGNORECASE)
_SVG_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)

_JPEG_STRIP_MARKERS = {0xE1, 0xEB, 0xED, 0xFE}
_JPEG_ICC_MARKER = 0xE2
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_PNG_STRIP_CHUNKS = {b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"tIME", b"caBX"}
_PNG_ICC_CHUNK = b"iCCP"
_WEBP_STRIP_CHUNKS = {b"EXIF", b"XMP ", b"JUMB", b"C2PA", b"c2pa"}
_WEBP_ICC_CHUNK = b"ICCP"
_WEBP_VP8X_CLEAR_FLAGS = 0x08 | 0x04
_WEBP_VP8X_ICC_FLAG = 0x20

_LOSSLESS_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp")
_UNSUPPORTED_SUFFIXES = (".gif", ".tif", ".tiff")


def inspect_file(path, strip_icc=False):
    return _process(path, write=False, backup=False, strip_icc=strip_icc)


def clean_file(path, write=True, backup=True, strip_icc=False):
    return _process(path, write=write, backup=backup, strip_icc=strip_icc)


def _process(path, write, backup, strip_icc=False):
    suffix = Path(path).suffix.lower()
    report = Report(path=str(path))
    if suffix == ".svg":
        _handle_svg(path, report, write, backup)
    elif suffix in _LOSSLESS_SUFFIXES:
        _handle_binary(path, report, write, backup, suffix, strip_icc)
    elif suffix in _UNSUPPORTED_SUFFIXES:
        report.findings.append(
            Finding("metadata", "raster", "warn", "lossless metadata stripping not supported for this format (file left untouched)", 1)
        )
    return report


def _handle_svg(path, report, write, backup):
    data = Path(path).read_text(encoding="utf-8", errors="ignore")
    hits = len(_SVG_METADATA.findall(data)) + len(_SVG_XMP.findall(data))
    comments = len(_SVG_COMMENT.findall(data))
    total = hits + comments
    if not total:
        return
    if not write:
        report.findings.append(
            Finding("metadata", "svg-metadata", "warn", "embedded svg metadata/xmp/comments present", total)
        )
        return
    cleaned = _SVG_COMMENT.sub("", _SVG_XMP.sub("", _SVG_METADATA.sub("", data)))
    if cleaned != data:
        if is_symlink(path):
            report.findings.append(Finding("io", "write", "warn", "refused to write through symlink", 1))
            return
        report.changed = True
        if backup:
            _backup_file(path)
        write_text_atomic(path, cleaned)
    report.findings.append(
        Finding("metadata", "svg-metadata", "fixed", "stripped svg metadata, xmp and comments", total)
    )


def _handle_binary(path, report, write, backup, suffix, strip_icc):
    data = Path(path).read_bytes()
    if suffix in (".jpg", ".jpeg"):
        result = _strip_jpeg(data, strip_icc)
    elif suffix == ".png":
        result = _strip_png(data, strip_icc)
    else:
        result = _strip_webp(data, strip_icc)

    if result is None:
        report.findings.append(
            Finding("metadata", "raster", "warn", "could not parse image (file left untouched)", 1)
        )
        return
    cleaned, stripped = result
    if not stripped:
        return
    if not write:
        report.findings.append(
            Finding("metadata", "raster", "warn", "embedded metadata present (exif/xmp/icc/c2pa)", stripped)
        )
        return
    if is_symlink(path):
        report.findings.append(Finding("io", "write", "warn", "refused to write through symlink", 1))
        return
    report.changed = True
    if backup:
        _backup_file(path)
    write_bytes_atomic(path, cleaned)
    report.findings.append(
        Finding("metadata", "raster", "fixed", "stripped metadata segments losslessly (pixels untouched)", stripped)
    )


def _strip_jpeg(data, strip_icc=False):
    if not data.startswith(b"\xff\xd8"):
        return None
    markers = set(_JPEG_STRIP_MARKERS)
    if strip_icc:
        markers.add(_JPEG_ICC_MARKER)
    out = bytearray(b"\xff\xd8")
    i = 2
    stripped = 0
    n = len(data)
    while i + 1 < n:
        if data[i] != 0xFF:
            return None
        marker = data[i + 1]
        if marker == 0xFF:
            i += 1
            continue
        if marker == 0xD9 or marker == 0xDA:
            out += data[i:]
            break
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:
            out += data[i:i + 2]
            i += 2
            continue
        if i + 4 > n:
            return None
        seg_len = int.from_bytes(data[i + 2:i + 4], "big")
        end = i + 2 + seg_len
        if seg_len < 2 or end > n:
            return None
        if marker in markers:
            stripped += 1
        else:
            out += data[i:end]
        i = end
    else:
        return None
    return bytes(out), stripped


def _strip_png(data, strip_icc=False):
    if not data.startswith(_PNG_SIGNATURE):
        return None
    chunks = set(_PNG_STRIP_CHUNKS)
    if strip_icc:
        chunks.add(_PNG_ICC_CHUNK)
    out = bytearray(_PNG_SIGNATURE)
    i = len(_PNG_SIGNATURE)
    stripped = 0
    n = len(data)
    while i < n:
        if i + 8 > n:
            return None
        length = int.from_bytes(data[i:i + 4], "big")
        chunk_type = data[i + 4:i + 8]
        end = i + 12 + length
        if end > n:
            return None
        if chunk_type in chunks:
            stripped += 1
        else:
            out += data[i:end]
        if chunk_type == b"IEND":
            out += data[end:]
            break
        i = end
    return bytes(out), stripped


def _strip_webp(data, strip_icc=False):
    if len(data) < 12 or data[0:4] != b"RIFF" or data[8:12] != b"WEBP":
        return None
    strip_set = set(_WEBP_STRIP_CHUNKS)
    clear_flags = _WEBP_VP8X_CLEAR_FLAGS
    if strip_icc:
        strip_set.add(_WEBP_ICC_CHUNK)
        clear_flags |= _WEBP_VP8X_ICC_FLAG
    chunks = []
    i = 12
    stripped = 0
    n = len(data)
    while i < n:
        if i + 8 > n:
            return None
        fourcc = data[i:i + 4]
        size = int.from_bytes(data[i + 4:i + 8], "little")
        end = i + 8 + size + (size % 2)
        if i + 8 + size > n:
            return None
        if fourcc in strip_set:
            stripped += 1
        else:
            chunks.append(bytearray(data[i:end]))
        i = end
    if stripped:
        for chunk in chunks:
            if chunk[0:4] == b"VP8X" and len(chunk) >= 9:
                chunk[8] &= ~clear_flags & 0xFF
    body = b"".join(bytes(c) for c in chunks)
    out = b"RIFF" + (len(body) + 4).to_bytes(4, "little") + b"WEBP" + body
    return out, stripped


def _backup_file(path):
    p = Path(path)
    backup = p.with_suffix(p.suffix + ".bak")
    if not backup.exists():
        backup.write_bytes(p.read_bytes())
