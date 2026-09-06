import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "python"))
os.environ.setdefault("WATERMARK_CLEANER_RULES_DIR", os.path.join(ROOT, "rules"))

from watermark_cleaner.config import DEFAULTS, apply_aggressive
from watermark_cleaner.core import clean_text
from watermark_cleaner.rules import load_rules


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


class GuardedSpaces(unittest.TestCase):
    def test_nbsp_next_to_digits_and_units_kept(self):
        for text in ["10\u00a0%", "5\u00a0kg", "\u00a7\u00a05", "20\u00a0Euro", "Nr.\u00a05", "Kapitel\u00a03", "12\u00a0000"]:
            with self.subTest(text=text):
                cleaned, _ = clean(text)
                self.assertEqual(cleaned, text)

    def test_nbsp_after_ordinal_and_in_abbreviations_kept(self):
        for text in ["am 5.\u00a0Mai", "z.\u00a0B. so", "d.\u00a0h. nie", "i.\u00a0d.\u00a0R. oft", "o.\u00a0\u00c4. auch"]:
            with self.subTest(text=text):
                cleaned, _ = clean(text)
                self.assertEqual(cleaned, text)

    def test_nbsp_between_words_and_sentences_replaced(self):
        for text, expected in [
            ("Hallo\u00a0Welt", "Hallo Welt"),
            ("Ende.\u00a0Neuer Satz.", "Ende. Neuer Satz."),
            ("Dr.\u00a0M\u00fcller", "Dr. M\u00fcller"),
            ("Abs.\u00a0Text", "Abs. Text"),
        ]:
            with self.subTest(text=text):
                cleaned, _ = clean(text)
                self.assertEqual(cleaned, expected)

    def test_guard_disabled_replaces_everything(self):
        cleaned, _ = clean("10\u00a0% z.\u00a0B.", keep_nbsp_in_numbers=False)
        self.assertEqual(cleaned, "10 % z. B.")


class HiddenCharacterCoverage(unittest.TestCase):
    def test_zwj_between_latin_letters_removed(self):
        cleaned, report = clean("wa\u200dter\u200dmark")
        self.assertEqual(cleaned, "watermark")
        self.assertEqual(report.findings[0].count, 2)
        self.assertIn("zero width joiner", report.findings[0].message)

    def test_zwj_kept_in_emoji_and_indic_sequences(self):
        for text in ["\U0001f468\u200d\U0001f469\u200d\U0001f467", "\u2764\ufe0f\u200d\U0001f525", "\u0915\u094d\u200d\u0937"]:
            with self.subTest(text=text):
                cleaned, _ = clean(text)
                self.assertEqual(cleaned, text)

    def test_deprecated_format_and_annotation_characters_removed(self):
        cleaned, _ = clean("a\u206ab\u206fc\ufff9d\ufffae\ufffbf\u3164g\uffa0h")
        self.assertEqual(cleaned, "abcdefgh")

    def test_line_separators_and_braille_blank_become_spaces(self):
        cleaned, _ = clean("one\u2028two\u2029three\u2800four")
        self.assertEqual(cleaned, "one two three four")

    def test_mongolian_selectors_only_stripped_when_aggressive(self):
        kept, _ = clean("a\u180bb")
        self.assertEqual(kept, "a\u180bb")
        stripped, _ = clean("a\u180bb", strip_variation_selectors=True)
        self.assertEqual(stripped, "ab")


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


class HomoglyphScriptContext(unittest.TestCase):
    def test_pure_cyrillic_text_is_not_flagged(self):
        text = "Привет, это обычный русский текст."
        cleaned, report = clean(text, replace_homoglyphs=True)
        self.assertEqual(cleaned, text)
        self.assertEqual(report.findings, [])

    def test_pure_greek_text_is_not_flagged(self):
        text = "Αθήνα και Βόρεια Ελλάδα"
        cleaned, report = clean(text, replace_homoglyphs=True)
        self.assertEqual(cleaned, text)
        self.assertEqual(report.findings, [])

    def test_mixed_script_word_is_flagged_and_replaced(self):
        cleaned, report = clean("log in at pаypal now", replace_homoglyphs=True)
        self.assertEqual(cleaned, "log in at paypal now")
        self.assertEqual(report.findings[0].count, 1)

    def test_all_confusable_word_in_latin_document_is_flagged(self):
        cleaned, report = clean("Visit СОРЕ today", replace_homoglyphs=True)
        self.assertEqual(cleaned, "Visit COPE today")
        self.assertEqual(report.findings[0].count, 4)

    def test_all_confusable_word_next_to_genuine_cyrillic_is_kept(self):
        text = "Слово а значит and"
        cleaned, report = clean(text, replace_homoglyphs=True)
        self.assertEqual(cleaned, text)
        self.assertEqual(report.findings, [])

    def test_mixed_word_inside_cyrillic_document_is_still_flagged(self):
        cleaned, report = clean("Привет, log in at pаypal", replace_homoglyphs=True)
        self.assertEqual(cleaned, "Привет, log in at paypal")
        self.assertEqual(report.findings[0].count, 1)


class SentenceShapeRulebook(unittest.TestCase):
    def test_every_shape_matches_its_own_example(self):
        for shape in load_rules()["phrases"]["sentence_shapes"]:
            with self.subTest(shape=shape["id"]):
                _, report = clean(shape["example"])
                ids = [i for f in report.findings if f.kind == "sentence-shape" for i in f.examples]
                self.assertIn(shape["id"], ids)

    def test_period_separated_shapes_block(self):
        for text in [
            "Agile is dead. Flow is the future.",
            "Stop thinking features. Start thinking jobs.",
            "The question isn't how. The question is why.",
            "You don't need more tools. You need focus.",
        ]:
            with self.subTest(text=text):
                _, report = clean(text)
                self.assertTrue(report.has_blocking)

    def test_comma_separated_shapes_still_block(self):
        _, report = clean("Agile is dead, flow is the future.")
        self.assertTrue(report.has_blocking)

    def test_unrelated_sentences_do_not_block(self):
        _, report = clean("Agile is dead. We moved on. Years later, nobody asked what is the future.")
        self.assertFalse(report.has_blocking)


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
