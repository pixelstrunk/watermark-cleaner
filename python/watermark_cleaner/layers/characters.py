import unicodedata

from ..findings import Finding


def _cp(value):
    return int(value, 16)


def _ranges(entries):
    return [(_cp(e["from"]), _cp(e["to"])) for e in entries]


def _in_ranges(code, ranges):
    return any(start <= code <= end for start, end in ranges)


_LATIN_LETTER_RANGES = ((0x41, 0x5A), (0x61, 0x7A), (0xC0, 0xD6), (0xD8, 0xF6), (0xF8, 0x24F))


def _is_digit(char):
    return "0" <= char <= "9"


def _is_letter(char):
    return bool(char) and _in_ranges(ord(char), _LATIN_LETTER_RANGES)


def _guarded_space(text, index):
    prev_char = text[index - 1] if index > 0 else ""
    next_char = text[index + 1] if index + 1 < len(text) else ""
    if _is_digit(prev_char) or _is_digit(next_char):
        return True
    if prev_char != "." or index < 2 or not _is_letter(next_char):
        return False
    before_dot = text[index - 2]
    if _is_digit(before_dot):
        return True
    single_letter = index < 3 or not _is_letter(text[index - 3])
    closes_abbreviation = index + 2 < len(text) and text[index + 2] == "."
    return _is_letter(before_dot) and single_letter and closes_abbreviation


def _build_removal(rules, config):
    chars = rules["characters"]
    names = {}
    removal = set()
    for entry in chars["remove_always"]:
        code = _cp(entry["cp"])
        removal.add(code)
        names[code] = entry["name"]
    for entry in chars["remove_ranges"]:
        start = _cp(entry["from"])
        end = _cp(entry["to"])
        for code in range(start, end + 1):
            removal.add(code)
            names[code] = entry["name"]
    if config.get("strip_variation_selectors"):
        vs = chars["variation_selectors"]
        for code in range(_cp(vs["from"]), _cp(vs["to"]) + 1):
            removal.add(code)
            names[code] = "variation selector"
        for code in range(_cp(vs["supplementary_from"]), _cp(vs["supplementary_to"]) + 1):
            removal.add(code)
            names[code] = "variation selector"
        if "mongolian_from" in vs:
            for code in range(_cp(vs["mongolian_from"]), _cp(vs["mongolian_to"]) + 1):
                removal.add(code)
                names[code] = "variation selector"
    return removal, names


def _build_bidi(rules):
    chars = rules["characters"]
    names = {}
    bidi = set()
    for entry in chars.get("bidi_marks", []):
        code = _cp(entry["cp"])
        bidi.add(code)
        names[code] = entry["name"]
    for entry in chars.get("bidi_control_ranges", []):
        for code in range(_cp(entry["from"]), _cp(entry["to"]) + 1):
            bidi.add(code)
            names[code] = entry["name"]
    return bidi, names


def clean(text, config, rules):
    chars = rules["characters"]
    removal, names = _build_removal(rules, config)
    bidi, bidi_names = _build_bidi(rules)
    exotic = {_cp(c) for c in chars["exotic_spaces_to_ascii"]}
    guards = {_cp(c) for c in chars.get("number_space_guard", [])}
    keep_numbers = config.get("keep_nbsp_in_numbers", True)

    zwnj = _cp(chars["zwnj"]["cp"]) if "zwnj" in chars else None
    zwnj_name = chars.get("zwnj", {}).get("name", "zero width non-joiner")
    zwj = _cp(chars["zwj"]["cp"]) if "zwj" in chars else None
    zwj_name = chars.get("zwj", {}).get("name", "zero width joiner")
    joining = _ranges(chars.get("joining_script_ranges", []))
    emoji = _ranges(chars.get("emoji_ranges", []))
    rtl = _ranges(chars.get("rtl_ranges", []))
    has_rtl = any(_in_ranges(ord(ch), rtl) for ch in text)

    out = []
    removed = {}
    kept_bidi = 0
    replaced_spaces = 0
    length = len(text)

    for index, char in enumerate(text):
        code = ord(char)
        if code == zwnj:
            prev_code = ord(text[index - 1]) if index > 0 else -1
            next_code = ord(text[index + 1]) if index + 1 < length else -1
            if _in_ranges(prev_code, joining) or _in_ranges(next_code, joining):
                out.append(char)
                continue
            removed[code] = removed.get(code, 0) + 1
            names[code] = zwnj_name
            continue
        if code == zwj:
            prev_code = ord(text[index - 1]) if index > 0 else -1
            next_code = ord(text[index + 1]) if index + 1 < length else -1
            if any(_in_ranges(neighbour, joining) or _in_ranges(neighbour, emoji) for neighbour in (prev_code, next_code)):
                out.append(char)
                continue
            removed[code] = removed.get(code, 0) + 1
            names[code] = zwj_name
            continue
        if code in bidi:
            if has_rtl:
                out.append(char)
                kept_bidi += 1
                continue
            removed[code] = removed.get(code, 0) + 1
            names[code] = bidi_names[code]
            continue
        if code in removal:
            removed[code] = removed.get(code, 0) + 1
            continue
        if code in exotic:
            if keep_numbers and code in guards and _guarded_space(text, index):
                out.append(char)
                continue
            out.append(" ")
            replaced_spaces += 1
            continue
        out.append(char)

    cleaned = "".join(out)

    form = config.get("normalize_form", "NFC")
    if form in ("NFC", "NFKC", "NFD", "NFKD"):
        cleaned = unicodedata.normalize(form, cleaned)

    findings = []
    for code, count in sorted(removed.items()):
        label = names.get(code, "invisible character")
        findings.append(
            Finding(
                layer="characters",
                kind="invisible-character",
                severity="fixed",
                message=f"removed {label} (U+{code:04X})",
                count=count,
            )
        )
    if kept_bidi:
        findings.append(
            Finding(
                layer="characters",
                kind="bidi-control",
                severity="warn",
                message="kept bidi control characters (document contains rtl text)",
                count=kept_bidi,
            )
        )
    if replaced_spaces:
        findings.append(
            Finding(
                layer="characters",
                kind="exotic-space",
                severity="fixed",
                message="replaced exotic space with normal space",
                count=replaced_spaces,
            )
        )
    return cleaned, findings
