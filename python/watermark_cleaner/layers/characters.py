import unicodedata

from ..findings import Finding


def _cp(value):
    return int(value, 16)


def _ranges(entries):
    return [(_cp(e["from"]), _cp(e["to"])) for e in entries]


def _in_ranges(code, ranges):
    return any(start <= code <= end for start, end in ranges)


_LATIN_LETTER_RANGES = ((0x41, 0x5A), (0x61, 0x7A), (0xC0, 0xD6), (0xD8, 0xF6), (0xF8, 0x24F))
_ALPHABETIC_BASE_LIMIT = 0x2000
_WHITESPACE = " \t\r\n\f\v"


def _is_digit(char):
    return "0" <= char <= "9"


def _is_letter(char):
    return bool(char) and _in_ranges(ord(char), _LATIN_LETTER_RANGES)


def _guarded_space(text, index, punctuation_guard):
    prev_char = text[index - 1] if index > 0 else ""
    next_char = text[index + 1] if index + 1 < len(text) else ""
    if _is_digit(prev_char) or _is_digit(next_char):
        return True
    if next_char and next_char in punctuation_guard["before"]:
        return True
    if prev_char and prev_char in punctuation_guard["after"]:
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
    ranges = [(_cp(e["from"]), _cp(e["to"]), e["name"]) for e in chars["remove_ranges"]]
    if config.get("strip_variation_selectors"):
        vs = chars["variation_selectors"]
        ranges.append((_cp(vs["from"]), _cp(vs["to"]), "variation selector"))
        ranges.append((_cp(vs["supplementary_from"]), _cp(vs["supplementary_to"]), "variation selector"))
        if "mongolian_from" in vs:
            ranges.append((_cp(vs["mongolian_from"]), _cp(vs["mongolian_to"]), "variation selector"))
    return removal, ranges, names


def _range_name(code, ranges):
    for start, end, name in ranges:
        if start <= code <= end:
            return name
    return None


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


def _flag_sequence_indices(text, chars):
    base = _cp(chars.get("flag_sequence_base", "1F3F4"))
    tags = _ranges(chars.get("flag_sequence_tags", []))
    cancel = _cp(chars.get("flag_sequence_cancel", "E007F"))
    kept = set()
    length = len(text)
    index = 0
    while index < length:
        if ord(text[index]) != base:
            index += 1
            continue
        end = index + 1
        while end < length and _in_ranges(ord(text[end]), tags):
            end += 1
        letters = end - index - 1
        if 3 <= letters <= 6 and end < length and ord(text[end]) == cancel:
            kept.update(range(index + 1, end + 1))
            index = end + 1
        else:
            index += 1
    return kept


class _VariationPolicy:
    def __init__(self, chars):
        vs = chars["variation_selectors"]
        self.basic = (_cp(vs["from"]), _cp(vs["to"]))
        self.supplementary = (_cp(vs["supplementary_from"]), _cp(vs["supplementary_to"]))
        self.mongolian = (_cp(vs["mongolian_from"]), _cp(vs["mongolian_to"])) if "mongolian_from" in vs else None
        self.ideographic = _ranges(vs.get("ideographic_base_ranges", []))
        mongolian_base = vs.get("mongolian_base_range")
        self.mongolian_base = (_cp(mongolian_base["from"]), _cp(mongolian_base["to"])) if mongolian_base else None

    def is_selector(self, code):
        if self.basic[0] <= code <= self.basic[1] or self.supplementary[0] <= code <= self.supplementary[1]:
            return True
        return bool(self.mongolian) and self.mongolian[0] <= code <= self.mongolian[1]

    def _is_alphabetic_base(self, prev_char):
        code = ord(prev_char)
        return code < _ALPHABETIC_BASE_LIMIT and unicodedata.category(prev_char).startswith("L")

    def is_orphan(self, text, index):
        code = ord(text[index])
        if index == 0:
            return True
        prev_char = text[index - 1]
        prev_code = ord(prev_char)
        if prev_char in _WHITESPACE or self.is_selector(prev_code):
            return True
        if self.supplementary[0] <= code <= self.supplementary[1]:
            return not _in_ranges(prev_code, self.ideographic)
        if self.mongolian and self.mongolian[0] <= code <= self.mongolian[1]:
            return self.mongolian_base is not None and not (self.mongolian_base[0] <= prev_code <= self.mongolian_base[1])
        return self._is_alphabetic_base(prev_char)


