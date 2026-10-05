const PROTECTED = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|(?![\s\S]))|```[\s\S]*?(?:```|(?![\s\S]))|~~~[\s\S]*?(?:~~~|(?![\s\S]))|``[^\r\n]*?``|`[^`\r\n]+`/g;

function forEachUnprotected(text, protect, visit) {
  if (!protect) {
    if (text) visit(text, 0);
    return;
  }
  let last = 0;
  PROTECTED.lastIndex = 0;
  let match;
  while ((match = PROTECTED.exec(text)) !== null) {
    if (match.index > last) visit(text.slice(last, match.index), last);
    last = match.index + match[0].length;
  }
  if (last < text.length) visit(text.slice(last), last);
}

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

module.exports = { PROTECTED, forEachUnprotected, runOnUnprotected };
