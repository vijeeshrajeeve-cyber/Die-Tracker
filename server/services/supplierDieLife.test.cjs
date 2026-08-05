'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('./supplierDieLife.cjs');

// ---------- validateEntry ----------

test('validateEntry normalises blanks to null, not zero', () => {
  const out = s.validateEntry({ supplier: ' PDTMC ', avgDieLifeMt: '', diesInService: null, diesFailed: undefined });
  assert.equal(out.supplier, 'PDTMC');
  assert.equal(out.avgDieLifeMt, null);
  assert.equal(out.diesInService, null);
  assert.equal(out.diesFailed, null);
});

test('validateEntry keeps a typed zero as zero', () => {
  const out = s.validateEntry({ supplier: 'PHME', diesInService: 12, diesFailed: 0 });
  assert.equal(out.diesFailed, 0, 'a typed 0 means zero failures and must survive');
});

test('validateEntry rejects more failures than dies in service', () => {
  assert.throws(
    () => s.validateEntry({ supplier: 'PHME', diesInService: 5, diesFailed: 9 }),
    (e) => e.status === 400 && /more dies failed/i.test(e.message)
  );
});

test('validateEntry rejects negative numbers', () => {
  assert.throws(
    () => s.validateEntry({ supplier: 'PHME', avgDieLifeMt: -3 }),
    (e) => e.status === 400 && /negative/i.test(e.message)
  );
});

test('validateEntry rejects a failure count with no denominator', () => {
  assert.throws(
    () => s.validateEntry({ supplier: 'PHME', diesFailed: 2 }),
    (e) => e.status === 400 && /dies in service/i.test(e.message)
  );
  assert.throws(
    () => s.validateEntry({ supplier: 'PHME', diesInService: 0, diesFailed: 0 }),
    (e) => e.status === 400
  );
});

test('validateEntry allows die life alone — it scores on its own', () => {
  const out = s.validateEntry({ supplier: 'ALMAX', avgDieLifeMt: 64 });
  assert.equal(out.avgDieLifeMt, 64);
  assert.equal(out.diesInService, null);
});

test('validateEntry requires a supplier', () => {
  assert.throws(() => s.validateEntry({ supplier: '  ' }), (e) => e.status === 400);
});

// ---------- aggregateDieLife ----------

test('aggregateDieLife weights die life by dies in service', () => {
  // 40 dies at 80 MT and 4 dies at 20 MT. A simple mean would say 50 MT;
  // the busy month must dominate.
  const out = s.aggregateDieLife([
    { avgDieLifeMt: 80, diesInService: 40, diesFailed: 4 },
    { avgDieLifeMt: 20, diesInService: 4, diesFailed: 0 },
  ]);
  assert.equal(Math.round(out.dieLife * 100) / 100, 74.55);
});

test('aggregateDieLife pools failure counts rather than averaging percentages', () => {
  const out = s.aggregateDieLife([
    { avgDieLifeMt: 80, diesInService: 40, diesFailed: 4 },
    { avgDieLifeMt: 20, diesInService: 4, diesFailed: 0 },
  ]);
  assert.equal(Math.round(out.dieFailure * 100) / 100, 9.09); // 4/44
});

test('aggregateDieLife returns null failure when no dies were in service', () => {
  const out = s.aggregateDieLife([{ avgDieLifeMt: 55, diesInService: null, diesFailed: null }]);
  assert.equal(out.dieFailure, null, '0 of 0 is unknown, not a perfect 0%');
});

test('aggregateDieLife falls back to a simple mean when no month has counts', () => {
  // Otherwise a weighted mean with no weights divides by zero and silently
  // discards a figure somebody typed.
  const out = s.aggregateDieLife([
    { avgDieLifeMt: 60, diesInService: null, diesFailed: null },
    { avgDieLifeMt: 80, diesInService: null, diesFailed: null },
  ]);
  assert.equal(out.dieLife, 70);
});

test('aggregateDieLife ignores unweighted months when others carry weight', () => {
  const out = s.aggregateDieLife([
    { avgDieLifeMt: 80, diesInService: 10, diesFailed: 1 },
    { avgDieLifeMt: 20, diesInService: null, diesFailed: null },
  ]);
  assert.equal(out.dieLife, 80);
});

test('aggregateDieLife returns nulls for an empty period', () => {
  assert.deepEqual(s.aggregateDieLife([]), { dieLife: null, dieFailure: null });
});

test('aggregateDieLife treats zero failures as a real zero', () => {
  const out = s.aggregateDieLife([{ avgDieLifeMt: 90, diesInService: 20, diesFailed: 0 }]);
  assert.equal(out.dieFailure, 0);
});
