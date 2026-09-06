const fs = require("fs");
const path = require("path");

const { isSymlink, writeAtomic } = require("./safeio");

const SVG_METADATA = /<metadata\b[^>]*>[\s\S]*?<\/metadata>/gi;
const SVG_XMP = /<x:xmpmeta\b[\s\S]*?<\/x:xmpmeta>/gi;
const SVG_COMMENT = /<!--[\s\S]*?-->/g;

const JPEG_STRIP_MARKERS = new Set([0xe1, 0xeb, 0xed, 0xfe]);
const JPEG_ICC_MARKER = 0xe2;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_STRIP_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME", "caBX"]);
const PNG_ICC_CHUNK = "iCCP";
const WEBP_STRIP_CHUNKS = new Set(["EXIF", "XMP ", "JUMB", "C2PA", "c2pa"]);
const WEBP_ICC_CHUNK = "ICCP";
const WEBP_VP8X_CLEAR_FLAGS = 0x08 | 0x04;
const WEBP_VP8X_ICC_FLAG = 0x20;

const LOSSLESS_SUFFIXES = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const UNSUPPORTED_SUFFIXES = new Set([".gif", ".tif", ".tiff"]);

function emptyReport(file) {
  return { path: file, findings: [], changed: false, counts: { fixed: 0, warn: 0, error: 0 }, has_errors: false };
}

function addFinding(report, severity, kind, message, count) {
  report.findings.push({ layer: "metadata", kind, severity, message, count, examples: [] });
  report.counts[severity] = (report.counts[severity] || 0) + count;
}

function inspectFile(file, stripIcc) {
  return processFile(file, false, false, stripIcc);
}

function cleanFile(file, write, backup, stripIcc) {
  return processFile(file, write, backup, stripIcc);
}

