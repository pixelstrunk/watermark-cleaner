const assert = require("assert");
const path = require("path");

process.env.WATERMARK_CLEANER_RULES_DIR = process.env.WATERMARK_CLEANER_RULES_DIR || path.join(__dirname, "..", "..", "rules");

const { DEFAULTS, applyAggressive } = require("../src/config");
const { cleanText } = require("../src/core");

function clean(text, overrides) {
  const config = { ...DEFAULTS, ...(overrides || {}) };
  return cleanText(text, config);
}

let passed = 0;
let failed = 0;
function ok(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
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

const { stripJpeg, stripPng, stripWebp, cleanFile: cleanImageFile, inspectFile: inspectImageFile } = require("../src/metadata");
const { readOrientation, crc32 } = require("../src/image");

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

function tiffWithOrientation(orientation, little) {
  const order = little ? [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00] : [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08];
  const u16 = (v) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v) => (little ? [v & 0xff, (v >> 8) & 0xff, 0, 0] : [0, 0, (v >> 8) & 0xff, v & 0xff]);
  return Buffer.from([...order, ...u16(2), ...u16(0x010f), ...u16(2), ...u32(4), 0x41, 0x42, 0x43, 0x00, ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, 0, 0, 0, 0]);
}

function jpegWithOrientation(orientation, little, withApp0 = true) {
  const parts = [Buffer.from([0xff, 0xd8])];
  if (withApp0) parts.push(jpegSegment(0xe0, Buffer.from("JFIF\x00\x01\x02", "latin1")));
  parts.push(jpegSegment(0xe1, Buffer.concat([Buffer.from("Exif\x00\x00", "latin1"), tiffWithOrientation(orientation, little)])));
  parts.push(jpegSegment(0xdb, Buffer.alloc(65)), Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00]), Buffer.from("scan", "latin1"), Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

const MINIMAL_EXIF_TIFF = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);

ok("jpeg keeps exif orientation in a minimal app1 behind app0", () => {
  const { cleaned, stripped, orientation } = stripJpeg(jpegWithOrientation(6, false));
  assert.strictEqual(stripped, 1);
  assert.strictEqual(orientation, 6);
  assert.ok(!cleaned.includes("ABC"));
  const app0 = cleaned.indexOf("JFIF");
  const app1 = cleaned.indexOf("Exif\x00\x00", "latin1");
  assert.ok(app0 !== -1 && app1 > app0);
  assert.strictEqual(cleaned.readUInt16BE(app1 - 2), 34);
  assert.ok(cleaned.subarray(app1 + 6, app1 + 6 + 26).equals(MINIMAL_EXIF_TIFF));
  assert.strictEqual(readOrientation(cleaned.subarray(app1, app1 + 32)), 6);
});

ok("jpeg orientation app1 goes right after soi without app0, little-endian exif is read too", () => {
  const { cleaned, orientation } = stripJpeg(jpegWithOrientation(8, true, false));
  assert.strictEqual(orientation, 8);
  assert.strictEqual(cleaned[2], 0xff);
  assert.strictEqual(cleaned[3], 0xe1);
  assert.strictEqual(readOrientation(cleaned.subarray(6, 38)), 8);
  assert.strictEqual(stripJpeg(jpegWithOrientation(3, false)).orientation, 3);
});

ok("upright or missing orientation writes no exif back", () => {
  const upright = stripJpeg(jpegWithOrientation(1, false));
  assert.strictEqual(upright.orientation, null);
  assert.ok(!upright.cleaned.includes("Exif"));
  const none = stripJpeg(makeJpeg(true));
  assert.strictEqual(none.orientation, null);
  assert.ok(!none.cleaned.includes("Exif"));
});

ok("cleaning a cleaned rotated jpeg is a no-op", () => {
  const once = stripJpeg(jpegWithOrientation(6, false)).cleaned;
  const twice = stripJpeg(once);
  assert.ok(twice.cleaned.equals(once));
  const dir = require("fs").mkdtempSync(path.join(require("os").tmpdir(), "wmc-orient-"));
  const file = path.join(dir, "photo.jpg");
  require("fs").writeFileSync(file, once);
  const report = inspectImageFile(file, false);
  assert.strictEqual(report.changed, false);
  assert.deepStrictEqual(report.findings, []);
});

ok("png keeps exif orientation in an eXIf chunk behind ihdr with a valid crc", () => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const data = Buffer.concat([sig, pngChunk("IHDR", Buffer.alloc(13)), pngChunk("tEXt", Buffer.from("Software\x00ai", "latin1")), pngChunk("eXIf", tiffWithOrientation(6, true)), pngChunk("IDAT", Buffer.alloc(1)), pngChunk("IEND", Buffer.alloc(0))]);
  const { cleaned, stripped, orientation } = stripPng(data);
  assert.strictEqual(stripped, 2);
  assert.strictEqual(orientation, 6);
  const at = cleaned.indexOf("eXIf");
  assert.strictEqual(at, 8 + 25 + 4);
  assert.strictEqual(cleaned.readUInt32BE(at - 4), 26);
  assert.ok(cleaned.subarray(at + 4, at + 30).equals(MINIMAL_EXIF_TIFF));
  assert.strictEqual(cleaned.readUInt32BE(at + 30), crc32(cleaned.subarray(at, at + 30)));
  assert.strictEqual(crc32(Buffer.from("123456789", "latin1")), 0xcbf43926);
});

ok("webp keeps exif orientation in a trailing exif chunk and keeps the vp8x exif flag", () => {
  const body = Buffer.concat([
    webpChunk("VP8X", Buffer.concat([Buffer.from([0x0c]), Buffer.alloc(9)])),
    webpChunk("VP8 ", Buffer.alloc(10)),
    webpChunk("EXIF", Buffer.concat([Buffer.from("Exif\x00\x00", "latin1"), tiffWithOrientation(6, false)])),
    webpChunk("XMP ", Buffer.from("xmp-payload", "latin1")),
  ]);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "latin1");
  const { cleaned, stripped, orientation } = stripWebp(Buffer.concat([header, body]));
  assert.strictEqual(stripped, 2);
  assert.strictEqual(orientation, 6);
  assert.ok(!cleaned.includes("xmp-payload"));
  assert.strictEqual(cleaned[cleaned.indexOf("VP8X") + 8], 0x08);
  const at = cleaned.lastIndexOf("EXIF");
  assert.strictEqual(at, cleaned.length - 34);
  assert.strictEqual(cleaned.readUInt32LE(at + 4), 26);
  assert.ok(cleaned.subarray(at + 8).equals(MINIMAL_EXIF_TIFF));
  assert.strictEqual(cleaned.readUInt32LE(4), cleaned.length - 8);
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
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const target = nodePath.join(tmp, "a.md");
  fs.writeFileSync(target, "old");
  writeAtomic(target, "new");
  assert.strictEqual(fs.readFileSync(target, "utf-8"), "new");
  assert.ok(!fs.readdirSync(tmp).some((f) => f.endsWith(".watermark-cleaner-tmp")));
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("fix refuses symlinked text file", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
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
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const target = nodePath.join(tmp, "big.md");
  fs.writeFileSync(target, "x".repeat(100));
  const reports = run([target], { ...RUN_DEFAULTS, max_file_bytes: 10 }, true);
  assert.ok(reports[0].findings.some((f) => f.message.includes("max_file_bytes")));
  assert.strictEqual(fs.readFileSync(target, "utf-8"), "x".repeat(100));
  fs.rmSync(tmp, { recursive: true, force: true });
});

