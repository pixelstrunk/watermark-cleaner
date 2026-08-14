import io
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "python"))
os.environ.setdefault("WATERMARK_CLEANER_RULES_DIR", os.path.join(ROOT, "rules"))

from watermark_cleaner.layers.office import clean_file, inspect_file

DOCX_CORE = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<cp:coreProperties xmlns:cp="cp" xmlns:dc="dc">'
    "<dc:title>Quarterly Report</dc:title>"
    "<dc:creator>Jane Doe</dc:creator>"
    "<cp:lastModifiedBy>Jane Doe</cp:lastModifiedBy>"
    "</cp:coreProperties>"
)
DOCX_APP = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Properties xmlns="app">'
    "<Application>Microsoft Office Word</Application>"
    "<Company>Acme Inc</Company>"
    "<Manager>Jane Doe</Manager>"
    "</Properties>"
)
DOCX_DOCUMENT = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Hello world</w:t></w:r></w:p></w:body></w:document>'
)
CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="ct"><Default Extension="xml" ContentType="application/xml"/></Types>'
)

ODT_META = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<office:document-meta xmlns:office="office" xmlns:dc="dc" xmlns:meta="meta">'
    "<office:meta>"
    "<meta:generator>SomeWordProcessor/1.0</meta:generator>"
    "<meta:initial-creator>Jane Doe</meta:initial-creator>"
    "<dc:creator>Jane Doe</dc:creator>"
    "</office:meta>"
    "</office:document-meta>"
)
ODT_CONTENT = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<office:document-content xmlns:office="office"><office:body>Hello world</office:body></office:document-content>'
)
ODT_MIMETYPE = "application/vnd.oasis.opendocument.text"
ODT_MANIFEST = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<manifest:manifest xmlns:manifest="manifest">'
    '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>'
    "</manifest:manifest>"
)


def make_docx(path, core=DOCX_CORE, app=DOCX_APP, document=DOCX_DOCUMENT):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", CONTENT_TYPES)
        zf.writestr("_rels/.rels", "<Relationships/>")
        zf.writestr("word/document.xml", document)
        zf.writestr("docProps/core.xml", core)
        zf.writestr("docProps/app.xml", app)


def make_odt(path, meta=ODT_META, content=ODT_CONTENT):
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr(zipfile.ZipInfo("mimetype"), ODT_MIMETYPE, zipfile.ZIP_STORED)
        zf.writestr("META-INF/manifest.xml", ODT_MANIFEST, zipfile.ZIP_DEFLATED)
        zf.writestr("content.xml", content, zipfile.ZIP_DEFLATED)
        zf.writestr("meta.xml", meta, zipfile.ZIP_DEFLATED)


class OfficeMetadataTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def path(self, name):
        return Path(self.tmp.name) / name

    def test_docx_strips_author_and_app_metadata_and_preserves_body(self):
        p = self.path("report.docx")
        make_docx(p)
        report = clean_file(p, write=True, backup=False)
        self.assertTrue(report.changed)
        counts = report.counts()
        self.assertEqual(counts["fixed"], 5)

        with zipfile.ZipFile(p) as zf:
            core = zf.read("docProps/core.xml").decode("utf-8")
            app = zf.read("docProps/app.xml").decode("utf-8")
            document = zf.read("word/document.xml").decode("utf-8")

        self.assertNotIn("Jane Doe", core)
        self.assertIn("Quarterly Report", core)
        self.assertNotIn("Microsoft Office Word", app)
        self.assertNotIn("Acme Inc", app)
        self.assertEqual(document, DOCX_DOCUMENT)

    def test_odt_strips_creator_and_generator_and_preserves_mimetype_first(self):
        p = self.path("notes.odt")
        make_odt(p)
        report = clean_file(p, write=True, backup=False)
        self.assertTrue(report.changed)

        with zipfile.ZipFile(p) as zf:
            names = zf.namelist()
            meta = zf.read("meta.xml").decode("utf-8")
            content = zf.read("content.xml").decode("utf-8")
            mimetype_info = zf.getinfo("mimetype")

        self.assertEqual(names[0], "mimetype")
        self.assertEqual(mimetype_info.compress_type, zipfile.ZIP_STORED)
        self.assertNotIn("Jane Doe", meta)
        self.assertNotIn("SomeWordProcessor", meta)
        self.assertEqual(content, ODT_CONTENT)

    def test_already_clean_docx_is_left_untouched(self):
        p = self.path("clean.docx")
        core = DOCX_CORE.replace("Jane Doe", "").replace("<dc:creator></dc:creator>", "").replace(
            "<cp:lastModifiedBy></cp:lastModifiedBy>", ""
        )
        app = '<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="app"></Properties>'
        make_docx(p, core=core, app=app)
        original_bytes = p.read_bytes()
        report = clean_file(p, write=True, backup=False)
        self.assertFalse(report.changed)
        self.assertEqual(p.read_bytes(), original_bytes)
        self.assertFalse((p.with_suffix(".docx.bak")).exists())

    def test_inspect_mode_does_not_write(self):
        p = self.path("report.docx")
        make_docx(p)
        original_bytes = p.read_bytes()
        report = inspect_file(p)
        self.assertFalse(report.changed)
        counts = report.counts()
        self.assertEqual(counts["warn"], 5)
        self.assertEqual(p.read_bytes(), original_bytes)

    def test_corrupt_zip_reports_warning_and_leaves_file_untouched(self):
        p = self.path("broken.docx")
        p.write_bytes(b"not actually a zip file")
        original_bytes = p.read_bytes()
        report = clean_file(p, write=True, backup=False)
        self.assertFalse(report.changed)
        self.assertEqual(p.read_bytes(), original_bytes)
        messages = [f.message for f in report.findings]
        self.assertTrue(any("could not parse" in m for m in messages))

    def test_backup_created_when_enabled(self):
        p = self.path("report.docx")
        make_docx(p)
        clean_file(p, write=True, backup=True)
        backup = p.with_suffix(".docx.bak")
        self.assertTrue(backup.exists())

    def test_unsupported_extension_is_noop(self):
        p = self.path("plain.txt")
        p.write_text("hello")
        report = clean_file(p, write=True, backup=False)
        self.assertFalse(report.changed)
        self.assertEqual(report.findings, [])


if __name__ == "__main__":
    unittest.main()
