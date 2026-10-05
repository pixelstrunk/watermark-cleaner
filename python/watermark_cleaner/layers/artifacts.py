import re
from functools import lru_cache

from ..findings import Finding


_CLOSERS = ".,;:!?)]}"
_OPENERS = "([{"
_BLANKS = " \t\r\n\u00a0\u202f"


@lru_cache(maxsize=None)
def _pattern(pattern):
    return re.compile(pattern)


@lru_cache(maxsize=None)
def _removal_pattern(pattern):
    return re.compile(rf"(?P<lead>[ \t]*)(?:{pattern})(?P<trail>[ \t]*)")


def _join_around_artifact(out, lead, trail, after):
    if after == "" or after in "\n\r" or after in _CLOSERS:
        return out.rstrip(" \t")
    before = out[-1:]
    if before == "" or before in _BLANKS or before in _OPENERS:
        return out
    return out + (lead or trail)


def _remove_artifacts(text, regex):
    out = ""
    last = 0
    count = 0
    for match in regex.finditer(text):
        if match.end() == match.start():
            continue
        count += 1
        after = text[match.end():match.end() + 1]
        out = _join_around_artifact(out + text[last:match.start()], match.group("lead"), match.group("trail"), after)
        last = match.end()
    return out + text[last:], count


@lru_cache(maxsize=None)
def _tracking_pattern(parameter, values):
    alternatives = "|".join(re.escape(v) for v in values)
    return re.compile(rf"([?&]){re.escape(parameter)}=(?:{alternatives})(?=[&\s)\]\"'>]|$)(&?)")


def _tracking_sub(match):
    lead, trailing_ampersand = match.groups()
    if lead == "?":
        return "?" if trailing_ampersand else ""
    return "&" if trailing_ampersand else ""


def clean(text, config, rules):
    spec = rules.get("artifacts")
    if not spec:
        return text, []
    findings = []
    removed = {}
    for entry in spec.get("remove_patterns", []):
        cleaned, count = _remove_artifacts(text, _removal_pattern(entry["pattern"]))
        if count:
            text = cleaned
            removed[entry["id"]] = count
    for parameter, values in spec.get("url_tracking_params", {}).items():
        text, count = _tracking_pattern(parameter, tuple(values)).subn(_tracking_sub, text)
        if count:
            removed[f"{parameter}-tracking"] = count
    if removed:
        findings.append(
            Finding(
                "artifacts",
                "copy-artifact",
                "fixed",
                "removed assistant copy artifacts (citation markers, tracking parameters)",
                sum(removed.values()),
                list(removed)[:8],
                dict(removed),
            )
        )
    warned = {}
    for entry in spec.get("warn_patterns", []):
        count = len(_pattern(entry["pattern"]).findall(text))
        if count:
            warned[entry["id"]] = count
    if warned:
        findings.append(
            Finding(
                "artifacts",
                "copy-artifact",
                "warn",
                "assistant upload or session references present (review the link)",
                sum(warned.values()),
                list(warned)[:8],
                dict(warned),
            )
        )
    return text, findings
