const { forEachUnprotected } = require("./protect");

function hex(value) {
  return parseInt(value, 16);
}

function finding(layer, kind, severity, message, count, examples, byRule) {
  return { layer, kind, severity, message, count, examples: examples || [], by_rule: byRule || {} };
}

function codeLabel(cp) {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

function tally(map, key, n = 1) {
  map.set(key, (map.get(key) || 0) + n);
}

function fromMap(map) {
  return Object.fromEntries(map);
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
  const ranges = chars.remove_ranges.map((e) => [hex(e.from), hex(e.to), e.name]);
  if (config.strip_variation_selectors) {
    const vs = chars.variation_selectors;
    ranges.push([hex(vs.from), hex(vs.to), "variation selector"]);
    ranges.push([hex(vs.supplementary_from), hex(vs.supplementary_to), "variation selector"]);
    if (vs.mongolian_from) ranges.push([hex(vs.mongolian_from), hex(vs.mongolian_to), "variation selector"]);
  }
  return { removal, ranges, names };
}

function rangeName(cp, ranges) {
  for (const [start, end, name] of ranges) {
    if (cp >= start && cp <= end) return name;
  }
  return null;
}

function isDigit(cp) {
  return cp >= 0x30 && cp <= 0x39;
}

const LATIN_LETTER_RANGES = [[0x41, 0x5a], [0x61, 0x7a], [0xc0, 0xd6], [0xd8, 0xf6], [0xf8, 0x24f]];
const ALPHABETIC_BASE_LIMIT = 0x2000;
const WHITESPACE = new Set([0x20, 0x09, 0x0d, 0x0a, 0x0c, 0x0b]);
const LETTER = /^\p{L}$/u;

function isLetter(cp) {
  return cp >= 0 && inRanges(cp, LATIN_LETTER_RANGES);
}

function guardedSpace(points, i, punctuationGuard) {
  const prev = i > 0 ? points[i - 1] : -1;
  const next = i + 1 < points.length ? points[i + 1] : -1;
  if (isDigit(prev) || isDigit(next)) return true;
  if (next >= 0 && punctuationGuard.before.has(next)) return true;
  if (prev >= 0 && punctuationGuard.after.has(prev)) return true;
  if (prev !== 0x2e || i < 2 || !isLetter(next)) return false;
  const beforeDot = points[i - 2];
  if (isDigit(beforeDot)) return true;
  const singleLetter = i < 3 || !isLetter(points[i - 3]);
  const closesAbbreviation = i + 2 < points.length && points[i + 2] === 0x2e;
  return isLetter(beforeDot) && singleLetter && closesAbbreviation;
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

function flagSequenceIndices(points, chars) {
  const base = hex(chars.flag_sequence_base || "1F3F4");
  const tags = toRanges(chars.flag_sequence_tags);
  const cancel = hex(chars.flag_sequence_cancel || "E007F");
  const kept = new Set();
  let i = 0;
  while (i < points.length) {
    if (points[i] !== base) {
      i += 1;
      continue;
    }
    let end = i + 1;
    while (end < points.length && inRanges(points[end], tags)) end += 1;
    const letters = end - i - 1;
    if (letters >= 3 && letters <= 6 && end < points.length && points[end] === cancel) {
      for (let k = i + 1; k <= end; k += 1) kept.add(k);
      i = end + 1;
    } else {
      i += 1;
    }
  }
  return kept;
}

function variationPolicy(chars) {
  const vs = chars.variation_selectors;
  const basic = [hex(vs.from), hex(vs.to)];
  const supplementary = [hex(vs.supplementary_from), hex(vs.supplementary_to)];
  const mongolian = vs.mongolian_from ? [hex(vs.mongolian_from), hex(vs.mongolian_to)] : null;
  const ideographic = toRanges(vs.ideographic_base_ranges);
  const mongolianBase = vs.mongolian_base_range ? [hex(vs.mongolian_base_range.from), hex(vs.mongolian_base_range.to)] : null;
  const within = (cp, range) => range !== null && cp >= range[0] && cp <= range[1];
  const isSelector = (cp) => within(cp, basic) || within(cp, supplementary) || within(cp, mongolian);
  const isAlphabeticBase = (cp) => cp < ALPHABETIC_BASE_LIMIT && LETTER.test(String.fromCodePoint(cp));
  const isOrphan = (points, i) => {
    const cp = points[i];
    if (i === 0) return true;
    const prev = points[i - 1];
    if (WHITESPACE.has(prev) || isSelector(prev)) return true;
    if (within(cp, supplementary)) return !inRanges(prev, ideographic);
    if (within(cp, mongolian)) return mongolianBase !== null && !within(prev, mongolianBase);
    return isAlphabeticBase(prev);
  };
  return { isSelector, isOrphan };
}

const KEEP = { action: "keep", name: null, tally: null };

function decideCharacters(text, config, rules) {
  const chars = rules.characters;
  const { removal, ranges: removalRanges, names } = buildRemoval(rules, config);
  const { bidi, names: bidiNames } = buildBidi(rules);
  const exotic = new Set(chars.exotic_spaces_to_ascii.map(hex));
  const guards = new Set((chars.number_space_guard || []).map(hex));
  const keepNumbers = config.keep_nbsp_in_numbers !== false;
  const guardSpec = chars.punctuation_space_guard || { before: [], after: [] };
  const punctuationGuard = {
    before: new Set(guardSpec.before.map((c) => c.codePointAt(0))),
    after: new Set(guardSpec.after.map((c) => c.codePointAt(0))),
  };
  const scriptGuards = new Map((chars.exotic_space_script_guards || []).map((e) => [hex(e.cp), [hex(e.keep_adjacent.from), hex(e.keep_adjacent.to)]]));

  const zwnj = chars.zwnj ? hex(chars.zwnj.cp) : null;
  const zwnjName = chars.zwnj ? chars.zwnj.name : "zero width non-joiner";
  const zwj = chars.zwj ? hex(chars.zwj.cp) : null;
  const zwjName = chars.zwj ? chars.zwj.name : "zero width joiner";
  const cgj = chars.cgj ? hex(chars.cgj.cp) : null;
  const cgjName = chars.cgj ? chars.cgj.name : "combining grapheme joiner";
  const cgjKeep = toRanges(chars.cgj ? chars.cgj.keep_adjacent_ranges : []);
  const joining = toRanges(chars.joining_script_ranges);
  const emoji = toRanges(chars.emoji_ranges);
  const rtl = toRanges(chars.rtl_ranges);

  const points = Array.from(text, (ch) => ch.codePointAt(0));
  const hasRtl = points.some((cp) => inRanges(cp, rtl));
  const flagKept = flagSequenceIndices(points, chars);
  const variation = variationPolicy(chars);
  const stripAllSelectors = Boolean(config.strip_variation_selectors);
  const decisions = new Array(points.length);

  const neighbours = (i) => [i > 0 ? points[i - 1] : -1, i + 1 < points.length ? points[i + 1] : -1];
  const invisible = (name) => ({ action: "remove", name, tally: "invisible" });

  for (let i = 0; i < points.length; i += 1) {
    const cp = points[i];
    if (zwnj !== null && cp === zwnj) {
      const [prev, next] = neighbours(i);
      decisions[i] = inRanges(prev, joining) || inRanges(next, joining) ? KEEP : invisible(zwnjName);
      continue;
    }
    if (zwj !== null && cp === zwj) {
      const [prev, next] = neighbours(i);
      decisions[i] = [prev, next].some((n) => inRanges(n, joining) || inRanges(n, emoji)) ? KEEP : invisible(zwjName);
      continue;
    }
    if (cgj !== null && cp === cgj) {
      const [prev, next] = neighbours(i);
      decisions[i] = inRanges(prev, cgjKeep) || inRanges(next, cgjKeep) ? KEEP : invisible(cgjName);
      continue;
    }
    if (bidi.has(cp)) {
      decisions[i] = hasRtl ? { action: "keep", name: bidiNames.get(cp), tally: "bidi" } : invisible(bidiNames.get(cp));
      continue;
    }
    if (flagKept.has(i)) {
      decisions[i] = KEEP;
      continue;
    }
    if (removal.has(cp)) {
      decisions[i] = invisible(names.get(cp));
      continue;
    }
    const name = rangeName(cp, removalRanges);
    if (name !== null) {
      decisions[i] = invisible(name);
      continue;
    }
    if (!stripAllSelectors && variation.isSelector(cp)) {
      decisions[i] = variation.isOrphan(points, i) ? { action: "remove", name: "variation selector", tally: "selector" } : KEEP;
      continue;
    }
    if (exotic.has(cp)) {
      if (keepNumbers && guards.has(cp) && guardedSpace(points, i, punctuationGuard)) {
        decisions[i] = KEEP;
        continue;
      }
      if (scriptGuards.has(cp)) {
        const [prev, next] = neighbours(i);
        const [start, end] = scriptGuards.get(cp);
        if ((prev >= start && prev <= end) || (next >= start && next <= end)) {
          decisions[i] = KEEP;
          continue;
        }
      }
      decisions[i] = { action: "space", name: "exotic space", tally: "space" };
      continue;
    }
    decisions[i] = KEEP;
  }
  return { points, decisions };
}

function classifyCharacters(text, config, rules) {
  const { points, decisions } = decideCharacters(text, config, rules);
  return points.map((cp, index) => {
    const decision = decisions[index];
    return { index, char: String.fromCodePoint(cp), code: cp, action: decision.action, name: decision.action === "keep" ? null : decision.name };
  });
}

function cleanCharacters(text, config, rules) {
  const { points, decisions } = decideCharacters(text, config, rules);
  const out = [];
  const removed = new Map();
  const names = new Map();
  let keptBidi = 0;
  let replacedSpaces = 0;
  let orphanSelectors = 0;

  for (let i = 0; i < points.length; i += 1) {
    const cp = points[i];
    const decision = decisions[i];
    if (decision.action === "remove") {
      if (decision.tally === "invisible") {
        tally(removed, cp);
        names.set(cp, decision.name);
      } else {
        orphanSelectors += 1;
      }
      continue;
    }
    if (decision.action === "space") {
      out.push(" ");
      replacedSpaces += 1;
      continue;
    }
    if (decision.tally === "bidi") keptBidi += 1;
    out.push(String.fromCodePoint(cp));
  }

  let cleaned = out.join("");
  const form = config.normalize_form || "NFC";
  if (["NFC", "NFKC", "NFD", "NFKD"].includes(form)) cleaned = cleaned.normalize(form);

  const findings = [];
  for (const [code, n] of [...removed.entries()].sort((a, b) => a[0] - b[0])) {
    const label = names.get(code) || "invisible character";
    findings.push(finding("characters", "invisible-character", "fixed", `removed ${label} (${codeLabel(code)})`, n, [], { [codeLabel(code)]: n }));
  }
  if (orphanSelectors) findings.push(finding("characters", "variation-selector", "fixed", "removed variation selector without a base character that supports it (hidden payload)", orphanSelectors));
  if (keptBidi) findings.push(finding("characters", "bidi-control", "warn", "kept bidi control characters (document contains rtl text)", keptBidi));
  if (replacedSpaces) findings.push(finding("characters", "exotic-space", "fixed", "replaced exotic space with normal space", replacedSpaces));
  return { text: cleaned, findings };
}

const ENTITY = /&(?:#(\d+)|#[xX]([0-9A-Fa-f]+)|([A-Za-z][A-Za-z0-9]*));/g;

function cleanEntities(text, config, rules) {
  const spec = rules.characters.html_entities;
  if (!spec || !text.includes("&")) return { text, findings: [] };
  const named = new Map(Object.entries(spec.named || {}).map(([name, code]) => [name, hex(code)]));
  const codes = new Set((spec.numeric_codepoints || []).map(hex));
  const ranges = toRanges(spec.numeric_ranges);
  const decoded = new Map();
  text = text.replace(ENTITY, (whole, decimal, hexadecimal, name) => {
    let code;
    if (name !== undefined) code = named.has(name) ? named.get(name) : null;
    else code = decimal !== undefined ? parseInt(decimal, 10) : parseInt(hexadecimal, 16);
    if (code === null || code > 0x10ffff) return whole;
    if (!codes.has(code) && !inRanges(code, ranges)) return whole;
    tally(decoded, whole);
    return String.fromCodePoint(code);
  });
  const findings = [];
  const total = [...decoded.values()].reduce((a, b) => a + b, 0);
  if (total) findings.push(finding("entities", "html-entity", "fixed", "decoded html entities of invisible characters (handled by the characters layer)", total, [], fromMap(decoded)));
  return { text, findings };
}

const DASH_CLASS = "—–‒―";
const DASH_RANGE = new RegExp(`(?<=\\d[ \\t])[${DASH_CLASS}](?=[ \\t]\\d)`, "g");
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
    const byRule = new Map();
    for (const [h, rep] of Object.entries(typo.quotes)) {
      const ch = String.fromCodePoint(hex(h));
      const before = text.split(ch).length - 1;
      if (before) {
        tally(byRule, codeLabel(hex(h)), before);
        text = text.split(ch).join(rep);
      }
    }
    const count = [...byRule.values()].reduce((a, b) => a + b, 0);
    if (count) findings.push(finding("typography", "smart-quote", "fixed", "straightened smart quotes", count, [], fromMap(byRule)));
  }

  if (config.fix_dashes !== false) {
    const policy = { ...typo.dash_policy, ...(config.dash_policy || {}) };
    const spaced = policy.spaced_replacement !== undefined ? policy.spaced_replacement : ", ";
    const unspaced = policy.unspaced_replacement !== undefined ? policy.unspaced_replacement : "-";
    const byRule = new Map();
    const nRange = countMatches(text, DASH_RANGE);
    text = text.replace(DASH_RANGE, "-");
    if (nRange) tally(byRule, "range", nRange);
    const nSpaced = countMatches(text, DASH_SPACED);
    text = text.replace(DASH_SPACED, spaced);
    if (nSpaced) tally(byRule, "spaced", nSpaced);
    const nUnspaced = countMatches(text, DASH_ANY);
    text = text.replace(DASH_ANY, unspaced);
    if (nUnspaced) tally(byRule, "unspaced", nUnspaced);
    const total = nRange + nSpaced + nUnspaced;
    if (total) findings.push(finding("typography", "dash", "fixed", "replaced em/en dash per policy", total, [], fromMap(byRule)));
  }

  if (config.fix_punctuation !== false) {
    const byRule = new Map();
    for (const [h, rep] of Object.entries(typo.punctuation)) {
      const ch = String.fromCodePoint(hex(h));
      const before = text.split(ch).length - 1;
      if (before) {
        tally(byRule, codeLabel(hex(h)), before);
        text = text.split(ch).join(rep);
      }
    }
    const dots = countMatches(text, DOT_RUN);
    text = text.replace(DOT_RUN, "...");
    if (dots) tally(byRule, "dot-run", dots);
    const total = [...byRule.values()].reduce((a, b) => a + b, 0);
    if (total) findings.push(finding("typography", "punctuation", "fixed", "normalized ellipsis and bullet glyphs", total, [], fromMap(byRule)));
  }

  return { text, findings };
}

const WORD = /\p{L}+/gu;
const LATIN_RANGES = [[0x41, 0x5a], [0x61, 0x7a], [0xc0, 0xd6], [0xd8, 0xf6], [0xf8, 0x24f], [0x1e00, 0x1eff]];
const CONFUSABLE_SCRIPT_RANGES = [[0x370, 0x3ff], [0x400, 0x52f]];

function classifyWord(word, table) {
  let hasLatin = false;
  let hasConfusable = false;
  let hasGenuineForeign = false;
  for (const ch of word) {
    const cp = ch.codePointAt(0);
    if (table.has(cp)) hasConfusable = true;
    else if (inRanges(cp, LATIN_RANGES)) hasLatin = true;
    else if (inRanges(cp, CONFUSABLE_SCRIPT_RANGES)) hasGenuineForeign = true;
  }
  return { hasLatin, hasConfusable, hasGenuineForeign };
}

function suspiciousWords(text, table) {
  const classified = [];
  WORD.lastIndex = 0;
  let match;
  while ((match = WORD.exec(text)) !== null) {
    classified.push({ index: match.index, word: match[0], ...classifyWord(match[0], table) });
  }
  const documentHasForeignScript = classified.some((c) => c.hasGenuineForeign);
  return classified.filter((c) => c.hasConfusable && !c.hasGenuineForeign && (c.hasLatin || !documentHasForeignScript));
}

function cleanHomoglyphs(text, config, rules) {
  const mapping = rules.homoglyphs.confusables;
  const table = new Map(Object.entries(mapping).map(([h, rep]) => [hex(h), rep]));
  const findings = [];

  const suspicious = suspiciousWords(text, table);
  const seen = new Set();
  const byRule = new Map();
  let total = 0;
  for (const { word } of suspicious) {
    for (const ch of word) {
      const cp = ch.codePointAt(0);
      if (table.has(cp)) {
        seen.add(cp);
        tally(byRule, codeLabel(cp));
        total += 1;
      }
    }
  }

  if (!total) return { text, findings };

  if (config.replace_homoglyphs) {
    const parts = [];
    let last = 0;
    for (const { index, word } of suspicious) {
      parts.push(text.slice(last, index));
      parts.push(Array.from(word, (ch) => table.get(ch.codePointAt(0)) || ch).join(""));
      last = index + word.length;
    }
    parts.push(text.slice(last));
    text = parts.join("");
    findings.push(finding("homoglyphs", "confusable", "fixed", "replaced look-alike letters with ascii", total, [], fromMap(byRule)));
  } else {
    const ordered = Object.keys(mapping).map(hex).filter((cp) => seen.has(cp));
    const examples = ordered.slice(0, 8).map((c) => `U+${c.toString(16).toUpperCase().padStart(4, "0")}`);
    findings.push(finding("homoglyphs", "confusable", "warn", "look-alike letters found (enable replace_homoglyphs or --aggressive to fix)", total, examples, fromMap(byRule)));
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
  return cachedRegex(`sds:${phrase}`, () => new RegExp(`(^|[.!?][ \\t]+|\\r?\\n[ \\t]*)(?<!\\w)${phraseBody(phrase)}(?!\\w)([,;:]?[ \\t]*)((?:\\r?\\n)?[ \\t]*[a-z])?`, "gi"));
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
  let count = 0;
  text = text.replace(safeDeleteStartRegex(phrase), (...args) => {
    count += 1;
    return safeDeleteStartSub(...args);
  });
  text = text.replace(safeDeleteMidRegex(phrase), (...args) => {
    count += 1;
    return safeDeleteMidSub(...args);
  });
  return { text, count };
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
    const removed = new Map();
    for (const phrase of withoutIgnored(phrases.safe_delete_phrases || [], ignore)) {
      const result = safeDelete(text, phrase);
      text = result.text;
      if (result.count) tally(removed, phrase, result.count);
    }
    const total = [...removed.values()].reduce((a, b) => a + b, 0);
    if (total) findings.push(finding("voice", "filler-phrase", "fixed", "removed filler phrases", total, [], fromMap(removed)));
  }

  const banned = withoutIgnored([...(phrases.banned_phrases || []), ...(config.custom_banned_phrases || [])], ignore);
  const bannedHits = new Map();
  for (const phrase of banned) {
    const count = countMatches(text, phraseRegex(phrase));
    if (count) tally(bannedHits, phrase, count);
  }
  const bannedTotal = [...bannedHits.values()].reduce((a, b) => a + b, 0);
  if (bannedTotal) findings.push(finding("voice", "banned-phrase", "error", "ai phrases present (rewrite required, not auto-fixed)", bannedTotal, [...bannedHits.keys()].slice(0, 8), fromMap(bannedHits)));

  const shapeErrors = [];
  const shapeWarns = [];
  for (const shape of phrases.sentence_shapes || []) {
    if (ignore.has(shape.id.toLowerCase())) continue;
    if (shapeRegex(shape.pattern).test(text)) {
      if ((shape.severity || "error") === "warn") shapeWarns.push(shape.id);
      else shapeErrors.push(shape.id);
    }
  }
  const once = (ids) => Object.fromEntries(ids.map((id) => [id, 1]));
  if (shapeErrors.length) findings.push(finding("voice", "sentence-shape", "error", "ai sentence shapes present (rewrite required, not auto-fixed)", shapeErrors.length, shapeErrors.slice(0, 8), once(shapeErrors)));
  if (shapeWarns.length) findings.push(finding("voice", "sentence-shape", "warn", "sentence patterns that can read as ai (fine in moderation)", shapeWarns.length, shapeWarns.slice(0, 8), once(shapeWarns)));

  const lexHits = new Map();
  for (const word of withoutIgnored([...(phrases.lexicon_warn || []), ...(phrases.transition_tics_warn || [])], ignore)) {
    const count = countMatches(text, wordRegex(word));
    if (count) tally(lexHits, word, count);
  }
  const lexTotal = [...lexHits.values()].reduce((a, b) => a + b, 0);
  if (lexTotal) findings.push(finding("voice", "lexicon", "warn", "faux-elegance lexicon found (use sparingly)", lexTotal, [...lexHits.keys()].slice(0, 8), fromMap(lexHits)));

  return { text, findings };
}

function shapeGlobalRegex(pattern) {
  return cachedRegex(`shape-all:${pattern}`, () => new RegExp(pattern, "gi"));
}

function collectHits(hits, segment, offset, re, kind, id, severity) {
  re.lastIndex = 0;
  let match;
  while ((match = re.exec(segment)) !== null) {
    if (match[0] === "") {
      re.lastIndex += 1;
      continue;
    }
    hits.push({ start: offset + match.index, end: offset + match.index + match[0].length, kind, id, severity, text: match[0] });
  }
}

function findPhrases(text, config, rules) {
  if (config.voice === false) return [];
  const phrases = rules.phrases;
  const ignore = new Set((config.ignore_phrases || []).map((p) => p.toLowerCase()));
  const fillers = config.fix_safe_delete_phrases !== false ? withoutIgnored(phrases.safe_delete_phrases || [], ignore) : [];
  const banned = withoutIgnored([...(phrases.banned_phrases || []), ...(config.custom_banned_phrases || [])], ignore);
  const shapes = (phrases.sentence_shapes || []).filter((shape) => !ignore.has(shape.id.toLowerCase()));
  const lexicon = withoutIgnored([...(phrases.lexicon_warn || []), ...(phrases.transition_tics_warn || [])], ignore);
  const hits = [];
  forEachUnprotected(text, config.protect_code !== false, (segment, offset) => {
    for (const phrase of fillers) collectHits(hits, segment, offset, phraseRegex(phrase), "filler", phrase, "fixed");
    for (const phrase of banned) collectHits(hits, segment, offset, phraseRegex(phrase), "banned", phrase, "error");
    for (const shape of shapes) collectHits(hits, segment, offset, shapeGlobalRegex(shape.pattern), "shape", shape.id, shape.severity || "error");
    for (const word of lexicon) collectHits(hits, segment, offset, wordRegex(word), "lexicon", word, "warn");
  });
  const fillerSpans = hits.filter((hit) => hit.kind === "filler");
  const insideFiller = (hit) => hit.kind !== "filler" && hit.kind !== "shape" && fillerSpans.some((span) => span.start <= hit.start && hit.end <= span.end);
  const visible = hits.filter((hit) => !insideFiller(hit));
  visible.sort((a, b) => a.start - b.start || b.end - a.end);
  return visible;
}

function trackingRegex(parameter, values) {
  const alternatives = values.map(escapeRegex).join("|");
  return cachedRegex(`tracking:${parameter}:${values.join(",")}`, () => new RegExp(`([?&])${escapeRegex(parameter)}=(?:${alternatives})(?=[&\\s)\\]"'>]|$)(&?)`, "g"));
}

function trackingSub(match, lead, trailingAmpersand) {
  if (lead === "?") return trailingAmpersand ? "?" : "";
  return trailingAmpersand ? "&" : "";
}

const ARTIFACT_CLOSERS = ".,;:!?)]}";
const ARTIFACT_OPENERS = "([{";
const ARTIFACT_BLANKS = " \t\r\n\u00a0\u202f";

function trimTrailingBlanks(value) {
  let end = value.length;
  while (end > 0 && (value[end - 1] === " " || value[end - 1] === "\t")) end -= 1;
  return value.slice(0, end);
}

function joinAroundArtifact(out, lead, trail, after) {
  if (after === "" || after === "\n" || after === "\r" || ARTIFACT_CLOSERS.includes(after)) return trimTrailingBlanks(out);
  const before = out.slice(-1);
  if (before === "" || ARTIFACT_BLANKS.includes(before) || ARTIFACT_OPENERS.includes(before)) return out;
  return out + (lead || trail);
}

function removeArtifacts(text, re) {
  let out = "";
  let last = 0;
  let count = 0;
  re.lastIndex = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match[0] === "") {
      re.lastIndex += 1;
      continue;
    }
    count += 1;
    const end = match.index + match[0].length;
    out = joinAroundArtifact(out + text.slice(last, match.index), match.groups.lead, match.groups.trail, text.charAt(end));
    last = end;
  }
  return { text: out + text.slice(last), count };
}

