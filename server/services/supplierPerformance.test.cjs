'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const p = require('./supplierPerformance.cjs');
const { METRIC_DEFAULTS } = require('./supplierPerformanceSettings.cjs');

const metric = (key) => METRIC_DEFAULTS.find(m => m.key === key);

test('scoreMetric: lower-better scores 10 at the target and 0 at the floor', () => {
  const m = metric('deliveryLeadTime'); // ten 30, zero 55
  assert.equal(p.scoreMetric(m, 30), 10);
  assert.equal(p.scoreMetric(m, 55), 0);
  assert.equal(p.scoreMetric(m, 42.5), 5);
});

test('scoreMetric clamps outside the band rather than going negative or past 10', () => {
  const m = metric('deliveryLeadTime');
  assert.equal(p.scoreMetric(m, 5), 10);
  assert.equal(p.scoreMetric(m, 900), 0);
});

test('scoreMetric returns null for a missing value', () => {
  const m = metric('trialRatio');
  assert.equal(p.scoreMetric(m, null), null);
  assert.equal(p.scoreMetric(m, undefined), null);
});

test('scoreMetric returns null for an unscored metric', () => {
  assert.equal(p.scoreMetric(metric('ordersPlaced'), 42), null);
});

test('scoreMetric handles a higher-better metric', () => {
  const m = { key: 'x', scored: true, lowerBetter: false, ten: 100, zero: 0, weight: 1 };
  assert.equal(p.scoreMetric(m, 100), 10);
  assert.equal(p.scoreMetric(m, 0), 0);
  assert.equal(p.scoreMetric(m, 50), 5);
});

test('overallRating renormalises over the weights actually present', () => {
  // Only deliveryLeadTime (weight .30) has data; a perfect score must read 10,
  // not 3, which is what happens if the missing weights are counted as zero.
  const snapshot = { deliveryLeadTime: 30 };
  const out = p.overallRating(METRIC_DEFAULTS, snapshot);
  assert.equal(out.score, 10);
  assert.equal(out.contributing, 1);
});

test('overallRating never treats a missing metric as a zero score', () => {
  // A supplier with no trials recorded must not be dragged down for it.
  const withTrials = p.overallRating(METRIC_DEFAULTS, { deliveryLeadTime: 30, trialRatio: 1.5 });
  const withoutTrials = p.overallRating(METRIC_DEFAULTS, { deliveryLeadTime: 30 });
  assert.equal(withTrials.score, 10);
  assert.equal(withoutTrials.score, 10);
});

test('overallRating weights the contributors correctly', () => {
  // Delivery scores 10 (at its target), design scores 0 (at its floor), and
  // the mean renormalises over just those two weights.
  //
  // Derived from METRIC_DEFAULTS rather than hardcoded: the weights are pinned
  // by their own tests, and this one is about the renormalisation, so it should
  // not have to be rewritten every time the business re-balances a weight.
  const wDelivery = metric('deliveryLeadTime').weight;
  const wDesign = metric('designLeadTime').weight;
  const expected = (10 * wDelivery + 0 * wDesign) / (wDelivery + wDesign);

  const out = p.overallRating(METRIC_DEFAULTS, { deliveryLeadTime: 30, designLeadTime: 10 });
  assert.equal(Math.round(out.score * 100) / 100, Math.round(expected * 100) / 100);
  assert.equal(out.contributing, 2);
});

test('overallRating returns null when nothing has data', () => {
  assert.equal(p.overallRating(METRIC_DEFAULTS, {}), null);
  assert.equal(p.overallRating(METRIC_DEFAULTS, { ordersPlaced: 12 }), null);
});

test('ratingBand boundaries', () => {
  assert.equal(p.ratingBand(8.5).label, 'Exceptional');
  assert.equal(p.ratingBand(7.5).label, 'Strong · Preferred');
  assert.equal(p.ratingBand(6.5).label, 'Good · Reliable');
  assert.equal(p.ratingBand(5.5).label, 'Fair · Watch');
  assert.equal(p.ratingBand(4.0).label, 'Marginal · Action needed');
  assert.equal(p.ratingBand(3.9).label, 'At risk');
});

// --- Die life and die failure -------------------------------------------
// The higher-is-better branch of scoreMetric has never run in production --
// every metric until now was lower-better. Untested branches are where the
// bugs live.

test('scoreMetric scores die life on the higher-is-better branch', () => {
  const m = metric('dieLife'); // ten 77, zero 20
  assert.equal(p.scoreMetric(m, 77), 10);
  assert.equal(p.scoreMetric(m, 20), 0);
  assert.equal(Math.round(p.scoreMetric(m, 48.5) * 100) / 100, 5);
});

test('scoreMetric clamps die life at both ends', () => {
  const m = metric('dieLife');
  assert.equal(p.scoreMetric(m, 500), 10, 'beating the target cannot score above 10');
  assert.equal(p.scoreMetric(m, 0), 0, 'below the floor cannot score below 0');
});

test('scoreMetric scores die failure lower-is-better', () => {
  const m = metric('dieFailure'); // ten 19, zero 40
  assert.equal(p.scoreMetric(m, 19), 10);
  assert.equal(p.scoreMetric(m, 40), 0);
  assert.equal(p.scoreMetric(m, 60), 0, 'clamped');
});

test('an unrecorded die life is excluded, not scored zero', () => {
  const snapshot = {
    dieLife: null, dieFailure: null, designLeadTime: 3, deliveryLeadTime: 30,
    trialRatio: 1.5, qdRate: 5, designRevisions: 1,
  };
  const out = p.overallRating(METRIC_DEFAULTS, snapshot);
  assert.equal(out.score, 10, 'renormalised over the metrics that have data');
  assert.equal(out.contributing, 5);
});

test('a score landing exactly on a band boundary is not lost to float error', () => {
  // The weights do not sum exactly in IEEE754, so renormalisation can turn an
  // exact 8.5 into 8.499999999999999 and drop the supplier a whole band.
  // Delivery LT alone: ten 30, zero 55. Halfway (42.5) scores exactly 5.
  const out = p.overallRating(METRIC_DEFAULTS, { deliveryLeadTime: 42.5 });
  assert.equal(out.score, 5);
  assert.equal(p.ratingBand(out.score).label, 'Marginal · Action needed');
});
