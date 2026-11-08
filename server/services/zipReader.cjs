'use strict';
// Minimal zip reader: central directory + stored/deflate entries, no ZIP64.
// Built for reading very large .xlsx workbooks (~20k entries) without a
// spreadsheet library; the whole file is held in memory once.
const fs = require('node:fs');
const zlib = require('node:zlib');

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const ZIP64_MSG = 'ZIP64 archives are not supported';

const findEndRecord = (buffer) => {
  // The end record is 22 bytes plus an optional comment of up to 65535 bytes.
  const lowest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= lowest; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error('Not a zip file: end of central directory record not found');
};

const listEntries = (buffer) => {
  const eocd = findEndRecord(buffer);
  if (eocd >= 20 && buffer.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIG) throw new Error(ZIP64_MSG);
  const count = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error(ZIP64_MSG);

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== CENTRAL_SIG) throw new Error('Corrupt zip: bad central directory entry');
    const method = buffer.readUInt16LE(p + 10);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const size = buffer.readUInt32LE(p + 24);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localHeaderOffset = buffer.readUInt32LE(p + 42);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localHeaderOffset === 0xffffffff) throw new Error(ZIP64_MSG);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compressedSize, size, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
};

const readEntry = (buffer, entry) => {
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`Unsupported zip compression method ${entry.method} for ${entry.name}`);
  const o = entry.localHeaderOffset;
  if (o + 30 > buffer.length || buffer.readUInt32LE(o) !== LOCAL_SIG) throw new Error(`Corrupt zip: bad local header for ${entry.name}`);
  // The local header carries its own name/extra lengths; they can differ from the central directory's.
  const start = o + 30 + buffer.readUInt16LE(o + 26) + buffer.readUInt16LE(o + 28);
  const data = buffer.subarray(start, start + entry.compressedSize);
  return entry.method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
};

const openZip = (filePath) => {
  const buffer = fs.readFileSync(filePath);
  const entries = new Map(listEntries(buffer).map((e) => [e.name, e]));
  const read = (name) => {
    const entry = entries.get(name);
    if (!entry) throw new Error(`Zip entry not found: ${name}`);
    return readEntry(buffer, entry);
  };
  return { entries, read };
};

module.exports = { listEntries, readEntry, openZip };
