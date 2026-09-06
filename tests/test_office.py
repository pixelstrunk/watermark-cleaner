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


DOCX_TRACKED = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:document xmlns:w="w"><w:body><w:p>'
    '<w:ins w:id="1" w:author="Carol Reviewer" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Hello</w:t></w:r></w:ins>'
    '<w:del w:id="2" w:author="Carol Reviewer" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>Bye</w:delText></w:r></w:del>'
    "</w:p></w:body></w:document>"
)
DOCX_COMMENTS = (
    '<w:comments xmlns:w="w"><w:comment w:id="0" w:author="Dave Editor" w:initials="DE" w:date="2026-01-01T00:00:00Z">'
    "<w:p><w:r><w:t>Looks good</w:t></w:r></w:p></w:comment></w:comments>"
)
DOCX_PEOPLE = (
    '<w15:people xmlns:w15="w15"><w15:person w15:author="Dave Editor">'
    '<w15:presenceInfo w15:providerId="Windows Live" w15:userId="dave@example.com"/></w15:person></w15:people>'
)
DOCX_APP_FULL = (
    '<Properties xmlns="app"><Application>Microsoft Office Word</Application><AppVersion>16.0000</AppVersion>'
    "<Template>Acme_Letterhead.dotm</Template><TotalTime>1342</TotalTime><Pages>3</Pages></Properties>"
)
ODT_CONTENT_ANNOTATED = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<office:document-content xmlns:office="office" xmlns:dc="dc" xmlns:text="text"><office:body>'
    "<office:annotation><dc:creator>Jane Doe</dc:creator><dc:date>2026-01-01</dc:date><text:p>Check this</text:p></office:annotation>"
    "<text:tracked-changes><text:changed-region><text:insertion><office:change-info><dc:creator>Jane Doe</dc:creator>"
    "<dc:date>2026-01-01</dc:date></office:change-info></text:insertion></text:changed-region></text:tracked-changes>"
    "Hello world</office:body></office:document-content>"
)
ODT_META_FULL = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<office:document-meta xmlns:office="office" xmlns:dc="dc" xmlns:meta="meta"><office:meta>'
    "<meta:generator>SomeWordProcessor/1.0</meta:generator><dc:creator>Jane Doe</dc:creator>"
    "<meta:editing-duration>PT2H14M</meta:editing-duration><meta:printed-by>Jane Doe</meta:printed-by>"
    "<meta:editing-cycles>12</meta:editing-cycles></office:meta></office:document-meta>"
)


def make_tracked_docx(path):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", CONTENT_TYPES)
        zf.writestr("word/document.xml", DOCX_TRACKED)
        zf.writestr("word/comments.xml", DOCX_COMMENTS)
        zf.writestr("word/people.xml", DOCX_PEOPLE)
        zf.writestr("word/media/image1.xml", '<x author="not a word part"/>')
        zf.writestr("docProps/core.xml", "<cp:coreProperties/>")
        zf.writestr("docProps/app.xml", DOCX_APP_FULL)


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

    def test_docx_blanks_authors_in_changes_comments_and_people(self):
        path = self.path("tracked.docx")
        make_tracked_docx(path)
        report = clean_file(path, write=True, backup=False)
        self.assertTrue(report.changed)
        with zipfile.ZipFile(path) as zf:
            document = zf.read("word/document.xml").decode()
            comments = zf.read("word/comments.xml").decode()
            people = zf.read("word/people.xml").decode()
            app = zf.read("docProps/app.xml").decode()
            media = zf.read("word/media/image1.xml").decode()
        for part in (document, comments, people):
            self.assertNotIn("Carol", part)
            self.assertNotIn("Dave", part)
        self.assertIn('w:author=""', document)
        self.assertIn("<w:t>Hello</w:t>", document)
        self.assertIn("<w:delText>Bye</w:delText>", document)
        self.assertIn('w:initials=""', comments)
        self.assertIn("Looks good", comments)
        self.assertEqual(people, '<w15:people xmlns:w15="w15"></w15:people>')
        self.assertNotIn("AppVersion", app)
        self.assertNotIn("Acme_Letterhead", app)
        self.assertNotIn("TotalTime", app)
        self.assertIn("<Pages>3</Pages>", app)
        self.assertEqual(media, '<x author="not a word part"/>')
        self.assertEqual(report.findings[0].count, 2 + 2 + 1 + 4)

    def test_odt_empties_creators_in_annotations_and_changes(self):
        path = self.path("annotated.odt")
        make_odt(path, meta=ODT_META_FULL, content=ODT_CONTENT_ANNOTATED)
        report = clean_file(path, write=True, backup=False)
        self.assertTrue(report.changed)
        with zipfile.ZipFile(path) as zf:
            content = zf.read("content.xml").decode()
            meta = zf.read("meta.xml").decode()
        self.assertNotIn("Jane Doe", content)
        self.assertEqual(content.count("<dc:creator></dc:creator>"), 2)
        self.assertIn("<text:p>Check this</text:p>", content)
        self.assertIn("Hello world", content)
        self.assertNotIn("Jane Doe", meta)
        self.assertNotIn("editing-duration", meta)
        self.assertIn("<meta:editing-cycles>12</meta:editing-cycles>", meta)
        self.assertEqual(report.findings[0].count, 2 + 4)

    def test_unsupported_extension_is_noop(self):
        p = self.path("plain.txt")
        p.write_text("hello")
        report = clean_file(p, write=True, backup=False)
        self.assertFalse(report.changed)
        self.assertEqual(report.findings, [])


if __name__ == "__main__":
    unittest.main()
