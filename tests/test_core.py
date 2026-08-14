import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "python"))
os.environ.setdefault("WATERMARK_CLEANER_RULES_DIR", os.path.join(ROOT, "rules"))

from watermark_cleaner.config import DEFAULTS, apply_aggressive
from watermark_cleaner.core import clean_text


def clean(text, **overrides):
    config = dict(DEFAULTS)
    config.update(overrides)
    return clean_text(text, config=config)


class CharacterLayer(unittest.TestCase):
    def test_removes_zero_width_space(self):
        cleaned, report = clean("a​b")
        self.assertEqual(cleaned, "ab")
        self.assertTrue(any(f.kind == "invisible-character" for f in report.findings))

    def test_removes_bom_and_word_joiner(self):
        cleaned, _ = clean("x﻿y⁠z")
        self.assertEqual(cleaned, "xyz")

    def test_strips_tag_characters(self):
        cleaned, _ = clean("hi\U000e0041\U000e0042")
        self.assertEqual(cleaned, "hi")

    def test_keeps_zwj_for_emoji(self):
        text = "\U0001f469‍\U0001f4bb"
        cleaned, _ = clean(text)
        self.assertIn("‍", cleaned)

    def test_exotic_space_becomes_ascii(self):
        cleaned, _ = clean("a b")
        self.assertEqual(cleaned, "a b")

    def test_number_nbsp_preserved(self):
        cleaned, _ = clean("12 000")
        self.assertEqual(cleaned, "12 000")

    def test_number_nbsp_dropped_when_disabled(self):
        cleaned, _ = clean("12 000", keep_nbsp_in_numbers=False)
        self.assertEqual(cleaned, "12 000")


class ScriptSafety(unittest.TestCase):
    def test_zwnj_removed_between_latin_letters(self):
        cleaned, _ = clean("water‌mark")
        self.assertEqual(cleaned, "watermark")

    def test_zwnj_kept_in_persian(self):
        cleaned, _ = clean("می‌خواهم")
        self.assertIn("‌", cleaned)

    def test_bidi_mark_removed_in_latin_text(self):
        cleaned, _ = clean("‎foo bar")
        self.assertEqual(cleaned, "foo bar")

    def test_bidi_mark_kept_in_rtl_document(self):
        cleaned, report = clean("שלום ‎ world")
        self.assertIn("‎", cleaned)
        self.assertTrue(any(f.kind == "bidi-control" and f.severity == "warn" for f in report.findings))


class TypographyLayer(unittest.TestCase):
    def test_straightens_quotes(self):
        cleaned, _ = clean("“hi” and ‘yo’")
        self.assertEqual(cleaned, '"hi" and \'yo\'')

    def test_em_dash_spaced(self):
        cleaned, _ = clean("fast — slow")
        self.assertEqual(cleaned, "fast, slow")

    def test_em_dash_unspaced(self):
        cleaned, _ = clean("fast—slow")
        self.assertEqual(cleaned, "fast-slow")

    def test_ellipsis(self):
        cleaned, _ = clean("wait…")
        self.assertEqual(cleaned, "wait...")

    def test_dash_policy_override(self):
        cleaned, _ = clean("fast — slow", dash_policy={"spaced_replacement": " - "})
        self.assertEqual(cleaned, "fast - slow")

    def test_collapse_dot_run(self):
        cleaned, _ = clean("done....")
        self.assertEqual(cleaned, "done...")


class VoiceLayer(unittest.TestCase):
    def test_banned_phrase_blocks(self):
        _, report = clean("We should delve into this.")
        self.assertTrue(report.has_errors)

    def test_sentence_shape_blocks(self):
        _, report = clean("This isn't a tool. This is a movement.")
        self.assertTrue(report.has_errors)

    def test_safe_delete_removes_filler(self):
        cleaned, _ = clean("Without further ado, we ship.")
        self.assertNotIn("further ado", cleaned.lower())
        self.assertEqual(cleaned, "We ship.")

    def test_safe_delete_capitalizes_sentence_start(self):
        cleaned, _ = clean("In conclusion, we did it.")
        self.assertEqual(cleaned, "We did it.")

    def test_safe_delete_across_newline(self):
        cleaned, _ = clean("We did it. It's worth noting that\nthis works.")
        self.assertEqual(cleaned, "We did it.\nThis works.")

    def test_safe_delete_mid_sentence(self):
        cleaned, _ = clean("We ship, without further ado, tomorrow.")
        self.assertEqual(cleaned, "We ship, tomorrow.")

    def test_object_taking_phrase_blocked_not_deleted(self):
        cleaned, report = clean("Let's explore the API together.")
        self.assertEqual(cleaned, "Let's explore the API together.")
        self.assertTrue(report.has_errors)

    def test_lexicon_warns_not_blocks(self):
        _, report = clean("A robust and seamless system.")
        self.assertFalse(report.has_errors)
        self.assertTrue(any(f.severity == "warn" for f in report.findings))

    def test_voice_disabled(self):
        _, report = clean("We should delve into this.", voice=False)
        self.assertFalse(report.has_errors)


