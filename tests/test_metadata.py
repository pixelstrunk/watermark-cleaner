import os
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "python"))
os.environ.setdefault("WATERMARK_CLEANER_RULES_DIR", os.path.join(ROOT, "rules"))

from watermark_cleaner.layers.metadata import _read_orientation, _strip_jpeg, _strip_png, _strip_webp, clean_file, inspect_file


def jpeg_segment(marker, payload):
    return bytes([0xFF, marker]) + (len(payload) + 2).to_bytes(2, "big") + payload


def make_jpeg(with_exif=True):
    data = b"\xff\xd8"
    data += jpeg_segment(0xE0, b"JFIF\x00\x01\x02")
    if with_exif:
        data += jpeg_segment(0xE1, b"Exif\x00\x00secretcamera")
        data += jpeg_segment(0xFE, b"a comment")
    data += jpeg_segment(0xDB, b"\x00" * 65)
    data += b"\xff\xda" + b"\x00\x08\x01\x01\x00" + b"scan-data-here" + b"\xff\xd9"
    return data


def png_chunk(chunk_type, payload):
    return len(payload).to_bytes(4, "big") + chunk_type + payload + b"\x00\x00\x00\x00"


def make_png(with_text=True):
    data = b"\x89PNG\r\n\x1a\n"
    data += png_chunk(b"IHDR", b"\x00" * 13)
    if with_text:
        data += png_chunk(b"tEXt", b"Comment\x00made by an ai")
        data += png_chunk(b"iTXt", b"XML:com.adobe.xmp\x00\x00\x00\x00\x00xmp")
    data += png_chunk(b"IDAT", b"\x00\x01\x02")
    data += png_chunk(b"IEND", b"")
    return data


def webp_chunk(fourcc, payload):
    data = fourcc + len(payload).to_bytes(4, "little") + payload
    if len(payload) % 2:
        data += b"\x00"
    return data


def make_webp(with_exif=True):
    vp8x_flags = 0x0C if with_exif else 0x00
    body = webp_chunk(b"VP8X", bytes([vp8x_flags]) + b"\x00" * 9)
    if with_exif:
        body += webp_chunk(b"EXIF", b"exif-payload")
        body += webp_chunk(b"XMP ", b"xmp-payload")
    body += webp_chunk(b"VP8 ", b"\x00" * 10)
    return b"RIFF" + (len(body) + 4).to_bytes(4, "little") + b"WEBP" + body


class JpegStripping(unittest.TestCase):
    def test_strips_exif_and_comment(self):
        cleaned, stripped, _ = _strip_jpeg(make_jpeg())
        self.assertEqual(stripped, 2)
        self.assertNotIn(b"secretcamera", cleaned)
        self.assertNotIn(b"a comment", cleaned)

    def test_keeps_pixels_and_structure(self):
        cleaned, _, _ = _strip_jpeg(make_jpeg())
        self.assertIn(b"scan-data-here", cleaned)
        self.assertIn(b"JFIF", cleaned)
        self.assertTrue(cleaned.endswith(b"\xff\xd9"))

    def test_clean_jpeg_untouched(self):
        cleaned, stripped, _ = _strip_jpeg(make_jpeg(with_exif=False))
        self.assertEqual(stripped, 0)
        self.assertEqual(cleaned, make_jpeg(with_exif=False))

    def test_garbage_returns_none(self):
        self.assertIsNone(_strip_jpeg(b"not a jpeg"))
        self.assertIsNone(_strip_jpeg(b"\xff\xd8truncated"))


class PngStripping(unittest.TestCase):
    def test_strips_text_chunks(self):
        cleaned, stripped, _ = _strip_png(make_png())
        self.assertEqual(stripped, 2)
        self.assertNotIn(b"made by an ai", cleaned)
        self.assertNotIn(b"com.adobe.xmp", cleaned)

    def test_keeps_image_chunks(self):
        cleaned, _, _ = _strip_png(make_png())
        self.assertIn(b"IHDR", cleaned)
        self.assertIn(b"IDAT", cleaned)
        self.assertIn(b"IEND", cleaned)

    def test_clean_png_untouched(self):
        cleaned, stripped, _ = _strip_png(make_png(with_text=False))
        self.assertEqual(stripped, 0)
        self.assertEqual(cleaned, make_png(with_text=False))

    def test_garbage_returns_none(self):
        self.assertIsNone(_strip_png(b"not a png"))


