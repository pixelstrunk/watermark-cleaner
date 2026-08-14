import re

from .config import DEFAULTS
from .findings import Report
from .layers import characters, homoglyphs, typography, voice
from .rules import load_rules

_LAYERS = {
    "characters": characters.clean,
    "homoglyphs": homoglyphs.clean,
    "typography": typography.clean,
    "voice": voice.clean,
}

_PROTECT_AWARE = {"typography", "voice"}

_PROTECTED = re.compile(
    r"\A---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|\Z)"
    r"|```[\s\S]*?(?:```|\Z)"
    r"|~~~[\s\S]*?(?:~~~|\Z)"
    r"|`[^`\n]+`"
)


def _run_on_unprotected(func, text, config, rules):
    parts = []
    findings = []
    last = 0
    for match in _PROTECTED.finditer(text):
        segment = text[last:match.start()]
        if segment:
            cleaned, segment_findings = func(segment, config, rules)
            parts.append(cleaned)
            findings.extend(segment_findings)
        parts.append(match.group(0))
        last = match.end()
    segment = text[last:]
    if segment:
        cleaned, segment_findings = func(segment, config, rules)
        parts.append(cleaned)
        findings.extend(segment_findings)
    return "".join(parts), findings


def clean_text(text, config=None, rules=None, path="<text>"):
    config = config or dict(DEFAULTS)
    rules = rules or load_rules()
    original = text
    findings = []
    protect = config.get("protect_code", True)
    for layer_name in config.get("layers", DEFAULTS["layers"]):
        func = _LAYERS.get(layer_name)
        if func is None:
            continue
        if protect and layer_name in _PROTECT_AWARE:
            text, layer_findings = _run_on_unprotected(func, text, config, rules)
        else:
            text, layer_findings = func(text, config, rules)
        findings.extend(layer_findings)

    report = Report(
        path=path,
        findings=findings,
        original_length=len(original),
        cleaned_length=len(text),
        changed=text != original,
    )
    return text, report
