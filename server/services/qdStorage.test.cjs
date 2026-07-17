'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const s = require('./qdStorage.cjs');

test('isAllowedExtension accepts evidence types, rejects executables', () => {
  assert.equal(s.isAllowedExtension('report.PDF'), true);
  assert.equal(s.isAllowedExtension('mandrel.jpg'), true);
  assert.equal(s.isAllowedExtension('shot.jpeg'), true);
  assert.equal(s.isAllowedExtension('shot.png'), true);
  assert.equal(s.isAllowedExtension('virus.exe'), false);
  assert.equal(s.isAllowedExtension('noext'), false);
});

test('sanitizeFilename strips traversal and unsafe chars', () => {
  assert.equal(s.sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(s.sanitizeFilename('Die performance analysis.pdf'), 'Die_performance_analysis.pdf');
  assert.equal(s.sanitizeFilename(''), 'file');
});

test('buildStoredPath composes root/qdNo/qdId/name', () => {
  const root = path.join('/srv', 'qd');
  const out = s.buildStoredPath(root, { qdNo: '2026GI-03', qdId: 7, fileName: 'a b.jpg' });
  assert.equal(out, path.join(root, '2026GI-03', '7', 'a_b.jpg'));
});

test('buildStoredPath cannot be escaped by a traversal filename', () => {
  const root = path.resolve('/srv/qd');
  const out = s.buildStoredPath(root, { qdNo: '../..', qdId: 1, fileName: '../../etc/passwd' });
  assert.equal(path.resolve(out).startsWith(root), true);
});

test('getTmpDir sits directly under the storage root (same filesystem)', () => {
  assert.equal(s.getTmpDir(), path.join(s.getRoot(), '.uploads-tmp'));
});

test('MAX_FILE_BYTES is 25 MB', () => {
  assert.equal(s.MAX_FILE_BYTES, 25 * 1024 * 1024);
});
