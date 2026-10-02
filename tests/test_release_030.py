import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "python"))
os.environ.setdefault("WATERMARK_CLEANER_RULES_DIR", os.path.join(ROOT, "rules"))

from watermark_cleaner.config import DEFAULTS
from watermark_cleaner.core import clean_text
from watermark_cleaner.layers import metadata, office

ENGLAND = "\U0001F3F4\U000E0067\U000E0062\U000E0065\U000E006E\U000E0067\U000E007F"
SCOTLAND = "\U0001F3F4\U000E0067\U000E0062\U000E0073\U000E0063\U000E0074\U000E007F"


def clean(text, **overrides):
    config = dict(DEFAULTS)
    config.update(overrides)
    return clean_text(text, config=config)


def messages(report):
    return [f.message for f in report.findings]


class FlagSequences(unittest.TestCase):
    def test_subdivision_flags_survive(self):
        text = f"England {ENGLAND} and Scotland {SCOTLAND}."
        cleaned, report = clean(text)
        self.assertEqual(cleaned, text)
        self.assertEqual(report.findings, [])

    def test_tag_characters_outside_flags_are_removed(self):
        cleaned, report = clean("fun\U000E0020ding and hi\U000E0041\U000E007F")
        self.assertEqual(cleaned, "funding and hi")
        self.assertTrue(any("tag characters" in m for m in messages(report)))

    def test_flag_without_cancel_tag_is_a_payload(self):
        cleaned, _ = clean("\U0001F3F4\U000E0067\U000E0062\U000E0065 text")
        self.assertEqual(cleaned, "\U0001F3F4 text")


class DashRanges(unittest.TestCase):
    def test_spaced_dash_between_numbers_becomes_hyphen(self):
        cleaned, _ = clean("Open 10 – 20 Uhr, from 1990 — 2000.")
        self.assertEqual(cleaned, "Open 10 - 20 Uhr, from 1990 - 2000.")

    def test_spaced_dash_between_words_still_follows_policy(self):
        cleaned, _ = clean("fast — slow")
        self.assertEqual(cleaned, "fast, slow")

    def test_typographic_hyphens_become_ascii(self):
        cleaned, _ = clean("E‑Mail and co‐operate")
        self.assertEqual(cleaned, "E-Mail and co-operate")


class FrenchPunctuationSpaces(unittest.TestCase):
    def test_narrow_nbsp_before_high_punctuation_is_kept(self):
        text = "Il dit : bonjour ! «Oui » et 12 000."
        cleaned, _ = clean(text, straight_quotes=False)
        self.assertEqual(cleaned, text)
        cleaned, _ = clean(text)
        self.assertEqual(cleaned, 'Il dit : bonjour ! "Oui " et 12 000.')

    def test_narrow_nbsp_between_words_is_still_replaced(self):
        cleaned, _ = clean("hidden mark")
        self.assertEqual(cleaned, "hidden mark")

    def test_guard_can_be_disabled(self):
        cleaned, _ = clean("Il dit :", keep_nbsp_in_numbers=False)
        self.assertEqual(cleaned, "Il dit :")


class HtmlEntities(unittest.TestCase):
    def test_entity_forms_of_invisibles_are_removed(self):
        text = "<p>Hid&#8203;den &#x200B;more &zwnj;x &shy;y &#65279;z &ZeroWidthSpace;w &nbsp;ok &amp; &lt;</p>"
        cleaned, report = clean(text)
        self.assertEqual(cleaned, "<p>Hidden more x y z w &nbsp;ok &amp; &lt;</p>")
        self.assertTrue(any("decoded html entities" in m for m in messages(report)))

    def test_entities_in_code_are_documentation(self):
        text = "Use `&#8203;` or ``&zwnj;`` to insert one.\n\n```html\n&#8203;\n```\n"
        cleaned, _ = clean(text)
        self.assertEqual(cleaned, text)

    def test_joiner_entities_follow_context_rules(self):
        emoji = "\U0001F468&zwj;\U0001F4BB"
        cleaned, _ = clean(emoji)
        self.assertEqual(cleaned, "\U0001F468‍\U0001F4BB")
        cleaned, _ = clean("wa&zwj;ter")
        self.assertEqual(cleaned, "water")


