import re
from functools import lru_cache

from ..findings import Finding


@lru_cache(maxsize=None)
def _pattern(pattern):
    return re.compile(pattern)


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
        text, count = _pattern(entry["pattern"]).subn("", text)
        if count:
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
            )
        )
    return text, findings
