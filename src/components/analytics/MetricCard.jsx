import React from 'react';
import { ScoreBar, Sparkline } from './charts';
import { COLORS, band } from './metricStyle';

export default function MetricCard({ metric, value, score, trend, theme }) {
  const color = COLORS[metric.key] || '#3B82F6';
  const fmt = (v) => (v == null ? '—' : Number(v).toFixed(metric.decimals ?? 0));
  const onTarget = metric.scored && value != null
    ? (metric.lowerBetter ? value <= metric.target : value >= metric.target)
    : null;
  const spark = (trend || []).map((r) => r.value);

  return (
    <div style={{ padding: 16, borderRadius: 10, border: `1px solid ${theme.cardBorder}`, background: theme.cardBg }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: theme.textMuted }}>{metric.label}</span>
        {score != null && (
          <span style={{ fontSize: 11, fontWeight: 700, color: band(score), padding: '2px 7px', borderRadius: 6, border: `1px solid ${band(score)}` }}>
            {score.toFixed(1)}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 12 }}>
        <span style={{ fontSize: 26, fontWeight: 700, color: value == null ? theme.textDim : theme.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {fmt(value)}
        </span>
        {metric.unit && value != null && <span style={{ fontSize: 12, color: theme.textDim, fontWeight: 500 }}>{metric.unit}</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, minHeight: 18 }}>
        {value == null ? (
          // Says why there is no number. An empty card reads as a bug.
          <span style={{ fontSize: 11, color: theme.textDim }}>Not tracked yet — no data this period</span>
        ) : metric.scored ? (
          <span style={{ fontSize: 11, color: onTarget ? '#16A34A' : '#D97706', fontWeight: 600 }}>
            {onTarget ? 'On target' : 'Off target'}
            <span style={{ color: theme.textDim, fontWeight: 400 }}>
              {' '}· target {metric.lowerBetter ? '≤' : '≥'} {fmt(metric.target)}{metric.unit ? ` ${metric.unit}` : ''}
            </span>
          </span>
        ) : (
          <span style={{ fontSize: 11, color: theme.textDim }}>{metric.blurb}</span>
        )}
      </div>

      {score != null && (
        <div style={{ marginTop: 10 }}><ScoreBar score={score} color={band(score)} theme={theme} /></div>
      )}

      <div style={{ marginTop: 10 }}>
        <Sparkline values={spark} color={color} />
      </div>
    </div>
  );
}
