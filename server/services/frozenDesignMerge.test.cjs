'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pdfPathsFromFiles } = require('./frozenDesignMerge.cjs');

const root = path.join('/srv', 'fz');

test('pdfPathsFromFiles keeps only PDFs and resolves under root', () => {
  const files = [
    { original_name: 'a.pdf', stored_path: '14752/PRESS_4/2/9/a.pdf' },
    { original_name: 'model.step', stored_path: '14752/PRESS_4/2/9/model.step' },
    { original_name: 'B.PDF', stored_path: '14752/PRESS_4/2/9/B.PDF' },
    { original_name: 'photo.jpg', stored_path: '14752/PRESS_4/2/9/photo.jpg' },
  ];
  const out = pdfPathsFromFiles(files, root);
  assert.equal(out.length, 2);
  assert.equal(out[0], path.resolve(root, '14752/PRESS_4/2/9/a.pdf'));
  assert.equal(out[1], path.resolve(root, '14752/PRESS_4/2/9/B.PDF'));
});

test('pdfPathsFromFiles drops paths that escape the root', () => {
  const files = [{ original_name: 'evil.pdf', stored_path: '../../etc/evil.pdf' }];
  assert.deepEqual(pdfPathsFromFiles(files, root), []);
});

test('pdfPathsFromFiles handles empty/missing input', () => {
  assert.deepEqual(pdfPathsFromFiles([], root), []);
  assert.deepEqual(pdfPathsFromFiles(undefined, root), []);
});