function cleanArtifacts(text, config, rules) {
  const spec = rules.artifacts;
  if (!spec) return { text, findings: [] };
  const findings = [];
  const removed = new Map();
  for (const entry of spec.remove_patterns || []) {
    const re = cachedRegex(`artifact:${entry.id}`, () => new RegExp(`(?<lead>[ \\t]*)(?:${entry.pattern})(?<trail>[ \\t]*)`, "g"));
    const result = removeArtifacts(text, re);
    if (result.count) {
      text = result.text;
      removed.set(entry.id, result.count);
    }
  }
  for (const [parameter, values] of Object.entries(spec.url_tracking_params || {})) {
    const re = trackingRegex(parameter, values);
    const n = countMatches(text, re);
    if (n) {
      text = text.replace(re, trackingSub);
      removed.set(`${parameter}-tracking`, n);
    }
  }
  if (removed.size) {
    const total = [...removed.values()].reduce((a, b) => a + b, 0);
    findings.push(finding("artifacts", "copy-artifact", "fixed", "removed assistant copy artifacts (citation markers, tracking parameters)", total, [...removed.keys()].slice(0, 8), fromMap(removed)));
  }
  const warned = new Map();
  for (const entry of spec.warn_patterns || []) {
    const re = cachedRegex(`artifact-warn:${entry.id}`, () => new RegExp(entry.pattern, "g"));
    const n = countMatches(text, re);
    if (n) warned.set(entry.id, n);
  }
  if (warned.size) {
    const total = [...warned.values()].reduce((a, b) => a + b, 0);
    findings.push(finding("artifacts", "copy-artifact", "warn", "assistant upload or session references present (review the link)", total, [...warned.keys()].slice(0, 8), fromMap(warned)));
  }
  return { text, findings };
}

const LAYERS = {
  entities: cleanEntities,
  characters: cleanCharacters,
  homoglyphs: cleanHomoglyphs,
  typography: cleanTypography,
  voice: cleanVoice,
  artifacts: cleanArtifacts,
};

module.exports = { LAYERS, classifyCharacters, findPhrases };
