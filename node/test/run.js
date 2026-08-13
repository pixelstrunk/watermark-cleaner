const assert = require("assert");
const path = require("path");

process.env.WMC_RULES_DIR = process.env.WMC_RULES_DIR || path.join(__dirname, "..", "..", "rules");

const { DEFAULTS, applyAggressive } = require("../src/config");
const { cleanText } = require("../src/core");

function clean(text, overrides) {
  const config = { ...DEFAULTS, ...(overrides || {}) };
  return cleanText(text, config);
}

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
}

ok("removes zero width space", () => {
  assert.strictEqual(clean("a​b").text, "ab");
});

ok("strips tag characters", () => {
  assert.strictEqual(clean("hi\u{e0041}\u{e0042}").text, "hi");
});

ok("keeps zwj for emoji", () => {
  const text = "\u{1f469}‍\u{1f4bb}";
  assert.ok(clean(text).text.includes("‍"));
});

ok("preserves number nbsp", () => {
  assert.strictEqual(clean("12 000").text, "12 000");
});

ok("straightens quotes", () => {
  assert.strictEqual(clean("“hi”").text, '"hi"');
});

ok("em dash spaced to comma", () => {
  assert.strictEqual(clean("fast — slow").text, "fast, slow");
});

ok("em dash unspaced to hyphen", () => {
  assert.strictEqual(clean("fast—slow").text, "fast-slow");
});

ok("ellipsis normalized", () => {
  assert.strictEqual(clean("wait…").text, "wait...");
});

ok("collapse dot run", () => {
  assert.strictEqual(clean("done....").text, "done...");
});

ok("banned phrase blocks", () => {
  assert.ok(clean("We should delve into this.").report.has_errors);
});

ok("sentence shape blocks", () => {
  assert.ok(clean("This isn't a tool. This is a movement.").report.has_errors);
});

ok("safe delete removes filler", () => {
  assert.ok(!clean("Without further ado, we ship.").text.toLowerCase().includes("further ado"));
});

ok("lexicon warns not blocks", () => {
  const report = clean("A robust and seamless system.").report;
  assert.ok(!report.has_errors);
  assert.ok(report.findings.some((f) => f.severity === "warn"));
});

ok("homoglyph detect only by default", () => {
  const result = clean("prіce");
  assert.strictEqual(result.text, "prіce");
  assert.ok(result.report.findings.some((f) => f.kind === "confusable" && f.severity === "warn"));
});

ok("homoglyph replace when aggressive", () => {
  const config = applyAggressive({ ...DEFAULTS });
  assert.strictEqual(cleanText("prіce", config).text, "price");
});

ok("idempotent fix", () => {
  const once = clean("In today’s world — “go”​ delve now…").text;
  const twice = clean(once);
  assert.strictEqual(once, twice.text);
  assert.ok(!twice.report.findings.some((f) => f.severity === "fixed"));
});

ok("zwnj removed between latin letters", () => {
  assert.strictEqual(clean("water‌mark").text, "watermark");
});

ok("zwnj kept in persian", () => {
  assert.ok(clean("می‌خواهم").text.includes("‌"));
});

ok("bidi mark removed in latin text", () => {
  assert.strictEqual(clean("‎foo bar").text, "foo bar");
});

ok("bidi mark kept in rtl document", () => {
  const result = clean("שלום ‎ world");
  assert.ok(result.text.includes("‎"));
  assert.ok(result.report.findings.some((f) => f.kind === "bidi-control" && f.severity === "warn"));
});

ok("safe delete capitalizes sentence start", () => {
  assert.strictEqual(clean("In conclusion, we did it.").text, "We did it.");
});

ok("safe delete across newline", () => {
  assert.strictEqual(clean("We did it. It's worth noting that\nthis works.").text, "We did it.\nThis works.");
});

ok("safe delete mid sentence", () => {
  assert.strictEqual(clean("We ship, without further ado, tomorrow.").text, "We ship, tomorrow.");
});

ok("object-taking phrase blocked not deleted", () => {
  const result = clean("Let's explore the API together.");
  assert.strictEqual(result.text, "Let's explore the API together.");
  assert.ok(result.report.has_errors);
});

ok("dash policy override", () => {
  assert.strictEqual(clean("fast — slow", { dash_policy: { spaced_replacement: " - " } }).text, "fast - slow");
});

ok("code fence typography untouched", () => {
  const result = clean('Say “hi”.\n\n```python\nprint(“kept”)\n```\n');
  assert.ok(result.text.includes('Say "hi".'));
  assert.ok(result.text.includes("print(“kept”)"));
});

