function hex(value) {
  return parseInt(value, 16);
}

function finding(layer, kind, severity, message, count, examples) {
  return { layer, kind, severity, message, count, examples: examples || [] };
}

function buildRemoval(rules, config) {
  const chars = rules.characters;
  const removal = new Set();
  const names = new Map();
  for (const entry of chars.remove_always) {
    const code = hex(entry.cp);
    removal.add(code);
    names.set(code, entry.name);
  }
  for (const entry of chars.remove_ranges) {
    for (let code = hex(entry.from); code <= hex(entry.to); code += 1) {
      removal.add(code);
      names.set(code, entry.name);
    }
  }
  if (config.strip_variation_selectors) {
    const vs = chars.variation_selectors;
    for (let code = hex(vs.from); code <= hex(vs.to); code += 1) {
      removal.add(code);
      names.set(code, "variation selector");
    }
    for (let code = hex(vs.supplementary_from); code <= hex(vs.supplementary_to); code += 1) {
      removal.add(code);
      names.set(code, "variation selector");
    }
  }
  return { removal, names };
}

function isDigit(cp) {
  return cp >= 0x30 && cp <= 0x39;
}

function buildBidi(rules) {
  const chars = rules.characters;
  const bidi = new Set();
  const names = new Map();
  for (const entry of chars.bidi_marks || []) {
    const code = hex(entry.cp);
    bidi.add(code);
    names.set(code, entry.name);
  }
  for (const entry of chars.bidi_control_ranges || []) {
    for (let code = hex(entry.from); code <= hex(entry.to); code += 1) {
      bidi.add(code);
      names.set(code, entry.name);
    }
  }
  return { bidi, names };
}

function toRanges(entries) {
  return (entries || []).map((e) => [hex(e.from), hex(e.to)]);
}

function inRanges(cp, ranges) {
  return ranges.some(([start, end]) => cp >= start && cp <= end);
}

function cleanCharacters(text, config, rules) {
  const chars = rules.characters;
  const { removal, names } = buildRemoval(rules, config);
  const { bidi, names: bidiNames } = buildBidi(rules);
  const exotic = new Set(chars.exotic_spaces_to_ascii.map(hex));
  const guards = new Set((chars.number_space_guard || []).map(hex));
  const keepNumbers = config.keep_nbsp_in_numbers !== false;

  const zwnj = chars.zwnj ? hex(chars.zwnj.cp) : null;
  const zwnjName = chars.zwnj ? chars.zwnj.name : "zero width non-joiner";
  const joining = toRanges(chars.joining_script_ranges);
  const rtl = toRanges(chars.rtl_ranges);

  const points = Array.from(text, (ch) => ch.codePointAt(0));
  const hasRtl = points.some((cp) => inRanges(cp, rtl));
  const out = [];
  const removed = new Map();
  let keptBidi = 0;
  let replacedSpaces = 0;

  for (let i = 0; i < points.length; i += 1) {
    const cp = points[i];
    if (zwnj !== null && cp === zwnj) {
      const prev = i > 0 ? points[i - 1] : -1;
      const next = i + 1 < points.length ? points[i + 1] : -1;
      if (inRanges(prev, joining) || inRanges(next, joining)) {
        out.push(String.fromCodePoint(cp));
        continue;
      }
      removed.set(cp, (removed.get(cp) || 0) + 1);
      names.set(cp, zwnjName);
      continue;
    }
    if (bidi.has(cp)) {
      if (hasRtl) {
        out.push(String.fromCodePoint(cp));
        keptBidi += 1;
        continue;
      }
      removed.set(cp, (removed.get(cp) || 0) + 1);
      names.set(cp, bidiNames.get(cp));
      continue;
    }
    if (removal.has(cp)) {
      removed.set(cp, (removed.get(cp) || 0) + 1);
      continue;
    }
    if (exotic.has(cp)) {
      if (keepNumbers && guards.has(cp) && i > 0 && i + 1 < points.length && isDigit(points[i - 1]) && isDigit(points[i + 1])) {
        out.push(String.fromCodePoint(cp));
        continue;
      }
      out.push(" ");
      replacedSpaces += 1;
      continue;
    }
    out.push(String.fromCodePoint(cp));
  }

  let cleaned = out.join("");
  const form = config.normalize_form || "NFC";
  if (["NFC", "NFKC", "NFD", "NFKD"].includes(form)) cleaned = cleaned.normalize(form);

  const findings = [];
  for (const [code, count] of [...removed.entries()].sort((a, b) => a[0] - b[0])) {
    const label = names.get(code) || "invisible character";
    findings.push(finding("characters", "invisible-character", "fixed", `removed ${label} (U+${code.toString(16).toUpperCase().padStart(4, "0")})`, count));
  }
  if (keptBidi) findings.push(finding("characters", "bidi-control", "warn", "kept bidi control characters (document contains rtl text)", keptBidi));
  if (replacedSpaces) findings.push(finding("characters", "exotic-space", "fixed", "replaced exotic space with normal space", replacedSpaces));
  return { text: cleaned, findings };
}