class PrivateUseAndFillers(unittest.TestCase):
    def test_chatgpt_citation_delimiters_are_removed(self):
        cleaned, report = clean("Paris is the capitalciteturn0search0.")
        self.assertEqual(cleaned, "Paris is the capital.")
        self.assertTrue(any("private use" in m for m in messages(report)))

    def test_supplementary_private_use_and_noncharacters(self):
        cleaned, _ = clean("a\U000F0000b\U0010FFFDc﷐d￾e")
        self.assertEqual(cleaned, "abcde")

    def test_hangul_fillers(self):
        cleaned, _ = clean("AᅟBᅠCㅤDﾠE")
        self.assertEqual(cleaned, "ABCDE")

    def test_grapheme_joiner_kept_next_to_hebrew(self):
        hebrew = "ב͏ְ"
        cleaned, _ = clean(hebrew)
        self.assertEqual(cleaned, hebrew)
        cleaned, _ = clean("a͏b")
        self.assertEqual(cleaned, "ab")

    def test_braille_blank_inside_braille_is_kept(self):
        braille = "⠓⠀⠑"
        cleaned, _ = clean(braille)
        self.assertEqual(cleaned, braille)
        cleaned, _ = clean("a⠀b")
        self.assertEqual(cleaned, "a b")


class VariationSelectors(unittest.TestCase):
    def test_selectors_after_letters_are_payload(self):
        cleaned, report = clean("Hello︁︂\U000E0100 world️")
        self.assertEqual(cleaned, "Hello world")
        self.assertTrue(any("variation selector" in m for m in messages(report)))

    def test_selectors_with_a_real_base_are_kept(self):
        for text in ("❤️", "1️⃣", "辻\U000E0100", "©️", "↔︎", "ᠠ᠋"):
            cleaned, _ = clean(text)
            self.assertEqual(cleaned, text)

    def test_repeated_selectors_after_emoji_are_payload(self):
        cleaned, _ = clean("❤️︁︂")
        self.assertEqual(cleaned, "❤️")

    def test_aggressive_strips_everything(self):
        cleaned, _ = clean("❤️", strip_variation_selectors=True)
        self.assertEqual(cleaned, "❤")


class CopyArtifacts(unittest.TestCase):
    def test_citation_tokens_and_tracking_params(self):
        text = (
            "Fact citeturn0search0 and [cite: 1, 2] and [span_1](start_span)x[span_1](end_span) "
            "and 【4†source】 see https://x.io/a?utm_source=chatgpt.com&b=1 "
            "and https://x.io/b?c=2&utm_source=openai and https://x.io/c?utm_source=perplexity done."
        )
        cleaned, report = clean(text)
        self.assertEqual(
            cleaned,
            "Fact  and  and x and  see https://x.io/a?b=1 and https://x.io/b?c=2 and https://x.io/c done.",
        )
        finding = [f for f in report.findings if f.layer == "artifacts"][0]
        self.assertEqual(finding.severity, "fixed")
        self.assertIn("utm_source-tracking", finding.examples)

    def test_unrelated_utm_sources_are_left_alone(self):
        text = "https://x.io/?utm_source=newsletter"
        cleaned, _ = clean(text)
        self.assertEqual(cleaned, text)

    def test_upload_urls_only_warn(self):
        text = "see https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/x.pdf"
        cleaned, report = clean(text)
        self.assertEqual(cleaned, text)
        self.assertEqual([f.severity for f in report.findings if f.layer == "artifacts"], ["warn"])

    def test_artifacts_inside_code_are_protected(self):
        text = "`citeturn0search0` stays"
        cleaned, _ = clean(text)
        self.assertEqual(cleaned, text)


class DoubleBacktickCode(unittest.TestCase):
    def test_double_backtick_span_is_protected(self):
        text = "Use `` a ` b “x” `` here “y”"
        cleaned, _ = clean(text)
        self.assertEqual(cleaned, 'Use `` a ` b “x” `` here "y"')


class VoiceRules(unittest.TestCase):
    def test_chat_residue_blocks(self):
        _, report = clean("Certainly! Here's the plan. I hope this helps! Let me know if you need more.")
        banned = [f for f in report.findings if f.kind == "banned-phrase"][0]
        self.assertEqual(banned.count, 3)

    def test_participial_tail_and_copula_warn(self):
        _, report = clean("We shipped it, highlighting the importance of focus. The library serves as a bridge.")
        warns = [f for f in report.findings if f.kind == "sentence-shape" and f.severity == "warn"][0]
        self.assertEqual(sorted(warns.examples), ["copula-avoidance", "participial-tail"])

    def test_german_rules(self):
        _, report = clean("In der heutigen digitalen Welt ist das essenziell. Es geht nicht um Tools. Es geht um Haltung.")
        kinds = {(f.kind, f.severity) for f in report.findings}
        self.assertIn(("banned-phrase", "error"), kinds)
        self.assertIn(("sentence-shape", "error"), kinds)
        self.assertIn(("lexicon", "warn"), kinds)

    def test_every_shape_matches_its_example(self):
        from watermark_cleaner.rules import load_rules
        import re

        for shape in load_rules()["phrases"]["sentence_shapes"]:
            self.assertTrue(re.search(shape["pattern"], shape["example"], re.IGNORECASE), shape["id"])


