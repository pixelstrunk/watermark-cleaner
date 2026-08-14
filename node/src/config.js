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
  backup: true,
  custom_banned_phrases: [],
  ignore_phrases: [],
  layers: ["characters", "homoglyphs", "typography", "voice"],
  text_extensions: [".md", ".mdx", ".txt", ".html", ".htm", ".markdown"],
  image_extensions: [".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff"],
  document_extensions: [".docx", ".odt"],
  exclude: ["node_modules", ".git", "dist", "build", ".next", ".venv", "__pycache__"],
};

const CONFIG_NAMES = ["watermark-cleaner.config.json", ".watermark-cleanerrc.json", ".watermark-cleanerrc"];

const BOOL_KEYS = [
  "strip_variation_selectors", "keep_nbsp_in_numbers", "straight_quotes",
  "fix_punctuation", "fix_dashes", "replace_homoglyphs", "fix_safe_delete_phrases",
  "voice", "protect_code", "strip_icc", "backup",
];
const STRING_LIST_KEYS = [
  "custom_banned_phrases", "ignore_phrases", "layers",
  "text_extensions", "image_extensions", "document_extensions", "exclude",
];
const NORMALIZE_FORMS = ["NFC", "NFKC", "NFD", "NFKD", "none"];

class ConfigError extends Error {}

function isString(value) {
  return typeof value === "string";
}

function validate(config, source) {
  for (const key of BOOL_KEYS) {
    const value = key in config ? config[key] : DEFAULTS[key];
    if (typeof value !== "boolean") {
      throw new ConfigError(`config error in ${source}: "${key}" must be true or false`);
    }
  }
  for (const key of STRING_LIST_KEYS) {
    const value = key in config ? config[key] : DEFAULTS[key];
    if (!Array.isArray(value) || !value.every(isString)) {
      throw new ConfigError(`config error in ${source}: "${key}" must be a list of strings`);
    }
  }
  const form = "normalize_form" in config ? config.normalize_form : DEFAULTS.normalize_form;
  if (!NORMALIZE_FORMS.includes(form)) {
    throw new ConfigError(`config error in ${source}: "normalize_form" must be one of ${NORMALIZE_FORMS.join(", ")}`);
  }
  const policy = config.dash_policy;
  if (policy !== undefined && policy !== null) {
    if (typeof policy !== "object" || Array.isArray(policy) || !Object.values(policy).every(isString)) {
      throw new ConfigError(`config error in ${source}: "dash_policy" must be an object with string values`);
    }
  }
  const size = config.max_file_bytes;
  if (size !== undefined && size !== null) {
    if (!Number.isInteger(size) || size <= 0) {
      throw new ConfigError(`config error in ${source}: "max_file_bytes" must be a positive integer`);
    }
  }
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch (error) {
    return false;
  }
}

function findConfigFile(explicitPath, startDir) {
  if (explicitPath) {
    if (!isFile(explicitPath)) throw new Error(`config not found: ${explicitPath}`);
    return explicitPath;
  }
  let dir = path.resolve(startDir);
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const candidate = path.join(dir, name);
      if (isFile(candidate)) return candidate;
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
  if (file) {
    let user;
    try {
      user = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (error) {
      throw new ConfigError(`config error in ${file}: not valid json (${error.message})`);
    }
    if (typeof user !== "object" || user === null || Array.isArray(user)) {
      throw new ConfigError(`config error in ${file}: top level must be a json object`);
    }
    Object.assign(config, user);
    validate(config, file);
  }
  return config;
}

function applyAggressive(config) {
  return { ...config, replace_homoglyphs: true, strip_variation_selectors: true, strip_icc: true };
}

module.exports = { DEFAULTS, loadConfig, applyAggressive, ConfigError };
