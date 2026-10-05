const fs = require("fs");
const path = require("path");

const image = require("./image");
const { isSymlink, writeAtomic } = require("./safeio");

const SVG_METADATA = /<metadata\b[^>]*>[\s\S]*?<\/metadata>/gi;
const SVG_XMP = /<x:xmpmeta\b[\s\S]*?<\/x:xmpmeta>/gi;
const SVG_COMMENT = /<!--[\s\S]*?-->/g;

const LOSSLESS_SUFFIXES = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const UNSUPPORTED_SUFFIXES = new Set([".gif", ".tif", ".tiff", ".heic", ".heif", ".avif"]);

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
    report.changed = true;
    addFinding(report, "fixed", "svg-metadata", "embedded svg metadata/xmp/comments present", total);
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
  const { cleaned, stripped, orientation } = result;
  if (!stripped || cleaned.equals(data)) return;
  if (!write) {
    report.changed = true;
    addFinding(report, "fixed", "raster", "embedded metadata present (exif/xmp/icc/c2pa)", stripped);
    addOrientation(report, orientation);
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
  addOrientation(report, orientation);
}

function addOrientation(report, orientation) {
  if (orientation !== null) addFinding(report, "info", "orientation", "kept exif orientation (tag 0x0112), nothing else", 1);
}

function asBuffer(result) {
  if (result === null) return null;
  const { cleaned } = result;
  return { ...result, cleaned: Buffer.from(cleaned.buffer, cleaned.byteOffset, cleaned.byteLength) };
}

function stripJpeg(data, stripIcc) {
  return asBuffer(image.stripJpeg(data, stripIcc));
}

function stripPng(data, stripIcc) {
  return asBuffer(image.stripPng(data, stripIcc));
}

function stripWebp(data, stripIcc) {
  return asBuffer(image.stripWebp(data, stripIcc));
}

function backupFile(file) {
  const bak = `${file}.bak`;
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
}

module.exports = { inspectFile, cleanFile, stripJpeg, stripPng, stripWebp };