class WebpStripping(unittest.TestCase):
    def test_strips_exif_and_xmp(self):
        cleaned, stripped, _ = _strip_webp(make_webp())
        self.assertEqual(stripped, 2)
        self.assertNotIn(b"exif-payload", cleaned)
        self.assertNotIn(b"xmp-payload", cleaned)

    def test_clears_vp8x_flags_and_fixes_riff_size(self):
        cleaned, _, _ = _strip_webp(make_webp())
        vp8x_at = cleaned.find(b"VP8X")
        self.assertNotEqual(vp8x_at, -1)
        self.assertEqual(cleaned[vp8x_at + 8] & 0x0C, 0)
        riff_size = int.from_bytes(cleaned[4:8], "little")
        self.assertEqual(riff_size, len(cleaned) - 8)

    def test_clean_webp_untouched(self):
        cleaned, stripped, _ = _strip_webp(make_webp(with_exif=False))
        self.assertEqual(stripped, 0)
        self.assertEqual(cleaned, make_webp(with_exif=False))

    def test_strips_c2pa_jumb_chunk(self):
        c2pa_chunk = webp_chunk(b"JUMB", b"c2pa-manifest-payload")
        body = webp_chunk(b"VP8X", bytes([0x00]) + b"\x00" * 9) + c2pa_chunk + webp_chunk(b"VP8 ", b"\x00" * 10)
        data = b"RIFF" + (len(body) + 4).to_bytes(4, "little") + b"WEBP" + body
        cleaned, stripped, _ = _strip_webp(data)
        self.assertEqual(stripped, 1)
        self.assertNotIn(b"c2pa-manifest-payload", cleaned)


def tiff_with_orientation(orientation, little=False):
    order = "little" if little else "big"
    header = (b"II\x2a\x00" if little else b"MM\x00\x2a") + (8).to_bytes(4, order)
    make = (0x010F).to_bytes(2, order) + (2).to_bytes(2, order) + (4).to_bytes(4, order) + b"ABC\x00"
    orient = (0x0112).to_bytes(2, order) + (3).to_bytes(2, order) + (1).to_bytes(4, order) + orientation.to_bytes(2, order) + b"\x00\x00"
    return header + (2).to_bytes(2, order) + make + orient + b"\x00\x00\x00\x00"


def jpeg_with_orientation(orientation, little=False, with_app0=True):
    data = b"\xff\xd8"
    if with_app0:
        data += jpeg_segment(0xE0, b"JFIF\x00\x01\x02")
    data += jpeg_segment(0xE1, b"Exif\x00\x00" + tiff_with_orientation(orientation, little))
    data += jpeg_segment(0xDB, b"\x00" * 65)
    data += b"\xff\xda" + b"\x00\x08\x01\x01\x00" + b"scan" + b"\xff\xd9"
    return data


MINIMAL_EXIF_TIFF = b"MM\x00\x2a\x00\x00\x00\x08\x00\x01\x01\x12\x00\x03\x00\x00\x00\x01\x00\x06\x00\x00\x00\x00\x00\x00"


