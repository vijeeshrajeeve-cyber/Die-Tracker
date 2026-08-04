'use strict';

// Scoring targets and weights for the supplier scorecard.
//
// Die Life and Die Failure are deliberately absent: nothing in the schema
// records tonnage extruded or dies failing before rated life, and 45% of the
// original design's weighting rested on them. Omitted rather than estimated.
// See docs/superpowers/specs/2026-08-04-supplier-performance-evaluation-design.md.
//
// The seed targets come from the observed distribution on real orders, not
// from the design mock. The mock's ≤7 day design-lead-time target sat far
// above actual performance of 1.6–5.2 days, which would have scored every
// supplier 10/10 and made that 20% of the rating carry no information.
const METRIC_DEFAULTS = [
  { key: 'ordersPlaced', label: 'Orders Placed', unit: '', scored: false, decimals: 0,
    blurb: 'Dies ordered in the period' },
  { key: 'designLeadTime', label: 'Avg Design Lead Time', unit: 'days', scored: true,
    lowerBetter: true, ten: 3, zero: 10, target: 3, weight: 0.20, decimals: 1,
    blurb: 'Order placed → design received' },
  { key: 'deliveryLeadTime', label: 'Avg Delivery Lead Time', unit: 'days', scored: true,
    lowerBetter: true, ten: 30, zero: 55, target: 30, weight: 0.30, decimals: 0,
    blurb: 'Order placed → die received on site' },
  { key: 'trialRatio', label: 'Avg Trial Ratio', unit: 'trials/die', scored: true,
    lowerBetter: true, ten: 1.5, zero: 3.0, target: 1.5, weight: 0.20, decimals: 2,
    blurb: 'Trials needed before acceptance' },
  { key: 'qdRate', label: 'QD Rate', unit: '%', scored: true,
    lowerBetter: true, ten: 5, zero: 20, target: 5, weight: 0.20, decimals: 1,
    blurb: 'Discrepancies raised per die received' },
  { key: 'designRevisions', label: 'Design Revisions', unit: 'per die', scored: true,
    lowerBetter: true, ten: 1.0, zero: 3.0, target: 1.0, weight: 0.10, decimals: 2,
    blurb: 'Design revisions before approval' },
];

const TUNABLE = ['ten', 'zero', 'target', 'weight'];

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function validateMetrics(metrics) {
  if (!Array.isArray(metrics) || !metrics.length) throw fail(400, 'Metrics are required');
  let total = 0;
  for (const m of metrics) {
    const def = METRIC_DEFAULTS.find(d => d.key === m.key);
    if (!def) throw fail(400, `Unknown metric "${m.key}"`);
    if (!def.scored) continue;
    for (const f of TUNABLE) {
      if (!Number.isFinite(Number(m[f]))) throw fail(400, `${def.label}: ${f} must be a number`);
    }
    // A zero-width band divides by zero in scoreMetric.
    if (Number(m.ten) === Number(m.zero)) {
      throw fail(400, `${def.label}: the 10-point and 0-point values must differ`);
    }
    total += Number(m.weight);
  }
  const pct = Math.round(total * 1000) / 1000;
  if (pct !== 1) throw fail(400, `Weights must total 100% (currently ${Math.round(total * 100)}%)`);
}

async function getSettings(pool) {
  const { rows } = await pool.query('SELECT metrics FROM supplier_performance_settings ORDER BY id LIMIT 1');
  let stored = [];
  try {
    const parsed = JSON.parse(rows[0]?.metrics || '[]');
    if (Array.isArray(parsed)) stored = parsed;
  } catch { stored = []; }

  // Presentation fields always come from code; only tunables are read back.
  return METRIC_DEFAULTS.map((def) => {
    const s = stored.find(x => x && x.key === def.key);
    if (!s) return def;
    const merged = { ...def };
    for (const f of TUNABLE) if (Number.isFinite(Number(s[f]))) merged[f] = Number(s[f]);
    return merged;
  });
}

async function saveSettings(pool, metrics) {
  validateMetrics(metrics);
  const slim = metrics
    .filter(m => METRIC_DEFAULTS.find(d => d.key === m.key && d.scored))
    .map(m => ({ key: m.key, ten: Number(m.ten), zero: Number(m.zero), target: Number(m.target), weight: Number(m.weight) }));
  const json = JSON.stringify(slim);
  const existing = await pool.query('SELECT id FROM supplier_performance_settings ORDER BY id LIMIT 1');
  if (existing.rows.length) {
    await pool.query(
      'UPDATE supplier_performance_settings SET metrics = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [json, existing.rows[0].id]);
  } else {
    await pool.query('INSERT INTO supplier_performance_settings (metrics) VALUES ($1)', [json]);
  }
}

module.exports = { METRIC_DEFAULTS, validateMetrics, getSettings, saveSettings };
