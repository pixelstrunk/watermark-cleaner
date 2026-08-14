import re
from functools import lru_cache

from ..findings import Finding

_APOSTROPHE = re.compile(r"['’]")
_PUNCT_AFTER = ".!?,;:"


def _phrase_body(phrase):
    escaped = re.escape(phrase)
    escaped = _APOSTROPHE.sub(r"['’]", escaped)
    escaped = escaped.replace(r"\ ", r"\s+")
    return escaped


@lru_cache(maxsize=None)
def _phrase_regex(phrase):
    return re.compile(r"(?<!\w)" + _phrase_body(phrase) + r"(?!\w)", re.IGNORECASE)


@lru_cache(maxsize=None)
def _word_regex(word):
    return re.compile(r"(?<!\w)" + re.escape(word) + r"(?!\w)", re.IGNORECASE)


@lru_cache(maxsize=None)
def _shape_regex(pattern):
    return re.compile(pattern, re.IGNORECASE)


@lru_cache(maxsize=None)
def _safe_delete_start_regex(phrase):
    return re.compile(
        r"(?P<lead>^|[.!?][ \t]+|\r?\n[ \t]*)(?<!\w)"
        + _phrase_body(phrase)
        + r"(?!\w)(?P<tail>[,;:]?[ \t]*)(?P<next>(?:\r?\n)?[ \t]*[a-z])?",
        re.IGNORECASE,
    )


@lru_cache(maxsize=None)
def _safe_delete_mid_regex(phrase):
    return re.compile(
        r"(?P<pre>[,;:][ \t]*|[ \t]+)?(?<!\w)"
        + _phrase_body(phrase)
        + r"(?!\w)(?P<tail>[,;:]?[ \t]*)",
        re.IGNORECASE,
    )


def _safe_delete_start_sub(match):
    lead = match.group("lead")
    nxt = match.group("next") or ""
    if nxt:
        stripped = nxt.lstrip()
        prefix = nxt[: len(nxt) - len(stripped)]
        if "\n" in prefix:
            lead = lead.rstrip(" \t")
        return lead + prefix + stripped.upper()
    return lead


def _safe_delete_mid_sub(match):
    pre = match.group("pre") or ""
    tail = match.group("tail") or ""
    after = match.string[match.end():match.end() + 1]
    if after and after in _PUNCT_AFTER:
        return ""
    if pre.strip():
        return pre
    if tail.strip():
        return tail
    if pre or tail:
        return " "
    return ""


def _safe_delete(text, phrase):
    text, start_count = _safe_delete_start_regex(phrase).subn(_safe_delete_start_sub, text)
    text, mid_count = _safe_delete_mid_regex(phrase).subn(_safe_delete_mid_sub, text)
    return text, start_count + mid_count


def _without_ignored(items, ignore):
    return [item for item in items if item.lower() not in ignore]


def clean(text, config, rules):
    if not config.get("voice", True):
        return text, []

    phrases = rules["phrases"]
    findings = []
    ignore = {p.lower() for p in config.get("ignore_phrases") or []}

    if config.get("fix_safe_delete_phrases", True):
        removed_total = 0
        for phrase in _without_ignored(phrases.get("safe_delete_phrases", []), ignore):
            text, count = _safe_delete(text, phrase)
            removed_total += count
        if removed_total:
            findings.append(
                Finding("voice", "filler-phrase", "fixed", "removed filler phrases", removed_total)
            )

    banned = _without_ignored(
        list(phrases.get("banned_phrases", [])) + list(config.get("custom_banned_phrases") or []),
        ignore,
    )
    banned_hits = {}
    for phrase in banned:
        matches = _phrase_regex(phrase).findall(text)
        if matches:
            banned_hits[phrase] = len(matches)
    if banned_hits:
        total = sum(banned_hits.values())
        examples = list(banned_hits.keys())[:8]
        findings.append(
            Finding(
                "voice",
                "banned-phrase",
                "error",
                "ai phrases present (rewrite required, not auto-fixed)",
                total,
                examples,
            )
        )

    shape_errors = []
    shape_warns = []
    for shape in phrases.get("sentence_shapes", []):
        if shape["id"].lower() in ignore:
            continue
        if _shape_regex(shape["pattern"]).search(text):
            if shape.get("severity", "error") == "warn":
                shape_warns.append(shape["id"])
            else:
                shape_errors.append(shape["id"])
    if shape_errors:
        findings.append(
            Finding(
                "voice",
                "sentence-shape",
                "error",
                "ai sentence shapes present (rewrite required, not auto-fixed)",
                len(shape_errors),
                shape_errors[:8],
            )
        )
    if shape_warns:
        findings.append(
            Finding(
                "voice",
                "sentence-shape",
                "warn",
                "sentence patterns that can read as ai (fine in moderation)",
                len(shape_warns),
                shape_warns[:8],
            )
        )

    lexicon_total = 0
    lexicon_examples = []
    lexicon = _without_ignored(
        phrases.get("lexicon_warn", []) + phrases.get("transition_tics_warn", []), ignore
    )
    for word in lexicon:
        count = len(_word_regex(word).findall(text))
        if count:
            lexicon_total += count
            if len(lexicon_examples) < 8:
                lexicon_examples.append(word)
    if lexicon_total:
        findings.append(
            Finding(
                "voice",
                "lexicon",
                "warn",
                "faux-elegance lexicon found (use sparingly)",
                lexicon_total,
                lexicon_examples,
            )
        )

    return text, findings
