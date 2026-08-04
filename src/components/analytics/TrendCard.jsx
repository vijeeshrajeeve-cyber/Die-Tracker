import React from 'react';
import { LineChart, BarChart } from './charts';
import { COLORS } from './metricStyle';

export default function TrendCard({ metric, trend, theme }) {
  const color = COLORS[metric.key] || '#3B82F6';
  const series = (trend || []).map((r) => ({ month: r.month, value: r.value }));
  const fmt = (v) => Number(v).toFixed(metric.decimals ?? 0);
  return (
    <div style={{ padding: 16, borderRadius: 10, border: `1px solid ${theme.cardBorder}`, background: theme.cardBg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: color }} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: theme.text }}>{metric.label}</span>
        <span style={{ fontSize: 11, color: theme.textDim, marginLeft: 'auto' }}>{metric.unit || 'count'}</span>
      </div>
      {metric.key === 'ordersPlaced'
        ? <BarChart series={series} color={color} theme={theme} />
        : <LineChart series={series} target={metric.target} color={color} formatVal={fmt} theme={theme} />}
    </div>
  );
}