const zlib = require("zlib");
const office = require("../src/office");

ok("crc32 matches known vectors", () => {
  assert.strictEqual(office.crc32(Buffer.from("")), 0);
  assert.strictEqual(office.crc32(Buffer.from("The quick brown fox jumps over the lazy dog")), 0x414fa339);
});

function buildZip(entries) {
  const ZIP_STORED = 0;
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf-8");
    const contentBuf = Buffer.from(entry.content, "utf-8");
    const method = entry.method === undefined ? 8 : entry.method;
    const compData = method === ZIP_STORED ? contentBuf : zlib.deflateRawSync(contentBuf);
    const crc = office.crc32(contentBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x21, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compData.length, 18);
    localHeader.writeUInt32LE(contentBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    const localOffset = offset;
    localParts.push(localHeader, nameBuf, compData);
    offset += localHeader.length + nameBuf.length + compData.length;

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x21, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compData.length, 20);
    centralHeader.writeUInt32LE(contentBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, nameBuf);
  }
  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

function readZipEntries(buffer) {
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  assert.ok(eocdOffset !== -1);
  const total = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  const result = {};
  const order = [];
  let pos = cdOffset;
  for (let i = 0; i < total; i += 1) {
    assert.strictEqual(buffer.readUInt32LE(pos), 0x02014b50);
    const method = buffer.readUInt16LE(pos + 10);
    const csize = buffer.readUInt32LE(pos + 20);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.subarray(pos + 46, pos + 46 + nameLen).toString("utf-8");
    const nameLenLocal = buffer.readUInt16LE(localOffset + 26);
    const extraLenLocal = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + nameLenLocal + extraLenLocal;
    const compData = buffer.subarray(dataStart, dataStart + csize);
    const content = method === 0 ? compData : zlib.inflateRawSync(compData);
    result[name] = { content: content.toString("utf-8"), method };
    order.push(name);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return { entries: result, order };
}

const DOCX_CORE = '<cp:coreProperties xmlns:cp="cp" xmlns:dc="dc"><dc:title>Quarterly Report</dc:title><dc:creator>Jane Doe</dc:creator><cp:lastModifiedBy>Jane Doe</cp:lastModifiedBy></cp:coreProperties>';
const DOCX_APP = '<Properties xmlns="app"><Application>Microsoft Office Word</Application><Company>Acme Inc</Company><Manager>Jane Doe</Manager></Properties>';
const DOCX_DOCUMENT = '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Hello world</w:t></w:r></w:p></w:body></w:document>';
const ODT_META = '<office:document-meta xmlns:office="office" xmlns:dc="dc" xmlns:meta="meta"><office:meta><meta:generator>SomeWordProcessor/1.0</meta:generator><meta:initial-creator>Jane Doe</meta:initial-creator><dc:creator>Jane Doe</dc:creator></office:meta></office:document-meta>';
const ODT_CONTENT = '<office:document-content xmlns:office="office"><office:body>Hello world</office:body></office:document-content>';
const ODT_MIMETYPE = "application/vnd.oasis.opendocument.text";

function makeDocx(core, app, document) {
  return buildZip([
    { name: "[Content_Types].xml", content: "<Types/>" },
    { name: "word/document.xml", content: document !== undefined ? document : DOCX_DOCUMENT },
    { name: "docProps/core.xml", content: core !== undefined ? core : DOCX_CORE },
    { name: "docProps/app.xml", content: app !== undefined ? app : DOCX_APP },
  ]);
}

function makeOdt(meta, content) {
  return buildZip([
    { name: "mimetype", content: ODT_MIMETYPE, method: 0 },
    { name: "META-INF/manifest.xml", content: "<manifest/>" },
    { name: "content.xml", content: content !== undefined ? content : ODT_CONTENT },
    { name: "meta.xml", content: meta !== undefined ? meta : ODT_META },
  ]);
}

ok("docx strips author and app metadata, preserves document body", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const target = nodePath.join(tmp, "report.docx");
  fs.writeFileSync(target, makeDocx());
  const report = office.cleanFile(target, true, false);
  assert.strictEqual(report.changed, true);
  assert.strictEqual(report.counts.fixed, 5);
  const { entries } = readZipEntries(fs.readFileSync(target));
  assert.ok(!entries["docProps/core.xml"].content.includes("Jane Doe"));
  assert.ok(entries["docProps/core.xml"].content.includes("Quarterly Report"));
  assert.ok(!entries["docProps/app.xml"].content.includes("Microsoft Office Word"));
  assert.ok(!entries["docProps/app.xml"].content.includes("Acme Inc"));
  assert.strictEqual(entries["word/document.xml"].content, DOCX_DOCUMENT);
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("odt strips creator and generator, keeps mimetype first and stored", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const target = nodePath.join(tmp, "notes.odt");
  fs.writeFileSync(target, makeOdt());
  const report = office.cleanFile(target, true, false);
  assert.strictEqual(report.changed, true);
  const { entries, order } = readZipEntries(fs.readFileSync(target));
  assert.strictEqual(order[0], "mimetype");
  assert.strictEqual(entries.mimetype.method, 0);
  assert.ok(!entries["meta.xml"].content.includes("Jane Doe"));
  assert.ok(!entries["meta.xml"].content.includes("SomeWordProcessor"));
  assert.strictEqual(entries["content.xml"].content, ODT_CONTENT);
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("already-clean docx is left byte-identical", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const target = nodePath.join(tmp, "clean.docx");
  const core = '<cp:coreProperties xmlns:cp="cp" xmlns:dc="dc"><dc:title>Quarterly Report</dc:title></cp:coreProperties>';
  const app = '<Properties xmlns="app"></Properties>';
  const original = makeDocx(core, app);
  fs.writeFileSync(target, original);
  const report = office.cleanFile(target, true, false);
  assert.strictEqual(report.changed, false);
  assert.ok(fs.readFileSync(target).equals(original));
  assert.ok(!fs.existsSync(`${target}.bak`));
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("docx inspect mode does not write", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const target = nodePath.join(tmp, "report.docx");
  const original = makeDocx();
  fs.writeFileSync(target, original);
  const report = office.inspectFile(target);
  assert.strictEqual(report.changed, true);
  assert.strictEqual(report.counts.fixed, 5);
  assert.ok(fs.readFileSync(target).equals(original));
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("corrupt docx reports warning and leaves file untouched", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const target = nodePath.join(tmp, "broken.docx");
  const original = Buffer.from("not actually a zip file");
  fs.writeFileSync(target, original);
  const report = office.cleanFile(target, true, false);
  assert.strictEqual(report.changed, false);
  assert.ok(fs.readFileSync(target).equals(original));
  assert.ok(report.findings.some((f) => f.message.includes("could not parse")));
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("docx backup created when enabled", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const target = nodePath.join(tmp, "report.docx");
  fs.writeFileSync(target, makeDocx());
  office.cleanFile(target, true, true);
  assert.ok(fs.existsSync(`${target}.bak`));
  fs.rmSync(tmp, { recursive: true, force: true });
});

const { loadConfig } = require("../src/config");

ok("crlf front matter is protected and line endings preserved", () => {
  const text = '---\r\ntitle: "Foo — Bar"\r\n---\r\n\r\nBody — text.\r\n';
  const result = clean(text);
  assert.ok(result.text.includes('title: "Foo — Bar"'));
  assert.ok(result.text.includes("Body, text."));
  assert.ok(result.text.includes("\r\n"));
});

ok("crlf filler phrase at line start is removed and repaired", () => {
  const text = "First line.\r\nIt's worth noting that the cache is cold.\r\n";
  const result = clean(text);
  assert.strictEqual(result.text, "First line.\r\nThe cache is cold.\r\n");
});

ok("empty dash replacement in config is honored", () => {
  const result = clean("fast — slow", { dash_policy: { spaced_replacement: "" } });
  assert.strictEqual(result.text, "fastslow");
});

ok("non-boolean config value is rejected with a clear error", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  fs.writeFileSync(nodePath.join(tmp, "watermark-cleaner.config.json"), '{"voice": 0}');
  assert.throws(() => loadConfig(undefined, tmp), /"voice" must be true or false/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("directory named like an rc file does not crash config lookup", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  fs.mkdirSync(nodePath.join(tmp, ".watermark-cleanerrc"));
  const config = loadConfig(undefined, tmp);
  assert.strictEqual(config.voice, true);
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("warn-severity sentence shapes do not block", () => {
  const result = clean("Not only fast, but also reliable.");
  const shape = result.report.findings.find((f) => f.kind === "sentence-shape");
  assert.ok(shape);
  assert.strictEqual(shape.severity, "warn");
  assert.strictEqual(result.report.has_errors, false);
});

ok("filler count reflects actual deletions", () => {
  const text = "It's worth noting that a. It's worth noting that b.";
  const result = clean(text);
  const filler = result.report.findings.find((f) => f.kind === "filler-phrase");
  assert.strictEqual(filler.count, 2);
});

ok("encrypted zip entry is refused, file untouched", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const target = nodePath.join(tmp, "enc.docx");
  const buffer = makeDocx();
  const centralOffset = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(centralOffset > 0);
  buffer.writeUInt16LE(1, centralOffset + 8);
  fs.writeFileSync(target, buffer);
  const report = office.cleanFile(target, true, false);
  assert.ok(report.findings.some((f) => f.message.includes("could not parse")));
  assert.ok(fs.readFileSync(target).equals(buffer));
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("cli flushes a large json report through a pipe before exiting", () => {
  const { spawnSync } = require("child_process");
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const line = "Let’s dive in — “quote” a plethora of things, in today’s fast-paced world.\n";
  for (let i = 0; i < 300; i += 1) fs.writeFileSync(nodePath.join(tmp, `f${i}.md`), line);
  const bin = nodePath.join(__dirname, "..", "bin", "watermark-cleaner.js");
  const result = spawnSync(process.execPath, [bin, "check", tmp, "--json"], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.strictEqual(result.status, 1);
  assert.ok(result.stdout.length > 65536, `expected more than one pipe buffer of output, got ${result.stdout.length}`);
  const payload = JSON.parse(result.stdout);
  assert.strictEqual(payload.reports.length, 300);
});

ok("fix_dashes disabled keeps every dash", () => {
  const text = "fast — slow, 1990–1995, a‒b, c―d";
  const result = clean(text, { fix_dashes: false });
  assert.strictEqual(result.text, text);
  assert.deepStrictEqual(result.report.findings, []);
});

ok("fix_dashes enabled still replaces every dash", () => {
  assert.strictEqual(clean("fast — slow, 1990–1995, a‒b, c―d").text, "fast, slow, 1990-1995, a-b, c-d");
});

ok("pure cyrillic and greek text is not a homoglyph finding", () => {
  for (const text of ["Привет, это обычный русский текст.", "Αθήνα και Βόρεια Ελλάδα"]) {
    const result = clean(text, { replace_homoglyphs: true });
    assert.strictEqual(result.text, text);
    assert.deepStrictEqual(result.report.findings, []);
  }
});

ok("mixed-script word is flagged and replaced", () => {
  const result = clean("log in at pаypal now", { replace_homoglyphs: true });
  assert.strictEqual(result.text, "log in at paypal now");
  assert.strictEqual(result.report.findings[0].count, 1);
});

ok("all-confusable word in a latin document is flagged", () => {
  const result = clean("Visit СОРЕ today", { replace_homoglyphs: true });
  assert.strictEqual(result.text, "Visit COPE today");
  assert.strictEqual(result.report.findings[0].count, 4);
});

ok("all-confusable word next to genuine cyrillic is kept", () => {
  const text = "Слово а значит and";
  const result = clean(text, { replace_homoglyphs: true });
  assert.strictEqual(result.text, text);
  assert.deepStrictEqual(result.report.findings, []);
});

ok("mixed word inside a cyrillic document is still flagged", () => {
  const result = clean("Привет, log in at pаypal", { replace_homoglyphs: true });
  assert.strictEqual(result.text, "Привет, log in at paypal");
  assert.strictEqual(result.report.findings[0].count, 1);
});

ok("every sentence shape matches its own example", () => {
  const { loadRules } = require("../src/rules");
  for (const shape of loadRules().phrases.sentence_shapes) {
    const ids = clean(shape.example).report.findings.filter((f) => f.kind === "sentence-shape").flatMap((f) => f.examples);
    assert.ok(ids.includes(shape.id), `${shape.id} misses its example`);
  }
});

ok("period-separated sentence shapes block", () => {
  for (const text of [
    "Agile is dead. Flow is the future.",
    "Stop thinking features. Start thinking jobs.",
    "The question isn't how. The question is why.",
    "You don't need more tools. You need focus.",
  ]) {
    assert.strictEqual(clean(text).report.has_errors, true, text);
  }
});

ok("unrelated sentences do not trigger a shape", () => {
  assert.strictEqual(clean("Agile is dead. We moved on. Years later, nobody asked what is the future.").report.has_errors, false);
});

ok("docx blanks authors in tracked changes, comments and people list", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const target = nodePath.join(tmp, "tracked.docx");
  fs.writeFileSync(target, buildZip([
    { name: "[Content_Types].xml", content: "<Types/>" },
    { name: "word/document.xml", content: '<w:document xmlns:w="w"><w:body><w:p><w:ins w:id="1" w:author="Carol Reviewer" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Hello</w:t></w:r></w:ins><w:del w:id="2" w:author="Carol Reviewer" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>Bye</w:delText></w:r></w:del></w:p></w:body></w:document>' },
    { name: "word/comments.xml", content: '<w:comments xmlns:w="w"><w:comment w:id="0" w:author="Dave Editor" w:initials="DE" w:date="2026-01-01T00:00:00Z"><w:p><w:r><w:t>Looks good</w:t></w:r></w:p></w:comment></w:comments>' },
    { name: "word/people.xml", content: '<w15:people xmlns:w15="w15"><w15:person w15:author="Dave Editor"><w15:presenceInfo w15:providerId="Windows Live" w15:userId="dave@example.com"/></w15:person></w15:people>' },
    { name: "word/media/image1.xml", content: '<x author="not a word part"/>' },
    { name: "docProps/core.xml", content: "<cp:coreProperties/>" },
    { name: "docProps/app.xml", content: '<Properties xmlns="app"><Application>Microsoft Office Word</Application><AppVersion>16.0000</AppVersion><Template>Acme_Letterhead.dotm</Template><TotalTime>1342</TotalTime><Pages>3</Pages></Properties>' },
  ]));
  const report = office.cleanFile(target, true, false);
  assert.strictEqual(report.changed, true);
  assert.strictEqual(report.counts.fixed, 2 + 2 + 1 + 4);
  const { entries } = readZipEntries(fs.readFileSync(target));
  for (const name of ["word/document.xml", "word/comments.xml", "word/people.xml"]) {
    assert.ok(!entries[name].content.includes("Carol"), name);
    assert.ok(!entries[name].content.includes("Dave"), name);
  }
  assert.ok(entries["word/document.xml"].content.includes('w:author=""'));
  assert.ok(entries["word/document.xml"].content.includes("<w:t>Hello</w:t>"));
  assert.ok(entries["word/comments.xml"].content.includes('w:initials=""'));
  assert.ok(entries["word/comments.xml"].content.includes("Looks good"));
  assert.strictEqual(entries["word/people.xml"].content, '<w15:people xmlns:w15="w15"></w15:people>');
  assert.ok(!entries["docProps/app.xml"].content.includes("Acme_Letterhead"));
  assert.ok(!entries["docProps/app.xml"].content.includes("TotalTime"));
  assert.ok(entries["docProps/app.xml"].content.includes("<Pages>3</Pages>"));
  assert.strictEqual(entries["word/media/image1.xml"].content, '<x author="not a word part"/>');
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("odt empties creators in annotations and tracked changes", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const target = nodePath.join(tmp, "annotated.odt");
  const content = '<office:document-content xmlns:office="office" xmlns:dc="dc" xmlns:text="text"><office:body><office:annotation><dc:creator>Jane Doe</dc:creator><dc:date>2026-01-01</dc:date><text:p>Check this</text:p></office:annotation><text:tracked-changes><text:changed-region><text:insertion><office:change-info><dc:creator>Jane Doe</dc:creator><dc:date>2026-01-01</dc:date></office:change-info></text:insertion></text:changed-region></text:tracked-changes>Hello world</office:body></office:document-content>';
  const meta = '<office:document-meta xmlns:office="office" xmlns:dc="dc" xmlns:meta="meta"><office:meta><meta:generator>SomeWordProcessor/1.0</meta:generator><dc:creator>Jane Doe</dc:creator><meta:editing-duration>PT2H14M</meta:editing-duration><meta:printed-by>Jane Doe</meta:printed-by><meta:editing-cycles>12</meta:editing-cycles></office:meta></office:document-meta>';
  fs.writeFileSync(target, makeOdt(meta, content));
  const report = office.cleanFile(target, true, false);
  assert.strictEqual(report.changed, true);
  assert.strictEqual(report.counts.fixed, 2 + 4);
  const { entries } = readZipEntries(fs.readFileSync(target));
  assert.ok(!entries["content.xml"].content.includes("Jane Doe"));
  assert.strictEqual(entries["content.xml"].content.split("<dc:creator></dc:creator>").length - 1, 2);
  assert.ok(entries["content.xml"].content.includes("<text:p>Check this</text:p>"));
  assert.ok(!entries["meta.xml"].content.includes("editing-duration"));
  assert.ok(entries["meta.xml"].content.includes("<meta:editing-cycles>12</meta:editing-cycles>"));
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("nbsp next to digits, units, ordinals and abbreviations is kept", () => {
  for (const text of ["10\u00a0%", "5\u00a0kg", "\u00a7\u00a05", "20\u00a0Euro", "Nr.\u00a05", "Kapitel\u00a03", "am 5.\u00a0Mai", "z.\u00a0B. so", "i.\u00a0d.\u00a0R. oft", "o.\u00a0\u00c4. auch"]) {
    assert.strictEqual(clean(text).text, text, JSON.stringify(text));
  }
});

ok("nbsp between words and sentences is replaced", () => {
  assert.strictEqual(clean("Hallo\u00a0Welt").text, "Hallo Welt");
  assert.strictEqual(clean("Ende.\u00a0Neuer Satz.").text, "Ende. Neuer Satz.");
  assert.strictEqual(clean("Dr.\u00a0M\u00fcller").text, "Dr. M\u00fcller");
  assert.strictEqual(clean("10\u00a0% z.\u00a0B.", { keep_nbsp_in_numbers: false }).text, "10 % z. B.");
});

ok("utf-8 svg loses comments and metadata but keeps text and line endings", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const target = nodePath.join(tmp, "logo.svg");
  fs.writeFileSync(target, '<?xml version="1.0" encoding="UTF-8"?>\r\n<!-- Generator: Adobe Illustrator -->\r\n<svg xmlns="http://www.w3.org/2000/svg"><metadata><rdf:RDF>secret</rdf:RDF></metadata><title>Caf\u00e9 M\u00fcnchen</title></svg>\r\n');
  const report = cleanImageFile(target, true, false, false);
  assert.strictEqual(report.changed, true);
  const result = fs.readFileSync(target, "utf-8");
  assert.ok(!result.includes("Illustrator"));
  assert.ok(!result.includes("secret"));
  assert.ok(result.includes("Caf\u00e9 M\u00fcnchen"));
  assert.ok(result.includes("\r\n"));
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("non utf-8 svg is skipped with a warning in check and fix", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const target = nodePath.join(tmp, "old.svg");
  const latin1 = Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?>\n<!-- Generator: Adobe Illustrator -->\n<svg><title>Caf\xe9 M\xfcnchen</title></svg>\n', "latin1");
  fs.writeFileSync(target, latin1);
  for (const report of [inspectImageFile(target, false), cleanImageFile(target, true, false, false)]) {
    assert.strictEqual(report.changed, false);
    assert.deepStrictEqual(report.findings.map((f) => f.message), ["skipped (not utf-8 text)"]);
    assert.strictEqual(report.counts.warn, 1);
  }
  assert.ok(fs.readFileSync(target).equals(latin1));
  assert.ok(!fs.existsSync(`${target}.bak`));
  fs.rmSync(tmp, { recursive: true, force: true });
});

const { run: runAll, collectFiles } = require("../src/runner");
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

ok("read-only directory is reported and the run continues", () => {
  if (isRoot) return;
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const locked = nodePath.join(tmp, "locked");
  fs.mkdirSync(locked);
  fs.writeFileSync(nodePath.join(locked, "a.md"), "smart \u201cquotes\u201d");
  const free = nodePath.join(tmp, "free.md");
  fs.writeFileSync(free, "smart \u201cquotes\u201d");
  fs.chmodSync(locked, 0o555);
  let reports;
  try {
    reports = runAll([tmp], { ...DEFAULTS, backup: false }, true);
  } finally {
    fs.chmodSync(locked, 0o755);
  }
  const byPath = Object.fromEntries(reports.map((r) => [r.path, r]));
  assert.strictEqual(byPath[free].changed, true);
  assert.strictEqual(fs.readFileSync(free, "utf-8"), 'smart "quotes"');
  const lockedReport = byPath[nodePath.join(locked, "a.md")];
  assert.strictEqual(lockedReport.changed, false);
  assert.ok(lockedReport.findings.some((f) => f.message === "skipped (permission denied)"));
  assert.strictEqual(fs.readFileSync(nodePath.join(locked, "a.md"), "utf-8"), "smart \u201cquotes\u201d");
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("unreadable directory is reported as a warning", () => {
  if (isRoot) return;
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const hidden = nodePath.join(tmp, "hidden");
  fs.mkdirSync(hidden);
  fs.writeFileSync(nodePath.join(hidden, "a.md"), "x");
  fs.writeFileSync(nodePath.join(tmp, "b.md"), "x");
  fs.chmodSync(hidden, 0o000);
  let reports;
  try {
    reports = runAll([tmp], { ...DEFAULTS }, false);
  } finally {
    fs.chmodSync(hidden, 0o755);
  }
  const messages = Object.fromEntries(reports.map((r) => [r.path, r.findings.map((f) => f.message)]));
  assert.deepStrictEqual(messages[hidden], ["skipped (permission denied)"]);
  assert.ok(nodePath.join(tmp, "b.md") in messages);
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("symlink to a directory as argument is scanned, inside the tree it is not followed", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const real = nodePath.join(tmp, "real");
  fs.mkdirSync(real);
  fs.writeFileSync(nodePath.join(real, "a.md"), "x");
  const link = nodePath.join(tmp, "link");
  fs.symlinkSync(real, link, "dir");
  const viaLink = collectFiles([link], { ...DEFAULTS });
  assert.deepStrictEqual(viaLink.textFiles.map((f) => nodePath.basename(f)), ["a.md"]);
  assert.deepStrictEqual(viaLink.missing, []);
  const whole = collectFiles([tmp], { ...DEFAULTS });
  assert.deepStrictEqual(whole.textFiles, [nodePath.join(real, "a.md")]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("zwj between latin letters is removed, emoji and indic sequences keep it", () => {
  const result = clean("wa\u200dter\u200dmark");
  assert.strictEqual(result.text, "watermark");
  assert.strictEqual(result.report.findings[0].count, 2);
  for (const text of ["\u{1f468}\u200d\u{1f469}\u200d\u{1f467}", "\u2764\ufe0f\u200d\u{1f525}", "\u0915\u094d\u200d\u0937"]) {
    assert.strictEqual(clean(text).text, text);
  }
});

ok("deprecated format, annotation and filler characters are removed, separators become spaces", () => {
  assert.strictEqual(clean("a\u206ab\u206fc\ufff9d\ufffae\ufffbf\u3164g\uffa0h").text, "abcdefgh");
  assert.strictEqual(clean("one\u2028two\u2029three\u2800four").text, "one two three four");
  assert.strictEqual(clean("\u1820\u180b\u1821").text, "\u1820\u180b\u1821");
  assert.strictEqual(clean("a\u180bb").text, "ab");
  assert.strictEqual(clean("\u1820\u180b\u1821", { strip_variation_selectors: true }).text, "\u1820\u1821");
});

const { execFileSync, spawnSync } = require("child_process");

const ENGLAND = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}";
const SCOTLAND = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";

ok("subdivision flag emoji survive, other tag characters are removed", () => {
  const text = `England ${ENGLAND} and Scotland ${SCOTLAND}.`;
  const result = clean(text);
  assert.strictEqual(result.text, text);
  assert.deepStrictEqual(result.report.findings, []);
  assert.strictEqual(clean("fun\u{E0020}ding and hi\u{E0041}\u{E007F}").text, "funding and hi");
  assert.strictEqual(clean("\u{1F3F4}\u{E0067}\u{E0062}\u{E0065} text").text, "\u{1F3F4} text");
});

ok("spaced dash between numbers becomes a hyphen, typographic hyphens become ascii", () => {
  assert.strictEqual(clean("Open 10 – 20 Uhr, from 1990 — 2000.").text, "Open 10 - 20 Uhr, from 1990 - 2000.");
  assert.strictEqual(clean("fast — slow").text, "fast, slow");
  assert.strictEqual(clean("E‑Mail and co‐operate").text, "E-Mail and co-operate");
});

ok("french narrow no-break spaces before high punctuation are kept", () => {
  const text = "Il dit : bonjour ! «Oui » et 12 000.";
  assert.strictEqual(clean(text, { straight_quotes: false }).text, text);
  assert.strictEqual(clean("hidden mark").text, "hidden mark");
  assert.strictEqual(clean("Il dit :", { keep_nbsp_in_numbers: false }).text, "Il dit :");
});

ok("html entities of invisible characters are decoded and removed, code and nbsp are left alone", () => {
  const text = "<p>Hid&#8203;den &#x200B;more &zwnj;x &shy;y &#65279;z &ZeroWidthSpace;w &nbsp;ok &amp; &lt;</p>";
  const result = clean(text);
  assert.strictEqual(result.text, "<p>Hidden more x y z w &nbsp;ok &amp; &lt;</p>");
  assert.ok(result.report.findings.some((f) => f.message.includes("decoded html entities")));
  const doc = "Use `&#8203;` or ``&zwnj;`` to insert one.\n\n```html\n&#8203;\n```\n";
  assert.strictEqual(clean(doc).text, doc);
  assert.strictEqual(clean("\u{1F468}&zwj;\u{1F4BB}").text, "\u{1F468}‍\u{1F4BB}");
  assert.strictEqual(clean("wa&zwj;ter").text, "water");
});

ok("private use characters, noncharacters and hangul fillers are removed", () => {
  const result = clean("Paris is the capitalciteturn0search0.");
  assert.strictEqual(result.text, "Paris is the capital.");
  assert.ok(result.report.findings.some((f) => f.message.includes("private use")));
  assert.strictEqual(clean("a\u{F0000}b\u{10FFFD}c﷐d￾e").text, "abcde");
  assert.strictEqual(clean("AᅟBᅠCㅤDﾠE").text, "ABCDE");
});

ok("grapheme joiner next to hebrew and braille blank inside braille are kept", () => {
  assert.strictEqual(clean("ב͏ְ").text, "ב͏ְ");
  assert.strictEqual(clean("a͏b").text, "ab");
  assert.strictEqual(clean("⠓⠀⠑").text, "⠓⠀⠑");
  assert.strictEqual(clean("a⠀b").text, "a b");
});

ok("variation selectors are removed only when their base cannot carry one", () => {
  const result = clean("Hello︁︂\u{E0100} world️");
  assert.strictEqual(result.text, "Hello world");
  assert.ok(result.report.findings.some((f) => f.kind === "variation-selector"));
  for (const text of ["❤️", "1️⃣", "辻\u{E0100}", "©️", "↔︎", "ᠠ᠋"]) {
    assert.strictEqual(clean(text).text, text);
  }
  assert.strictEqual(clean("❤️︁︂").text, "❤️");
  assert.strictEqual(clean("❤️", { strip_variation_selectors: true }).text, "❤");
});

ok("assistant copy artifacts and tracking parameters are removed, uploads only warn", () => {
  const text =
    "Fact citeturn0search0 and [cite: 1, 2] and [span_1](start_span)x[span_1](end_span) " +
    "and 【4†source】 see https://x.io/a?utm_source=chatgpt.com&b=1 " +
    "and https://x.io/b?c=2&utm_source=openai and https://x.io/c?utm_source=perplexity done.";
  const result = clean(text);
  assert.strictEqual(result.text, "Fact and and x and see https://x.io/a?b=1 and https://x.io/b?c=2 and https://x.io/c done.");
  const artifact = result.report.findings.find((f) => f.layer === "artifacts");
  assert.strictEqual(artifact.severity, "fixed");
  assert.ok(artifact.examples.includes("utm_source-tracking"));
  assert.strictEqual(clean("https://x.io/?utm_source=newsletter").text, "https://x.io/?utm_source=newsletter");
  const upload = "see https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/x.pdf";
  const uploadResult = clean(upload);
  assert.strictEqual(uploadResult.text, upload);
  assert.deepStrictEqual(uploadResult.report.findings.filter((f) => f.layer === "artifacts").map((f) => f.severity), ["warn"]);
  assert.strictEqual(clean("`citeturn0search0` stays").text, "`citeturn0search0` stays");
});

ok("removing a copy artifact leaves a single space and none before punctuation", () => {
  assert.strictEqual(clean("See source citeturn0search0 and more").text, "See source and more");
  assert.strictEqual(clean("Fact citeturn0search0.").text, "Fact.");
  assert.strictEqual(clean("A [cite: 1] b, then 【1†source】!").text, "A b, then!");
  assert.strictEqual(clean("(see citeturn0search0) and (citeturn0search0 more)").text, "(see) and (more)");
  assert.strictEqual(clean("citeturn0search0 start, end citeturn0search0\nnext").text, "start, end\nnext");
  assert.strictEqual(clean("a citeturn0search0 citeturn0search1 b citeturn0search0 citeturn0search1.").text, "a b.");
  assert.strictEqual(clean("tab\tciteturn0search0\tsep").text, "tab\tsep");
});

const browser = require("../src/browser");
const nodeEntry = require("../src/core");

ok("browser entry cleans every text fixture exactly like the node entry", () => {
  const dir = path.join(__dirname, "..", "..", "tests", "fixtures", "parity");
  for (const name of fs.readdirSync(dir).filter((n) => /\.(md|html)$/.test(n))) {
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    const viaBrowser = browser.cleanText(text);
    const viaNode = nodeEntry.cleanText(text);
    assert.strictEqual(viaBrowser.text, viaNode.text, name);
    assert.deepStrictEqual(viaBrowser.report.findings, viaNode.report.findings, name);
  }
  assert.deepStrictEqual(browser.DEFAULTS, DEFAULTS);
  assert.deepStrictEqual(Object.keys(browser.RULES).sort(), ["artifacts", "characters", "homoglyphs", "phrases", "typography"]);
  assert.strictEqual(browser.cleanText("a\u200bb", { layers: ["typography"] }).text, "a\u200bb");
});

ok("package exports expose only the two entries and block deep imports", () => {
  const pkg = require("../package.json");
  assert.deepStrictEqual(Object.keys(pkg.exports), [".", "./browser", "./package.json"]);
  assert.strictEqual(pkg.version, "0.4.0");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "browser.js"), "utf8");
  for (const forbidden of ['require("fs")', 'require("path")', 'require("./config")', 'require("./rules")', 'require("./metadata")', 'require("./office")']) assert.ok(!src.includes(forbidden), forbidden);
  for (const file of ["defaults.js", "pipeline.js", "protect.js", "layers.js", "image.js"]) {
    const code = fs.readFileSync(path.join(__dirname, "..", "src", file), "utf8");
    assert.ok(!/require\("(fs|path|zlib|crypto|os)"\)/.test(code), `${file} must not touch node built-ins`);
  }
});

ok("classifyCharacters mirrors the characters layer decision for every code point", () => {
  const text = "a\u200bb\u2003c 12\u00a0000 \u{1f469}\u200d\u{1f4bb} x\u200d y\u202e";
  const classes = browser.classifyCharacters(text);
  assert.strictEqual(classes.length, Array.from(text).length);
  const rebuilt = classes.map((c) => (c.action === "remove" ? "" : c.action === "space" ? " " : c.char)).join("");
  assert.strictEqual(rebuilt, clean(text, { layers: ["characters"], normalize_form: "none" }).text);
  assert.deepStrictEqual(classes[1], { index: 1, char: "\u200b", code: 0x200b, action: "remove", name: "zero width space" });
  assert.deepStrictEqual(classes[3], { index: 3, char: "\u2003", code: 0x2003, action: "space", name: "exotic space" });
  assert.strictEqual(classes.find((c) => c.code === 0xa0).action, "keep");
  const joiners = classes.filter((c) => c.code === 0x200d).map((c) => c.action);
  assert.deepStrictEqual(joiners, ["keep", "remove"]);
  assert.strictEqual(classes[classes.length - 1].name, "bidi embedding / override");
  assert.ok(classes.every((c) => c.action !== "keep" || c.name === null));
});

ok("findPhrases returns offsets, kinds and severities and skips code", () => {
  const text = "Without further ado, we delve into the `delve` landscape. This isn\u2019t a tool. This is a movement.";
  const hits = browser.findPhrases(text);
  assert.deepStrictEqual(hits.map((h) => [h.kind, h.id, h.severity, text.slice(h.start, h.end)]), [
    ["filler", "without further ado", "fixed", "Without further ado"],
    ["banned", "delve into", "error", "delve into"],
    ["lexicon", "delve", "warn", "delve"],
    ["lexicon", "landscape", "warn", "landscape"],
    ["shape", "this-isnt-this-is", "error", "This isn\u2019t a tool. This is"],
  ]);
  assert.deepStrictEqual(browser.findPhrases(text, { voice: false }), []);
  assert.ok(!browser.findPhrases(text, { ignore_phrases: ["delve into", "landscape"] }).some((h) => h.id === "delve into" || h.id === "landscape"));
  assert.ok(browser.findPhrases("we must synergize", { custom_banned_phrases: ["synergize"] }).some((h) => h.kind === "banned" && h.id === "synergize"));
  assert.ok(browser.findPhrases("delve into the `delve into` code", { protect_code: false }).filter((h) => h.id === "delve into").length === 2);
  const warnShape = browser.findPhrases("Not only fast but also cheap.").find((h) => h.kind === "shape");
  assert.strictEqual(warnShape.severity, "warn");
});

ok("findings carry per-rule counts", () => {
  const result = clean("Fact citeturn0search0 and citeturn1search2 and https://x.io/a?utm_source=chatgpt.com see \u201cq\u201d and \u201cq\u201d fast \u2014 slow 10 \u2013 20 wait\u2026 &#8203;x a\u200bb\u200bc delve into the landscape, landscape");
  const byKind = Object.fromEntries(result.report.findings.map((f) => [`${f.layer}/${f.kind}/${f.severity}`, f.by_rule]));
  assert.deepStrictEqual(byKind["artifacts/copy-artifact/fixed"], { "chatgpt-citation-token": 2, "utm_source-tracking": 1 });
  assert.deepStrictEqual(byKind["typography/smart-quote/fixed"], { "U+201C": 2, "U+201D": 2 });
  assert.deepStrictEqual(byKind["typography/dash/fixed"], { range: 1, spaced: 1 });
  assert.deepStrictEqual(byKind["typography/punctuation/fixed"], { "U+2026": 1 });
  assert.deepStrictEqual(byKind["entities/html-entity/fixed"], { "&#8203;": 1 });
  assert.deepStrictEqual(byKind["characters/invisible-character/fixed"], { "U+200B": 3 });
  assert.deepStrictEqual(byKind["voice/banned-phrase/error"], { "delve into": 1 });
  assert.deepStrictEqual(byKind["voice/lexicon/warn"], { delve: 1, landscape: 2 });
  assert.ok(result.report.findings.every((f) => typeof f.by_rule === "object"));
});

ok("image strippers list every removed block with kind, label and bytes", () => {
  const jpeg = stripJpeg(makeJpeg(true));
  assert.deepStrictEqual(jpeg.blocks, [
    { kind: "exif", label: "APP1 (EXIF)", bytes: 4 + 18 },
    { kind: "comment", label: "COM (comment)", bytes: 4 + 9 },
  ]);
  assert.strictEqual(jpeg.blocks.reduce((n, b) => n + b.bytes, 0), makeJpeg(true).length - jpeg.cleaned.length);
  const xmp = stripJpeg(Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta/>", "latin1")),
    jpegSegment(0xeb, Buffer.from("JP\x00\x00jumb", "latin1")),
    jpegSegment(0xed, Buffer.from("Photoshop 3.0\x00", "latin1")),
    Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00]), Buffer.from("scan", "latin1"), Buffer.from([0xff, 0xd9]),
  ]));
  assert.deepStrictEqual(xmp.blocks.map((b) => b.kind), ["xmp", "c2pa", "iptc"]);
  assert.strictEqual(stripJpeg(makeJpeg(false)).blocks.length, 0);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const png = stripPng(Buffer.concat([sig, pngChunk("IHDR", Buffer.alloc(13)), pngChunk("tEXt", Buffer.from("Comment\x00ai", "latin1")), pngChunk("iTXt", Buffer.from("XML:com.adobe.xmp\x00\x00\x00\x00\x00xmp", "latin1")), pngChunk("tIME", Buffer.alloc(7)), pngChunk("caBX", Buffer.alloc(3)), pngChunk("iCCP", Buffer.alloc(3)), pngChunk("IDAT", Buffer.alloc(1)), pngChunk("IEND", Buffer.alloc(0))]), true);
  assert.deepStrictEqual(png.blocks.map((b) => [b.kind, b.bytes]), [["text", 22], ["xmp", 37], ["timestamp", 19], ["c2pa", 15], ["icc", 15]]);
  const webp = stripWebp(makeWebp(true));
  assert.deepStrictEqual(webp.blocks, [
    { kind: "exif", label: "EXIF", bytes: 8 + 12 },
    { kind: "xmp", label: "XMP", bytes: 8 + 11 + 1 },
  ]);
  assert.deepStrictEqual(browser.stripJpeg(new Uint8Array(fs.readFileSync(path.join(__dirname, "..", "..", "tests", "fixtures", "parity", "orientation.jpg")))).blocks.map((b) => b.kind), ["exif", "comment"]);
});

ok("findings split by code spans are merged into one per layer, kind, severity and message", () => {
  const result = clean("A citeturn0search0 `code` B citeturn1search2 and [cite: 1] `more` [cite: 2].");
  const artifacts = result.report.findings.filter((f) => f.layer === "artifacts");
  assert.strictEqual(artifacts.length, 1);
  assert.strictEqual(artifacts[0].count, 4);
  assert.deepStrictEqual(artifacts[0].by_rule, { "chatgpt-citation-token": 2, "gemini-citation": 2 });
  assert.deepStrictEqual(artifacts[0].examples, ["chatgpt-citation-token", "gemini-citation"]);
  const voice = clean("We delve into `x` and delve into the landscape, then `y` the landscape again.").report;
  assert.deepStrictEqual(voice.findings.filter((f) => f.kind === "banned-phrase").map((f) => [f.count, f.by_rule]), [[2, { "delve into": 2 }]]);
  assert.deepStrictEqual(voice.findings.filter((f) => f.kind === "lexicon").map((f) => [f.count, f.by_rule]), [[4, { delve: 2, landscape: 2 }]]);
  assert.strictEqual(voice.counts.error, 2);
  const keys = result.report.findings.map((f) => `${f.layer}|${f.kind}|${f.severity}|${f.message}`);
  assert.strictEqual(new Set(keys).size, keys.length);
});

ok("double backtick code spans are protected", () => {
  assert.strictEqual(clean("Use `` a ` b “x” `` here “y”").text, 'Use `` a ` b “x” `` here "y"');
});

ok("chat residue blocks, participial tails and copula avoidance warn, german rules work", () => {
  const residue = clean("Certainly! Here's the plan. I hope this helps! Let me know if you need more.").report;
  assert.strictEqual(residue.findings.find((f) => f.kind === "banned-phrase").count, 3);
  const shapes = clean("We shipped it, highlighting the importance of focus. The library serves as a bridge.").report;
  const warn = shapes.findings.find((f) => f.kind === "sentence-shape" && f.severity === "warn");
  assert.deepStrictEqual([...warn.examples].sort(), ["copula-avoidance", "participial-tail"]);
  const german = clean("In der heutigen digitalen Welt ist das essenziell. Es geht nicht um Tools. Es geht um Haltung.").report;
  const kinds = new Set(german.findings.map((f) => `${f.kind}:${f.severity}`));
  assert.ok(kinds.has("banned-phrase:error"));
  assert.ok(kinds.has("sentence-shape:error"));
  assert.ok(kinds.has("lexicon:warn"));
});

ok("every sentence shape matches its own example", () => {
  const { loadRules } = require("../src/rules");
  for (const shape of loadRules().phrases.sentence_shapes) {
    assert.ok(new RegExp(shape.pattern, "i").test(shape.example), shape.id);
  }
});

const PPTX_CORE = '<cp:coreProperties xmlns:cp="cp" xmlns:dc="dc"><dc:title>T</dc:title><dc:creator>Jane</dc:creator><cp:lastModifiedBy>Jane</cp:lastModifiedBy></cp:coreProperties>';

ok("pptx comment authors are blanked, slides untouched", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const target = nodePath.join(tmp, "deck.pptx");
  fs.writeFileSync(target, buildZip([
    { name: "[Content_Types].xml", content: "<Types/>" },
    { name: "docProps/core.xml", content: PPTX_CORE },
    { name: "docProps/app.xml", content: "<Properties><Application>Microsoft Office PowerPoint</Application><Company>Acme</Company></Properties>" },
    { name: "ppt/commentAuthors.xml", content: '<p:cmAuthorLst xmlns:p="p"><p:cmAuthor id="0" name="Jane Doe" initials="JD" lastIdx="1" clrIdx="0"/></p:cmAuthorLst>' },
    { name: "ppt/authors.xml", content: '<p188:authorLst xmlns:p188="p"><p188:author id="{1}" name="Jane Doe" initials="JD" userId="jane@acme" providerId="AD"/></p188:authorLst>' },
    { name: "ppt/slides/slide1.xml", content: "<p:sld>Hello</p:sld>" },
  ]));
  const report = office.cleanFile(target, true, false);
  assert.strictEqual(report.changed, true);
  const { entries } = readZipEntries(fs.readFileSync(target));
  assert.ok(!entries["docProps/core.xml"].content.includes("Jane"));
  assert.ok(!entries["docProps/app.xml"].content.includes("PowerPoint"));
  assert.ok(entries["ppt/commentAuthors.xml"].content.includes('name="" initials=""'));
  assert.ok(entries["ppt/authors.xml"].content.includes('userId="" providerId=""'));
  assert.strictEqual(entries["ppt/slides/slide1.xml"].content, "<p:sld>Hello</p:sld>");
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("xlsx comment authors and persons are blanked", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const target = nodePath.join(tmp, "sheet.xlsx");
  fs.writeFileSync(target, buildZip([
    { name: "[Content_Types].xml", content: "<Types/>" },
    { name: "docProps/core.xml", content: PPTX_CORE },
    { name: "xl/workbook.xml", content: "<workbook/>" },
    { name: "xl/comments1.xml", content: "<comments><authors><author>Jane Doe</author></authors><commentList/></comments>" },
    { name: "xl/persons/person.xml", content: '<personList><person displayName="Jane Doe" id="{1}" userId="jane@acme" providerId="AD"/></personList>' },
  ]));
  office.cleanFile(target, true, false);
  const { entries } = readZipEntries(fs.readFileSync(target));
  assert.ok(entries["xl/comments1.xml"].content.includes("<author></author>"));
  assert.ok(entries["xl/persons/person.xml"].content.includes('displayName=""'));
  assert.strictEqual(entries["xl/workbook.xml"].content, "<workbook/>");
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("odp and ods use the opendocument rules", () => {
  for (const name of ["deck.odp", "sheet.ods"]) {
    const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
    const target = nodePath.join(tmp, name);
    fs.writeFileSync(target, buildZip([
      { name: "mimetype", content: "application/vnd.oasis.opendocument.presentation", method: 0 },
      { name: "meta.xml", content: '<office:document-meta xmlns:meta="m" xmlns:dc="dc"><office:meta><meta:generator>Impress</meta:generator><dc:creator>Jane</dc:creator></office:meta></office:document-meta>' },
      { name: "content.xml", content: "<office:document-content>Hello</office:document-content>" },
    ]));
    const report = office.cleanFile(target, true, false);
    assert.strictEqual(report.changed, true, name);
    const { entries } = readZipEntries(fs.readFileSync(target));
    assert.ok(!entries["meta.xml"].content.includes("Jane"));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

ok("streamed zip entries get consistent local headers after cleaning", () => {
  const streamed = fs.readFileSync(nodePath.join(__dirname, "..", "..", "tests", "fixtures", "parity", "streamed.docx"));
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const target = nodePath.join(tmp, "streamed.docx");
  fs.writeFileSync(target, streamed);
  office.cleanFile(target, true, false);
  const cleaned = fs.readFileSync(target);
  let offset = 0;
  let entries = 0;
  while (cleaned.readUInt32LE(offset) === 0x04034b50) {
    const flags = cleaned.readUInt16LE(offset + 6);
    const csize = cleaned.readUInt32LE(offset + 18);
    const usize = cleaned.readUInt32LE(offset + 22);
    assert.strictEqual(flags & 0x08, 0);
    assert.ok(csize > 0 && usize > 0);
    offset += 30 + cleaned.readUInt16LE(offset + 26) + cleaned.readUInt16LE(offset + 28) + csize;
    entries += 1;
  }
  assert.strictEqual(entries, 3);
  fs.rmSync(tmp, { recursive: true, force: true });
});

ok("pdf is reported, not rewritten, heic is reported as unsupported, inspect counts as would change", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const pdf = nodePath.join(tmp, "scan.pdf");
  const pdfData = Buffer.from("%PDF-1.4\n1 0 obj<</Author(Jane)/Producer(Acrobat)>>endobj\ntrailer<</Info 1 0 R>>\n%%EOF\n", "latin1");
  fs.writeFileSync(pdf, pdfData);
  const pdfReport = office.cleanFile(pdf, true, false);
  assert.strictEqual(pdfReport.changed, false);
  assert.ok(fs.readFileSync(pdf).equals(pdfData));
  assert.strictEqual(pdfReport.findings[0].severity, "warn");
  assert.ok(pdfReport.findings[0].message.includes("pdf metadata present"));
  assert.strictEqual(pdfReport.findings[0].count, 2);
  const heic = nodePath.join(tmp, "photo.heic");
  fs.writeFileSync(heic, Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]));
  const heicReport = cleanImageFile(heic, true, false, false);
  assert.strictEqual(heicReport.changed, false);
  assert.ok(heicReport.findings[0].message.includes("not supported"));
  const deck = nodePath.join(tmp, "deck.pptx");
  fs.writeFileSync(deck, buildZip([{ name: "docProps/core.xml", content: PPTX_CORE }, { name: "ppt/slides/slide1.xml", content: "<p:sld/>" }]));
  const inspect = office.inspectFile(deck);
  assert.strictEqual(inspect.changed, true);
  assert.strictEqual(inspect.findings[0].severity, "fixed");
  fs.rmSync(tmp, { recursive: true, force: true });
});

const CLI = nodePath.join(__dirname, "..", "bin", "watermark-cleaner.js");

function runCli(args, input) {
  return spawnSync(process.execPath, [CLI, ...args], { input, cwd: nodePath.join(__dirname, "..", "..") });
}

ok("fix from stdin writes cleaned text to stdout and the report to stderr", () => {
  const result = runCli(["fix", "-"], Buffer.from("Hel​lo “world”\n", "utf-8"));
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout.toString("utf-8"), 'Hello "world"\n');
  assert.ok(result.stderr.toString("utf-8").includes("<stdin>"));
  assert.ok(result.stderr.toString("utf-8").includes("1 changed"));
});

ok("check from stdin reports on stdout, stdin cannot be mixed with paths", () => {
  const result = runCli(["check", "-"], Buffer.from("in today's fast-paced world\n", "utf-8"));
  assert.strictEqual(result.status, 1);
  assert.ok(result.stdout.toString("utf-8").includes("ai phrases present"));
  assert.strictEqual(runCli(["fix", "-", "README.md"], Buffer.from("x")).status, 2);
});

ok("check --strict fails when anything would change", () => {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "watermark-cleaner-"));
  const target = nodePath.join(tmp, "a.md");
  fs.writeFileSync(target, "te​st\n");
  assert.strictEqual(runCli(["check", target, "--quiet"]).status, 0);
  assert.strictEqual(runCli(["check", target, "--quiet", "--strict"]).status, 1);
  fs.writeFileSync(target, "clean\n");
  assert.strictEqual(runCli(["check", target, "--quiet", "--strict"]).status, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

if (failed) {
  console.error(`\n${passed} passed, ${failed} FAILED`);
  process.exit(1);
}
console.log(`\n${passed} node tests passed`);
