'use strict';
// Combination chart: which insert and bolster sizes a press may run for a die size.
const { normalizeSizeClass } = require('./toolingNumbers.cjs');

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
const text = (v) => { const t = String(v == null ? '' : v).trim(); return t === '' ? null : t; };

// header text (normalised) -> field
const HEADERS = {
  'press': 'press', 'die size': 'die_size', 'insert size': 'insert_size', 'bolster size': 'bolster_size',
  'sub bolster size': 'sub_bolster_size', 'die ring size': 'die_ring_size', 'total stack': 'total_stack',
  'insert holder': 'insert_holder', 'baffle ring': 'baffle_ring', 'bol holder': 'bolster_holder',
  'bolster holder': 'bolster_holder', 'remark': 'remark', 'remarks': 'remark',
};
const SIZE_FIELDS = ['die_size', 'insert_size', 'bolster_size', 'sub_bolster_size', 'die_ring_size', 'total_stack', 'insert_holder'];

// onSkip(info) is an optional hook for reporting: { press, reason, row }.
function parseChartRows(rows, { sourceSheet, excludePresses = [], onSkip } = {}) {
  const skip = (press, reason, row) => { if (onSkip) onSkip({ press, reason, row }); };
  const headerIdx = rows.findIndex((r) => r && norm(r[0]) === 'press');
  if (headerIdx < 0) throw new Error('Chart header row (first cell "Press") not found');
  const col = {};
  rows[headerIdx].forEach((h, i) => { const f = HEADERS[norm(h)]; if (f && !(f in col)) col[f] = i; });
  const get = (r, f) => (f in col ? r[col[f]] : '');

  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const r = rows[i];
    const pressRaw = String(get(r, 'press')).trim();
    if (!/^\d+$/.test(pressRaw)) continue; // blank or non-data row
    const n = parseInt(pressRaw, 10);
    if (excludePresses.includes(n)) { skip(`PRESS ${n}`, 'excluded press', i + 1); continue; }
    const rec = { press: `PRESS ${n}` };
    for (const f of SIZE_FIELDS) rec[f] = normalizeSizeClass(get(r, f));
    rec.baffle_ring = text(get(r, 'baffle_ring'));
    rec.bolster_holder = text(get(r, 'bolster_holder'));
    rec.remark = text(get(r, 'remark'));
    // The 2014 sheet has no Remark header; notes such as "New" and "HOLD" are written in the
    // last column. Anything there that is not a size or YES/NO is a remark, not a holder.
    if (!('remark' in col) && rec.bolster_holder) {
      const v = rec.bolster_holder;
      const size = normalizeSizeClass(v);
      if (!/^(NO|YES)$/i.test(v) && !(size && /^\d+(\.\d+)?X\d+(\.\d+)?$/.test(size))) {
        rec.remark = v.toUpperCase();
        rec.bolster_holder = null;
      }
    }
    rec.source_sheet = sourceSheet;
    if (!rec.die_size) { skip(rec.press, 'no die size', i + 1); continue; }
    if (!rec.insert_size && !rec.bolster_size) { skip(rec.press, 'no insert or bolster size', i + 1); continue; }
    out.push({
      press: rec.press, die_size: rec.die_size, insert_size: rec.insert_size, bolster_size: rec.bolster_size,
      sub_bolster_size: rec.sub_bolster_size, die_ring_size: rec.die_ring_size, total_stack: rec.total_stack,
      insert_holder: rec.insert_holder, baffle_ring: rec.baffle_ring, bolster_holder: rec.bolster_holder,
      remark: rec.remark, source_sheet: rec.source_sheet,
    });
  }
  return out;
}

function chartVerdict(rows, { press, dieSize, kind, sizeClass }) {
  const forPress = rows.filter((r) => r.press === press);
  if (forPress.length === 0) return { verdict: 'no_chart', rows: [] };
  const die = normalizeSizeClass(dieSize);
  const size = normalizeSizeClass(sizeClass);
  const field = kind === 'bolster' ? 'bolster_size' : 'insert_size';
  // A row marked HOLD is not available to run, so it never counts as allowed.
  const matches = size && die
    ? forPress.filter((r) => r.die_size === die && r[field] === size && !/^hold$/i.test(String(r.remark || '').trim()))
    : [];
  return matches.length ? { verdict: 'allowed', rows: matches } : { verdict: 'not_allowed', rows: [] };
}

const COLS = ['press', 'die_size', 'insert_size', 'bolster_size', 'sub_bolster_size', 'die_ring_size',
  'total_stack', 'insert_holder', 'baffle_ring', 'bolster_holder', 'remark', 'source_sheet'];

function buildChartReplace(rows, sourceSheet) {
  const statements = [{ sql: 'DELETE FROM tooling_combinations WHERE source_sheet = $1', params: [sourceSheet] }];
  const sql = `INSERT INTO tooling_combinations (${COLS.join(', ')}) VALUES (${COLS.map((_, i) => `$${i + 1}`).join(', ')})`;
  for (const r of rows) statements.push({ sql, params: COLS.map((c) => r[c] ?? null) });
  return { statements };
}

module.exports = { parseChartRows, chartVerdict, buildChartReplace };