def make_zip(parts, streamed=False):
    if not streamed:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, content in parts.items():
                zf.writestr(name, content)
        return buffer.getvalue()

    class NoSeek(io.RawIOBase):
        def __init__(self):
            self.buf = bytearray()

        def writable(self):
            return True

        def seekable(self):
            return False

        def write(self, data):
            self.buf += data
            return len(data)

    stream = NoSeek()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in parts.items():
            zf.writestr(name, content)
    return bytes(stream.buf)


CORE = '<cp:coreProperties xmlns:cp="cp" xmlns:dc="dc"><dc:title>T</dc:title><dc:creator>Jane</dc:creator><cp:lastModifiedBy>Jane</cp:lastModifiedBy></cp:coreProperties>'
APP = '<Properties><Application>Microsoft Office PowerPoint</Application><Company>Acme</Company></Properties>'


class OfficeFormats(unittest.TestCase):
    def path(self, name, data):
        self.tmp = tempfile.TemporaryDirectory()
        p = Path(self.tmp.name) / name
        p.write_bytes(data)
        return p

    def test_pptx_authors_are_blanked(self):
        parts = {
            "[Content_Types].xml": "<Types/>",
            "docProps/core.xml": CORE,
            "docProps/app.xml": APP,
            "ppt/commentAuthors.xml": '<p:cmAuthorLst xmlns:p="p"><p:cmAuthor id="0" name="Jane Doe" initials="JD" lastIdx="1" clrIdx="0"/></p:cmAuthorLst>',
            "ppt/authors.xml": '<p188:authorLst xmlns:p188="p"><p188:author id="{1}" name="Jane Doe" initials="JD" userId="jane@acme" providerId="AD"/></p188:authorLst>',
            "ppt/slides/slide1.xml": "<p:sld>Hello</p:sld>",
        }
        p = self.path("deck.pptx", make_zip(parts))
        report = office.clean_file(p, write=True, backup=False)
        self.assertTrue(report.changed)
        with zipfile.ZipFile(p) as zf:
            self.assertNotIn("Jane", zf.read("docProps/core.xml").decode())
            self.assertNotIn("PowerPoint", zf.read("docProps/app.xml").decode())
            self.assertIn('name="" initials=""', zf.read("ppt/commentAuthors.xml").decode())
            self.assertIn('userId="" providerId=""', zf.read("ppt/authors.xml").decode())
            self.assertEqual(zf.read("ppt/slides/slide1.xml").decode(), "<p:sld>Hello</p:sld>")

    def test_xlsx_comment_authors_and_persons(self):
        parts = {
            "[Content_Types].xml": "<Types/>",
            "docProps/core.xml": CORE,
            "xl/workbook.xml": "<workbook/>",
            "xl/comments1.xml": "<comments><authors><author>Jane Doe</author></authors><commentList/></comments>",
            "xl/persons/person.xml": '<personList><person displayName="Jane Doe" id="{1}" userId="jane@acme" providerId="AD"/></personList>',
        }
        p = self.path("sheet.xlsx", make_zip(parts))
        office.clean_file(p, write=True, backup=False)
        with zipfile.ZipFile(p) as zf:
            self.assertIn("<author></author>", zf.read("xl/comments1.xml").decode())
            self.assertIn('displayName=""', zf.read("xl/persons/person.xml").decode())
            self.assertEqual(zf.read("xl/workbook.xml").decode(), "<workbook/>")

    def test_odp_and_ods_use_the_opendocument_rules(self):
        for suffix in ("deck.odp", "sheet.ods"):
            parts = {
                "mimetype": "application/vnd.oasis.opendocument.presentation",
                "meta.xml": '<office:document-meta xmlns:meta="m" xmlns:dc="dc"><office:meta><meta:generator>Impress</meta:generator><dc:creator>Jane</dc:creator></office:meta></office:document-meta>',
                "content.xml": "<office:document-content>Hello</office:document-content>",
            }
            p = self.path(suffix, make_zip(parts))
            report = office.clean_file(p, write=True, backup=False)
            self.assertTrue(report.changed, suffix)
            with zipfile.ZipFile(p) as zf:
                self.assertNotIn("Jane", zf.read("meta.xml").decode())
                self.assertEqual(zf.testzip(), None)

    def test_streamed_entries_get_consistent_local_headers(self):
        parts = {"[Content_Types].xml": "<Types/>", "docProps/core.xml": CORE, "word/document.xml": "<w:document>Hello</w:document>"}
        data = make_zip(parts, streamed=True)
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            self.assertTrue(all(info.flag_bits & 0x08 for info in zf.infolist()))
        p = self.path("streamed.docx", data)
        office.clean_file(p, write=True, backup=False)
        cleaned = p.read_bytes()
        offset = 0
        entries = 0
        while cleaned[offset:offset + 4] == b"PK\x03\x04":
            flags, method = struct.unpack("<HH", cleaned[offset + 6:offset + 10])
            crc, csize, usize = struct.unpack("<III", cleaned[offset + 14:offset + 26])
            name_len, extra_len = struct.unpack("<HH", cleaned[offset + 26:offset + 30])
            self.assertEqual(flags & 0x08, 0)
            self.assertGreater(csize, 0)
            self.assertGreater(usize, 0)
            offset += 30 + name_len + extra_len + csize
            entries += 1
        self.assertEqual(entries, 3)
        with zipfile.ZipFile(p) as zf:
            self.assertEqual(zf.testzip(), None)

    def test_pdf_is_reported_not_rewritten(self):
        data = b"%PDF-1.4\n1 0 obj<</Author(Jane)/Producer(Acrobat)>>endobj\ntrailer<</Info 1 0 R>>\n%%EOF\n"
        p = self.path("scan.pdf", data)
        report = office.clean_file(p, write=True, backup=False)
        self.assertFalse(report.changed)
        self.assertEqual(p.read_bytes(), data)
        self.assertEqual(report.findings[0].severity, "warn")
        self.assertIn("pdf metadata present", report.findings[0].message)
        self.assertEqual(report.findings[0].count, 2)

    def test_heic_is_reported_as_unsupported(self):
        p = self.path("photo.heic", b"\x00\x00\x00\x18ftypheic")
        report = metadata.clean_file(p, write=True, backup=False)
        self.assertFalse(report.changed)
        self.assertIn("not supported", report.findings[0].message)

    def test_inspect_mode_counts_as_would_change(self):
        p = self.path("deck.pptx", make_zip({"docProps/core.xml": CORE, "ppt/slides/slide1.xml": "<p:sld/>"}))
        report = office.inspect_file(p)
        self.assertTrue(report.changed)
        self.assertEqual(report.findings[0].severity, "fixed")


