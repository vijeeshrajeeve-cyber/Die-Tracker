'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseTitleBlock, readTitleBlock } = require('./titleBlockOcr.cjs');

// What tesseract gives for real GEX title blocks (30604_401 and 30595_601), line breaks as read.
const OCR_30604 = `1. All dimensions are 1n millimeter.

Customer :

C/S Area

419.064| CCD

102

Description :

Weight kg/m.

1.131

342

Ext/R

External perimeter

Scale: 1:1, 3:2, 4:1

Drawn by

176

Total internal perimeter

89

No. of cavities

Date

18.02.2026

30604`;

test('parseTitleBlock takes the CCD and the scales in the order printed', () => {
  assert.deepEqual(parseTitleBlock(OCR_30604), { ccd: 102, scales: [1, 2 / 3, 1 / 4] });
  assert.deepEqual(parseTitleBlock('C/S Area 2019.809 CCD 318 Description : Scale : 1:3, 1:2, 2:1, 3:1 Drawn by Maher'), {
    ccd: 318, scales: [3, 2, 1 / 2, 1 / 3],
  });
});

test('parseTitleBlock survives what OCR does to the line', () => {
  assert.equal(parseTitleBlock('CCD | 48').ccd, 48);
  assert.equal(parseTitleBlock('CCD: 181,6 Description').ccd, 181.6);
  assert.deepEqual(parseTitleBlock('Scale; 1;1, 3:2 , 3:2').scales, [1, 2 / 3], 'a semicolon for a colon, a ratio twice');
  assert.deepEqual(parseTitleBlock('Scale: 1:1. 2:1, 4:1 Drawn by').scales, [1, 1 / 2, 1 / 4], 'a full stop for a comma');
  assert.deepEqual(parseTitleBlock('Scale: 1:1.2:1, 4:1 Drawn by').scales, [1, 1 / 2, 1 / 4], 'and with the space lost too');
  assert.deepEqual(parseTitleBlock('CCD Description : -'), { ccd: null, scales: [] }, 'no number after the label');
  assert.equal(parseTitleBlock('CCD 9000').ccd, null, 'four digits is not a CCD');
  assert.equal(parseTitleBlock('CCD 1').ccd, null, 'below the range');
  assert.deepEqual(parseTitleBlock(''), { ccd: null, scales: [] });
  assert.deepEqual(parseTitleBlock(null), { ccd: null, scales: [] });
});

test('readTitleBlock reads through the OCR program and cleans up', async () => {
  let seen = null;
  const out = await readTitleBlock(Buffer.from('png'), {
    run: async (file) => { seen = file; return OCR_30604; },
  });
  assert.deepEqual(out, { available: true, ccd: 102, scales: [1, 2 / 3, 1 / 4] });
  assert.equal(require('node:fs').existsSync(seen), false, 'the temporary strip is removed');
});

test('readTitleBlock says so when the OCR program is not installed', async () => {
  const out = await readTitleBlock(Buffer.from('png'), {
    run: async () => { throw Object.assign(new Error('spawn tesseract ENOENT'), { code: 'ENOENT' }); },
  });
  assert.deepEqual(out, { available: false, ccd: null, scales: [] });
  await assert.rejects(readTitleBlock(Buffer.from('png'), { run: async () => { throw new Error('timed out'); } }), /timed out/);
});
