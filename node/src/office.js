const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const { isSymlink, writeAtomic } = require("./safeio");

const DOCX_CORE_TAGS = ["creator", "lastModifiedBy"];
const DOCX_APP_TAGS = ["Application", "Company", "Manager"];
const ODT_META_TAGS = ["creator", "initial-creator", "generator"];

const TARGETS = {
  ".docx": { "docProps/core.xml": DOCX_CORE_TAGS, "docProps/app.xml": DOCX_APP_TAGS },
  ".odt": { "meta.xml": ODT_META_TAGS },
};

const ALL_TAGS = new Set();
for (const targets of Object.values(TARGETS)) {
  for (const tags of Object.values(targets)) {
    for (const tag of tags) ALL_TAGS.add(tag);
  }
}

function tagPattern(tag) {
  const name = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<([\\w.]+:)?${name}\\b[^>]*/>|<([\\w.]+:)?${name}\\b[^>]*>[\\s\\S]*?</([\\w.]+:)?${name}>`, "g");
}

const PATTERNS = {};
for (const tag of ALL_TAGS) PATTERNS[tag] = tagPattern(tag);

function stripTags(text, tags) {
  let count = 0;
  for (const tag of tags) {
    text = text.replace(PATTERNS[tag], () => {
      count += 1;
      return "";
    });
  }
  return { text, count };
}

function emptyReport(file) {
  return { path: file, findings: [], changed: false, counts: { fixed: 0, warn: 0, error: 0 }, has_errors: false };
}

function addFinding(report, severity, kind, message, count) {
  report.findings.push({ layer: "metadata", kind, severity, message, count, examples: [] });
  report.counts[severity] = (report.counts[severity] || 0) + count;
}

function inspectFile(file) {
  return processFile(file, false, false);
}

function cleanFile(file, write, backup) {
  return processFile(file, write, backup);
}

function processFile(file, write, backup) {
  const suffix = path.extname(file).toLowerCase();
  const report = emptyReport(file);
  const targets = TARGETS[suffix];
  if (!targets) return report;
  const data = fs.readFileSync(file);
  const result = cleanZip(data, targets);
  if (result === null) {
    addFinding(report, "warn", "office", "could not parse (file left untouched)", 1);
    return report;
  }
  const { data: newData, stripped } = result;
  if (!stripped) return report;
  if (!write) {
    addFinding(report, "warn", "office", "embedded author/application metadata present", stripped);
    return report;
  }
  if (isSymlink(file)) {
    addFinding(report, "warn", "write", "refused to write through symlink", 1);
    return report;
  }
  report.changed = true;
  if (backup) backupFile(file);
  writeAtomic(file, newData);
  addFinding(report, "fixed", "office", "stripped author/application metadata (lossless, container-level)", stripped);
  return report;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const STREAMED_FLAG = 0x0008;
const ENCRYPTED_FLAG = 0x0001;
const ZIP_STORED = 0;
const ZIP_DEFLATED = 8;
const MAX_METADATA_BYTES = 64 * 1024 * 1024;

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

function findEocd(data) {
  const maxCommentLen = 65535;
  const minPos = Math.max(0, data.length - 22 - maxCommentLen);
  for (let i = data.length - 22; i >= minPos; i -= 1) {
    if (data.readUInt32LE(i) === EOCD_SIGNATURE) {
      const commentLen = data.readUInt16LE(i + 20);
      if (i + 22 + commentLen === data.length) return i;
    }
  }
  return -1;
}

function parseCentralDirectory(data) {
  if (data.length < 22) return null;
  const eocdOffset = findEocd(data);
  if (eocdOffset === -1) return null;
  const totalEntries = data.readUInt16LE(eocdOffset + 10);
  const cdSize = data.readUInt32LE(eocdOffset + 12);
  const cdOffset = data.readUInt32LE(eocdOffset + 16);
  if (totalEntries === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) return null;
  if (cdOffset + cdSize > data.length) return null;

  const entries = [];
  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (pos + 46 > data.length) return null;
    if (data.readUInt32LE(pos) !== CENTRAL_SIGNATURE) return null;
    const versionMadeBy = data.readUInt16LE(pos + 4);
    const versionNeeded = data.readUInt16LE(pos + 6);
    const flags = data.readUInt16LE(pos + 8);
    const method = data.readUInt16LE(pos + 10);
    const modTime = data.readUInt16LE(pos + 12);
    const modDate = data.readUInt16LE(pos + 14);
    const crc = data.readUInt32LE(pos + 16);
    const csize = data.readUInt32LE(pos + 20);
    const usize = data.readUInt32LE(pos + 24);
    const nameLen = data.readUInt16LE(pos + 28);
    const extraLen = data.readUInt16LE(pos + 30);
    const commentLen = data.readUInt16LE(pos + 32);
    const internalAttr = data.readUInt16LE(pos + 36);
    const externalAttr = data.readUInt32LE(pos + 38);
    const localOffset = data.readUInt32LE(pos + 42);
    if (csize === 0xffffffff || usize === 0xffffffff || localOffset === 0xffffffff) return null;
    const nameStart = pos + 46;
    const nameEnd = nameStart + nameLen;
    const extraEnd = nameEnd + extraLen;
    const commentEnd = extraEnd + commentLen;
    if (commentEnd > data.length) return null;
    entries.push({
      filename: data.subarray(nameStart, nameEnd).toString("utf-8"),
      versionMadeBy,
      versionNeeded,
      flags,
      method,
      modTime,
      modDate,
      crc,
      csize,
      usize,
      internalAttr,
      externalAttr,
      localOffset,
      extra: Buffer.from(data.subarray(nameEnd, extraEnd)),
      comment: Buffer.from(data.subarray(extraEnd, commentEnd)),
    });
    pos = commentEnd;
  }
  if (pos !== cdOffset + cdSize) return null;
  return entries;
}

function localDataSpan(data, entry) {
  const offset = entry.localOffset;
  if (offset < 0 || offset + 30 > data.length) return null;
  if (data.readUInt32LE(offset) !== LOCAL_SIGNATURE) return null;
  const nameLen = data.readUInt16LE(offset + 26);
  const extraLen = data.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.csize;
  if (dataEnd > data.length) return null;
  return { header: Buffer.from(data.subarray(offset, dataStart)), compData: data.subarray(dataStart, dataEnd) };
}

function decompressEntry(compData, method) {
  if (method === ZIP_STORED) {
    return compData.length > MAX_METADATA_BYTES ? null : compData;
  }
  try {
    return zlib.inflateRawSync(compData, { maxOutputLength: MAX_METADATA_BYTES });
  } catch (error) {
    return null;
  }
}

function patchHeader(header, crc, csize, usize, method) {
  const patched = Buffer.from(header);
  let flags = patched.readUInt16LE(6);
  flags &= ~STREAMED_FLAG;
  patched.writeUInt16LE(flags, 6);
  patched.writeUInt16LE(method, 8);
  patched.writeUInt32LE(crc, 14);
  patched.writeUInt32LE(csize, 18);
  patched.writeUInt32LE(usize, 22);
  return patched;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function cleanZip(data, targets) {
  const entries = parseCentralDirectory(data);
  if (entries === null) return null;

  const records = [];
  let strippedTotal = 0;
  for (const entry of entries) {
    if (entry.method !== ZIP_STORED && entry.method !== ZIP_DEFLATED) return null;
    if (entry.flags & ENCRYPTED_FLAG) return null;
    const span = localDataSpan(data, entry);
    if (span === null) return null;
    let compData = span.compData;
    let crc = entry.crc;
    let csize = entry.csize;
    let usize = entry.usize;
    let method = entry.method;
    let modified = false;
    const tags = targets[entry.filename];
    if (tags) {
      if (entry.usize > MAX_METADATA_BYTES) return null;
      const content = decompressEntry(compData, entry.method);
      if (content === null) return null;
      let text = null;
      try {
        text = strictUtf8.decode(content);
      } catch (error) {
        text = null;
      }
      if (text !== null) {
        const { text: newText, count } = stripTags(text, tags);
        if (count) {
          strippedTotal += count;
          modified = true;
          const newBytes = Buffer.from(newText, "utf-8");
          compData = newBytes;
          method = ZIP_STORED;
          crc = crc32(newBytes);
          csize = compData.length;
          usize = newBytes.length;
        }
      }
    }
    records.push({ entry, header: span.header, compData, crc, csize, usize, method, modified });
  }

  if (!strippedTotal) return { data, stripped: 0 };
  return { data: writeZip(records), stripped: strippedTotal };
}

function centralRecord(entry, crc, csize, usize, method, localOffset) {
  const name = Buffer.from(entry.filename, "utf-8");
  const flags = entry.flags & ~STREAMED_FLAG;
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_SIGNATURE, 0);
  header.writeUInt16LE(entry.versionMadeBy, 4);
  header.writeUInt16LE(entry.versionNeeded, 6);
  header.writeUInt16LE(flags, 8);
  header.writeUInt16LE(method, 10);
  header.writeUInt16LE(entry.modTime, 12);
  header.writeUInt16LE(entry.modDate, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(csize, 20);
  header.writeUInt32LE(usize, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(entry.extra.length, 30);
  header.writeUInt16LE(entry.comment.length, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(entry.internalAttr, 36);
  header.writeUInt32LE(entry.externalAttr, 38);
  header.writeUInt32LE(localOffset, 42);
  return Buffer.concat([header, name, entry.extra, entry.comment]);
}

function buildEocd(count, cdSize, cdOffset) {
  const buf = Buffer.alloc(22);
  buf.writeUInt32LE(EOCD_SIGNATURE, 0);
  buf.writeUInt16LE(0, 4);
  buf.writeUInt16LE(0, 6);
  buf.writeUInt16LE(count, 8);
  buf.writeUInt16LE(count, 10);
  buf.writeUInt32LE(cdSize, 12);
  buf.writeUInt32LE(cdOffset, 16);
  buf.writeUInt16LE(0, 20);
  return buf;
}

function writeZip(records) {
  const ordered = [...records].sort((a, b) => a.entry.localOffset - b.entry.localOffset);
  const localParts = [];
  const offsets = [];
  let pos = 0;
  for (const record of ordered) {
    offsets.push(pos);
    const header = record.modified
      ? patchHeader(record.header, record.crc, record.csize, record.usize, record.method)
      : record.header;
    localParts.push(header, record.compData);
    pos += header.length + record.compData.length;
  }
  const centralParts = ordered.map((record, i) =>
    centralRecord(record.entry, record.crc, record.csize, record.usize, record.method, offsets[i])
  );
  const central = Buffer.concat(centralParts);
  const cdOffset = pos;
  const eocd = buildEocd(ordered.length, central.length, cdOffset);
  return Buffer.concat([...localParts, central, eocd]);
}

function backupFile(file) {
  const bak = `${file}.bak`;
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
}

module.exports = { inspectFile, cleanFile, crc32, TARGETS };
