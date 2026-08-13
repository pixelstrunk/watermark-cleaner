import re

from ..findings import Finding

_DASH_SPACED = re.compile(r"[ \t]+[—–‒―][ \t]+")
_DASH_ANY = re.compile(r"[—–‒―]")
_DOT_RUN = re.compile(r"\.{4,}")


def _translate_group(text, mapping):
    table = {}
    count = 0
    for hex_cp, replacement in mapping.items():
        code = int(hex_cp, 16)
        occurrences = text.count(chr(code))
        if occurrences:
            count += occurrences
            table[code] = replacement
    if table:
        text = text.translate(table)
    return text, count


def clean(text, config, rules):
    typo = rules["typography"]
    findings = []

    if config.get("straight_quotes", True):
        text, count = _translate_group(text, typo["quotes"])
        if count:
            findings.append(
                Finding("typography", "smart-quote", "fixed", "straightened smart quotes", count)
            )

    if config.get("fix_dashes", True):
        policy = dict(typo["dash_policy"])
        policy.update(config.get("dash_policy") or {})
        spaced = policy.get("spaced_replacement", ", ")
        unspaced = policy.get("unspaced_replacement", "-")
        text, n_spaced = _DASH_SPACED.subn(spaced, text)
        text, n_unspaced = _DASH_ANY.subn(unspaced, text)
        total = n_spaced + n_unspaced
        if total:
            findings.append(
                Finding("typography", "dash", "fixed", "replaced em/en dash per policy", total)
            )

    if config.get("fix_punctuation", True):
        text, count = _translate_group(text, typo["punctuation"])
        text, dots = _DOT_RUN.subn("...", text)
        if count or dots:
            findings.append(
                Finding("typography", "punctuation", "fixed", "normalized ellipsis and bullet glyphs", count + dots)
            )

    return text, findings
