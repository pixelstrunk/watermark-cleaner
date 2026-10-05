import re

from ..findings import Finding

_ENTITY = re.compile(r"&(?:#(\d+)|#[xX]([0-9A-Fa-f]+)|([A-Za-z][A-Za-z0-9]*));")


def _cp(value):
    return int(value, 16)


def _targets(rules):
    spec = rules["characters"].get("html_entities")
    if not spec:
        return None, None, None
    named = {name: _cp(code) for name, code in spec.get("named", {}).items()}
    codes = {_cp(code) for code in spec.get("numeric_codepoints", [])}
    ranges = [(_cp(r["from"]), _cp(r["to"])) for r in spec.get("numeric_ranges", [])]
    return named, codes, ranges


def clean(text, config, rules):
    named, codes, ranges = _targets(rules)
    if named is None or "&" not in text:
        return text, []
    decoded = {}

    def replace(match):
        nonlocal decoded
        decimal, hexadecimal, name = match.groups()
        if name is not None:
            code = named.get(name)
        else:
            code = int(decimal) if decimal is not None else int(hexadecimal, 16)
        if code is None or code > 0x10FFFF:
            return match.group(0)
        if code not in codes and not any(start <= code <= end for start, end in ranges):
            return match.group(0)
        decoded[match.group(0)] = decoded.get(match.group(0), 0) + 1
        return chr(code)

    text = _ENTITY.sub(replace, text)
    findings = []
    if decoded:
        findings.append(
            Finding(
                "entities",
                "html-entity",
                "fixed",
                "decoded html entities of invisible characters (handled by the characters layer)",
                sum(decoded.values()),
                [],
                dict(decoded),
            )
        )
    return text, findings
