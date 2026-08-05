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

// Targets are set annually — 77 MT is 2026's die life KPI, not a constant — and
// these reports leave the building. A supplier sent 7.4/10 in March must get
// 7.4/10 if they ask for a copy in November, so a report resolves the targets
// for its own year.
//
// Resolution order: the exact year, then the most recent EARLIER year, then the
// code defaults. Never forward: setting 2027's targets must not rescore 2026.
async function getSettings(pool, year) {
  const y = Number(year) || new Date().getFullYear();
  const { rows } = await pool.query(
    `SELECT metrics FROM supplier_performance_settings
      WHERE year IS NOT NULL AND year <= $1
      ORDER BY year DESC LIMIT 1`, [y]);

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

async function saveSettings(pool, year, metrics) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw fail(400, 'A valid year is required');
  validateMetrics(metrics);
  const slim = metrics
    .filter(m => METRIC_DEFAULTS.find(d => d.key === m.key && d.scored))
    .map(m => ({ key: m.key, ten: Number(m.ten), zero: Number(m.zero), target: Number(m.target), weight: Number(m.weight) }));
  await pool.query(
    `INSERT INTO supplier_performance_settings (year, metrics) VALUES ($1, $2)
     ON CONFLICT (year) DO UPDATE
        SET metrics = EXCLUDED.metrics, updated_at = CURRENT_TIMESTAMP`,
    [y, JSON.stringify(slim)]);
}

module.exports = { METRIC_DEFAULTS, validateMetrics, getSettings, saveSettings };
