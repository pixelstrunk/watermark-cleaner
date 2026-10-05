import re

from ..findings import Finding

_DASH_RANGE = re.compile(r"(?<=\d[ \t])[—–‒―](?=[ \t]\d)")
_DASH_SPACED = re.compile(r"[ \t]+[—–‒―][ \t]+")
_DASH_ANY = re.compile(r"[—–‒―]")
_DOT_RUN = re.compile(r"\.{4,}")


def _translate_group(text, mapping):
    table = {}
    by_rule = {}
    for hex_cp, replacement in mapping.items():
        code = int(hex_cp, 16)
        occurrences = text.count(chr(code))
        if occurrences:
            by_rule[f"U+{code:04X}"] = occurrences
            table[code] = replacement
    if table:
        text = text.translate(table)
    return text, by_rule


def clean(text, config, rules):
    typo = rules["typography"]
    findings = []

    if config.get("straight_quotes", True):
        text, by_rule = _translate_group(text, typo["quotes"])
        if by_rule:
            findings.append(
                Finding("typography", "smart-quote", "fixed", "straightened smart quotes", sum(by_rule.values()), [], by_rule)
            )

    if config.get("fix_dashes", True):
        policy = dict(typo["dash_policy"])
        policy.update(config.get("dash_policy") or {})
        spaced = policy.get("spaced_replacement", ", ")
        unspaced = policy.get("unspaced_replacement", "-")
        text, n_range = _DASH_RANGE.subn("-", text)
        text, n_spaced = _DASH_SPACED.subn(spaced, text)
        text, n_unspaced = _DASH_ANY.subn(unspaced, text)
        total = n_range + n_spaced + n_unspaced
        if total:
            by_rule = {name: n for name, n in (("range", n_range), ("spaced", n_spaced), ("unspaced", n_unspaced)) if n}
            findings.append(
                Finding("typography", "dash", "fixed", "replaced em/en dash per policy", total, [], by_rule)
            )

    if config.get("fix_punctuation", True):
        text, by_rule = _translate_group(text, typo["punctuation"])
        text, dots = _DOT_RUN.subn("...", text)
        if dots:
            by_rule["dot-run"] = dots
        if by_rule:
            findings.append(
                Finding("typography", "punctuation", "fixed", "normalized ellipsis and bullet glyphs", sum(by_rule.values()), [], by_rule)
            )

    return text, findings