class Homoglyphs(unittest.TestCase):
    def test_detects_without_replacing(self):
        cleaned, report = clean("prіce")
        self.assertEqual(cleaned, "prіce")
        self.assertTrue(any(f.kind == "confusable" and f.severity == "warn" for f in report.findings))

    def test_replaces_when_aggressive(self):
        config = apply_aggressive(dict(DEFAULTS))
        cleaned, _ = clean_text("prіce", config=config)
        self.assertEqual(cleaned, "price")


class CodeProtection(unittest.TestCase):
    def test_code_fence_typography_untouched(self):
        text = 'Say “hi”.\n\n```python\nprint(“kept”)\n```\n'
        cleaned, _ = clean(text)
        self.assertIn('Say "hi".', cleaned)
        self.assertIn("print(“kept”)", cleaned)

    def test_inline_code_untouched(self):
        cleaned, _ = clean("Use `--flag — value` here — ok.")
        self.assertIn("`--flag — value`", cleaned)
        self.assertIn("here, ok.", cleaned)

    def test_frontmatter_untouched(self):
        text = '---\ntitle: “Post”\n---\nBody “text”.\n'
        cleaned, _ = clean(text)
        self.assertIn("title: “Post”", cleaned)
        self.assertIn('Body "text".', cleaned)

    def test_invisible_chars_still_removed_inside_code(self):
        cleaned, _ = clean("```\nif user​name == admin\n```")
        self.assertNotIn("​", cleaned)

    def test_voice_skips_code(self):
        _, report = clean("```\nWe delve into this.\n```")
        self.assertFalse(report.has_errors)

    def test_protection_can_be_disabled(self):
        cleaned, _ = clean("`“x”`", protect_code=False)
        self.assertEqual(cleaned, '`"x"`')


class SafeDeleteLocality(unittest.TestCase):
    def test_indentation_preserved(self):
        text = "In conclusion, done.\n\n    indented  code\n"
        cleaned, _ = clean(text)
        self.assertIn("    indented  code", cleaned)

    def test_phrase_before_period(self):
        cleaned, _ = clean("We ship without further ado.")
        self.assertEqual(cleaned, "We ship.")


class CustomRules(unittest.TestCase):
    def test_custom_banned_phrase_blocks(self):
        _, report = clean("Our synergy blaster is live.", custom_banned_phrases=["synergy blaster"])
        self.assertTrue(report.has_errors)

    def test_ignore_phrase_unblocks(self):
        _, report = clean("We delve into this.", ignore_phrases=["delve into", "delve"])
        self.assertFalse(report.has_errors)
        self.assertFalse(any(f.kind == "lexicon" for f in report.findings))

    def test_ignore_sentence_shape(self):
        _, report = clean("This isn't a tool. This is a movement.", ignore_phrases=["this-isnt-this-is"])
        self.assertFalse(report.has_errors)


class DigitParity(unittest.TestCase):
    def test_nbsp_between_non_ascii_digits_replaced(self):
        cleaned, _ = clean("١٢ ٣٤٥")
        self.assertEqual(cleaned, "١٢ ٣٤٥")

    def test_nbsp_between_ascii_digits_kept(self):
        cleaned, _ = clean("12 000")
        self.assertEqual(cleaned, "12 000")


class Idempotency(unittest.TestCase):
    def test_fix_twice_equals_once(self):
        dirty = "In today’s world — “go”​ delve now…"
        once, _ = clean(dirty)
        twice, report = clean(once)
        self.assertEqual(once, twice)
        self.assertFalse(any(f.severity == "fixed" for f in report.findings))


if __name__ == "__main__":
    unittest.main()
