import React, { useEffect, useState } from 'react';
import { X, AlertTriangle, Search } from 'lucide-react';
import { toolingsAPI } from '../../api';
import OpeningOverlay from './OpeningOverlay';
import {
  candidateTags, candidateMeta, linkedDiesText, similarCards, similarOnlyCards, rejectedSummary,
} from '../../utils/toolingFinderView';

// The Find tooling panel both order forms embed. `query` is the finder request
// without minClearance ({ plant, press, dieSize, cavities, profile | dieNo });
// `c` is a palette like FrozenDesignsPage's usePalette (bg, inset, border, text,
// muted, dim, primary, ok/okBg, warn/warnBg, danger/dangerBg).

const NO_PROFILE_404 = 'no true-size profile stored for this die — similarity and fit unavailable';

function toneColors(tone, c) {
  if (tone === 'ok') return { color: c.ok, background: c.okBg, border: 'transparent' };
  if (tone === 'warn') return { color: c.warn, background: c.warnBg, border: 'transparent' };
  if (tone === 'no') return { color: c.danger, background: c.dangerBg, border: 'transparent' };
  return { color: c.muted, background: c.inset, border: c.border };
}

function Tag({ text, tone, c }) {
  const t = toneColors(tone, c);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', color: t.color, background: t.background, border: `1px solid ${t.border}` }}>
      {text}
    </span>
  );
}

function CandidateCard({ candidate, best, profilePoints, tagCtx, onUse, c }) {
  const tags = candidateTags(candidate, tagCtx);
  return (
    <div
      aria-label={best ? `Best fit ${candidate.number}` : `Candidate ${candidate.number}`}
      style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 10, borderRadius: 8, background: c.bg, border: best ? `2px solid ${c.ok}` : `1px solid ${c.border}` }}
    >
      <OpeningOverlay pockets={candidate.pockets} profilePoints={profilePoints} placements={candidate.placements} c={c} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: c.text }}>{candidate.number}</span>
          <span style={{ fontSize: 12, color: c.muted }}>{candidateMeta(candidate)}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {tags.map((t, i) => <Tag key={i} text={t.text} tone={t.tone} c={c} />)}
        </div>
        <div style={{ fontSize: 11, color: c.dim, marginTop: 6 }}>{linkedDiesText(candidate)}</div>
      </div>
      <button
        type="button"
        onClick={() => onUse(candidate)}
        style={{ flexShrink: 0, padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'transparent', color: c.primary, border: `1px solid ${c.primary}` }}
      >
        Use this
      </button>
    </div>
  );
}

function SimilarOnlyCard({ item, c }) {
  const kind = item.kind === 'bolster' ? 'Bolster' : item.kind === 'insert' ? 'Insert' : 'Tooling';
  return (
    <div style={{ padding: '8px 10px', borderRadius: 8, border: `1px dashed ${c.border}`, background: c.inset, opacity: 0.7 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: c.muted }}>{item.number}</span>
        <span style={{ fontSize: 12, color: c.dim }}>{kind} · {item.sizeClass || 'size unknown'} · used by similar die {item.dieNo}</span>
      </div>
      <div style={{ fontSize: 11, color: c.dim, marginTop: 4 }}>{item.reasonText}</div>
    </div>
  );
}

