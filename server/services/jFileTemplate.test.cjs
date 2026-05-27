'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

// ── Mock pg pool ─────────────────────────────────────────────────────────
function makePool({ activeDies = [], extrudedByDie = {}, orderVolume = 0, prevSuppliers = [] } = {}) {
  return {
    query: async (sql, params) => {
      if (sql.includes('existing_die_details')) {
        return { rows: activeDies, rowCount: activeDies.length };
      }
      if (sql.includes('existing_production_data')) {
        if (sql.includes('profile_number')) {
          return { rows: [{ total: orderVolume }] };
        }
        // per-die query: params[0] is die_no
        const vol = extrudedByDie[params?.[0]] ?? 0;
        return { rows: [{ total: vol }] };
      }
      if (sql.includes('die_orders')) {
        return { rows: prevSuppliers.map(s => ({ supplier: s })) };
      }
      return { rows: [] };
    },
  };
}

const SAMPLE_REQUEST = {
  die_no: '014752-702',
  customer: 'Gutmann Systems Middle East FZCO',
  press: 'P7',
};

const SAMPLE_VALUES = {
  HOLLOW: 'Y',
  SOLID: '',
  DIE_SIZE: 'Dia 320x160',
  SUPPLIER: 'PDTMC',
  PENDING_ORDER_KG: '16280',
};

// ── Pure helper tests (no template file needed) ───────────────────────────
test('extractProfile: splits on first hyphen', () => {
  const { extractProfile } = require('./jFileTemplate.cjs');
  assert.equal(extractProfile('014752-702'), '014752');
  assert.equal(extractProfile('24216-201'), '24216');
  assert.equal(extractProfile('24216-2501'), '24216');
  assert.equal(extractProfile('NODASH'), 'NODASH');
  assert.equal(extractProfile(''), '');
  assert.equal(extractProfile(null), '');
});

test('extractNewDieNo: returns portion after first hyphen', () => {
  const { extractNewDieNo } = require('./jFileTemplate.cjs');
  assert.equal(extractNewDieNo('014752-702'), '702');
  assert.equal(extractNewDieNo('24216-2501'), '2501');
  assert.equal(extractNewDieNo('NODASH'), '');
  assert.equal(extractNewDieNo(''), '');
});

test('formatKg: formats integers with thousands separator and Kg suffix', () => {
  const { formatKg } = require('./jFileTemplate.cjs');
  assert.equal(formatKg(60374), '60,374 Kg');
  assert.equal(formatKg(0), '0 Kg');
  assert.equal(formatKg(null), '0 Kg');
  assert.equal(formatKg(undefined), '0 Kg');
  assert.equal(formatKg(1000000), '1,000,000 Kg');
});

test('formatDate: returns DD/MM/YYYY', () => {
  const { formatDate } = require('./jFileTemplate.cjs');
  const result = formatDate(new Date('2026-05-12'));
  assert.equal(result, '12/05/2026');
});

// ── Integration test (requires Task 1 template to be in place) ────────────
test('generateJFilePdf: returns a Buffer starting with %PDF', async () => {
  const { generateJFilePdf } = require('./jFileTemplate.cjs');
  const pool = makePool({
    activeDies: [
      { die_no: '014752-2505', raw_data: { Supplier: 'PDTMC' } },
    ],
    extrudedByDie: { '014752-2505': 44351 },
    orderVolume: 60374,
    prevSuppliers: ['PDTMC', 'EXTEC-NEW ZEALAND'],
  });

  const result = await generateJFilePdf(SAMPLE_REQUEST, SAMPLE_VALUES, pool);
  assert.ok(Buffer.isBuffer(result), 'result must be a Buffer');
  assert.ok(result.length > 10000, 'buffer should be non-trivially large');
  assert.equal(result.slice(0, 4).toString(), '%PDF', 'must be a valid PDF');
});

test('generateJFilePdf: succeeds with empty DB (all fields blank/zero)', async () => {
  const { generateJFilePdf } = require('./jFileTemplate.cjs');
  const pool = makePool(); // all empty
  const result = await generateJFilePdf(SAMPLE_REQUEST, SAMPLE_VALUES, pool);
  assert.equal(result.slice(0, 4).toString(), '%PDF');
});