ok("inline code untouched", () => {
  const result = clean("Use `--flag — value` here — ok.");
  assert.ok(result.text.includes("`--flag — value`"));
  assert.ok(result.text.includes("here, ok."));
});

ok("frontmatter untouched", () => {
  const result = clean('---\ntitle: “Post”\n---\nBody “text”.\n');
  assert.ok(result.text.includes("title: “Post”"));
  assert.ok(result.text.includes('Body "text".'));
});

ok("invisible chars still removed inside code", () => {
  assert.ok(!clean("```\nif user​name == admin\n```").text.includes("​"));
});

ok("voice skips code", () => {
  assert.ok(!clean("```\nWe delve into this.\n```").report.has_errors);
});

ok("indentation preserved after safe delete", () => {
  const result = clean("In conclusion, done.\n\n    indented  code\n");
  assert.ok(result.text.includes("    indented  code"));
});

ok("phrase before period", () => {
  assert.strictEqual(clean("We ship without further ado.").text, "We ship.");
});

ok("custom banned phrase blocks", () => {
  const result = clean("Our synergy blaster is live.", { custom_banned_phrases: ["synergy blaster"] });
  assert.ok(result.report.has_errors);
});

ok("ignore phrase unblocks", () => {
  const result = clean("We delve into this.", { ignore_phrases: ["delve into", "delve"] });
  assert.ok(!result.report.has_errors);
  assert.ok(!result.report.findings.some((f) => f.kind === "lexicon"));
});

ok("nbsp between non-ascii digits replaced", () => {
  assert.strictEqual(clean("١٢ ٣٤٥").text, "١٢ ٣٤٥");
});

const { stripJpeg, stripPng, stripWebp } = require("../src/metadata");

function jpegSegment(marker, payload) {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

function makeJpeg(withExif) {
  const parts = [Buffer.from([0xff, 0xd8]), jpegSegment(0xe0, Buffer.from("JFIF\x00\x01\x02", "latin1"))];
  if (withExif) {
    parts.push(jpegSegment(0xe1, Buffer.from("Exif\x00\x00secretcamera", "latin1")));
    parts.push(jpegSegment(0xfe, Buffer.from("a comment", "latin1")));
  }
  parts.push(jpegSegment(0xdb, Buffer.alloc(65)));
  parts.push(Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00]));
  parts.push(Buffer.from("scan-data-here", "latin1"));
  parts.push(Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

function pngChunk(type, payload) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length, 0);
  return Buffer.concat([len, Buffer.from(type, "latin1"), payload, Buffer.alloc(4)]);
}

function makePng(withText) {
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", Buffer.alloc(13))];
  if (withText) parts.push(pngChunk("tEXt", Buffer.from("Comment\x00made by an ai", "latin1")));
  parts.push(pngChunk("IDAT", Buffer.from([0, 1, 2])));
  parts.push(pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function webpChunk(fourcc, payload) {
  const head = Buffer.alloc(8);
  head.write(fourcc, 0, "latin1");
  head.writeUInt32LE(payload.length, 4);
  const parts = [head, payload];
  if (payload.length % 2) parts.push(Buffer.alloc(1));
  return Buffer.concat(parts);
}

function makeWebp(withExif) {
  const flags = withExif ? 0x0c : 0x00;
  const body = [webpChunk("VP8X", Buffer.concat([Buffer.from([flags]), Buffer.alloc(9)]))];
  if (withExif) {
    body.push(webpChunk("EXIF", Buffer.from("exif-payload", "latin1")));
    body.push(webpChunk("XMP ", Buffer.from("xmp-payload", "latin1")));
  }
  body.push(webpChunk("VP8 ", Buffer.alloc(10)));
  const joined = Buffer.concat(body);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(joined.length + 4, 4);
  header.write("WEBP", 8, "latin1");
  return Buffer.concat([header, joined]);
}

ok("jpeg exif and comment stripped losslessly", () => {
  const { cleaned, stripped } = stripJpeg(makeJpeg(true));
  assert.strictEqual(stripped, 2);
  assert.ok(!cleaned.includes("secretcamera"));
  assert.ok(cleaned.includes("scan-data-here"));
  assert.ok(cleaned.includes("JFIF"));
});

ok("clean jpeg untouched", () => {
  const { cleaned, stripped } = stripJpeg(makeJpeg(false));
  assert.strictEqual(stripped, 0);
  assert.ok(cleaned.equals(makeJpeg(false)));
});

ok("jpeg garbage returns null", () => {
  assert.strictEqual(stripJpeg(Buffer.from("not a jpeg")), null);
});

ok("png text chunks stripped", () => {
  const { cleaned, stripped } = stripPng(makePng(true));
  assert.strictEqual(stripped, 1);
  assert.ok(!cleaned.includes("made by an ai"));
  assert.ok(cleaned.includes("IDAT"));
});

ok("clean png untouched", () => {
  const { cleaned, stripped } = stripPng(makePng(false));
  assert.strictEqual(stripped, 0);
  assert.ok(cleaned.equals(makePng(false)));
});

ok("webp exif stripped and flags cleared", () => {
  const { cleaned, stripped } = stripWebp(makeWebp(true));
  assert.strictEqual(stripped, 2);
  assert.ok(!cleaned.includes("exif-payload"));
  const at = cleaned.indexOf("VP8X");
  assert.ok(at !== -1);
  assert.strictEqual(cleaned[at + 8] & 0x0c, 0);
  assert.strictEqual(cleaned.readUInt32LE(4), cleaned.length - 8);
});

ok("webp c2pa jumb chunk stripped", () => {
  const body = Buffer.concat([
    webpChunk("VP8X", Buffer.alloc(10)),
    webpChunk("JUMB", Buffer.from("c2pa-manifest-payload", "latin1")),
    webpChunk("VP8 ", Buffer.alloc(10)),
  ]);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "latin1");
  const { cleaned, stripped } = stripWebp(Buffer.concat([header, body]));
  assert.strictEqual(stripped, 1);
  assert.ok(!cleaned.includes("c2pa-manifest-payload"));
});

ok("png icc kept by default", () => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const data = Buffer.concat([sig, pngChunk("IHDR", Buffer.alloc(13)), pngChunk("iCCP", Buffer.from("profile", "latin1")), pngChunk("IDAT", Buffer.alloc(1)), pngChunk("IEND", Buffer.alloc(0))]);
  const { cleaned, stripped } = stripPng(data);
  assert.strictEqual(stripped, 0);
  assert.ok(cleaned.includes("iCCP"));
});

