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
  // delivery .30 scoring 10, design .20 scoring 0 -> (10*.3 + 0*.2) / .5 = 6
  const out = p.overallRating(METRIC_DEFAULTS, { deliveryLeadTime: 30, designLeadTime: 10 });
  assert.equal(Math.round(out.score * 100) / 100, 6);
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
