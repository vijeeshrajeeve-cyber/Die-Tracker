import React from 'react';
import { Truck, FlaskConical, CheckCircle } from 'lucide-react';

const COLS = '110px 1fr 1.1fr 0.9fr 96px 72px';

// One bucket: a titled, counted list, or a green all-clear when it is empty.
// A count of zero is itself an answer to "what is pending", so the bucket is
// never hidden.
// `icon` is a rendered element rather than a component type, so the caller owns
// its colour and this stays a plain presentational shell.
function FocBucket({ title, icon, rows, headers, emptyText, render, onOpen, s }) {
  return (
    <div style={{ ...s.panel, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
        {icon}
        <span style={s.sectionLabel}>{title}</span>
        <span style={{ fontFamily: s.mono, fontSize: 13, fontWeight: 700, color: rows.length ? s.text : s.dim, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
          {rows.length}
        </span>
      </div>

      {rows.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '18px 4px', color: s.dim, fontSize: 12.5 }}>
          <CheckCircle size={15} style={{ color: '#34D399' }} /> {emptyText}
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 10, alignItems: 'center', padding: '10px 0 8px', borderBottom: `1px solid ${s.border}` }}>
            {headers.map((h, i) => (
              <span key={h} style={{ ...s.headCell, textAlign: i >= headers.length - 2 ? 'right' : 'left' }}>{h}</span>
            ))}
          </div>
          {rows.map((r) => (
            <div key={r.id} className="qd-foc-row" onClick={() => onOpen && onOpen(r.id)}
              style={{ display: 'grid', gridTemplateColumns: COLS, gap: 10, alignItems: 'center', padding: '11px 0', borderBottom: `1px solid ${s.border}`, cursor: onOpen ? 'pointer' : 'default' }}>
              {render(r)}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// The two things that can be outstanding against an accepted FOC:
//
//   awaiting receipt — the supplier promised a replacement and it has not come
//   awaiting trial   — it came, and has been sitting unproven ever since
//
// Both are rendered whether or not anything is late, because a count of zero is
// itself the answer to "what is pending". Clicking a row opens that QD.
export default function FocPendingPanel({ foc, theme = {}, onOpen }) {
  if (!foc) return null;
  const { awaitingReceipt = [], awaitingTrial = [], overdueCount = 0 } = foc;

  const bg = theme.cardBg || '#09090b';
  const border = theme.cardBorder || '#27272a';
  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';
  const surfaceHover = theme.surfaceHover || 'rgba(255,255,255,0.03)';
  const mono = "'JetBrains Mono', ui-monospace, monospace";

  const panel = { background: bg, border: `1px solid ${border}`, borderRadius: 12, boxShadow: theme.shadowSm };
  const sectionLabel = { fontSize: '0.75rem', fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' };
  const headCell = { fontSize: 10.5, fontWeight: 700, color: dim, textTransform: 'uppercase', letterSpacing: '0.05em' };

  const s = { panel, sectionLabel, headCell, mono, text, dim, border };

  const pill = (label, colour) => (
    <span style={{ padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${colour}22`, color: colour, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );

  const identity = (r) => ([
    <span key="qd" style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 600, color: text }}>{r.qd_no || '—'}</span>,
    <span key="die" style={{ fontSize: 12.5, color: muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.die_no}</span>,
    <span key="sup" style={{ fontSize: 12.5, color: muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {r.supplier}
      {r.round_count > 1 && <span style={{ color: dim, fontSize: 11 }}> · attempt {r.round_no}</span>}
    </span>,
  ]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(430px, 1fr))', gap: 16, marginBottom: 20 }}>
      <style>{`.qd-foc-row:hover { background: ${surfaceHover}; }`}</style>

      <FocBucket
        s={s} onOpen={onOpen}
        title={overdueCount ? `Awaiting receipt · ${overdueCount} overdue` : 'Awaiting receipt'}
        icon={<Truck size={15} style={{ color: overdueCount ? '#F87171' : '#60A5FA' }} />}
        rows={awaitingReceipt}
        headers={['QD No', 'Die No', 'Supplier', 'Promised ETA', 'Overdue', 'Plant']}
        emptyText="No FOC replacement is outstanding."
        render={(r) => ([
          ...identity(r),
          <span key="eta" style={{ fontFamily: mono, fontSize: 12.5, color: r.promised_eta ? muted : dim }}>
            {r.promised_eta || 'no ETA'}
          </span>,
          <span key="over" style={{ textAlign: 'right' }}>
            {r.days_overdue == null
              ? <span style={{ fontSize: 12, color: dim }}>—</span>
              : r.days_overdue > 0
                ? pill(`${r.days_overdue}d late`, '#F87171')
                : <span style={{ fontSize: 12, color: dim }}>in {Math.abs(r.days_overdue)}d</span>}
          </span>,
          <span key="plant" style={{ fontSize: 11.5, color: dim, textAlign: 'right' }}>{r.plant}</span>,
        ])}
      />

      <FocBucket
        s={s} onOpen={onOpen}
        title="In plant, awaiting trial"
        icon={<FlaskConical size={15} style={{ color: '#F0ABFC' }} />}
        rows={awaitingTrial}
        headers={['QD No', 'Die No', 'Supplier', 'Received', 'Idle', 'Plant']}
        emptyText="Every received replacement has been trialled."
        render={(r) => ([
          ...identity(r),
          <span key="rec" style={{ fontFamily: mono, fontSize: 12.5, color: muted }}>{r.received_date || '—'}</span>,
          <span key="idle" style={{ textAlign: 'right' }}>
            {r.days_idle == null
              ? <span style={{ fontSize: 12, color: dim }}>—</span>
              : pill(`${r.days_idle}d`, r.days_idle > 7 ? '#FBBF24' : '#F0ABFC')}
          </span>,
          <span key="plant" style={{ fontSize: 11.5, color: dim, textAlign: 'right' }}>{r.plant}</span>,
        ])}
      />
    </div>
  );
}
