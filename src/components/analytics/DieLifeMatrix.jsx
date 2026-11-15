import React from 'react';
import { MONTHS } from '../../utils/constants';

const FIELDS = ['tonnageMt', 'diesScrapped', 'diesInService', 'diesFailed'];

// The Period row, from the monthly counts already summed across plants. Same
// rules as the server: a blank is never summed as 0, and no figure is averaged.
function periodOf(rows) {
  const totals = {};
  FIELDS.forEach((f) => { totals[f] = null; });
  let lifeT = 0, lifeS = 0, lifeRows = 0, run = 0, unloaded = 0;
  for (const r of rows) {
    const t = r.totals || {};
    FIELDS.forEach((f) => { if (t[f] != null) totals[f] = (totals[f] || 0) + Number(t[f]); });
    if (t.tonnageMt != null && t.diesScrapped != null) { lifeT += Number(t.tonnageMt); lifeS += Number(t.diesScrapped); lifeRows += 1; }
    if (t.diesInService != null) { run += Number(t.diesInService); unloaded += t.diesFailed == null ? 0 : Number(t.diesFailed); }
  }
  return {
    totals,
    noDiesScrapped: lifeRows > 0 && lifeS === 0,
    dieLife: lifeRows > 0 && lifeS > 0 ? lifeT / lifeS : null,
    dieFailure: run > 0 ? (unloaded / run) * 100 : null,
  };
}

// The month-by-month figures behind the die life and die failure scores.
//
// The counts are shown beside the percentage on purpose: a supplier who
// disputes a failure rate can be shown the two numbers it came from.
export default function DieLifeMatrix({ rows, theme }) {
  const data = rows || [];
  const cell = { padding: '7px 10px', fontSize: '0.78rem', color: theme.text, fontVariantNumeric: 'tabular-nums' };
  const head = { ...cell, color: theme.textDim, fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' };
  const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toFixed(d));

  // Summed from the monthly counts, as the server aggregates, so the Period
  // row agrees with the score. Averaging the monthly ratios would not.
  const period = periodOf(data);

  const count = (v) => (v == null ? '—' : String(Math.round(Number(v) * 100) / 100));
  const life = (c) => (c.noDiesScrapped ? 'no dies scrapped' : fmt(c.dieLife, 1));
  const failure = (c) => (c.dieFailure == null ? '—' : `${c.dieFailure.toFixed(1)}%`);
  const right = { ...cell, textAlign: 'right' };

  return (
    <div className="dt-span-all" style={{ padding: 16, borderRadius: 10, border: `1px solid ${theme.cardBorder}`, background: theme.cardBg }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: theme.text, marginBottom: 10 }}>Die Life &amp; Failure</div>
      {data.length === 0 ? (
        <p style={{ fontSize: 12, color: theme.textDim, margin: 0 }}>
          No die life figures recorded for this supplier yet. Enter them on the Die Life Data tab.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th scope="col" style={{ ...head, textAlign: 'left' }}>Month</th>
                <th scope="col" style={head}>Tonnage (MT)</th>
                <th scope="col" style={head}>Dies scrapped</th>
                <th scope="col" style={head}>Die life (MT)</th>
                <th scope="col" style={head}>Dies run</th>
                <th scope="col" style={head}>Dies unloaded</th>
                <th scope="col" style={head}>Failure %</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => {
                const t = r.totals || {};
                return (
                  <tr key={r.month} style={{ borderTop: `1px solid ${theme.cardBorder}` }}>
                    <td style={{ ...cell, fontWeight: 600 }}>{MONTHS[r.month - 1]}</td>
                    <td style={right}>{count(t.tonnageMt)}</td>
                    <td style={right}>{count(t.diesScrapped)}</td>
                    <td style={right}>{life(r)}</td>
                    <td style={right}>{count(t.diesInService)}</td>
                    <td style={right}>{count(t.diesFailed)}</td>
                    <td style={right}>{failure(r)}</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: `2px solid ${theme.cardBorder}`, fontWeight: 700 }}>
                <td style={cell}>Period</td>
                <td style={right}>{count(period.totals.tonnageMt)}</td>
                <td style={right}>{count(period.totals.diesScrapped)}</td>
                <td style={right}>{life(period)}</td>
                <td style={right}>{count(period.totals.diesInService)}</td>
                <td style={right}>{count(period.totals.diesFailed)}</td>
                <td style={right}>{failure(period)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