function processFile(file, write, backup, stripIcc) {
  const suffix = path.extname(file).toLowerCase();
  const report = emptyReport(file);
  if (suffix === ".svg") {
    handleSvg(file, report, write, backup);
  } else if (LOSSLESS_SUFFIXES.has(suffix)) {
    handleBinary(file, report, write, backup, suffix, stripIcc);
  } else if (UNSUPPORTED_SUFFIXES.has(suffix)) {
    addFinding(report, "warn", "raster", "lossless metadata stripping not supported for this format (file left untouched)", 1);
  }
  return report;
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

function handleSvg(file, report, write, backup) {
  let data;
  try {
    data = strictUtf8.decode(fs.readFileSync(file));
  } catch (error) {
    report.findings.push({ layer: "io", kind: "read", severity: "warn", message: "skipped (not utf-8 text)", count: 1, examples: [] });
    report.counts.warn += 1;
    return;
  }
  const hits = (data.match(SVG_METADATA) || []).length + (data.match(SVG_XMP) || []).length;
  const comments = (data.match(SVG_COMMENT) || []).length;
  const total = hits + comments;
  if (!total) return;
  if (!write) {
    addFinding(report, "warn", "svg-metadata", "embedded svg metadata/xmp/comments present", total);
    return;
  }
  const cleaned = data.replace(SVG_METADATA, "").replace(SVG_XMP, "").replace(SVG_COMMENT, "");
  if (cleaned !== data) {
    if (isSymlink(file)) {
      addFinding(report, "warn", "write", "refused to write through symlink", 1);
      return;
    }
    report.changed = true;
    if (backup) backupFile(file);
    writeAtomic(file, cleaned);
  }
  addFinding(report, "fixed", "svg-metadata", "stripped svg metadata, xmp and comments", total);
}

function handleBinary(file, report, write, backup, suffix, stripIcc) {
  const data = fs.readFileSync(file);
  let result;
  if (suffix === ".jpg" || suffix === ".jpeg") result = stripJpeg(data, stripIcc);
  else if (suffix === ".png") result = stripPng(data, stripIcc);
  else result = stripWebp(data, stripIcc);

  if (result === null) {
    addFinding(report, "warn", "raster", "could not parse image (file left untouched)", 1);
    return;
  }
  const { cleaned, stripped } = result;
  if (!stripped) return;
  if (!write) {
    addFinding(report, "warn", "raster", "embedded metadata present (exif/xmp/icc/c2pa)", stripped);
    return;
  }
  if (isSymlink(file)) {
    addFinding(report, "warn", "write", "refused to write through symlink", 1);
    return;
  }
  report.changed = true;
  if (backup) backupFile(file);
  writeAtomic(file, cleaned);
  addFinding(report, "fixed", "raster", "stripped metadata segments losslessly (pixels untouched)", stripped);
}

function stripJpeg(data, stripIcc) {
  if (data.length < 2 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  const markers = new Set(JPEG_STRIP_MARKERS);
  if (stripIcc) markers.add(JPEG_ICC_MARKER);
  const parts = [Buffer.from([0xff, 0xd8])];
  let i = 2;
  let stripped = 0;
  const n = data.length;
  let terminated = false;
  while (i + 1 < n) {
    if (data[i] !== 0xff) return null;
    const marker = data[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      parts.push(data.subarray(i));
      terminated = true;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(data.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > n) return null;
    const segLen = data.readUInt16BE(i + 2);
    const end = i + 2 + segLen;
    if (segLen < 2 || end > n) return null;
    if (markers.has(marker)) stripped += 1;
    else parts.push(data.subarray(i, end));
    i = end;
  }
  if (!terminated) return null;
  return { cleaned: Buffer.concat(parts), stripped };
}

function stripPng(data, stripIcc) {
  if (data.length < 8 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const chunkTypes = new Set(PNG_STRIP_CHUNKS);
  if (stripIcc) chunkTypes.add(PNG_ICC_CHUNK);
  const parts = [PNG_SIGNATURE];
  let i = 8;
  let stripped = 0;
  const n = data.length;
  while (i < n) {
    if (i + 8 > n) return null;
    const length = data.readUInt32BE(i);
    const chunkType = data.subarray(i + 4, i + 8).toString("latin1");
    const end = i + 12 + length;
    if (end > n) return null;
    if (chunkTypes.has(chunkType)) stripped += 1;
    else parts.push(data.subarray(i, end));
    if (chunkType === "IEND") {
      parts.push(data.subarray(end));
      break;
    }
    i = end;
  }
  return { cleaned: Buffer.concat(parts), stripped };
}

function stripWebp(data, stripIcc) {
  if (data.length < 12 || data.subarray(0, 4).toString("latin1") !== "RIFF" || data.subarray(8, 12).toString("latin1") !== "WEBP") return null;
  const stripSet = new Set(WEBP_STRIP_CHUNKS);
  let clearFlags = WEBP_VP8X_CLEAR_FLAGS;
  if (stripIcc) {
    stripSet.add(WEBP_ICC_CHUNK);
    clearFlags |= WEBP_VP8X_ICC_FLAG;
  }
  const chunks = [];
  let i = 12;
  let stripped = 0;
  const n = data.length;
  while (i < n) {
    if (i + 8 > n) return null;
    const fourcc = data.subarray(i, i + 4).toString("latin1");
    const size = data.readUInt32LE(i + 4);
    if (i + 8 + size > n) return null;
    const end = i + 8 + size + (size % 2);
    if (stripSet.has(fourcc)) stripped += 1;
    else chunks.push(Buffer.from(data.subarray(i, Math.min(end, n))));
    i = end;
  }
  if (stripped) {
    for (const chunk of chunks) {
      if (chunk.subarray(0, 4).toString("latin1") === "VP8X" && chunk.length >= 9) {
        chunk[8] &= ~clearFlags & 0xff;
      }
    }
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "latin1");
  return { cleaned: Buffer.concat([header, body]), stripped };
}

function backupFile(file) {
  const bak = `${file}.bak`;
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
}

module.exports = { inspectFile, cleanFile, stripJpeg, stripPng, stripWebp };
