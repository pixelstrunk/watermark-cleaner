const JPEG_STRIP_MARKERS = new Set([0xe1, 0xeb, 0xed, 0xfe]);
const JPEG_ICC_MARKER = 0xe2;
const JPEG_APP0_MARKER = 0xe0;
const JPEG_APP1_MARKER = 0xe1;
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_STRIP_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME", "caBX"]);
const PNG_ICC_CHUNK = "iCCP";
const PNG_EXIF_CHUNK = "eXIf";
const WEBP_STRIP_CHUNKS = new Set(["EXIF", "XMP ", "JUMB", "C2PA", "c2pa"]);
const WEBP_ICC_CHUNK = "ICCP";
const WEBP_EXIF_CHUNK = "EXIF";
const WEBP_VP8X_EXIF_FLAG = 0x08;
const WEBP_VP8X_XMP_FLAG = 0x04;
const WEBP_VP8X_ICC_FLAG = 0x20;

const EXIF_HEADER = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
const XMP_NAMESPACE = "http://ns.adobe.com/x";
const PNG_XMP_KEYWORD = "XML:com.adobe.xmp";
const JPEG_BLOCKS = {
  0xeb: { kind: "c2pa", label: "APP11 (JUMBF, C2PA content credentials)" },
  0xed: { kind: "iptc", label: "APP13 (Photoshop IPTC)" },
  0xfe: { kind: "comment", label: "COM (comment)" },
  0xe2: { kind: "icc", label: "APP2 (ICC profile)" },
};
const PNG_BLOCKS = {
  tEXt: { kind: "text", label: "tEXt (text metadata)" },
  zTXt: { kind: "text", label: "zTXt (compressed text metadata)" },
  eXIf: { kind: "exif", label: "eXIf (EXIF)" },
  tIME: { kind: "timestamp", label: "tIME (last modified)" },
  caBX: { kind: "c2pa", label: "caBX (C2PA content credentials)" },
  iCCP: { kind: "icc", label: "iCCP (ICC profile)" },
};
const WEBP_BLOCKS = {
  EXIF: { kind: "exif", label: "EXIF" },
  "XMP ": { kind: "xmp", label: "XMP" },
  JUMB: { kind: "c2pa", label: "JUMBF (C2PA content credentials)" },
  C2PA: { kind: "c2pa", label: "C2PA content credentials" },
  c2pa: { kind: "c2pa", label: "C2PA content credentials" },
  ICCP: { kind: "icc", label: "ICCP (ICC profile)" },
};
const ORIENTATION_TAG = 0x0112;
const TIFF_SHORT = 3;

function ascii(bytes, start, end) {
  let text = "";
  for (let i = start; i < end; i += 1) text += String.fromCharCode(bytes[i]);
  return text;
}

function asciiBytes(text) {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0));
}

function readU16(bytes, at, little) {
  return little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1];
}

