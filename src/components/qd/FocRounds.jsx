import React from 'react';
import { Truck, PackageCheck, Check, XCircle, FlaskConical } from 'lucide-react';

const day = (v) => (v ? String(v).slice(0, 10) : null);

// One line per attempt at a free-of-charge replacement, so a QD on its third
// die reads as a history rather than a single overwritten date. Renders nothing
// when no FOC was ever accepted — most QDs never get here.
export default function FocRounds({ qd, theme = {}, onRecordTrial, busy }) {
  const foc = qd.foc;
  if (!foc || !foc.roundCount) return null;

  const border = theme.cardBorder || '#27272a';
  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';
  const bg = theme.cardBg || '#09090b';

  const sectionLabel = { fontSize: 11, fontWeight: 700, color: dim, textTransform: 'uppercase', letterSpacing: '0.06em' };

  // What is outstanding right now, stated plainly — this is the line the person
  // opening the QD is actually looking for.
  const banner = {
    'awaiting-receipt': foc.daysOverdue > 0
      ? { icon: Truck, colour: '#F87171', text: `Awaiting receipt — ${foc.daysOverdue} day(s) past the promised ${foc.promisedEta}` }
      : { icon: Truck, colour: '#60A5FA', text: foc.promisedEta ? `Awaiting receipt — due ${foc.promisedEta}` : 'Awaiting receipt — no ETA on record' },
    'awaiting-trial': { icon: FlaskConical, colour: '#F0ABFC', text: `In plant since ${foc.receivedDate} — awaiting trial (${foc.daysIdle} day(s))` },
    'trial-passed': { icon: Check, colour: '#34D399', text: 'Replacement passed its trial — ready to close' },
    'trial-failed': { icon: XCircle, colour: '#F87171', text: 'Last replacement failed its trial' },
  }[foc.state];

  const canTrial = foc.state === 'awaiting-trial';

  const cell = (value, colour) => (
    <span style={{ color: value ? (colour || muted) : dim, fontSize: 12.5 }}>{value || '—'}</span>
  );

  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 8, padding: 16, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={sectionLabel}>
          FOC replacement · {foc.roundCount} {foc.roundCount === 1 ? 'attempt' : 'attempts'}
        </div>
        {canTrial && (
          <button type="button" onClick={onRecordTrial} disabled={busy}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, fontWeight: 500, fontSize: 12.5, cursor: busy ? 'wait' : 'pointer' }}>
            <FlaskConical size={14} /> Record trial
          </button>
        )}
      </div>

      {banner && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 8, background: `${banner.colour}18`, color: banner.colour, fontSize: 12.5, fontWeight: 600, marginBottom: 14 }}>
          <banner.icon size={15} /> {banner.text}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr 1fr 1fr', gap: 8, alignItems: 'center', paddingBottom: 8, borderBottom: `1px solid ${border}` }}>
        {['Round', 'Promised', 'Received', 'Trial'].map((h, i) => (
          <span key={h} style={{ ...sectionLabel, fontSize: 10.5, textAlign: i === 0 ? 'left' : 'left' }}>{h}</span>
        ))}
      </div>

      {foc.rounds.map((r) => {
        const passed = r.trial_result === 'Pass';
        const failed = r.trial_result === 'Fail';
        return (
          <div key={r.round_no}
            style={{ display: 'grid', gridTemplateColumns: '56px 1fr 1fr 1fr', gap: 8, alignItems: 'baseline', padding: '10px 0', borderBottom: `1px solid ${border}` }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: text }}>#{r.round_no}</span>
            {cell(day(r.promised_eta))}
            {cell(day(r.received_date), r.received_date ? '#F0ABFC' : undefined)}
            <span style={{ fontSize: 12.5, color: passed ? '#34D399' : failed ? '#F87171' : dim, fontWeight: r.trial_result ? 700 : 400 }}>
              {r.trial_result
                ? <>{r.trial_result}{day(r.trial_date) ? ` · ${day(r.trial_date)}` : ''}</>
                : (r.received_date ? 'not yet trialled' : '—')}
            </span>
            {r.trial_notes && (
              <span style={{ gridColumn: '2 / -1', fontSize: 12, color: dim, lineHeight: 1.5, marginTop: -4 }}>
                <PackageCheck size={12} style={{ verticalAlign: -2, marginRight: 5 }} />{r.trial_notes}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