const DASH_CLASS = "—–‒―";
const DASH_SPACED = new RegExp(`[ \\t]+[${DASH_CLASS}][ \\t]+`, "g");
const DASH_ANY = new RegExp(`[${DASH_CLASS}]`, "g");
const DOT_RUN = /\.{4,}/g;

function countMatches(text, re) {
  const m = text.match(re);
  return m ? m.length : 0;
}

function cleanTypography(text, config, rules) {
  const typo = rules.typography;
  const findings = [];

  if (config.straight_quotes !== false) {
    let count = 0;
    for (const [h, rep] of Object.entries(typo.quotes)) {
      const ch = String.fromCodePoint(hex(h));
      const before = text.split(ch).length - 1;
      if (before) {
        count += before;
        text = text.split(ch).join(rep);
      }
    }
    if (count) findings.push(finding("typography", "smart-quote", "fixed", "straightened smart quotes", count));
  }

  if (config.fix_dashes !== false) {
    const policy = { ...typo.dash_policy, ...(config.dash_policy || {}) };
    const spaced = policy.spaced_replacement || ", ";
    const unspaced = policy.unspaced_replacement || "-";
    const nSpaced = countMatches(text, DASH_SPACED);
    text = text.replace(DASH_SPACED, spaced);
    const nUnspaced = countMatches(text, DASH_ANY);
    text = text.replace(DASH_ANY, unspaced);
    const total = nSpaced + nUnspaced;
    if (total) findings.push(finding("typography", "dash", "fixed", "replaced em/en dash per policy", total));
  }

  if (config.fix_punctuation !== false) {
    let count = 0;
    for (const [h, rep] of Object.entries(typo.punctuation)) {
      const ch = String.fromCodePoint(hex(h));
      const before = text.split(ch).length - 1;
      if (before) {
        count += before;
        text = text.split(ch).join(rep);
      }
    }
    const dots = countMatches(text, DOT_RUN);
    text = text.replace(DOT_RUN, "...");
    if (count + dots) findings.push(finding("typography", "punctuation", "fixed", "normalized ellipsis and bullet glyphs", count + dots));
  }

  return { text, findings };
}