function SimilarStrip({ similar, c }) {
  const cards = similarCards(similar);
  if (cards.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: c.text, marginBottom: 6 }}>Similar existing profiles</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
        {cards.map((card) => (
          <div key={card.dieNo} style={{ padding: 8, borderRadius: 6, border: `1px solid ${c.border}`, background: c.bg }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: c.text }}>{card.dieNo}</div>
            {card.meta && <div style={{ fontSize: 11, color: c.muted }}>{card.meta}</div>}
            {card.cavityMatch === false && <div style={{ fontSize: 11, color: c.warn }}>cavities differ</div>}
            {card.cavityMatch === null && <div style={{ fontSize: 11, color: c.dim }}>cavities unknown</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
              {card.toolings.length === 0 && <span style={{ fontSize: 11, color: c.dim }}>no tooling recorded</span>}
              {card.toolings.map((t) => (
                <div key={t.number} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: c.text }}>{t.number}</span>
                  <Tag text={t.tag} tone={t.tone} c={c} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function headerLine(q) {
  const parts = ['Candidates', q.press, `die ${q.dieSize}`, `${q.cavities} ${Number(q.cavities) === 1 ? 'cavity' : 'cavities'}`];
  if (q.profile && typeof q.profile.ccd === 'number') parts.push(`CCD ${Math.round(q.profile.ccd)} mm`);
  return parts.join(' · ');
}

export default function FindToolingPanel({ query, onUse, onClose, c, minClearance = 5, onMinClearanceChange }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  // The parent rebuilds `query` on every render; the effect keys on its content.
  const queryKey = JSON.stringify(query ?? {});

  useEffect(() => {
    let active = true; // a newer request makes this one's answer stale
    setState({ status: 'loading', data: null, error: '' });
    toolingsAPI.find({ ...JSON.parse(queryKey), minClearance })
      .then((data) => { if (active) setState({ status: 'done', data, error: '' }); })
      .catch((e) => {
        if (!active) return;
        const error = e?.status === 404 ? NO_PROFILE_404 : (e?.message || 'Finder failed');
        setState({ status: 'error', data: null, error });
      });
    return () => { active = false; };
  }, [queryKey, minClearance]);

  const { status, data, error } = state;
  const tight = minClearance < 5;

  return (
    <section aria-label="Find tooling" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 10, border: `1px solid ${c.border}`, background: c.inset, color: c.text }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Search size={15} aria-hidden="true" style={{ color: c.muted }} />
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>
          {status === 'done' ? headerLine(data.query || {}) : 'Find tooling'}
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close Find tooling" style={{ background: 'transparent', border: 'none', color: c.muted, cursor: 'pointer', padding: 2, display: 'flex' }}>
            <X size={16} />
          </button>
        )}
      </div>

      {status === 'loading' && <div role="status" style={{ fontSize: 12, color: c.muted }}>Finding toolings…</div>}

      {status === 'error' && (
        <div role="alert" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, padding: '8px 10px', borderRadius: 6, color: c.danger, background: c.dangerBg }}>
          <AlertTriangle size={14} aria-hidden="true" />{error}
        </div>
      )}

      {status === 'done' && (
        <FinderResult data={data} onUse={onUse} c={c} tight={tight} onMinClearanceChange={onMinClearanceChange} />
      )}
    </section>
  );
}

function FinderResult({ data, onUse, c, tight, onMinClearanceChange }) {
  const q = data.query || {};
  const chartBasis = data.chart?.basis;
  const tagCtx = { press: q.press, dieSize: q.dieSize, chartBasis };
  const candidates = data.candidates || [];
  const greyed = similarOnlyCards(data.similar, candidates);
  const summary = rejectedSummary(data.rejected, data.truncated);
  const profilePoints = q.profile?.points || null;

  return (
    <>
      {chartBasis === 'no_chart' && (
        <div role="note" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, padding: '8px 10px', borderRadius: 6, color: c.warn, background: c.warnBg }}>
          <AlertTriangle size={14} aria-hidden="true" />No combination chart for this press — chart gate not applied
        </div>
      )}

      {tight && (
        <div role="note" style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, color: c.warn, background: c.warnBg }}>
          Showing fits down to {q.minClearance ?? 3} mm — every card under 5 mm is marked; check those with the die maker.
        </div>
      )}

      {candidates.length === 0 && (
        <div style={{ fontSize: 12, color: c.muted }}>No tooling fits this profile.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {candidates.map((cand, i) => (
          <CandidateCard key={cand.number} candidate={cand} best={i === 0} profilePoints={profilePoints} tagCtx={tagCtx} onUse={onUse} c={c} />
        ))}
      </div>

      {greyed.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {greyed.map((item) => <SimilarOnlyCard key={item.number} item={item} c={c} />)}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {summary && <span style={{ fontSize: 12, color: c.muted, flex: 1 }}>{summary}</span>}
        {onMinClearanceChange && (
          <button
            type="button"
            onClick={() => onMinClearanceChange(tight ? 5 : 3)}
            style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'transparent', color: tight ? c.text : c.warn, border: `1px solid ${tight ? c.border : c.warn}` }}
          >
            {tight ? 'Back to 5 mm' : 'Show tighter fits (3 mm)'}
          </button>
        )}
      </div>

      <SimilarStrip similar={data.similar} c={c} />

      {data.timings && typeof data.timings.totalMs === 'number' && (
        <div style={{ fontSize: 10, color: c.dim, textAlign: 'right' }}>{data.timings.totalMs} ms</div>
      )}
    </>
  );
}
