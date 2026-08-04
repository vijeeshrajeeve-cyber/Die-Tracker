'use strict';

// Scoring model for the supplier scorecard. Kept separate from the aggregation
// queries so the arithmetic can be tested without a database.

const clamp01 = (x) => Math.max(0, Math.min(1, x));

function scoreMetric(metric, value) {
  if (!metric || !metric.scored) return null;
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const v = Number(value);
  const frac = metric.lowerBetter
    ? (metric.zero - v) / (metric.zero - metric.ten)
    : (v - metric.zero) / (metric.ten - metric.zero);
  return clamp01(frac) * 10;
}

// Weighted mean over the metrics that actually have data, renormalised by the
// weights present. A metric with no data is excluded — never scored 0. Scoring
// an absence as zero would rate a supplier "At risk" for data nobody collected.
function overallRating(metrics, snapshot) {
  let sum = 0;
  let wsum = 0;
  let contributing = 0;
  for (const m of metrics) {
    if (!m.scored) continue;
    const s = scoreMetric(m, snapshot ? snapshot[m.key] : null);
    if (s === null) continue;
    sum += s * m.weight;
    wsum += m.weight;
    contributing += 1;
  }
  if (!wsum) return null;
  return { score: sum / wsum, contributing };
}

function ratingBand(score) {
  if (score >= 8.5) return { label: 'Exceptional', color: '#16A34A', bg: '#F0FDF4' };
  if (score >= 7.5) return { label: 'Strong · Preferred', color: '#16A34A', bg: '#F0FDF4' };
  if (score >= 6.5) return { label: 'Good · Reliable', color: '#0D9488', bg: '#F0FDFA' };
  if (score >= 5.5) return { label: 'Fair · Watch', color: '#D97706', bg: '#FFFBEB' };
  if (score >= 4.0) return { label: 'Marginal · Action needed', color: '#EA580C', bg: '#FFF7ED' };
  return { label: 'At risk', color: '#DC2626', bg: '#FEF2F2' };
}

module.exports = { scoreMetric, overallRating, ratingBand };
