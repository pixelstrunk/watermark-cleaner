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
    "custom_banned_phrases": [],
    "ignore_phrases": [],
    "layers": ["characters", "homoglyphs", "typography", "voice"],
    "text_extensions": [".md", ".mdx", ".txt", ".html", ".htm", ".markdown"],
    "image_extensions": [".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".tif", ".tiff"],
    "exclude": ["node_modules", ".git", "dist", "build", ".next", ".venv", "__pycache__"],
}

CONFIG_NAMES = ["watermark-cleaner.config.json", ".watermark-cleanerrc.json", ".watermark-cleanerrc"]


def load_config(explicit_path=None, start_dir="."):
    config = dict(DEFAULTS)
    path = _find_config_file(explicit_path, start_dir)
    if path is not None:
        with open(path, "r", encoding="utf-8") as handle:
            user = json.load(handle)
        config.update(user)
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