function cleanHomoglyphs(text, config, rules) {
  const mapping = rules.homoglyphs.confusables;
  const findings = [];
  const seen = [];
  let total = 0;
  const table = new Map();
  for (const [h, rep] of Object.entries(mapping)) {
    const ch = String.fromCodePoint(hex(h));
    const count = text.split(ch).length - 1;
    if (count) {
      total += count;
      table.set(ch, rep);
      seen.push(hex(h));
    }
  }
  if (!total) return { text, findings };
  if (config.replace_homoglyphs) {
    for (const [ch, rep] of table.entries()) text = text.split(ch).join(rep);
    findings.push(finding("homoglyphs", "confusable", "fixed", "replaced look-alike letters with ascii", total));
  } else {
    const examples = seen.slice(0, 8).map((c) => `U+${c.toString(16).toUpperCase().padStart(4, "0")}`);
    findings.push(finding("homoglyphs", "confusable", "warn", "look-alike letters found (enable replace_homoglyphs or --aggressive to fix)", total, examples));
  }
  return { text, findings };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const regexCache = new Map();

function cachedRegex(key, make) {
  if (!regexCache.has(key)) regexCache.set(key, make());
  return regexCache.get(key);
}

function phraseBody(phrase) {
  let escaped = escapeRegex(phrase);
  escaped = escaped.replace(/['’]/g, "['’]");
  escaped = escaped.replace(/ /g, "\\s+");
  return escaped;
}

function phraseRegex(phrase) {
  return cachedRegex(`phrase:${phrase}`, () => new RegExp(`(?<!\\w)${phraseBody(phrase)}(?!\\w)`, "gi"));
}

function wordRegex(word) {
  return cachedRegex(`word:${word}`, () => new RegExp(`(?<!\\w)${escapeRegex(word)}(?!\\w)`, "gi"));
}

function shapeRegex(pattern) {
  return cachedRegex(`shape:${pattern}`, () => new RegExp(pattern, "i"));
}

function safeDeleteStartRegex(phrase) {
  return cachedRegex(`sds:${phrase}`, () => new RegExp(`(^|[.!?][ \\t]+|\\n[ \\t]*)(?<!\\w)${phraseBody(phrase)}(?!\\w)([,;:]?[ \\t]*)(\\n?[ \\t]*[a-z])?`, "gi"));
}

function safeDeleteMidRegex(phrase) {
  return cachedRegex(`sdm:${phrase}`, () => new RegExp(`([,;:][ \\t]*|[ \\t]+)?(?<!\\w)${phraseBody(phrase)}(?!\\w)([,;:]?[ \\t]*)`, "gi"));
}

const PUNCT_AFTER = ".!?,;:";

function safeDeleteStartSub(match, lead, tail, next) {
  const nxt = next || "";
  if (nxt) {
    const stripped = nxt.replace(/^\s+/, "");
    const prefix = nxt.slice(0, nxt.length - stripped.length);
    const base = prefix.includes("\n") ? lead.replace(/[ \t]+$/, "") : lead;
    return base + prefix + stripped.toUpperCase();
  }
  return lead;
}

function safeDeleteMidSub(match, pre, tail, offset, whole) {
  pre = pre || "";
  tail = tail || "";
  const after = whole[offset + match.length] || "";
  if (after && PUNCT_AFTER.includes(after)) return "";
  if (pre.trim()) return pre;
  if (tail.trim()) return tail;
  if (pre || tail) return " ";
  return "";
}

function safeDelete(text, phrase) {
  return text
    .replace(safeDeleteStartRegex(phrase), safeDeleteStartSub)
    .replace(safeDeleteMidRegex(phrase), safeDeleteMidSub);
}

function withoutIgnored(items, ignore) {
  return items.filter((item) => !ignore.has(item.toLowerCase()));
}

function cleanVoice(text, config, rules) {
  if (config.voice === false) return { text, findings: [] };
  const phrases = rules.phrases;
  const findings = [];
  const ignore = new Set((config.ignore_phrases || []).map((p) => p.toLowerCase()));

  if (config.fix_safe_delete_phrases !== false) {
    let removed = 0;
    for (const phrase of withoutIgnored(phrases.safe_delete_phrases || [], ignore)) {
      const count = countMatches(text, phraseRegex(phrase));
      if (count) {
        removed += count;
        text = safeDelete(text, phrase);
      }
    }
    if (removed) {
      findings.push(finding("voice", "filler-phrase", "fixed", "removed filler phrases", removed));
    }
  }

  const banned = withoutIgnored([...(phrases.banned_phrases || []), ...(config.custom_banned_phrases || [])], ignore);
  const bannedHits = [];
  let bannedTotal = 0;
  for (const phrase of banned) {
    const count = countMatches(text, phraseRegex(phrase));
    if (count) {
      bannedTotal += count;
      bannedHits.push(phrase);
    }
  }
  if (bannedTotal) findings.push(finding("voice", "banned-phrase", "error", "ai phrases present (rewrite required, not auto-fixed)", bannedTotal, bannedHits.slice(0, 8)));

  const shapeHits = [];
  for (const shape of phrases.sentence_shapes || []) {
    if (ignore.has(shape.id.toLowerCase())) continue;
    if (shapeRegex(shape.pattern).test(text)) shapeHits.push(shape.id);
  }
  if (shapeHits.length) findings.push(finding("voice", "sentence-shape", "error", "ai sentence shapes present (rewrite required, not auto-fixed)", shapeHits.length, shapeHits.slice(0, 8)));

  let lexTotal = 0;
  const lexExamples = [];
  for (const word of withoutIgnored([...(phrases.lexicon_warn || []), ...(phrases.transition_tics_warn || [])], ignore)) {
    const count = countMatches(text, wordRegex(word));
    if (count) {
      lexTotal += count;
      if (lexExamples.length < 8) lexExamples.push(word);
    }
  }
  if (lexTotal) findings.push(finding("voice", "lexicon", "warn", "faux-elegance lexicon found (use sparingly)", lexTotal, lexExamples));

  return { text, findings };
}

const LAYERS = {
  characters: cleanCharacters,
  homoglyphs: cleanHomoglyphs,
  typography: cleanTypography,
  voice: cleanVoice,
};

module.exports = { LAYERS };
