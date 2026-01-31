import React from 'react';
import { Package, CheckCircle, Clock, XCircle, AlertTriangle } from 'lucide-react';

function KPICards({ stats, theme }) {
  const kpis = [
    { title: 'Total Orders', value: stats.total, color: '#3B82F6', icon: Package, sub: 'Year to date' },
    { title: 'Completed', value: stats.completed, color: '#10B981', icon: CheckCircle, sub: `${stats.total > 0 ? ((stats.completed / stats.total) * 100).toFixed(0) : 0}% rate` },
    { title: 'In Progress', value: stats.pending, color: '#F59E0B', icon: Clock, sub: 'Active orders' },
    { title: 'Cancelled', value: stats.cancelled, color: '#EF4444', icon: XCircle, sub: `${stats.total > 0 ? ((stats.cancelled / stats.total) * 100).toFixed(1) : 0}%` },
    { title: 'Avg Delay', value: `${stats.avgDelay}d`, color: '#8B5CF6', icon: AlertTriangle, sub: 'Design approval' },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '1rem',
      marginBottom: '1.5rem'
    }}>
      {kpis.map(kpi => (
        <div
          key={kpi.title}
          style={{
            background: theme.cardBg,
            borderRadius: '16px',
            padding: '1.25rem',
            border: `1px solid ${theme.border}`
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textMuted }}>
                {kpi.title}
              </p>
              <h3 style={{ fontSize: '2rem', fontWeight: 700, color: kpi.color, marginTop: '8px', fontFamily: 'monospace' }}>
                {kpi.value}
              </h3>
              <p style={{ fontSize: '0.8rem', color: theme.textMuted, marginTop: '4px' }}>
                {kpi.sub}
              </p>
            </div>
            <div style={{
              width: '48px', height: '48px', borderRadius: '12px',
              background: `${kpi.color}18`,
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <kpi.icon size={24} color={kpi.color} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default KPICards;