class OrientationKept(unittest.TestCase):
    def test_jpeg_minimal_app1_behind_app0(self):
        cleaned, stripped, orientation = _strip_jpeg(jpeg_with_orientation(6))
        self.assertEqual((stripped, orientation), (1, 6))
        self.assertNotIn(b"ABC", cleaned)
        app0 = cleaned.find(b"JFIF")
        app1 = cleaned.find(b"Exif\x00\x00")
        self.assertTrue(app0 != -1 and app1 > app0)
        self.assertEqual(int.from_bytes(cleaned[app1 - 2:app1], "big"), 34)
        self.assertEqual(cleaned[app1 + 6:app1 + 32], MINIMAL_EXIF_TIFF)
        self.assertEqual(_read_orientation(cleaned[app1:app1 + 32]), 6)

    def test_jpeg_without_app0_and_little_endian_exif(self):
        cleaned, _, orientation = _strip_jpeg(jpeg_with_orientation(8, little=True, with_app0=False))
        self.assertEqual(orientation, 8)
        self.assertEqual(cleaned[2:4], b"\xff\xe1")
        self.assertEqual(_read_orientation(cleaned[6:38]), 8)
        self.assertEqual(_strip_jpeg(jpeg_with_orientation(3))[2], 3)

    def test_upright_or_missing_orientation_writes_nothing_back(self):
        cleaned, _, orientation = _strip_jpeg(jpeg_with_orientation(1))
        self.assertIsNone(orientation)
        self.assertNotIn(b"Exif", cleaned)
        cleaned, _, orientation = _strip_jpeg(make_jpeg())
        self.assertIsNone(orientation)
        self.assertNotIn(b"Exif", cleaned)

    def test_cleaning_twice_is_a_no_op(self):
        once, _, _ = _strip_jpeg(jpeg_with_orientation(6))
        self.assertEqual(_strip_jpeg(once)[0], once)
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "photo.jpg"
            target.write_bytes(once)
            report = inspect_file(target)
            self.assertFalse(report.changed)
            self.assertEqual(report.findings, [])

    def test_info_finding_reports_kept_orientation(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "photo.jpg"
            target.write_bytes(jpeg_with_orientation(6))
            report = clean_file(target, backup=False)
            self.assertEqual([(f.severity, f.kind) for f in report.findings], [("fixed", "raster"), ("info", "orientation")])

    def test_png_exif_chunk_behind_ihdr_with_valid_crc(self):
        data = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", b"\x00" * 13)
        data += png_chunk(b"tEXt", b"Software\x00ai") + png_chunk(b"eXIf", tiff_with_orientation(6, little=True))
        data += png_chunk(b"IDAT", b"\x00") + png_chunk(b"IEND", b"")
        cleaned, stripped, orientation = _strip_png(data)
        self.assertEqual((stripped, orientation), (2, 6))
        at = cleaned.find(b"eXIf")
        self.assertEqual(at, 8 + 25 + 4)
        self.assertEqual(int.from_bytes(cleaned[at - 4:at], "big"), 26)
        self.assertEqual(cleaned[at + 4:at + 30], MINIMAL_EXIF_TIFF)
        self.assertEqual(int.from_bytes(cleaned[at + 30:at + 34], "big"), zlib.crc32(cleaned[at:at + 30]))

    def test_webp_trailing_exif_chunk_and_flag(self):
        body = webp_chunk(b"VP8X", bytes([0x0C]) + b"\x00" * 9) + webp_chunk(b"VP8 ", b"\x00" * 10)
        body += webp_chunk(b"EXIF", b"Exif\x00\x00" + tiff_with_orientation(6)) + webp_chunk(b"XMP ", b"xmp-payload")
        data = b"RIFF" + (len(body) + 4).to_bytes(4, "little") + b"WEBP" + body
        cleaned, stripped, orientation = _strip_webp(data)
        self.assertEqual((stripped, orientation), (2, 6))
        self.assertNotIn(b"xmp-payload", cleaned)
        self.assertEqual(cleaned[cleaned.find(b"VP8X") + 8], 0x08)
        at = cleaned.rfind(b"EXIF")
        self.assertEqual(at, len(cleaned) - 34)
        self.assertEqual(int.from_bytes(cleaned[at + 4:at + 8], "little"), 26)
        self.assertEqual(cleaned[at + 8:], MINIMAL_EXIF_TIFF)
        self.assertEqual(int.from_bytes(cleaned[4:8], "little"), len(cleaned) - 8)


class IccHandling(unittest.TestCase):
    def test_png_icc_kept_by_default(self):
        data = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", b"\x00" * 13) + png_chunk(b"iCCP", b"profile") + png_chunk(b"IDAT", b"\x00") + png_chunk(b"IEND", b"")
        cleaned, stripped, _ = _strip_png(data)
        self.assertEqual(stripped, 0)
        self.assertIn(b"iCCP", cleaned)

    def test_png_icc_stripped_when_requested(self):
        data = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", b"\x00" * 13) + png_chunk(b"iCCP", b"profile") + png_chunk(b"IDAT", b"\x00") + png_chunk(b"IEND", b"")
        cleaned, stripped, _ = _strip_png(data, strip_icc=True)
        self.assertEqual(stripped, 1)
        self.assertNotIn(b"iCCP", cleaned)

    def test_jpeg_icc_kept_by_default(self):
        data = b"\xff\xd8" + jpeg_segment(0xE2, b"ICC_PROFILE\x00data") + b"\xff\xda\x00\x08\x01\x01\x00scan\xff\xd9"
        cleaned, stripped, _ = _strip_jpeg(data)
        self.assertEqual(stripped, 0)
        self.assertIn(b"ICC_PROFILE", cleaned)

    def test_webp_icc_kept_by_default(self):
        body = webp_chunk(b"VP8X", bytes([0x20]) + b"\x00" * 9) + webp_chunk(b"ICCP", b"profile") + webp_chunk(b"VP8 ", b"\x00" * 10)
        data = b"RIFF" + (len(body) + 4).to_bytes(4, "little") + b"WEBP" + body
        cleaned, stripped, _ = _strip_webp(data)
        self.assertEqual(stripped, 0)
        self.assertIn(b"ICCP", cleaned)


LATIN1_SVG = (
    b'<?xml version="1.0" encoding="ISO-8859-1"?>\n<!-- Generator: Adobe Illustrator -->\n'
    b'<svg xmlns="http://www.w3.org/2000/svg"><title>Caf\xe9 M\xfcnchen</title></svg>\n'
)
UTF8_SVG = (
    '<?xml version="1.0" encoding="UTF-8"?>\r\n<!-- Generator: Adobe Illustrator -->\r\n'
    '<svg xmlns="http://www.w3.org/2000/svg"><metadata><rdf:RDF>secret</rdf:RDF></metadata>'
    "<title>Caf\u00e9 M\u00fcnchen</title></svg>\r\n"
).encode("utf-8")


class SvgHandling(unittest.TestCase):
    def test_utf8_svg_loses_comments_and_metadata_but_keeps_text_and_line_endings(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "logo.svg"
            target.write_bytes(UTF8_SVG)
            report = clean_file(str(target), write=True, backup=False)
            self.assertTrue(report.changed)
            result = target.read_bytes()
            self.assertNotIn(b"Illustrator", result)
            self.assertNotIn(b"secret", result)
            self.assertIn("Caf\u00e9 M\u00fcnchen".encode("utf-8"), result)
            self.assertIn(b"\r\n", result)

    def test_non_utf8_svg_is_skipped_with_warning_in_check_and_fix(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "old.svg"
            target.write_bytes(LATIN1_SVG)
            for report in (inspect_file(str(target)), clean_file(str(target), write=True, backup=False)):
                self.assertFalse(report.changed)
                self.assertEqual([f.message for f in report.findings], ["skipped (not utf-8 text)"])
                self.assertEqual(report.findings[0].severity, "warn")
            self.assertEqual(target.read_bytes(), LATIN1_SVG)
            self.assertFalse((Path(tmp) / "old.svg.bak").exists())


class FileRoundTrip(unittest.TestCase):
    def test_fix_writes_backup_and_cleans(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "photo.jpg"
            target.write_bytes(make_jpeg())
            report = clean_file(str(target), write=True, backup=True)
            self.assertTrue(report.changed)
            self.assertTrue((Path(tmp) / "photo.jpg.bak").exists())
            self.assertNotIn(b"secretcamera", target.read_bytes())

    def test_gif_left_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "anim.gif"
            original = b"GIF89a" + b"\x00" * 20
            target.write_bytes(original)
            report = clean_file(str(target), write=True, backup=True)
            self.assertFalse(report.changed)
            self.assertEqual(target.read_bytes(), original)
            self.assertTrue(any(f.severity == "warn" for f in report.findings))

    def test_unparseable_left_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "broken.png"
            target.write_bytes(b"not really a png")
            report = clean_file(str(target), write=True, backup=True)
            self.assertFalse(report.changed)
            self.assertEqual(target.read_bytes(), b"not really a png")


if __name__ == "__main__":
    unittest.main()
