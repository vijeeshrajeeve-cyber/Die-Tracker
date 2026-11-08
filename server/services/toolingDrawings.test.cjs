'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { getRoot, storedRelativePath, absolutePath, formatOf, sha256Of } = require('./toolingDrawings.cjs');

test('stored path is number/sha8_name with unsafe characters replaced', () => {
  assert.equal(storedRelativePath({ number: 'BOL-4-6-A', sha256: 'abcdef0123456789', originalName: '14017 Bol(475x220).dxf' }), 'BOL-4-6-A/abcdef01_14017_Bol_475x220_.dxf');
});
test('absolutePath refuses to leave the root', () => {
  assert.throws(() => absolutePath('/root/tooling-files', '../etc/passwd'), /outside/);
  assert.equal(path.basename(absolutePath('/root/tooling-files', 'I-21599/abc_x.dxf')), 'abc_x.dxf');
});
test('formatOf is case-insensitive and null for unknown types', () => {
  assert.equal(formatOf('A.DXF'), 'dxf'); assert.equal(formatOf('a.tif'), 'tif'); assert.equal(formatOf('a.TIFF'), 'tif'); assert.equal(formatOf('a.bak'), null);
});
test('sha256Of hashes a buffer', () => {
  assert.equal(sha256Of(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('getRoot honours TOOLING_FILES_ROOT', () => { process.env.TOOLING_FILES_ROOT = '/x'; assert.equal(getRoot(), '/x'); delete process.env.TOOLING_FILES_ROOT; assert.equal(getRoot(), '/app/storage/tooling-files'); });
test('profileImagePath shards by the first two hex characters', () => {
  const { profileImagePath } = require('./toolingDrawings.cjs');
  assert.equal(profileImagePath('abcdef0123456789', 'gif'), 'profiles/ab/abcdef0123456789.gif');
});
