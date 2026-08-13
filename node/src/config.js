const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  strip_variation_selectors: false,
  keep_nbsp_in_numbers: true,
  normalize_form: "NFC",
  straight_quotes: true,
  fix_punctuation: true,
  fix_dashes: true,
  replace_homoglyphs: false,
  fix_safe_delete_phrases: true,
  voice: true,
  protect_code: true,
  strip_icc: false,
  custom_banned_phrases: [],
  ignore_phrases: [],
  layers: ["characters", "homoglyphs", "typography", "voice"],
  text_extensions: [".md", ".mdx", ".txt", ".html", ".htm", ".markdown"],
  image_extensions: [".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff"],
  exclude: ["node_modules", ".git", "dist", "build", ".next", ".venv", "__pycache__"],
};

const CONFIG_NAMES = ["wmc.config.json", ".wmcrc.json", ".wmcrc"];

function findConfigFile(explicitPath, startDir) {
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) throw new Error(`config not found: ${explicitPath}`);
    return explicitPath;
  }
  let dir = path.resolve(startDir);
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadConfig(explicitPath, startDir = ".") {
  const config = { ...DEFAULTS };
  const file = findConfigFile(explicitPath, startDir);
  if (file) Object.assign(config, JSON.parse(fs.readFileSync(file, "utf-8")));
  return config;
}

function applyAggressive(config) {
  return { ...config, replace_homoglyphs: true, strip_variation_selectors: true, strip_icc: true };
}

module.exports = { DEFAULTS, loadConfig, applyAggressive };
