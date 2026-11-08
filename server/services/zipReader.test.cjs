'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { listEntries, readEntry, openZip } = require('./zipReader.cjs');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// Test helper (Task 4 can copy it): builds a zip from [{ name, data: Buffer, deflate?: bool }].
// `comment` is appended after the end record to exercise the backwards EOCD search.
function buildZip(files, { comment = '' } = {}) {
  const locals = []; const centrals = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const method = f.deflate ? 8 : 0;
    const body = f.deflate ? zlib.deflateRawSync(f.data) : f.data;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc32(f.data), 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26);
    const local = Buffer.concat([lh, name, body]);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc32(f.data), 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([ch, name])); locals.push(local); offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(Buffer.byteLength(comment), 20);
  return Buffer.concat([...locals, cd, eocd, Buffer.from(comment)]);
}

const A = Buffer.from('stored bytes');
const B = Buffer.from('deflate me deflate me deflate me '.repeat(20));
const sample = (opts) => buildZip([{ name: 'a.txt', data: A }, { name: 'dir/b.txt', data: B, deflate: true }], opts);

test('listEntries returns name, method and sizes from the central directory', () => {
  const entries = listEntries(sample());
  assert.deepEqual(entries.map((e) => [e.name, e.method, e.size]), [['a.txt', 0, A.length], ['dir/b.txt', 8, B.length]]);
  assert.equal(entries[0].localHeaderOffset, 0);
  assert.ok(entries[1].compressedSize < B.length);
});

test('readEntry returns the original bytes for stored and deflated entries', () => {
  const zip = sample();
  const [a, b] = listEntries(zip);
  assert.deepEqual(readEntry(zip, a), A);
  assert.deepEqual(readEntry(zip, b), B);
});

test('a trailing zip comment does not hide the end record', () => {
  assert.equal(listEntries(sample({ comment: 'hello zip comment' })).length, 2);
});

test('UTF-8 names are decoded', () => {
  const zip = buildZip([{ name: 'caf\u00e9/\u5de5.txt', data: A }]);
  assert.equal(listEntries(zip)[0].name, 'caf\u00e9/\u5de5.txt');
});

test('openZip reads a file once and exposes entries and read()', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zipreader-'));
  try {
    const file = path.join(dir, 't.zip');
    fs.writeFileSync(file, sample());
    const zip = openZip(file);
    assert.deepEqual([...zip.entries.keys()], ['a.txt', 'dir/b.txt']);
    assert.deepEqual(zip.read('dir/b.txt'), B);
    assert.throws(() => zip.read('nope.txt'), /nope\.txt/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('rejects non-zip input, unsupported methods and ZIP64 markers with clear errors', () => {
  assert.throws(() => listEntries(Buffer.from('not a zip at all')), /not a zip/i);
  const zip = sample();
  const eocd = zip.length - 22;
  const z64 = Buffer.from(zip); z64.writeUInt32LE(0xffffffff, eocd + 16);
  assert.throws(() => listEntries(z64), /ZIP64/);
  const loc = Buffer.concat([zip.subarray(0, eocd), Buffer.from([0x50, 0x4b, 0x06, 0x07, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), zip.subarray(eocd)]);
  assert.throws(() => listEntries(loc), /ZIP64/);
  const entry = { ...listEntries(zip)[0], method: 12 };
  assert.throws(() => readEntry(zip, entry), /method 12/);
});
