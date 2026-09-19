'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// qdStorage reads QD_FILES_ROOT at call time; point it at a scratch dir.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-doc-'));
process.env.QD_FILES_ROOT = root;
after(() => fs.rmSync(root, { recursive: true, force: true }));

const { buildQdPdfBytes } = require('./qdDocument.cjs');

const ORIGINAL = Buffer.from('%PDF-1.4\n% the form exactly as it was issued\n');
fs.mkdirSync(path.join(root, '2026PH-04', '7'), { recursive: true });
fs.writeFileSync(path.join(root, '2026PH-04', '7', 'old.pdf'), ORIGINAL);

const ROW = {
  id: 7, qd_no: '2026PH-04', imported: true, die_no: '30601-201', profile_number: '30601',
  supplier: 'PHOENIX', plant: 'GEX 1', raised_date: '2026-06-04', status: 'Open',
  issue_summary: 'Heavy blend.', issue_detail: 'Heavy blend observed on the profile after trial production.',
  prepared_by: 'Veera', closed_at: null,
};
const ORIGINAL_FILE = {
  id: 1, original_name: 'old.pdf', mime_type: 'application/pdf',
  stored_path: path.join('2026PH-04', '7', 'old.pdf'), category: 'original_form',
};

function fakePool({ row, files = [] }) {
  return {
    async query(sql) {
      const s = String(sql);
      if (s.includes('FROM quality_discrepancy_files')) return { rows: files };
      if (s.includes('FROM quality_discrepancies')) return { rows: row ? [row] : [] };
      return { rows: [] };
    },
  };
}

test('an imported QD serves the original PDF, byte for byte', async () => {
  const { row, bytes } = await buildQdPdfBytes(fakePool({ row: ROW, files: [ORIGINAL_FILE] }), 7);
  assert.equal(row.qd_no, '2026PH-04');
  assert.ok(Buffer.from(bytes).equals(ORIGINAL));
});

test('an imported QD whose original is missing fails rather than redrawing', async () => {
  await assert.rejects(buildQdPdfBytes(fakePool({ row: ROW, files: [] }), 7), /Original QD form missing for QD 2026PH-04/);
  const gone = { ...ORIGINAL_FILE, stored_path: '2026PH-04/7/gone.pdf' };
  await assert.rejects(buildQdPdfBytes(fakePool({ row: ROW, files: [gone] }), 7), /Original QD form missing/);
});

test('a QD raised in the app is still drawn from its record', async () => {
  const { bytes } = await buildQdPdfBytes(fakePool({ row: { ...ROW, imported: false } }), 7);
  const buf = Buffer.from(bytes);
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(!buf.equals(ORIGINAL));
});