class CliBehaviour(unittest.TestCase):
    def run_cli(self, args, stdin=None):
        env = dict(os.environ, PYTHONPATH=os.path.join(ROOT, "python"))
        return subprocess.run(
            [sys.executable, "-m", "watermark_cleaner.cli", *args],
            input=stdin,
            capture_output=True,
            env=env,
            cwd=ROOT,
        )

    def test_fix_from_stdin_writes_cleaned_text_to_stdout(self):
        result = self.run_cli(["fix", "-"], stdin="Hel​lo “world”\n".encode("utf-8"))
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.decode("utf-8"), 'Hello "world"\n')
        self.assertIn("<stdin>", result.stderr.decode("utf-8"))
        self.assertIn("1 changed", result.stderr.decode("utf-8"))

    def test_check_from_stdin_reports_on_stdout(self):
        result = self.run_cli(["check", "-"], stdin="in today's fast-paced world\n".encode("utf-8"))
        self.assertEqual(result.returncode, 1)
        self.assertIn("ai phrases present", result.stdout.decode("utf-8"))

    def test_stdin_cannot_be_mixed_with_paths(self):
        result = self.run_cli(["fix", "-", "README.md"], stdin=b"x")
        self.assertEqual(result.returncode, 2)

    def test_check_strict_fails_on_would_fix(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "a.md"
            p.write_text("te​st\n", encoding="utf-8")
            self.assertEqual(self.run_cli(["check", str(p), "--quiet"]).returncode, 0)
            self.assertEqual(self.run_cli(["check", str(p), "--quiet", "--strict"]).returncode, 1)
            p.write_text("clean\n", encoding="utf-8")
            self.assertEqual(self.run_cli(["check", str(p), "--quiet", "--strict"]).returncode, 0)


if __name__ == "__main__":
    unittest.main()