ok("png icc stripped when requested", () => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const data = Buffer.concat([sig, pngChunk("IHDR", Buffer.alloc(13)), pngChunk("iCCP", Buffer.from("profile", "latin1")), pngChunk("IDAT", Buffer.alloc(1)), pngChunk("IEND", Buffer.alloc(0))]);
  const { cleaned, stripped } = stripPng(data, true);
  assert.strictEqual(stripped, 1);
  assert.ok(!cleaned.includes("iCCP"));
});

ok("jpeg icc kept by default", () => {
  const data = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe2, Buffer.from("ICC_PROFILE\x00data", "latin1")),
    Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00]),
    Buffer.from("scan", "latin1"),
    Buffer.from([0xff, 0xd9]),
  ]);
  const { cleaned, stripped } = stripJpeg(data);
  assert.strictEqual(stripped, 0);
  assert.ok(cleaned.includes("ICC_PROFILE"));
});

const fs = require("fs");
const os = require("os");
const nodePath = require("path");
const { writeAtomic } = require("../src/safeio");
const { run } = require("../src/runner");
const { DEFAULTS: RUN_DEFAULTS } = require("../src/config");

ok("atomic write replaces content and leaves no temp files", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "wmc-"));
  const target = nodePath.join(tmp, "a.md");
  fs.writeFileSync(target, "old");
  writeAtomic(target, "new");
  assert.strictEqual(fs.readFileSync(target, "utf-8"), "new");
  assert.ok(!fs.readdirSync(tmp).some((f) => f.endsWith(".wmc-tmp")));
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("fix refuses symlinked text file", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "wmc-"));
  const real = nodePath.join(tmp, "real.md");
  fs.writeFileSync(real, "smart “quotes”");
  const link = nodePath.join(tmp, "link.md");
  fs.symlinkSync(real, link);
  const reports = run([link], { ...RUN_DEFAULTS }, true);
  assert.ok(reports[0].findings.some((f) => f.kind === "write" && f.severity === "warn"));
  assert.strictEqual(fs.readFileSync(real, "utf-8"), "smart “quotes”");
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("oversized file skipped", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "wmc-"));
  const target = nodePath.join(tmp, "big.md");
  fs.writeFileSync(target, "x".repeat(100));
  const reports = run([target], { ...RUN_DEFAULTS, max_file_bytes: 10 }, true);
  assert.ok(reports[0].findings.some((f) => f.message.includes("max_file_bytes")));
  assert.strictEqual(fs.readFileSync(target, "utf-8"), "x".repeat(100));
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log(`\n${passed} node tests passed`);
