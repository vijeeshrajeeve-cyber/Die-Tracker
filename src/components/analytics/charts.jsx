import React from 'react';

// SVG chart primitives for the supplier scorecard, ported from the
// "Die Ordering Design System" Claude Design project
// (ui_kits/dieshop/SupplierReportCharts.jsx). Deliberately dependency-free
// rather than recharts: every one uses viewBox + width:100% so it scales
// cleanly into an A4 print, which the recharts ResponsiveContainer does not.

export function RatingGauge({ score, band, size = 168, theme = {} }) {
  const r = (size - 18) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * Math.max(0, Math.min(1, score / 10));
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke={theme.cardBorder || '#334155'} strokeWidth={12} />
        <circle cx={c} cy={c} r={r} fill="none" stroke={band.color} strokeWidth={12}
          strokeLinecap="round" strokeDasharray={`${dash} ${circ - dash}`} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
          <span style={{ fontSize: 46, fontWeight: 700, color: theme.text, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{score.toFixed(1)}</span>
          <span style={{ fontSize: 18, fontWeight: 600, color: theme.textDim }}>/10</span>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: band.color, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center' }}>
          {band.label.split(' · ')[0]}
        </span>
      </div>
    </div>
  );
}

export function ScoreBar({ score, color, height = 6, theme = {} }) {
  const pct = Math.max(0, Math.min(100, score * 10));
  return (
    <div style={{ position: 'relative', width: '100%', height, background: theme.inputBg || '#1E293B', borderRadius: 99 }}>
      <div style={{ position: 'absolute', inset: 0, right: 'auto', width: `${pct}%`, background: color, borderRadius: 99 }} />
    </div>
  );
}

export function Sparkline({ values, color, width = 110, height = 30 }) {
  const clean = (values || []).filter((v) => Number.isFinite(v));
  if (clean.length < 2) return null;
  const min = Math.min(...clean);
  const span = (Math.max(...clean) - min) || 1;
  const pad = 3;
  const pts = clean.map((v, i) => [
    pad + (i / (clean.length - 1)) * (width - pad * 2),
    pad + (1 - (v - min) / span) * (height - pad * 2),
  ]);
  const dAttr = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <path d={dAttr} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.4} fill={color} />
    </svg>
  );
}

export function LineChart({ series, target, color, formatVal, theme = {} }) {
  const pts0 = (series || []).filter((s) => Number.isFinite(s.value));
  if (pts0.length < 2) {
    return <div style={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.textDim, fontSize: '0.8rem' }}>Not enough data</div>;
  }
  const W = 320, H = 150, padL = 8, padR = 14, padT = 16, padB = 24;
  const values = pts0.map((s) => s.value);
  const all = target != null ? [...values, target] : values;
  let min = Math.min(...all), max = Math.max(...all);
  const range = (max - min) || 1;
  min -= range * 0.18; max += range * 0.18;
  const span = max - min;
  const x = (i) => padL + (i / (pts0.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - min) / span) * (H - padT - padB);
  const pts = pts0.map((s, i) => [x(i), y(s.value)]);
  const lineD = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const areaD = `${lineD} L${pts[pts.length - 1][0].toFixed(1)} ${H - padB} L${pts[0][0].toFixed(1)} ${H - padB} Z`;
  const gid = `sp-grad-${color.replace('#', '')}`;
  const fmt = formatVal || ((v) => v);
  const last = pts[pts.length - 1];
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {target != null && (
        <g>
          <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke={theme.textDim || '#64748B'} strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
          <text x={W - padR} y={y(target) - 4} textAnchor="end" fontSize="9" fill={theme.textDim || '#64748B'}>target {fmt(target)}</text>
        </g>
      )}
      <path d={areaD} fill={`url(#${gid})`} />
      <path d={lineD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 3.5 : 2.4}
          fill={i === pts.length - 1 ? color : (theme.cardBg || '#0F172A')} stroke={color} strokeWidth="1.5" />
      ))}
      <text x={last[0]} y={Math.max(padT - 4, last[1] - 9)} textAnchor="end" fontSize="11" fontWeight="700" fill={theme.text || '#F1F5F9'}>
        {fmt(pts0[pts0.length - 1].value)}
      </text>
      {pts0.map((s, i) => (
        <text key={i} x={x(i)} y={H - 7} textAnchor="middle" fontSize="9" fill={theme.textDim || '#64748B'}>{s.month}</text>
      ))}
    </svg>
  );
}

export function BarChart({ series, color, theme = {} }) {
  const rows = (series || []).filter((s) => Number.isFinite(s.value));
  if (!rows.length) {
    return <div style={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.textDim, fontSize: '0.8rem' }}>Not enough data</div>;
  }
  const W = 320, H = 150, padL = 8, padR = 8, padT = 18, padB = 24;
  const max = (Math.max(...rows.map((s) => s.value)) * 1.15) || 1;
  const bw = (W - padL - padR) / rows.length;
  const y = (v) => padT + (1 - v / max) * (H - padT - padB);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
      {rows.map((s, i) => {
        const bx = padL + i * bw + bw * 0.2;
        const w = bw * 0.6;
        const top = y(s.value);
        return (
          <g key={i}>
            <rect x={bx} y={top} width={w} height={(H - padB) - top} rx="3" fill={color} opacity={i === rows.length - 1 ? 1 : 0.4} />
            <text x={bx + w / 2} y={top - 5} textAnchor="middle" fontSize="10" fontWeight="700" fill={theme.text || '#F1F5F9'}>{s.value}</text>
            <text x={bx + w / 2} y={H - 7} textAnchor="middle" fontSize="9" fill={theme.textDim || '#64748B'}>{s.month}</text>
          </g>
        );
      })}
    </svg>
  );
}
