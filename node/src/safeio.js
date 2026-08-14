const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_FILE_BYTES = 256 * 1024 * 1024;

let warnedBadEnv = false;

const STRICT_INT_RE = /^[+-]?\d+(_\d+)*$/;

function parseStrictInt(value) {
  if (!STRICT_INT_RE.test(value)) return null;
  const n = Number(value.replace(/_/g, ""));
  return Number.isSafeInteger(n) ? n : null;
}

function envMaxFileBytes() {
  const env = process.env.WATERMARK_CLEANER_MAX_FILE_BYTES;
  if (!env) return null;
  const value = parseStrictInt(env);
  if (value === null || value <= 0) {
    if (!warnedBadEnv) {
      console.error(`warning: ignoring WATERMARK_CLEANER_MAX_FILE_BYTES='${env}' (must be a positive integer)`);
      warnedBadEnv = true;
    }
    return null;
  }
  return value;
}

function maxFileBytes(config) {
  if (config && config.max_file_bytes) return Number(config.max_file_bytes);
  const env = envMaxFileBytes();
  if (env !== null) return env;
  return DEFAULT_MAX_FILE_BYTES;
}

function tooLarge(file, config) {
  try {
    return fs.statSync(file).size > maxFileBytes(config);
  } catch (error) {
    return false;
  }
}

function isSymlink(file) {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch (error) {
    return false;
  }
}

function writeAtomic(file, data) {
  if (isSymlink(file)) {
    throw new Error(`refusing to write through symlink: ${file}`);
  }
  const dir = path.dirname(file);
  const temp = path.join(dir, `${path.basename(file)}.${crypto.randomBytes(6).toString("hex")}.watermark-cleaner-tmp`);
  try {
    fs.writeFileSync(temp, data);
    try {
      const mode = fs.statSync(file).mode;
      fs.chmodSync(temp, mode);
    } catch (error) {}
    fs.renameSync(temp, file);
  } catch (error) {
    try {
      fs.unlinkSync(temp);
    } catch (cleanupError) {}
    throw error;
  }
}

module.exports = { tooLarge, isSymlink, writeAtomic, maxFileBytes };
