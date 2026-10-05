const { DEFAULTS } = require("./defaults");
const { LAYERS } = require("./layers");
const { runOnUnprotected } = require("./protect");

function counts(findings) {
  const result = { fixed: 0, warn: 0, error: 0, info: 0 };
  for (const f of findings) result[f.severity] = (result[f.severity] || 0) + f.count;
  return result;
}

const PROTECT_AWARE = new Set(["entities", "typography", "voice", "artifacts"]);
const EXAMPLE_LIMIT = 8;

function mergeFindings(findings) {
  const merged = new Map();
  for (const f of findings) {
    const key = [f.layer, f.kind, f.severity, f.message].join("\u0000");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...f, examples: [...(f.examples || [])], by_rule: { ...(f.by_rule || {}) } });
      continue;
    }
    existing.count += f.count;
    for (const example of f.examples || []) {
      if (existing.examples.length >= EXAMPLE_LIMIT) break;
      if (!existing.examples.includes(example)) existing.examples.push(example);
    }
    for (const [rule, n] of Object.entries(f.by_rule || {})) existing.by_rule[rule] = (existing.by_rule[rule] || 0) + n;
  }
  return [...merged.values()];
}

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
  const merged = mergeFindings(findings);
  const report = {
    path: filePath || "<text>",
    findings: merged,
    original_length: [...original].length,
    cleaned_length: [...text].length,
    changed: text !== original,
    counts: counts(merged),
    has_errors: merged.some((f) => f.severity === "error"),
  };
  return { text, report };
}

module.exports = { cleanText, withDefaults };
