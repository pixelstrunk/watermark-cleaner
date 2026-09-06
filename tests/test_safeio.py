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
from watermark_cleaner.runner import collect_files, process_text_file, run
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


def _root():
    return hasattr(os, "geteuid") and os.geteuid() == 0


class RunResilience(unittest.TestCase):
    @unittest.skipIf(_root(), "permissions are not enforced for root")
    def test_read_only_directory_is_reported_and_the_run_continues(self):
        with tempfile.TemporaryDirectory() as tmp:
            locked = Path(tmp) / "locked"
            locked.mkdir()
            (locked / "a.md").write_text("smart “quotes”", encoding="utf-8")
            free = Path(tmp) / "free.md"
            free.write_text("smart “quotes”", encoding="utf-8")
            locked.chmod(0o555)
            try:
                reports = run([str(tmp)], dict(DEFAULTS, backup=False), write=True)
            finally:
                locked.chmod(0o755)
            by_path = {r.path: r for r in reports}
            self.assertEqual(by_path[str(free)].changed, True)
            self.assertEqual(free.read_text(encoding="utf-8"), 'smart "quotes"')
            locked_report = by_path[str(locked / "a.md")]
            self.assertFalse(locked_report.changed)
            self.assertIn("skipped (permission denied)", [f.message for f in locked_report.findings])
            self.assertEqual((locked / "a.md").read_text(encoding="utf-8"), "smart “quotes”")

    @unittest.skipIf(_root(), "permissions are not enforced for root")
    def test_unreadable_directory_is_reported_as_warning(self):
        with tempfile.TemporaryDirectory() as tmp:
            hidden = Path(tmp) / "hidden"
            hidden.mkdir()
            (hidden / "a.md").write_text("x", encoding="utf-8")
            (Path(tmp) / "b.md").write_text("x", encoding="utf-8")
            hidden.chmod(0o000)
            try:
                reports = run([str(tmp)], dict(DEFAULTS), write=False)
            finally:
                hidden.chmod(0o755)
            messages = {r.path: [f.message for f in r.findings] for r in reports}
            self.assertEqual(messages[str(hidden)], ["skipped (permission denied)"])
            self.assertIn(str(Path(tmp) / "b.md"), messages)

    def test_symlink_to_directory_as_argument_is_scanned(self):
        with tempfile.TemporaryDirectory() as tmp:
            real = Path(tmp) / "real"
            real.mkdir()
            (real / "a.md").write_text("x", encoding="utf-8")
            link = Path(tmp) / "link"
            link.symlink_to(real, target_is_directory=True)
            text_files, _, _, missing, unreadable = collect_files([str(link)], dict(DEFAULTS))
            self.assertEqual([p.name for p in text_files], ["a.md"])
            self.assertEqual(missing, [])
            self.assertEqual(unreadable, [])

    def test_symlinked_directory_inside_tree_is_not_followed(self):
        with tempfile.TemporaryDirectory() as tmp:
            real = Path(tmp) / "real"
            real.mkdir()
            (real / "a.md").write_text("x", encoding="utf-8")
            (Path(tmp) / "loop").symlink_to(real, target_is_directory=True)
            text_files, _, _, _, _ = collect_files([str(tmp)], dict(DEFAULTS))
            self.assertEqual([str(p) for p in text_files], [str(real / "a.md")])
