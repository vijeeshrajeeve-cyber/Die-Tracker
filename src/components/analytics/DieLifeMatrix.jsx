import React from 'react';
import { MONTHS } from '../../utils/constants';

// The month-by-month figures behind the die life and die failure scores.
//
// The counts are shown beside the percentage on purpose: a supplier who
// disputes a failure rate can be shown the two numbers it came from.
export default function DieLifeMatrix({ rows, period, theme }) {
  const data = rows || [];
  const cell = { padding: '7px 10px', fontSize: '0.78rem', color: theme.text, fontVariantNumeric: 'tabular-nums' };
  const head = { ...cell, color: theme.textDim, fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' };
  const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toFixed(d));

  const same = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(Number(a) - Number(b)) < 1e-9);
  const starred = (c, f) => !same((c.totals || {})[f], (c.paired || {})[f]);
  // The count cells are the paired sums the figure beside them was calculated
  // from, so every row divides. A star marks a count where some plant typed
  // half a pair; the footnote explains.
  const count = (c, f) => {
    const v = (c.paired || {})[f];
    if (v == null) return '—';
    return `${Math.round(Number(v) * 100) / 100}${starred(c, f) ? '*' : ''}`;
  };
  const life = (c) => (c.noDiesScrapped ? 'no dies scrapped' : fmt(c.dieLife, 1));
  const failure = (c) => (c.dieFailure == null ? '—' : `${c.dieFailure.toFixed(1)}%`);
  const right = { ...cell, textAlign: 'right' };
  const FIELDS = ['tonnageMt', 'diesScrapped', 'diesInService', 'diesFailed'];
  // The server's period aggregate (from the raw rows), never a re-sum of the
  // monthly totals, so it agrees with the score.
  const total = period || {};
  const anyStar = [total, ...data].some((c) => FIELDS.some((f) => (c.paired || {})[f] != null && starred(c, f)));

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
              {data.map((r) => (
                  <tr key={r.month} style={{ borderTop: `1px solid ${theme.cardBorder}` }}>
                    <td style={{ ...cell, fontWeight: 600 }}>{MONTHS[r.month - 1]}</td>
                    <td style={right}>{count(r, 'tonnageMt')}</td>
                    <td style={right}>{count(r, 'diesScrapped')}</td>
                    <td style={right}>{life(r)}</td>
                    <td style={right}>{count(r, 'diesInService')}</td>
                    <td style={right}>{count(r, 'diesFailed')}</td>
                    <td style={right}>{failure(r)}</td>
                  </tr>
              ))}
              <tr style={{ borderTop: `2px solid ${theme.cardBorder}`, fontWeight: 700 }}>
                <td style={cell}>Period</td>
                <td style={right}>{count(total, 'tonnageMt')}</td>
                <td style={right}>{count(total, 'diesScrapped')}</td>
                <td style={right}>{life(total)}</td>
                <td style={right}>{count(total, 'diesInService')}</td>
                <td style={right}>{count(total, 'diesFailed')}</td>
                <td style={right}>{failure(total)}</td>
              </tr>
            </tbody>
          </table>
          {anyStar && (
            <p style={{ fontSize: 11, color: theme.textDim, margin: '8px 0 0' }}>
              * Some figures were entered without their matching count and are left out of the calculation.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
