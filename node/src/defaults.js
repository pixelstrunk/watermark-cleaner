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
  layers: ["entities", "characters", "homoglyphs", "typography", "voice", "artifacts"],
  text_extensions: [".md", ".mdx", ".txt", ".html", ".htm", ".markdown"],
  image_extensions: [".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff", ".heic", ".heif", ".avif"],
  document_extensions: [".docx", ".odt", ".pptx", ".xlsx", ".odp", ".ods", ".pdf"],
  exclude: ["node_modules", ".git", "dist", "build", ".next", ".venv", "__pycache__"],
};

module.exports = { DEFAULTS };
