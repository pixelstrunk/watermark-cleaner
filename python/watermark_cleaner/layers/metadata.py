import re
import zlib
from pathlib import Path

from ..findings import Finding, Report
from ..safeio import is_symlink, write_bytes_atomic, write_text_atomic

_SVG_METADATA = re.compile(r"<metadata\b[^>]*>.*?</metadata>", re.DOTALL | re.IGNORECASE)
_SVG_XMP = re.compile(r"<x:xmpmeta\b.*?</x:xmpmeta>", re.DOTALL | re.IGNORECASE)
_SVG_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)

_JPEG_STRIP_MARKERS = {0xE1, 0xEB, 0xED, 0xFE}
_JPEG_ICC_MARKER = 0xE2
_JPEG_APP0_MARKER = 0xE0
_JPEG_APP1_MARKER = 0xE1
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_PNG_STRIP_CHUNKS = {b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"tIME", b"caBX"}
_PNG_ICC_CHUNK = b"iCCP"
_PNG_EXIF_CHUNK = b"eXIf"
_WEBP_STRIP_CHUNKS = {b"EXIF", b"XMP ", b"JUMB", b"C2PA", b"c2pa"}
_WEBP_ICC_CHUNK = b"ICCP"
_WEBP_EXIF_CHUNK = b"EXIF"
_WEBP_VP8X_EXIF_FLAG = 0x08
_WEBP_VP8X_XMP_FLAG = 0x04
_WEBP_VP8X_ICC_FLAG = 0x20

_EXIF_HEADER = b"Exif\x00\x00"
_ORIENTATION_TAG = 0x0112
_TIFF_SHORT = 3

