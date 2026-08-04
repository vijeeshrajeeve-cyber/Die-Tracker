import React from 'react';
import { RatingGauge } from './charts';

// The headline: one number, one band, and a sentence saying what to do about it.
export default function RatingHero({ report, theme }) {
  const { rating, metrics, scores } = report;

  // No rating at all is a real state, not an error: it means nothing this
  // supplier does in this period has data behind it. Saying 0.0 would be a lie.
  if (!rating) {
    return (
      <div style={{ padding: 22, borderRadius: 12, border: `1px solid ${theme.cardBorder}`, background: theme.cardBg }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: theme.text, marginBottom: 6 }}>Not enough data to rate this supplier</div>
        <p style={{ fontSize: 13, color: theme.textMuted, lineHeight: 1.6, margin: 0 }}>
          No scored metric has a value for this period. Widen the period, or check that
          order dates and receipt dates are recorded for {report.supplier}.
        </p>
      </div>
    );
  }

  const scored = metrics
    .filter((m) => m.scored && scores[m.key] != null)
    .map((m) => ({ m, s: scores[m.key] }))
    .sort((a, b) => b.s - a.s);
  const best = scored[0];
  const worst = scored[scored.length - 1];
  const totalScored = metrics.filter((m) => m.scored).length;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 28, padding: 22, borderRadius: 12, border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, flexWrap: 'wrap' }}>
      <RatingGauge score={rating.score} band={rating.band} theme={theme} />
      <div style={{ flex: 1, minWidth: 280 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: rating.band.bg, marginBottom: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: rating.band.color }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: rating.band.color }}>{rating.band.label}</span>
        </div>
        <p style={{ fontSize: 14, color: theme.text, lineHeight: 1.6, marginBottom: 4 }}>
          <strong>{report.supplier}</strong> scores <strong>{rating.score.toFixed(1)}/10</strong>.
          {best && <> Strongest area is <strong style={{ color: '#16A34A' }}>{best.m.label}</strong> ({best.s.toFixed(1)}).</>}
          {worst && worst !== best && <> Priority for improvement is <strong style={{ color: rating.band.color }}>{worst.m.label}</strong> ({worst.s.toFixed(1)}).</>}
        </p>
        <div style={{ fontSize: 11, color: theme.textDim, marginTop: 10, lineHeight: 1.5 }}>
          Weighted across {metrics.filter((m) => m.scored).map((m) => `${m.label} (${Math.round(m.weight * 100)}%)`).join(', ')}.
          {rating.contributing < totalScored && (
            <> Only {rating.contributing} of {totalScored} scored metrics have data this period; the rating is renormalised over those.</>
          )}
        </div>
      </div>
    </div>
  );
}
