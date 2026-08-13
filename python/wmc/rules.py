import json
import os
from functools import lru_cache
from pathlib import Path

_RULE_FILES = ["characters", "typography", "phrases", "homoglyphs"]


def _candidate_dirs():
    env = os.environ.get("WMC_RULES_DIR")
    if env:
        yield Path(env)
    here = Path(__file__).resolve()
    yield here.parent / "rules_data"
    for parent in here.parents:
        candidate = parent / "rules"
        if candidate.is_dir():
            yield candidate


def _resolve_dir():
    for candidate in _candidate_dirs():
        if candidate.is_dir() and (candidate / "characters.json").is_file():
            return candidate
    raise FileNotFoundError(
        "wmc rules not found. set WMC_RULES_DIR or run from the repository."
    )


@lru_cache(maxsize=1)
def load_rules():
    base = _resolve_dir()
    rules = {}
    for name in _RULE_FILES:
        with open(base / f"{name}.json", "r", encoding="utf-8") as handle:
            rules[name] = json.load(handle)
    return rules
