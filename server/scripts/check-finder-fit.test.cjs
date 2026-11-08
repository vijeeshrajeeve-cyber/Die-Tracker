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
  assert.deepEqual(s.gates, {
    sizePrefilterRejectsFits: 0, sizePrefilterRejectsNonFits: 0, sizePrefilterUnknown: 5,
    pocketCountRejectsFits: 0, pocketCountRejectsNonFits: 0, pocketCountUnknown: 5,
  });
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

test('buildSummary counts the fitting and non-fitting pairs the size pre-filter and the pocket-count gate would remove', () => {
  const r = (o) => ({ kind: 'insert', confidence: 'confirmed', dieCavities: 1, toolingCavities: 1, pockets: 1, ms: 1, passesSizePrefilter: true, pocketCountMatches: true, ...o });
  const fit = { clearance: 8, rawClearance: 8, clearanceCapped: false };
  const noFit = { clearance: null, reason: 'no-fit', exactClearance: -2 };
  const s = buildSummary([
    r({ ...fit }),
    r({ ...fit, passesSizePrefilter: false }),
    r({ ...fit, passesSizePrefilter: false, pocketCountMatches: false }),
    r({ ...fit, pocketCountMatches: null }),
    r({ ...noFit, passesSizePrefilter: false }),
    r({ ...noFit, pocketCountMatches: false }),
    r({ ...noFit, passesSizePrefilter: null, pocketCountMatches: false }),
  ]);
  assert.equal(s.gates.sizePrefilterRejectsFits, 2);
  assert.equal(s.gates.sizePrefilterRejectsNonFits, 1);
  assert.equal(s.gates.sizePrefilterUnknown, 1);
  assert.equal(s.gates.pocketCountRejectsFits, 1);
  assert.equal(s.gates.pocketCountRejectsNonFits, 2);
  assert.equal(s.gates.pocketCountUnknown, 1);
});

test('checkPair records the size pre-filter and pocket-count verdicts and keeps the diagnostic grids', () => {
  const row = (over) => ({
    id: 1, number: 'T', kind: 'insert', plant: 'GEX 1', cavities: '1', status: 'active', confidence: 'confirmed',
    pockets: JSON.stringify([circle(30)]), die_no: 'D', die_cavities: 1, outer_mm: circle(20), ...over,
  });
  const ok = checkPair(row(), candidateFromRow(row()));
  assert.equal(ok.passesSizePrefilter, true);
  assert.equal(ok.pocketCountMatches, true);
  const twoCav = row({ cavities: 2 });
  assert.equal(checkPair(twoCav, candidateFromRow(twoCav)).pocketCountMatches, false);
  const unk = row({ cavities: null });
  assert.equal(checkPair(unk, candidateFromRow(unk)).pocketCountMatches, null);
  const small = row({ pockets: JSON.stringify([circle(22, 72, -200, 0), circle(22, 72, 200, 0)]), cavities: 2 });
  const c = candidateFromRow(small);
  const fail = checkPair(small, c);
  assert.equal(fail.passesSizePrefilter, false);
  assert.equal(fail.pocketCountMatches, true);
  assert.equal(fail.reason, 'no-fit');
  assert.ok(c.grids[0] && c.grids[1], 'both pockets keep their grids, the one after the failing pocket too');
});