def clean(text, config, rules):
    chars = rules["characters"]
    removal, removal_ranges, names = _build_removal(rules, config)
    bidi, bidi_names = _build_bidi(rules)
    exotic = {_cp(c) for c in chars["exotic_spaces_to_ascii"]}
    guards = {_cp(c) for c in chars.get("number_space_guard", [])}
    keep_numbers = config.get("keep_nbsp_in_numbers", True)
    punctuation_guard = chars.get("punctuation_space_guard", {"before": [], "after": []})
    script_guards = {
        _cp(entry["cp"]): (_cp(entry["keep_adjacent"]["from"]), _cp(entry["keep_adjacent"]["to"]))
        for entry in chars.get("exotic_space_script_guards", [])
    }

    zwnj = _cp(chars["zwnj"]["cp"]) if "zwnj" in chars else None
    zwnj_name = chars.get("zwnj", {}).get("name", "zero width non-joiner")
    zwj = _cp(chars["zwj"]["cp"]) if "zwj" in chars else None
    zwj_name = chars.get("zwj", {}).get("name", "zero width joiner")
    cgj = _cp(chars["cgj"]["cp"]) if "cgj" in chars else None
    cgj_name = chars.get("cgj", {}).get("name", "combining grapheme joiner")
    cgj_keep = _ranges(chars.get("cgj", {}).get("keep_adjacent_ranges", []))
    joining = _ranges(chars.get("joining_script_ranges", []))
    emoji = _ranges(chars.get("emoji_ranges", []))
    rtl = _ranges(chars.get("rtl_ranges", []))
    has_rtl = any(_in_ranges(ord(ch), rtl) for ch in text)
    flag_kept = _flag_sequence_indices(text, chars)
    variation = _VariationPolicy(chars)
    strip_all_selectors = bool(config.get("strip_variation_selectors"))

    out = []
    removed = {}
    kept_bidi = 0
    replaced_spaces = 0
    orphan_selectors = 0
    length = len(text)

    def neighbours(index):
        prev_code = ord(text[index - 1]) if index > 0 else -1
        next_code = ord(text[index + 1]) if index + 1 < length else -1
        return prev_code, next_code

    for index, char in enumerate(text):
        code = ord(char)
        if code == zwnj:
            prev_code, next_code = neighbours(index)
            if _in_ranges(prev_code, joining) or _in_ranges(next_code, joining):
                out.append(char)
                continue
            removed[code] = removed.get(code, 0) + 1
            names[code] = zwnj_name
            continue
        if code == zwj:
            prev_code, next_code = neighbours(index)
            if any(_in_ranges(n, joining) or _in_ranges(n, emoji) for n in (prev_code, next_code)):
                out.append(char)
                continue
            removed[code] = removed.get(code, 0) + 1
            names[code] = zwj_name
            continue
        if code == cgj:
            prev_code, next_code = neighbours(index)
            if _in_ranges(prev_code, cgj_keep) or _in_ranges(next_code, cgj_keep):
                out.append(char)
                continue
            removed[code] = removed.get(code, 0) + 1
            names[code] = cgj_name
            continue
        if code in bidi:
            if has_rtl:
                out.append(char)
                kept_bidi += 1
                continue
            removed[code] = removed.get(code, 0) + 1
            names[code] = bidi_names[code]
            continue
        if index in flag_kept:
            out.append(char)
            continue
        if code in removal:
            removed[code] = removed.get(code, 0) + 1
            continue
        range_name = _range_name(code, removal_ranges)
        if range_name is not None:
            removed[code] = removed.get(code, 0) + 1
            names[code] = range_name
            continue
        if not strip_all_selectors and variation.is_selector(code):
            if variation.is_orphan(text, index):
                orphan_selectors += 1
                continue
            out.append(char)
            continue
        if code in exotic:
            if keep_numbers and code in guards and _guarded_space(text, index, punctuation_guard):
                out.append(char)
                continue
            if code in script_guards:
                prev_code, next_code = neighbours(index)
                start, end = script_guards[code]
                if start <= prev_code <= end or start <= next_code <= end:
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
                by_rule={f"U+{code:04X}": count},
            )
        )
    if orphan_selectors:
        findings.append(
            Finding(
                layer="characters",
                kind="variation-selector",
                severity="fixed",
                message="removed variation selector without a base character that supports it (hidden payload)",
                count=orphan_selectors,
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