function readU32(bytes, at, little) {
  return little
    ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
    : ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function u16be(value) {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function u32be(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u32le(value) {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function concat(parts) {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function startsWith(bytes, prefix, at = 0) {
  if (bytes.length < at + prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) if (bytes[at + i] !== prefix[i]) return false;
  return true;
}

function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function block(spec, bytes) {
  return { kind: spec.kind, label: spec.label, bytes };
}

function jpegBlock(marker, payload, bytes) {
  if (marker !== JPEG_APP1_MARKER) return block(JPEG_BLOCKS[marker] || { kind: "metadata", label: `APP${marker - 0xe0}` }, bytes);
  if (startsWith(payload, EXIF_HEADER)) return block({ kind: "exif", label: "APP1 (EXIF)" }, bytes);
  if (ascii(payload, 0, XMP_NAMESPACE.length) === XMP_NAMESPACE) return block({ kind: "xmp", label: "APP1 (XMP)" }, bytes);
  return block({ kind: "metadata", label: "APP1" }, bytes);
}

function pngBlock(chunkType, payload, bytes) {
  if (chunkType !== "iTXt") return block(PNG_BLOCKS[chunkType] || { kind: "metadata", label: chunkType }, bytes);
  const xmp = ascii(payload, 0, PNG_XMP_KEYWORD.length) === PNG_XMP_KEYWORD;
  return block(xmp ? { kind: "xmp", label: "iTXt (XMP)" } : { kind: "text", label: "iTXt (international text)" }, bytes);
}

function readOrientation(tiff) {
  const base = startsWith(tiff, EXIF_HEADER) ? EXIF_HEADER.length : 0;
  if (tiff.length < base + 8) return null;
  const order = ascii(tiff, base, base + 2);
  if (order !== "II" && order !== "MM") return null;
  const little = order === "II";
  if (readU16(tiff, base + 2, little) !== 42) return null;
  const ifd = base + readU32(tiff, base + 4, little);
  if (ifd + 2 > tiff.length) return null;
  const entries = readU16(tiff, ifd, little);
  for (let i = 0; i < entries; i += 1) {
    const at = ifd + 2 + i * 12;
    if (at + 12 > tiff.length) return null;
    if (readU16(tiff, at, little) !== ORIENTATION_TAG) continue;
    if (readU16(tiff, at + 2, little) !== TIFF_SHORT || readU32(tiff, at + 4, little) !== 1) return null;
    const value = readU16(tiff, at + 8, little);
    return value >= 2 && value <= 8 ? value : null;
  }
  return null;
}

function orientationTiff(orientation) {
  return new Uint8Array([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    0x00, 0x01,
    ...u16be(ORIENTATION_TAG), ...u16be(TIFF_SHORT), ...u32be(1), ...u16be(orientation), 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
}

function jpegOrientationSegment(orientation) {
  const payload = concat([EXIF_HEADER, orientationTiff(orientation)]);
  return concat([new Uint8Array([0xff, JPEG_APP1_MARKER, ...u16be(payload.length + 2)]), payload]);
}

function pngChunk(type, payload) {
  const body = concat([asciiBytes(type), payload]);
  return concat([new Uint8Array(u32be(payload.length)), body, new Uint8Array(u32be(crc32(body)))]);
}

function webpChunk(fourcc, payload) {
  const parts = [asciiBytes(fourcc), new Uint8Array(u32le(payload.length)), payload];
  if (payload.length % 2) parts.push(new Uint8Array(1));
  return concat(parts);
}

function stripJpeg(data, stripIcc) {
  if (data.length < 2 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  const markers = new Set(JPEG_STRIP_MARKERS);
  if (stripIcc) markers.add(JPEG_ICC_MARKER);
  const segments = [];
  const blocks = [];
  let i = 2;
  let stripped = 0;
  let orientation = null;
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
      segments.push(data.subarray(i));
      terminated = true;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push(data.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > n) return null;
    const segLen = readU16(data, i + 2, false);
    const end = i + 2 + segLen;
    if (segLen < 2 || end > n) return null;
    if (markers.has(marker)) {
      stripped += 1;
      const payload = data.subarray(i + 4, end);
      blocks.push(jpegBlock(marker, payload, end - i));
      if (marker === JPEG_APP1_MARKER && orientation === null) orientation = readOrientation(payload);
    } else {
      segments.push(data.subarray(i, end));
    }
    i = end;
  }
  if (!terminated) return null;
  if (orientation !== null) {
    let at = 0;
    while (at < segments.length && segments[at][1] === JPEG_APP0_MARKER) at += 1;
    segments.splice(at, 0, jpegOrientationSegment(orientation));
  }
  return { cleaned: concat([new Uint8Array([0xff, 0xd8]), ...segments]), stripped, orientation, blocks };
}

function stripPng(data, stripIcc) {
  if (!startsWith(data, PNG_SIGNATURE)) return null;
  const chunkTypes = new Set(PNG_STRIP_CHUNKS);
  if (stripIcc) chunkTypes.add(PNG_ICC_CHUNK);
  const parts = [PNG_SIGNATURE];
  const blocks = [];
  let i = PNG_SIGNATURE.length;
  let stripped = 0;
  let orientation = null;
  let headerIndex = 0;
  const n = data.length;
  while (i < n) {
    if (i + 8 > n) return null;
    const length = readU32(data, i, false);
    const chunkType = ascii(data, i + 4, i + 8);
    const end = i + 12 + length;
    if (end > n) return null;
    if (chunkTypes.has(chunkType)) {
      stripped += 1;
      const payload = data.subarray(i + 8, i + 8 + length);
      blocks.push(pngBlock(chunkType, payload, end - i));
      if (chunkType === PNG_EXIF_CHUNK && orientation === null) orientation = readOrientation(payload);
    } else {
      parts.push(data.subarray(i, end));
      if (chunkType === "IHDR" && !headerIndex) headerIndex = parts.length - 1;
    }
    if (chunkType === "IEND") {
      parts.push(data.subarray(end));
      break;
    }
    i = end;
  }
  if (orientation !== null) parts.splice(headerIndex + 1, 0, pngChunk(PNG_EXIF_CHUNK, orientationTiff(orientation)));
  return { cleaned: concat(parts), stripped, orientation, blocks };
}

function stripWebp(data, stripIcc) {
  if (data.length < 12 || ascii(data, 0, 4) !== "RIFF" || ascii(data, 8, 12) !== "WEBP") return null;
  const stripSet = new Set(WEBP_STRIP_CHUNKS);
  let clearFlags = WEBP_VP8X_EXIF_FLAG | WEBP_VP8X_XMP_FLAG;
  if (stripIcc) {
    stripSet.add(WEBP_ICC_CHUNK);
    clearFlags |= WEBP_VP8X_ICC_FLAG;
  }
  const chunks = [];
  const blocks = [];
  let i = 12;
  let stripped = 0;
  let orientation = null;
  let header = null;
  const n = data.length;
  while (i < n) {
    if (i + 8 > n) return null;
    const fourcc = ascii(data, i, i + 4);
    const size = readU32(data, i + 4, true);
    if (i + 8 + size > n) return null;
    const end = i + 8 + size + (size % 2);
    if (stripSet.has(fourcc)) {
      stripped += 1;
      blocks.push(block(WEBP_BLOCKS[fourcc] || { kind: "metadata", label: fourcc }, Math.min(end, n) - i));
      if (fourcc === WEBP_EXIF_CHUNK && orientation === null) orientation = readOrientation(data.subarray(i + 8, i + 8 + size));
    } else {
      const chunk = Uint8Array.from(data.subarray(i, Math.min(end, n)));
      if (fourcc === "VP8X" && chunk.length >= 9 && header === null) header = chunk;
      chunks.push(chunk);
    }
    i = end;
  }
  if (header === null) orientation = null;
  if (orientation !== null) clearFlags &= ~WEBP_VP8X_EXIF_FLAG;
  if (stripped && header !== null) {
    header[8] &= ~clearFlags & 0xff;
    if (orientation !== null) header[8] |= WEBP_VP8X_EXIF_FLAG;
  }
  if (orientation !== null) chunks.push(webpChunk(WEBP_EXIF_CHUNK, orientationTiff(orientation)));
  const body = concat(chunks);
  const riff = concat([asciiBytes("RIFF"), new Uint8Array(u32le(body.length + 4)), asciiBytes("WEBP")]);
  return { cleaned: concat([riff, body]), stripped, orientation, blocks };
}

module.exports = { stripJpeg, stripPng, stripWebp, readOrientation, orientationTiff, crc32, equalBytes };
