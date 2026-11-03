import React from 'react';
import { journeyStops } from '../../utils/qdJourney';

const LATE = '#F87171';
const DONE = '#34D399';

// The journey strip: every hand-off a QD goes through, in a row, so "where is
// this stuck" is read before anything else. Read-only — dates are edited in
// the tabs below it.
export default function QdJourneyStrip({ qd, theme = {} }) {
  const border = theme.cardBorder || '#27272a';
  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';
  const accent = theme.accent || '#3B82F6';
  const stops = journeyStops(qd);

  const colourOf = (s) => {
    if (s.late) return LATE;
    if (s.state === 'done') return DONE;
    if (s.state === 'current') return accent;
    return dim;
  };

  return (
    <div role="list" aria-label="QD journey"
      style={{ display: 'flex', flexWrap: 'wrap', rowGap: 14, margin: '0 0 20px', padding: '14px 0 12px', borderTop: `1px solid ${border}`, borderBottom: `1px solid ${border}` }}>
      {stops.map((s, i) => {
        const colour = colourOf(s);
        const cancelled = s.state === 'cancelled';
        const last = i === stops.length - 1;
        return (
          <div key={s.key} role="listitem" data-state={s.state} data-late={s.late ? 'true' : 'false'}
            aria-current={s.state === 'current' ? 'step' : undefined}
            style={{ flex: '1 1 96px', minWidth: 96, position: 'relative', paddingRight: 8 }}>
            {/* connector to the next stop */}
            {!last && (
              <span aria-hidden="true" style={{ position: 'absolute', top: 5, left: 14, right: -4, height: 2, background: s.state === 'done' ? DONE : border, opacity: cancelled ? 0.4 : 1 }} />
            )}
            <span aria-hidden="true" style={{
              position: 'relative', zIndex: 1, display: 'block', width: 12, height: 12, borderRadius: '50%', boxSizing: 'border-box',
              background: s.state === 'current' ? '#fff' : s.state === 'todo' || cancelled ? 'transparent' : colour,
              border: `2px solid ${colour}`,
              boxShadow: s.state === 'current' ? `0 0 0 3px ${colour}44` : 'none',
            }} />
            <div style={{
              marginTop: 8, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
              color: s.state === 'current' || s.late ? colour : s.state === 'done' ? muted : dim,
              textDecoration: cancelled && s.key === 'cancelled' ? 'line-through' : 'none',
            }}>{s.label}</div>
            <div style={{ marginTop: 3, fontSize: 12, lineHeight: 1.4, color: s.late ? LATE : s.state === 'todo' || cancelled ? dim : text, fontWeight: s.late ? 600 : 400 }}>
              {s.date || (s.note ? '' : '—')}
              {s.date && s.note ? <br /> : null}
              {s.note}
            </div>
          </div>
        );
      })}
    </div>
  );
}
