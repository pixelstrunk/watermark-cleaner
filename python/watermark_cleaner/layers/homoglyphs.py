import re

from ..findings import Finding

_WORD = re.compile(r"[^\W\d_]+")
_LATIN_RANGES = ((0x41, 0x5A), (0x61, 0x7A), (0xC0, 0xD6), (0xD8, 0xF6), (0xF8, 0x24F), (0x1E00, 0x1EFF))
_CONFUSABLE_SCRIPT_RANGES = ((0x370, 0x3FF), (0x400, 0x52F))


def _in_ranges(code, ranges):
    return any(start <= code <= end for start, end in ranges)


def _classify_word(word, table):
    has_latin = False
    has_confusable = False
    has_genuine_foreign = False
    for char in word:
        code = ord(char)
        if code in table:
            has_confusable = True
        elif _in_ranges(code, _LATIN_RANGES):
            has_latin = True
        elif _in_ranges(code, _CONFUSABLE_SCRIPT_RANGES):
            has_genuine_foreign = True
    return has_latin, has_confusable, has_genuine_foreign


def _suspicious_words(text, table):
    classified = [(match, *_classify_word(match.group(0), table)) for match in _WORD.finditer(text)]
    document_has_foreign_script = any(genuine for _, _, _, genuine in classified)
    suspicious = []
    for match, has_latin, has_confusable, has_genuine_foreign in classified:
        if not has_confusable or has_genuine_foreign:
            continue
        if has_latin or not document_has_foreign_script:
            suspicious.append(match)
    return suspicious


def clean(text, config, rules):
    mapping = rules["homoglyphs"]["confusables"]
    table = {int(hex_cp, 16): replacement for hex_cp, replacement in mapping.items()}
    findings = []

    suspicious = _suspicious_words(text, table)
    seen = set()
    total = 0
    for match in suspicious:
        for char in match.group(0):
            code = ord(char)
            if code in table:
                seen.add(code)
                total += 1

    if not total:
        return text, findings

    if config.get("replace_homoglyphs", False):
        parts = []
        last = 0
        for match in suspicious:
            parts.append(text[last:match.start()])
            parts.append(match.group(0).translate(table))
            last = match.end()
        parts.append(text[last:])
        text = "".join(parts)
        findings.append(
            Finding("homoglyphs", "confusable", "fixed", "replaced look-alike letters with ascii", total)
        )
    else:
        ordered = [int(hex_cp, 16) for hex_cp in mapping if int(hex_cp, 16) in seen]
        examples = [f"U+{code:04X}" for code in ordered[:8]]
        findings.append(
            Finding(
                "homoglyphs",
                "confusable",
                "warn",
                "look-alike letters found (enable replace_homoglyphs or --aggressive to fix)",
                total,
                examples,
            )
        )
    return text, findings