_LOSSLESS_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp")
_UNSUPPORTED_SUFFIXES = (".gif", ".tif", ".tiff", ".heic", ".heif", ".avif")


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
    try:
        data = Path(path).read_bytes().decode("utf-8")
    except UnicodeDecodeError:
        report.findings.append(Finding("io", "read", "warn", "skipped (not utf-8 text)", 1))
        return
    hits = len(_SVG_METADATA.findall(data)) + len(_SVG_XMP.findall(data))
    comments = len(_SVG_COMMENT.findall(data))
    total = hits + comments
    if not total:
        return
    if not write:
        report.changed = True
        report.findings.append(
            Finding("metadata", "svg-metadata", "fixed", "embedded svg metadata/xmp/comments present", total)
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
    cleaned, stripped, orientation = result
    if not stripped or cleaned == data:
        return
    if not write:
        report.changed = True
        report.findings.append(
            Finding("metadata", "raster", "fixed", "embedded metadata present (exif/xmp/icc/c2pa)", stripped)
        )
        _add_orientation(report, orientation)
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
    _add_orientation(report, orientation)


def _add_orientation(report, orientation):
    if orientation is not None:
        report.findings.append(
            Finding("metadata", "orientation", "info", "kept exif orientation (tag 0x0112), nothing else", 1)
        )


def _read_orientation(tiff):
    base = len(_EXIF_HEADER) if tiff.startswith(_EXIF_HEADER) else 0
    if len(tiff) < base + 8:
        return None
    order = tiff[base:base + 2]
    if order == b"II":
        byteorder = "little"
    elif order == b"MM":
        byteorder = "big"
    else:
        return None
    if int.from_bytes(tiff[base + 2:base + 4], byteorder) != 42:
        return None
    ifd = base + int.from_bytes(tiff[base + 4:base + 8], byteorder)
    if ifd + 2 > len(tiff):
        return None
    entries = int.from_bytes(tiff[ifd:ifd + 2], byteorder)
    for index in range(entries):
        at = ifd + 2 + index * 12
        if at + 12 > len(tiff):
            return None
        if int.from_bytes(tiff[at:at + 2], byteorder) != _ORIENTATION_TAG:
            continue
        field_type = int.from_bytes(tiff[at + 2:at + 4], byteorder)
        count = int.from_bytes(tiff[at + 4:at + 8], byteorder)
        if field_type != _TIFF_SHORT or count != 1:
            return None
        value = int.from_bytes(tiff[at + 8:at + 10], byteorder)
        return value if 2 <= value <= 8 else None
    return None


def _orientation_tiff(orientation):
    return (
        b"MM\x00\x2a\x00\x00\x00\x08"
        + b"\x00\x01"
        + _ORIENTATION_TAG.to_bytes(2, "big")
        + _TIFF_SHORT.to_bytes(2, "big")
        + (1).to_bytes(4, "big")
        + orientation.to_bytes(2, "big")
        + b"\x00\x00"
        + b"\x00\x00\x00\x00"
    )


def _jpeg_orientation_segment(orientation):
    payload = _EXIF_HEADER + _orientation_tiff(orientation)
    return bytes([0xFF, _JPEG_APP1_MARKER]) + (len(payload) + 2).to_bytes(2, "big") + payload


def _png_chunk(chunk_type, payload):
    body = chunk_type + payload
    return len(payload).to_bytes(4, "big") + body + zlib.crc32(body).to_bytes(4, "big")


def _webp_chunk(fourcc, payload):
    data = fourcc + len(payload).to_bytes(4, "little") + payload
    if len(payload) % 2:
        data += b"\x00"
    return data


def _strip_jpeg(data, strip_icc=False):
    if not data.startswith(b"\xff\xd8"):
        return None
    markers = set(_JPEG_STRIP_MARKERS)
    if strip_icc:
        markers.add(_JPEG_ICC_MARKER)
    segments = []
    i = 2
    stripped = 0
    orientation = None
    n = len(data)
    while i + 1 < n:
        if data[i] != 0xFF:
            return None
        marker = data[i + 1]
        if marker == 0xFF:
            i += 1
            continue
        if marker == 0xD9 or marker == 0xDA:
            segments.append(data[i:])
            break
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:
            segments.append(data[i:i + 2])
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
            if marker == _JPEG_APP1_MARKER and orientation is None:
                orientation = _read_orientation(data[i + 4:end])
        else:
            segments.append(data[i:end])
        i = end
    else:
        return None
    if orientation is not None:
        at = 0
        while at < len(segments) and segments[at][1] == _JPEG_APP0_MARKER:
            at += 1
        segments.insert(at, _jpeg_orientation_segment(orientation))
    return b"\xff\xd8" + b"".join(segments), stripped, orientation


def _strip_png(data, strip_icc=False):
    if not data.startswith(_PNG_SIGNATURE):
        return None
    chunks = set(_PNG_STRIP_CHUNKS)
    if strip_icc:
        chunks.add(_PNG_ICC_CHUNK)
    parts = [_PNG_SIGNATURE]
    i = len(_PNG_SIGNATURE)
    stripped = 0
    orientation = None
    header_index = 0
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
            if chunk_type == _PNG_EXIF_CHUNK and orientation is None:
                orientation = _read_orientation(data[i + 8:i + 8 + length])
        else:
            parts.append(data[i:end])
            if chunk_type == b"IHDR" and not header_index:
                header_index = len(parts) - 1
        if chunk_type == b"IEND":
            parts.append(data[end:])
            break
        i = end
    if orientation is not None:
        parts.insert(header_index + 1, _png_chunk(_PNG_EXIF_CHUNK, _orientation_tiff(orientation)))
    return b"".join(parts), stripped, orientation


def _strip_webp(data, strip_icc=False):
    if len(data) < 12 or data[0:4] != b"RIFF" or data[8:12] != b"WEBP":
        return None
    strip_set = set(_WEBP_STRIP_CHUNKS)
    clear_flags = _WEBP_VP8X_EXIF_FLAG | _WEBP_VP8X_XMP_FLAG
    if strip_icc:
        strip_set.add(_WEBP_ICC_CHUNK)
        clear_flags |= _WEBP_VP8X_ICC_FLAG
    chunks = []
    i = 12
    stripped = 0
    orientation = None
    header = None
    n = len(data)
    while i < n:
        if i + 8 > n:
            return None
        fourcc = data[i:i + 4]
        size = int.from_bytes(data[i + 4:i + 8], "little")
        if i + 8 + size > n:
            return None
        end = i + 8 + size + (size % 2)
        if fourcc in strip_set:
            stripped += 1
            if fourcc == _WEBP_EXIF_CHUNK and orientation is None:
                orientation = _read_orientation(data[i + 8:i + 8 + size])
        else:
            chunk = bytearray(data[i:end])
            if fourcc == b"VP8X" and len(chunk) >= 9 and header is None:
                header = chunk
            chunks.append(chunk)
        i = end
    if header is None:
        orientation = None
    if orientation is not None:
        clear_flags &= ~_WEBP_VP8X_EXIF_FLAG
    if stripped and header is not None:
        header[8] &= ~clear_flags & 0xFF
        if orientation is not None:
            header[8] |= _WEBP_VP8X_EXIF_FLAG
    if orientation is not None:
        chunks.append(bytearray(_webp_chunk(_WEBP_EXIF_CHUNK, _orientation_tiff(orientation))))
    body = b"".join(bytes(c) for c in chunks)
    out = b"RIFF" + (len(body) + 4).to_bytes(4, "little") + b"WEBP" + body
    return out, stripped, orientation


def _backup_file(path):
    p = Path(path)
    backup = p.with_suffix(p.suffix + ".bak")
    if not backup.exists():
        backup.write_bytes(p.read_bytes())
