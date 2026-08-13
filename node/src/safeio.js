const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_FILE_BYTES = 256 * 1024 * 1024;

function maxFileBytes(config) {
  if (config && config.max_file_bytes) return Number(config.max_file_bytes);
  if (process.env.WMC_MAX_FILE_BYTES) return Number(process.env.WMC_MAX_FILE_BYTES);
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
  const temp = path.join(dir, `${path.basename(file)}.${crypto.randomBytes(6).toString("hex")}.wmc-tmp`);
  try {
    fs.writeFileSync(temp, data);
    fs.renameSync(temp, file);
  } catch (error) {
    try {
      fs.unlinkSync(temp);
    } catch (cleanupError) {}
    throw error;
  }
}

module.exports = { tooLarge, isSymlink, writeAtomic, maxFileBytes };
