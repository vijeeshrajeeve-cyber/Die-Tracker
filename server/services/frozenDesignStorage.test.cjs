'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const s = require('./frozenDesignStorage.cjs');

test('isAllowedExtension accepts design types, rejects others', () => {
  assert.equal(s.isAllowedExtension('drawing.PDF'), true);
  assert.equal(s.isAllowedExtension('model.step'), true);
  assert.equal(s.isAllowedExtension('a.dwg'), true);
  assert.equal(s.isAllowedExtension('photo.jpeg'), true);
  assert.equal(s.isAllowedExtension('virus.exe'), false);
  assert.equal(s.isAllowedExtension('noext'), false);
});

test('sanitizeFilename strips paths and unsafe chars but keeps extension', () => {
  assert.equal(s.sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(s.sanitizeFilename('My Drawing #1.pdf'), 'My_Drawing_1.pdf');
  assert.equal(s.sanitizeFilename(''), 'file');
});

test('buildStoredPath composes root/profile/press/cavity/id/name', () => {
  const root = path.join('/srv', 'fz');
  const out = s.buildStoredPath(root, { profile: '14752', press: 'PRESS 4', cavity: 2, frozenDesignId: 9, fileName: 'd.pdf' });
  assert.equal(out, path.join(root, '14752', 'PRESS_4', '2', '9', 'd.pdf'));
});

test('MAX_FILE_BYTES is 100 MB', () => {
  assert.equal(s.MAX_FILE_BYTES, 100 * 1024 * 1024);
});
