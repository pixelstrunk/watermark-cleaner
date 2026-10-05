const { DEFAULTS } = require("./defaults");
const { LAYERS } = require("./layers");
const { runOnUnprotected } = require("./protect");

function counts(findings) {
  const result = { fixed: 0, warn: 0, error: 0, info: 0 };
  for (const f of findings) result[f.severity] = (result[f.severity] || 0) + f.count;
  return result;
}

const PROTECT_AWARE = new Set(["entities", "typography", "voice", "artifacts"]);

function withDefaults(config) {
  return { ...DEFAULTS, ...(config || {}) };
}

function cleanText(text, config, rules, filePath) {
  config = withDefaults(config);
  const original = text;
  const findings = [];
  const protect = config.protect_code !== false;
  for (const name of config.layers || DEFAULTS.layers) {
    const fn = LAYERS[name];
    if (!fn) continue;
    const result = protect && PROTECT_AWARE.has(name) ? runOnUnprotected(fn, text, config, rules) : fn(text, config, rules);
    text = result.text;
    findings.push(...result.findings);
  }
  const report = {
    path: filePath || "<text>",
    findings,
    original_length: [...original].length,
    cleaned_length: [...text].length,
    changed: text !== original,
    counts: counts(findings),
    has_errors: findings.some((f) => f.severity === "error"),
  };
  return { text, report };
}

module.exports = { cleanText, withDefaults };
