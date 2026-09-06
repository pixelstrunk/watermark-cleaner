const fs = require("fs");
const path = require("path");

const { cleanText } = require("./core");
const { loadRules } = require("./rules");
const metadata = require("./metadata");
const office = require("./office");
const { tooLarge, isSymlink, writeAtomic } = require("./safeio");

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

const PERMISSION_MESSAGE = "skipped (permission denied)";
const IO_MESSAGE = "skipped (i/o error)";

function byUtf8Bytes(a, b) {
  return Buffer.compare(Buffer.from(a.name, "utf-8"), Buffer.from(b.name, "utf-8"));
}

function walk(directory, exclude, acc, unreadable) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    unreadable.push(directory);
    return;
  }
  entries.sort(byUtf8Bytes);
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(full, exclude, acc, unreadable);
    } else if (entry.isFile()) {
      acc.push(full);
    } else if (entry.isSymbolicLink()) {
      try {
        if (fs.statSync(full).isFile()) acc.push(full);
      } catch (error) {}
    }
  }
}

function collectFiles(paths, config) {
  const textExt = new Set(config.text_extensions.map((e) => e.toLowerCase()));
  const imageExt = new Set(config.image_extensions.map((e) => e.toLowerCase()));
  const documentExt = new Set((config.document_extensions || []).map((e) => e.toLowerCase()));
  const exclude = config.exclude || [];
  const all = [];
  const missing = [];
  const unreadable = [];
  for (const p of paths) {
    let stat;
    try {
      stat = fs.statSync(p);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") missing.push(p);
      else unreadable.push(p);
      continue;
    }
    if (stat.isFile()) all.push(p);
    else if (stat.isDirectory()) walk(p, exclude, all, unreadable);
    else missing.push(p);
  }
  const textFiles = [];
  const imageFiles = [];
  const documentFiles = [];
  const seen = new Set();
  for (const file of all) {
    let key;
    try {
      key = fs.realpathSync(file);
    } catch (error) {
      key = path.resolve(file);
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const ext = path.extname(file).toLowerCase();
    if (textExt.has(ext)) textFiles.push(file);
    else if (imageExt.has(ext)) imageFiles.push(file);
    else if (documentExt.has(ext)) documentFiles.push(file);
  }
  return { textFiles, imageFiles, documentFiles, missing, unreadable };
}

function skipReport(file, message) {
  return {
    path: file,
    findings: [{ layer: "io", kind: "read", severity: "warn", message, count: 1, examples: [] }],
    changed: false,
    counts: { fixed: 0, warn: 1, error: 0 },
    has_errors: false,
  };
}

function safely(file, action) {
  try {
    return action();
  } catch (error) {
    if (error && (error.code === "EACCES" || error.code === "EPERM")) return skipReport(file, PERMISSION_MESSAGE);
    if (error && typeof error.code === "string") return skipReport(file, IO_MESSAGE);
    throw error;
  }
}

function processTextFile(file, config, rules, write) {
  if (tooLarge(file, config)) {
    return skipReport(file, "skipped (larger than max_file_bytes)");
  }
  const raw = fs.readFileSync(file);
  let original;
  try {
    original = utf8Decoder.decode(raw);
  } catch (error) {
    return skipReport(file, "skipped (not utf-8 text)");
  }
  const { text, report } = cleanText(original, config, rules, file);
  if (write && report.changed) {
    if (isSymlink(file)) {
      report.changed = false;
      report.findings.push({ layer: "io", kind: "write", severity: "warn", message: "refused to write through symlink", count: 1, examples: [] });
      report.counts.warn += 1;
      return report;
    }
    if (config.backup !== false) backup(file);
    writeAtomic(file, text);
  }
  return report;
}

function backup(file) {
  const bak = `${file}.bak`;
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
}

function run(paths, config, write) {
  const rules = loadRules();
  const { textFiles, imageFiles, documentFiles, missing, unreadable } = collectFiles(paths, config);
  const reports = [];
  for (const p of missing) reports.push(skipReport(p, "path not found"));
  for (const p of unreadable) reports.push(skipReport(p, PERMISSION_MESSAGE));
  for (const file of textFiles) reports.push(safely(file, () => processTextFile(file, config, rules, write)));
  const doBackup = config.backup !== false;
  const stripIcc = config.strip_icc === true;
  for (const file of imageFiles) {
    if (tooLarge(file, config)) {
      reports.push(skipReport(file, "skipped (larger than max_file_bytes)"));
      continue;
    }
    if (write) reports.push(safely(file, () => metadata.cleanFile(file, true, doBackup, stripIcc)));
    else reports.push(safely(file, () => metadata.inspectFile(file, stripIcc)));
  }
  for (const file of documentFiles) {
    if (tooLarge(file, config)) {
      reports.push(skipReport(file, "skipped (larger than max_file_bytes)"));
      continue;
    }
    if (write) reports.push(safely(file, () => office.cleanFile(file, true, doBackup)));
    else reports.push(safely(file, () => office.inspectFile(file)));
  }
  return reports;
}

module.exports = { run, collectFiles };
