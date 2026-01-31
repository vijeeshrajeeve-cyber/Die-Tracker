import React from 'react';
import { STATUS_CONFIG } from '../../utils/constants';

function StatusTable({ data, theme }) {
  const statusCounts = {};
  data.forEach(o => {
    if (o.STATUS) statusCounts[o.STATUS] = (statusCounts[o.STATUS] || 0) + 1;
  });
  const total = data.length;

  return (
    <div style={{
      background: theme.cardBg,
      borderRadius: '16px',
      padding: '1.25rem',
      border: `1px solid ${theme.border}`
    }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', color: theme.text }}>
        Status Distribution
      </h3>
      <div style={{ overflowX: 'auto', maxHeight: '320px', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase' }}>Status</th>
              <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase' }}>Count</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase' }}>%</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(statusCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([status, count]) => {
                const config = STATUS_CONFIG[status] || { color: '#94A3B8' };
                return (
                  <tr key={status} style={{ borderBottom: `1px solid ${theme.border}` }}>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: config.color }} />
                        <span style={{ fontSize: '0.85rem', color: theme.text }}>{status}</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '0.9rem', fontWeight: 600, color: theme.text }}>
                      {count}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '0.85rem', color: theme.textDim }}>
                      {total > 0 ? ((count / total) * 100).toFixed(1) : 0}%
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default StatusTable;
