import React from 'react';
import { MONTHS } from '../../utils/constants';

// The month-by-month figures behind the die life and die failure scores.
//
// The counts are shown beside the percentage on purpose: a supplier who
// disputes a failure rate can be shown the two numbers it came from.
export default function DieLifeMatrix({ rows, theme }) {
  const data = rows || [];
  const cell = { padding: '7px 10px', fontSize: '0.78rem', color: theme.text, fontVariantNumeric: 'tabular-nums' };
  const head = { ...cell, color: theme.textDim, fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' };
  const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toFixed(d));

  // Weighted exactly as the server aggregates, so the total row agrees with the
  // score. A simple mean here would quietly contradict the rating above it.
  let failed = 0, inService = 0, weighted = 0, weight = 0;
  for (const r of data) {
    if (r.diesInService != null) {
      inService += r.diesInService;
      if (r.diesFailed != null) failed += r.diesFailed;
      if (r.avgDieLifeMt != null && r.diesInService > 0) {
        weighted += r.avgDieLifeMt * r.diesInService;
        weight += r.diesInService;
      }
    }
  }
  const totalLife = weight > 0 ? weighted / weight : null;
  const totalRate = inService > 0 ? (failed / inService) * 100 : null;

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
                <th scope="col" style={head}>Avg Die Life (MT)</th>
                <th scope="col" style={head}>Dies In Service</th>
                <th scope="col" style={head}>Dies Failed</th>
                <th scope="col" style={head}>Failure %</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => {
                const pct = (r.diesInService != null && r.diesInService > 0 && r.diesFailed != null)
                  ? (r.diesFailed / r.diesInService) * 100 : null;
                return (
                  <tr key={r.month} style={{ borderTop: `1px solid ${theme.cardBorder}` }}>
                    <td style={{ ...cell, fontWeight: 600 }}>{MONTHS[r.month - 1]}</td>
                    <td style={{ ...cell, textAlign: 'right' }}>{fmt(r.avgDieLifeMt, 1)}</td>
                    <td style={{ ...cell, textAlign: 'right' }}>{fmt(r.diesInService)}</td>
                    <td style={{ ...cell, textAlign: 'right' }}>{fmt(r.diesFailed)}</td>
                    <td style={{ ...cell, textAlign: 'right' }}>{pct == null ? '—' : `${pct.toFixed(1)}%`}</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: `2px solid ${theme.cardBorder}`, fontWeight: 700 }}>
                <td style={cell}>Period</td>
                <td style={{ ...cell, textAlign: 'right' }}>{fmt(totalLife, 1)}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{inService || '—'}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{inService ? failed : '—'}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{totalRate == null ? '—' : `${totalRate.toFixed(1)}%`}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
