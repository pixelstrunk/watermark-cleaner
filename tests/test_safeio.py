import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "python"))
os.environ.setdefault("WATERMARK_CLEANER_RULES_DIR", os.path.join(ROOT, "rules"))

from watermark_cleaner.config import DEFAULTS
from watermark_cleaner.rules import load_rules
from watermark_cleaner.runner import process_text_file
from watermark_cleaner.safeio import write_text_atomic


class AtomicWrites(unittest.TestCase):
    def test_write_replaces_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "a.md"
            target.write_text("old", encoding="utf-8")
            write_text_atomic(str(target), "new")
            self.assertEqual(target.read_text(encoding="utf-8"), "new")
            self.assertEqual(list(Path(tmp).glob("*.watermark-cleaner-tmp")), [])

    def test_write_refuses_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            real = Path(tmp) / "real.md"
            real.write_text("original", encoding="utf-8")
            link = Path(tmp) / "link.md"
            link.symlink_to(real)
            with self.assertRaises(OSError):
                write_text_atomic(str(link), "changed")
            self.assertEqual(real.read_text(encoding="utf-8"), "original")


class RunnerSafety(unittest.TestCase):
    def test_fix_refuses_symlinked_text_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            real = Path(tmp) / "real.md"
            real.write_text("smart “quotes”", encoding="utf-8")
            link = Path(tmp) / "link.md"
            link.symlink_to(real)
            config = dict(DEFAULTS)
            report = process_text_file(str(link), config, load_rules(), write=True)
            self.assertFalse(report.changed)
            self.assertTrue(any(f.kind == "write" and f.severity == "warn" for f in report.findings))
            self.assertEqual(real.read_text(encoding="utf-8"), "smart “quotes”")

    def test_oversized_file_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "big.md"
            target.write_text("x" * 100, encoding="utf-8")
            config = dict(DEFAULTS)
            config["max_file_bytes"] = 10
            report = process_text_file(str(target), config, load_rules(), write=True)
            self.assertTrue(any("max_file_bytes" in f.message for f in report.findings))
            self.assertEqual(target.read_text(encoding="utf-8"), "x" * 100)


if __name__ == "__main__":
    unittest.main()
