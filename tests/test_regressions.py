import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "python"))
os.environ.setdefault("WATERMARK_CLEANER_RULES_DIR", os.path.join(ROOT, "rules"))

from watermark_cleaner.config import ConfigError, DEFAULTS, load_config
from watermark_cleaner.core import clean_text
from watermark_cleaner.rules import load_rules
from watermark_cleaner.runner import collect_files, process_text_file
from watermark_cleaner.safeio import write_text_atomic


def clean(text, **overrides):
    config = dict(DEFAULTS)
    config.update(overrides)
    return clean_text(text, config=config)


class CrlfHandling(unittest.TestCase):
    def test_crlf_front_matter_is_protected(self):
        text = '---\r\ntitle: "Foo — Bar"\r\n---\r\n\r\nBody — text.\r\n'
        cleaned, _ = clean(text)
        self.assertIn('title: "Foo — Bar"', cleaned)
        self.assertIn("Body, text.", cleaned)
        self.assertIn("\r\n", cleaned)

    def test_crlf_filler_phrase_removed_and_repaired(self):
        text = "First line.\r\nIt's worth noting that the cache is cold.\r\n"
        cleaned, _ = clean(text)
        self.assertEqual(cleaned, "First line.\r\nThe cache is cold.\r\n")

    def test_crlf_file_round_trips_line_endings(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "doc.md"
            target.write_bytes(b"Body \xe2\x80\x94 text.\r\n")
            config = dict(DEFAULTS)
            config["backup"] = False
            process_text_file(target, config, load_rules(), write=True)
            self.assertEqual(target.read_bytes(), b"Body, text.\r\n")


class ExcludeScoping(unittest.TestCase):
    def test_excluded_name_in_parent_path_does_not_hide_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp) / "build" / "docs"
            base.mkdir(parents=True)
            (base / "a.md").write_text("hello", encoding="utf-8")
            text_files, _, _, _ = collect_files([str(base)], dict(DEFAULTS))
            self.assertEqual(len(text_files), 1)

    def test_excluded_name_below_base_is_still_excluded(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp) / "site"
            (base / "dist").mkdir(parents=True)
            (base / "dist" / "a.md").write_text("hello", encoding="utf-8")
            (base / "b.md").write_text("hello", encoding="utf-8")
            text_files, _, _, _ = collect_files([str(base)], dict(DEFAULTS))
            self.assertEqual([f.name for f in text_files], ["b.md"])

    def test_duplicate_paths_deduplicated(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "a.md"
            target.write_text("hello", encoding="utf-8")
            text_files, _, _, _ = collect_files([str(target), str(target)], dict(DEFAULTS))
            self.assertEqual(len(text_files), 1)


class ConfigValidation(unittest.TestCase):
    def test_non_boolean_value_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "watermark-cleaner.config.json"
            path.write_text('{"voice": 0}', encoding="utf-8")
            with self.assertRaises(ConfigError):
                load_config(start_dir=tmp)

    def test_invalid_json_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "watermark-cleaner.config.json"
            path.write_text("{not json", encoding="utf-8")
            with self.assertRaises(ConfigError):
                load_config(start_dir=tmp)

    def test_valid_config_loads(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "watermark-cleaner.config.json"
            path.write_text(json.dumps({"voice": False, "max_file_bytes": 1024}), encoding="utf-8")
            config = load_config(start_dir=tmp)
            self.assertFalse(config["voice"])
            self.assertEqual(config["max_file_bytes"], 1024)


class PermissionPreservation(unittest.TestCase):
    def test_atomic_write_keeps_mode(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "f.md"
            target.write_text("x", encoding="utf-8")
            os.chmod(target, 0o755)
            write_text_atomic(target, "y")
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o755)
            self.assertEqual(target.read_text(encoding="utf-8"), "y")


class ShapeSeverity(unittest.TestCase):
    def test_warn_shapes_do_not_block(self):
        _, report = clean("Not only fast, but also reliable.")
        shapes = [f for f in report.findings if f.kind == "sentence-shape"]
        self.assertTrue(shapes)
        self.assertEqual(shapes[0].severity, "warn")
        self.assertFalse(report.has_errors)

    def test_error_shapes_still_block(self):
        _, report = clean("This isn't a tool. This is a movement.")
        self.assertTrue(report.has_errors)


class EncryptedOffice(unittest.TestCase):
    def test_encrypted_docx_left_untouched(self):
        import zipfile

        from watermark_cleaner.layers.office import clean_file

        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "enc.docx"
            with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as zf:
                zf.writestr("docProps/core.xml", "<cp:coreProperties><dc:creator>Jane</dc:creator></cp:coreProperties>")
            data = bytearray(target.read_bytes())
            central = data.find(b"PK\x01\x02")
            self.assertGreater(central, 0)
            data[central + 8] |= 0x01
            target.write_bytes(bytes(data))
            original = target.read_bytes()
            report = clean_file(target, write=True, backup=False)
            self.assertEqual(target.read_bytes(), original)
            self.assertTrue(any("could not parse" in f.message for f in report.findings))


class DashPolicy(unittest.TestCase):
    def test_empty_spaced_replacement_honored(self):
        cleaned, _ = clean("fast — slow", dash_policy={"spaced_replacement": ""})
        self.assertEqual(cleaned, "fastslow")


if __name__ == "__main__":
    unittest.main()
