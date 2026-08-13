const fs = require("fs");
const path = require("path");

const { cleanText } = require("./core");
const { loadRules } = require("./rules");
const metadata = require("./metadata");
const { tooLarge, isSymlink, writeAtomic } = require("./safeio");

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function walk(target, exclude, acc) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) {
    let real;
    try {
      real = fs.statSync(target);
    } catch (error) {
      return;
    }
    if (real.isFile()) acc.push(target);
    return;
  }
  if (stat.isFile()) {
    acc.push(target);
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(target)) {
    if (exclude.includes(entry)) continue;
    walk(path.join(target, entry), exclude, acc);
  }
}

function collectFiles(paths, config) {
  const textExt = new Set(config.text_extensions.map((e) => e.toLowerCase()));
  const imageExt = new Set(config.image_extensions.map((e) => e.toLowerCase()));
  const exclude = config.exclude || [];
  const all = [];
  const missing = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) {
      missing.push(p);
      continue;
    }
    walk(p, exclude, all);
  }
  const textFiles = [];
  const imageFiles = [];
  for (const file of all) {
    const ext = path.extname(file).toLowerCase();
    if (textExt.has(ext)) textFiles.push(file);
    else if (imageExt.has(ext)) imageFiles.push(file);
  }
  return { textFiles, imageFiles, missing };
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

function processTextFile(file, config, rules, write) {
  if (tooLarge(file, config)) {
    return skipReport(file, "skipped (larger than max_file_bytes)");
  }
  let original;
  try {
    original = utf8Decoder.decode(fs.readFileSync(file));
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
  const { textFiles, imageFiles, missing } = collectFiles(paths, config);
  const reports = [];
  for (const p of missing) reports.push(skipReport(p, "path not found"));
  for (const file of textFiles) reports.push(processTextFile(file, config, rules, write));
  const doBackup = config.backup !== false;
  const stripIcc = config.strip_icc === true;
  for (const file of imageFiles) {
    if (tooLarge(file, config)) {
      reports.push(skipReport(file, "skipped (larger than max_file_bytes)"));
      continue;
    }
    if (write) reports.push(metadata.cleanFile(file, true, doBackup, stripIcc));
    else reports.push(metadata.inspectFile(file, stripIcc));
  }
  return reports;
}

module.exports = { run };
