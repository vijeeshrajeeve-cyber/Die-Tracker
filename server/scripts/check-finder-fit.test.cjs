'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { percentile, bucketOf, buildSummary, parseArgs, checkPair } = require('./check-finder-fit.cjs');
const { candidateFromRow } = require('../services/toolingFinder.cjs');

const circle = (r, n = 72, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => {
  const a = (2 * Math.PI * i) / n;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
});

test('percentile interpolates between ranks and ignores non-finite values', () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([7], 0.9), 7);
  assert.equal(percentile([4, 1, 3, 2], 0.5), 2.5);
  assert.ok(Math.abs(percentile([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, NaN], 0.1) - 10) < 1e-9);
});

test('bucketOf splits failures into outside, too tight and unmeasured', () => {
  assert.equal(bucketOf(-3), 'outside (<0)');
  assert.equal(bucketOf(0), 'too tight (0-5)');
  assert.equal(bucketOf(4.99), 'too tight (0-5)');
  assert.equal(bucketOf(null), 'unmeasured');
  assert.equal(bucketOf(6), 'measured >= 5');
});

test('buildSummary counts pass rates, cavity agreement, failure buckets and the worst confirmed failures', () => {
  const r = (o) => ({ kind: 'insert', confidence: 'confirmed', dieCavities: 1, toolingCavities: 1, pockets: 1, ms: 2, ...o });
  const records = [
    r({ dieNo: 'A', tooling: 'T1', clearance: 8, rawClearance: 8, clearanceCapped: false }),
    r({ dieNo: 'B', tooling: 'T2', clearance: 50, rawClearance: 70, clearanceCapped: true, confidence: 'likely' }),
    r({ dieNo: 'C', tooling: 'T3', clearance: null, reason: 'no-fit', exactClearance: -12, worstPocket: 0, ms: 4 }),
    r({ dieNo: 'D', tooling: 'T4', clearance: null, reason: 'no-fit', exactClearance: 3, worstPocket: 1, toolingCavities: 2 }),
    r({ dieNo: 'E', tooling: 'T5', clearance: null, reason: 'no-fit', exactClearance: -1, toolingCavities: null, confidence: 'likely' }),
  ];
  const s = buildSummary(records, { plant: 'GEX 1', confidences: ['confirmed', 'likely'] });
  assert.equal(s.pairs, 5);
  assert.equal(s.passes, 2);
  assert.equal(s.passRate, 40);
  assert.deepEqual(s.byConfidence.confirmed, { pairs: 3, passes: 1, passRate: 33.3 });
  assert.deepEqual(s.byConfidence.likely, { pairs: 2, passes: 1, passRate: 50 });
  assert.equal(s.clearanceOfPasses.p50, 29);
  assert.equal(s.clearanceOfPasses.capped, 1);
  assert.equal(s.cavities.bothKnown, 4);
  assert.equal(s.cavities.agree, 3);
  assert.equal(s.cavities.unknown, 1);
  assert.equal(s.cavities.passRateAgreeing, 66.7);
  assert.equal(s.cavities.confirmedAgreeing, 2);
  assert.equal(s.cavities.passRateConfirmedAgreeing, 50);
  assert.deepEqual(s.failures['no-fit'], { count: 3, buckets: { 'outside (<0)': 2, 'too tight (0-5)': 1 } });
  assert.deepEqual(s.worstConfirmedFailures.map((w) => w.dieNo), ['C', 'D']);
  assert.deepEqual(s.worstConfirmedAgreeingFailures.map((w) => w.dieNo), ['C']);
  assert.equal(s.msPerFit.mean, 2.4);
  assert.equal(s.msPerFit.max, 4);
});

test('parseArgs needs a plant and defaults the confidences', () => {
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(['--plant', 'GEX 1', '--limit', '0']), null);
  assert.deepEqual(parseArgs(['--plant', 'GEX 1']), { plant: 'GEX 1', confidences: ['confirmed', 'likely'], limit: null, out: null });
  assert.deepEqual(parseArgs(['--plant', 'GEX 2', '--confidence', 'uncertain', '--limit', '5', '--out', 'x.json']).confidences, ['uncertain']);
});

test('checkPair recentres the profile and measures a failure with the gate off', () => {
  const row = (r) => ({ id: 1, number: 'T', kind: 'insert', plant: 'GEX 1', cavities: '1', status: 'active', confidence: 'confirmed', pockets: JSON.stringify([circle(r)]), die_no: 'D', die_cavities: 1, outer_mm: circle(20, 72, 300, -200) });
  const pass = checkPair(row(30), candidateFromRow(row(30)));
  assert.equal(pass.reason, null);
  assert.ok(pass.clearance > 9.5 && pass.clearance < 10.1, String(pass.clearance));
  const fail = checkPair(row(22), candidateFromRow(row(22)));
  assert.equal(fail.reason, 'no-fit');
  assert.equal(fail.clearance, null);
  assert.ok(fail.exactClearance > 1.5 && fail.exactClearance < 2.1, String(fail.exactClearance));
  assert.equal(fail.worstPocket, 0);
});
