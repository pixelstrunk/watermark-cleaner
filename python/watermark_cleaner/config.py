import json
from pathlib import Path

DEFAULTS = {
    "strip_variation_selectors": False,
    "keep_nbsp_in_numbers": True,
    "normalize_form": "NFC",
    "straight_quotes": True,
    "fix_punctuation": True,
    "fix_dashes": True,
    "replace_homoglyphs": False,
    "fix_safe_delete_phrases": True,
    "voice": True,
    "protect_code": True,
    "strip_icc": False,
    "backup": True,
    "custom_banned_phrases": [],
    "ignore_phrases": [],
    "layers": ["characters", "homoglyphs", "typography", "voice"],
    "text_extensions": [".md", ".mdx", ".txt", ".html", ".htm", ".markdown"],
    "image_extensions": [".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".tif", ".tiff"],
    "document_extensions": [".docx", ".odt"],
    "exclude": ["node_modules", ".git", "dist", "build", ".next", ".venv", "__pycache__"],
}

CONFIG_NAMES = ["watermark-cleaner.config.json", ".watermark-cleanerrc.json", ".watermark-cleanerrc"]

_BOOL_KEYS = [
    "strip_variation_selectors", "keep_nbsp_in_numbers", "straight_quotes",
    "fix_punctuation", "fix_dashes", "replace_homoglyphs", "fix_safe_delete_phrases",
    "voice", "protect_code", "strip_icc", "backup",
]
_STRING_LIST_KEYS = [
    "custom_banned_phrases", "ignore_phrases", "layers",
    "text_extensions", "image_extensions", "document_extensions", "exclude",
]
_NORMALIZE_FORMS = ["NFC", "NFKC", "NFD", "NFKD", "none"]


class ConfigError(ValueError):
    pass


def _validate(config, source):
    for key in _BOOL_KEYS:
        if not isinstance(config.get(key, DEFAULTS[key]), bool):
            raise ConfigError(f'config error in {source}: "{key}" must be true or false')
    for key in _STRING_LIST_KEYS:
        value = config.get(key, DEFAULTS[key])
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            raise ConfigError(f'config error in {source}: "{key}" must be a list of strings')
    form = config.get("normalize_form", DEFAULTS["normalize_form"])
    if form not in _NORMALIZE_FORMS:
        raise ConfigError(f'config error in {source}: "normalize_form" must be one of {", ".join(_NORMALIZE_FORMS)}')
    policy = config.get("dash_policy")
    if policy is not None:
        if not isinstance(policy, dict) or not all(isinstance(v, str) for v in policy.values()):
            raise ConfigError(f'config error in {source}: "dash_policy" must be an object with string values')
    size = config.get("max_file_bytes")
    if size is not None:
        if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
            raise ConfigError(f'config error in {source}: "max_file_bytes" must be a positive integer')


def load_config(explicit_path=None, start_dir="."):
    config = dict(DEFAULTS)
    path = _find_config_file(explicit_path, start_dir)
    if path is not None:
        with open(path, "r", encoding="utf-8") as handle:
            try:
                user = json.load(handle)
            except json.JSONDecodeError as error:
                raise ConfigError(f"config error in {path}: not valid json ({error})") from error
        if not isinstance(user, dict):
            raise ConfigError(f"config error in {path}: top level must be a json object")
        config.update(user)
        _validate(config, str(path))
    return config


def _find_config_file(explicit_path, start_dir):
    if explicit_path:
        p = Path(explicit_path)
        if not p.is_file():
            raise FileNotFoundError(f"config not found: {explicit_path}")
        return p
    base = Path(start_dir).resolve()
    for directory in [base, *base.parents]:
        for name in CONFIG_NAMES:
            candidate = directory / name
            if candidate.is_file():
                return candidate
    return None


def apply_aggressive(config):
    config = dict(config)
    config["replace_homoglyphs"] = True
    config["strip_variation_selectors"] = True
    config["strip_icc"] = True
    return config
