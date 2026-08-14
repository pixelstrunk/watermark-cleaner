const { DEFAULTS } = require("./config");
const { LAYERS } = require("./layers");
const { loadRules } = require("./rules");

function counts(findings) {
  const result = { fixed: 0, warn: 0, error: 0, info: 0 };
  for (const f of findings) result[f.severity] = (result[f.severity] || 0) + f.count;
  return result;
}

const PROTECT_AWARE = new Set(["typography", "voice"]);

const PROTECTED = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|(?![\s\S]))|```[\s\S]*?(?:```|(?![\s\S]))|~~~[\s\S]*?(?:~~~|(?![\s\S]))|`[^`\r\n]+`/g;

function runOnUnprotected(fn, text, config, rules) {
  const parts = [];
  const findings = [];
  let last = 0;
  PROTECTED.lastIndex = 0;
  let match;
  while ((match = PROTECTED.exec(text)) !== null) {
    const segment = text.slice(last, match.index);
    if (segment) {
      const result = fn(segment, config, rules);
      parts.push(result.text);
      findings.push(...result.findings);
    }
    parts.push(match[0]);
    last = match.index + match[0].length;
  }
  const segment = text.slice(last);
  if (segment) {
    const result = fn(segment, config, rules);
    parts.push(result.text);
    findings.push(...result.findings);
  }
  return { text: parts.join(""), findings };
}

function cleanText(text, config, rules, filePath) {
  config = config || { ...DEFAULTS };
  rules = rules || loadRules();
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

module.exports = { cleanText };
