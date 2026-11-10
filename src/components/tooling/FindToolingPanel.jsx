import React, { useEffect, useRef, useState } from 'react';
import { X, AlertTriangle, Search, Check, ChevronDown, ChevronUp, CircleCheck, CircleX, Maximize2, Minimize2 } from 'lucide-react';
import { toolingsAPI, profileShapesAPI } from '../../api';
import OpeningOverlay from './OpeningOverlay';
import ProfileOutline from './ProfileOutline';
import {
  candidateTags, linkedDiesText, similarCards, similarOnlyCards, rejectedSummary, similarFromItems,
  sizeClassText, openingText, profileSizeText, chartCheck, chartSummary,
} from '../../utils/toolingFinderView';

// The Find tooling panel both order forms embed. `query` is the finder request
// without minClearance ({ plant, press, dieSize, cavities, profile | dieNo });
// `c` is a palette like FrozenDesignsPage's usePalette (bg, inset, border, text,
// muted, dim, primary, ok/okBg, warn/warnBg, danger/dangerBg). Optional
// `dieMeta(dieNo) → string | null` supplies a similar die's "press · die size · cav"
// line from the caller's die list; the panel fetches nothing for it. Optional
// `onResult(data)` hears each finder answer as it lands (the new die order form keeps
// the candidates for its record). Optional `chosenNumber` marks the candidate the
// form currently holds as "In use".
//
// mode 'similarity' (an unscaled profile: no defensible size, so no fit): `query` is
// { plant, outer, holes, cavities } in any frame, the panel asks POST /profile-shapes/similar
// and shows only the similar strip, its toolings as information (no Use this: no fit was
// checked). onResult is not called in this mode, so the form record gets no candidates.

const NO_PROFILE_404 = 'no true-size profile stored for this die — similarity and fit unavailable';
const SIMILARITY_BANNER = 'Profile size unknown — fit not run; similar dies by shape only';
const SIMILAR_LIMIT = 20;
const FIRST_SHOWN = 4; // candidates before "Show all"

function toneColors(tone, c) {
  if (tone === 'ok') return { color: c.ok, background: c.okBg, border: 'transparent' };
  if (tone === 'warn') return { color: c.warn, background: c.warnBg, border: 'transparent' };
  if (tone === 'no') return { color: c.danger, background: c.dangerBg, border: 'transparent' };
  return { color: c.muted, background: c.inset, border: c.border };
}

function Tag({ text, tone, c }) {
  const t = toneColors(tone, c);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, lineHeight: 1.4, color: t.color, background: t.background, border: `1px solid ${t.border}` }}>
      {text}
    </span>
  );
}

function Note({ tone = 'warn', icon = true, children, c }) {
  const t = toneColors(tone, c);
  return (
    <div role={tone === 'no' ? 'alert' : 'note'} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, lineHeight: 1.45, padding: '8px 10px', borderRadius: 8, color: t.color, background: t.background }}>
      {icon && <AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />}
      <span>{children}</span>
    </div>
  );
}

// Room for two columns side by side (the wide window); below it they stack.
const TWO_COLUMN_QUERY = '(min-width: 1000px)';
function useTwoColumns() {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(TWO_COLUMN_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(TWO_COLUMN_QUERY);
    if (!mq) return undefined;
    const update = () => setOn(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return on;
}

const linkButton = (c) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 2px', background: 'transparent', border: 'none',
  color: c.link || c.primary, fontSize: 12, fontWeight: 600, cursor: 'pointer',
});

const KIND_WORD = { insert: 'Insert', bolster: 'Bolster' };

// One fact of a suggestion: a quiet label over the value.
function Spec({ label, value, c, wide = false }) {
  return (
    <div style={{ minWidth: 0, gridColumn: wide ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: c.dim }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: value ? c.text : c.dim, overflowWrap: 'anywhere' }}>{value || 'not known'}</div>
    </div>
  );
}

function ChartLine({ check, c }) {
  if (!check) return null;
  const t = toneColors(check.tone, c);
  const Icon = check.tone === 'ok' ? CircleCheck : check.tone === 'no' ? CircleX : AlertTriangle;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 9px', borderRadius: 8, background: t.background, color: t.color, fontSize: 12, lineHeight: 1.4 }}>
      <Icon size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
      <div>
        <div style={{ fontWeight: 600 }}>Combination chart: {check.text}</div>
        {check.detail && <div style={{ color: c.muted }}>{check.detail}</div>}
      </div>
    </div>
  );
}

function CandidateCard({ candidate, best, inUse, profilePoints, tagCtx, onUse, c }) {
  const [big, setBig] = useState(false);
  const tags = candidateTags(candidate, { ...tagCtx, skipChart: true });
  const accent = inUse ? c.primary : best ? c.ok : c.border;
  const kind = KIND_WORD[candidate.kind] || 'Tooling';
  const cav = candidate.cavities == null ? null : `${candidate.cavities}`;
  const picture = (
    <button
      type="button"
      onClick={() => setBig((v) => !v)}
      aria-expanded={big}
      aria-label={big ? `Shrink the picture of ${candidate.number}` : `Enlarge the picture of ${candidate.number}`}
      title={big ? 'Shrink' : 'Enlarge'}
      style={{ position: 'relative', padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', flexShrink: 0, display: 'block', width: big ? '100%' : 164 }}
    >
      <OpeningOverlay
        pockets={candidate.pockets}
        outer={candidate.outer || null}
        profilePoints={profilePoints}
        placements={candidate.placements}
        size={big ? { w: '100%', h: 280 } : { w: 164, h: 124 }}
        c={c}
      />
      <span aria-hidden="true" style={{ position: 'absolute', right: 5, bottom: 5, display: 'flex', padding: 3, borderRadius: 5, background: c.bg, border: `1px solid ${c.border}`, color: c.muted }}>
        {big ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
      </span>
    </button>
  );
  const heading = (
    <div style={{ flex: 1, minWidth: 0 }}>
      {best && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: c.ok, marginBottom: 2 }}>Best fit</div>}
      <div style={{ fontWeight: 700, fontSize: 15, color: c.text, overflowWrap: 'anywhere' }}>{candidate.number}</div>
      <div style={{ fontSize: 12, color: c.muted, marginTop: 1 }}>{kind}</div>
    </div>
  );
  const useButton = (
    <button
      type="button"
      onClick={() => onUse(candidate)}
      aria-pressed={inUse}
      style={{
        flexShrink: 0, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
        background: inUse ? c.primarySoft : best ? c.primary : 'transparent',
        color: inUse ? c.primary : best ? c.primaryText : c.primary,
        border: `1px solid ${c.primary}`,
      }}
    >
      {inUse ? <><Check size={13} aria-hidden="true" /> In use</> : 'Use this'}
    </button>
  );
  const specs = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px 12px' }}>
      <Spec label={`${kind} size`} value={sizeClassText(candidate.sizeClass)} c={c} />
      <Spec label="Cavities" value={cav} c={c} />
      <Spec label="Opening" value={openingText(candidate.pockets)} c={c} wide />
    </div>
  );
  return (
    <div
      aria-label={best ? `Best fit ${candidate.number}` : `Candidate ${candidate.number}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: 10, borderRadius: 10, background: c.bg, border: `1px solid ${accent}`, boxShadow: (best || inUse) ? `inset 3px 0 0 ${accent}` : 'none' }}
    >
      {big ? (
        <>
          <div style={{ display: 'flex', gap: 12 }}>{heading}{useButton}</div>
          {picture}
          <div style={{ fontSize: 11, color: c.dim }}>
            {candidate.outer ? 'Outline of the tooling, its opening, and the profile placed in it (blue).' : 'The opening, and the profile placed in it (blue). The tooling outline is not stored.'}
          </div>
          {specs}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12 }}>{heading}{useButton}</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {picture}
            <div style={{ flex: 1, minWidth: 0 }}>{specs}</div>
          </div>
        </>
      )}
      <ChartLine check={chartCheck(candidate, tagCtx)} c={c} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {tags.map((t, i) => <Tag key={i} text={t.text} tone={t.tone} c={c} />)}
      </div>
      <div style={{ fontSize: 11, color: c.dim }}>{linkedDiesText(candidate)}</div>
    </div>
  );
}

function SimilarOnlyCard({ item, c }) {
  const kind = item.kind === 'bolster' ? 'Bolster' : item.kind === 'insert' ? 'Insert' : 'Tooling';
  return (
    <div style={{ padding: '8px 10px', borderRadius: 8, border: `1px dashed ${c.border}`, background: c.bg }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: c.muted }}>{item.number}</span>
        <span style={{ fontSize: 12, color: c.dim }}>{kind} · {item.sizeClass || 'size unknown'} · used by similar die {item.dieNo}</span>
      </div>
      <div style={{ fontSize: 11, color: c.dim, marginTop: 4 }}>{item.reasonText}</div>
    </div>
  );
}

function SimilarStrip({ similar, dieMeta, c, infoOnly = false, bare = false, limit = 8 }) {
  const cards = similarCards(similar, limit, dieMeta);
  if (cards.length === 0) return null;
  const fact = (label, value, missing) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11 }}>
      <span style={{ color: c.dim }}>{label}</span>
      <span style={{ fontWeight: 600, color: value ? c.text : c.dim, textAlign: 'right', overflowWrap: 'anywhere' }}>{value || missing}</span>
    </div>
  );
  return (
    <div style={bare ? undefined : { paddingTop: 10, borderTop: `1px solid ${c.border}` }}>
      <div style={{ fontSize: bare ? 13 : 12, fontWeight: 700, color: c.text }}>Similar existing profiles</div>
      <div style={{ fontSize: 11, color: c.muted, margin: '2px 0 8px' }}>
        {infoOnly ? 'Toolings for information only — no fit was checked.' : 'Nearest dies by shape, with the tooling each one runs in.'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
        {cards.map((card) => (
          <div key={card.dieNo} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: 8, border: `1px solid ${c.border}`, background: c.bg }}>
            <ProfileOutline outline={card.outline} height={84} label={`Profile of die ${card.dieNo}`} c={c} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: c.text, overflowWrap: 'anywhere' }}>{card.dieNo}</div>
              {card.otherDies.length > 0 && (
                <div style={{ fontSize: 11, color: c.muted, overflowWrap: 'anywhere' }} title={card.otherDies.join(', ')}>
                  same for {card.otherDies.slice(0, 3).join(', ')}{card.otherDies.length > 3 ? ` and ${card.otherDies.length - 3} more` : ''}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {fact('CCD', card.ccd != null ? `${Math.round(card.ccd)} mm` : null, 'not known')}
              {fact('Die size', card.dieSize, 'not in die list')}
              {fact('Press', card.press, 'not in die list')}
              {fact('Cavities', card.cavity != null ? String(card.cavity) : null, 'not known')}
            </div>
            {card.cavityMatch === false && <div style={{ fontSize: 11, color: c.warn }}>cavities differ from this order</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 6, borderTop: `1px solid ${c.border}` }}>
              {card.toolings.length === 0 && <span style={{ fontSize: 11, color: c.dim }}>no tooling recorded</span>}
              {card.toolings.map((t) => (
                <div key={t.number} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: c.text }}>{t.number}</span>
                  {t.sizeClass && <span style={{ fontSize: 11, color: c.muted }}>{t.sizeClass}</span>}
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

// "PRESS 6 · die 450X250 · 2 cavities · CCD 182 mm": what the answer was asked for.
function queryLine(q) {
  const parts = [
    q.press,
    q.dieSize ? `die ${q.dieSize}` : null,
    q.cavities != null && q.cavities !== '' ? `${q.cavities} ${Number(q.cavities) === 1 ? 'cavity' : 'cavities'}` : null,
  ];
  if (q.profile && typeof q.profile.ccd === 'number') parts.push(`CCD ${Math.round(q.profile.ccd)} mm`);
  const size = q.profile ? profileSizeText(q.profile.points) : null;
  if (size) parts.push(`profile ${size}`);
  return parts.filter(Boolean).join(' · ');
}

function Skeleton({ c }) {
  return (
    <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[0.7, 0.5, 0.35].map((opacity) => (
        <div key={opacity} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 10, borderRadius: 10, border: `1px solid ${c.border}`, background: c.bg, opacity }}>
          <div style={{ width: 104, height: 72, borderRadius: 4, background: c.inset }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ width: '45%', height: 12, borderRadius: 4, background: c.inset }} />
            <div style={{ width: '70%', height: 10, borderRadius: 4, background: c.inset }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function FindToolingPanel({
  query, onUse, onClose, c, minClearance = 5, onMinClearanceChange, dieMeta = null, onResult = null, mode = 'fit',
  chosenNumber = null, wide = false, note = null,
}) {
  const similarityOnly = mode === 'similarity';
  const twoColumns = useTwoColumns();
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  // Read through a ref so an inline callback does not refetch on every parent render.
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; });
  // The parent rebuilds `query` on every render; the effect keys on its content.
  const queryKey = JSON.stringify(query ?? {});

  useEffect(() => {
    let active = true; // a newer request makes this one's answer stale
    setState({ status: 'loading', data: null, error: '' });
    const q = JSON.parse(queryKey);
    const request = similarityOnly
      ? profileShapesAPI.similarTo({ plant: q.plant, outer: q.outer, holes: q.holes || [], cavities: q.cavities, limit: SIMILAR_LIMIT })
        .then((r) => ({ similar: similarFromItems(r?.items) }))
      : toolingsAPI.find({ ...q, minClearance });
    request
      .then((data) => {
        if (!active) return;
        setState({ status: 'done', data, error: '' });
        if (!similarityOnly && onResultRef.current) onResultRef.current(data);
      })
      .catch((e) => {
        if (!active) return;
        const error = !similarityOnly && e?.status === 404 ? NO_PROFILE_404 : (e?.message || 'Finder failed');
        setState({ status: 'error', data: null, error });
      });
    return () => { active = false; };
  }, [queryKey, minClearance, similarityOnly]);

  const { status, data, error } = state;
  const tight = minClearance < 5;
  const count = status === 'done' && !similarityOnly ? (data.candidates || []).length : null;
  const title = similarityOnly ? 'Similar dies by shape'
    : count == null ? 'Find tooling'
      : count === 0 ? 'No tooling fits' : `${count} tooling${count === 1 ? '' : 's'} fit`;
  const subtitle = similarityOnly ? '' : queryLine((status === 'done' && data.query) || query || {});

  return (
    <section
      aria-label="Find tooling"
      style={wide
        ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10, padding: 16, background: c.inset, color: c.text }
        : { display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 12, border: `1px solid ${c.border}`, background: c.inset, color: c.text }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Search size={15} aria-hidden="true" style={{ color: c.muted, marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: wide ? 16 : 14, fontWeight: 700 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: c.muted, marginTop: 1 }}>{subtitle}</div>}
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close Find tooling" style={{ background: 'transparent', border: 'none', color: c.muted, cursor: 'pointer', padding: 4, display: 'flex', borderRadius: 6 }}>
            <X size={16} />
          </button>
        )}
      </div>

      {!similarityOnly && onMinClearanceChange && (
        <div role="group" aria-label="Minimum clearance" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: c.muted }}>Minimum clearance</span>
          <div style={{ display: 'inline-flex', padding: 2, borderRadius: 8, background: c.bg, border: `1px solid ${c.border}` }}>
            {[[5, '5 mm'], [3, '3 mm']].map(([mm, label]) => {
              const on = tight ? mm === 3 : mm === 5;
              return (
                <button
                  key={mm}
                  type="button"
                  aria-pressed={on}
                  onClick={() => { if (!on) onMinClearanceChange(mm); }}
                  title={mm === 3 ? 'Show tighter fits (3 mm)' : 'Standard clearance (5 mm)'}
                  style={{ padding: '3px 10px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: on ? 'default' : 'pointer', background: on ? c.primarySoft : 'transparent', color: on ? c.primary : c.muted }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {note && <div style={{ fontSize: 12, color: c.muted }}>{note}</div>}

      {similarityOnly && <Note c={c}>{SIMILARITY_BANNER}</Note>}

      {status === 'loading' && (
        <>
          <div role="status" style={{ fontSize: 12, color: c.muted }}>{similarityOnly ? 'Finding similar dies…' : 'Finding toolings…'}</div>
          <Skeleton c={c} />
        </>
      )}

      {status === 'error' && <Note tone="no" c={c}>{error}</Note>}

      {status === 'done' && similarityOnly && (
        <div style={wide ? { flex: 1, minHeight: 0, overflowY: 'auto' } : undefined}>
          {(data.similar || []).length
            ? <SimilarStrip similar={data.similar} dieMeta={dieMeta} c={c} infoOnly bare={wide} limit={wide ? 20 : 8} />
            : <div style={{ fontSize: 12, color: c.muted }}>No similar dies found.</div>}
        </div>
      )}

      {status === 'done' && !similarityOnly && (
        <FinderResult data={data} onUse={onUse} c={c} tight={tight} onMinClearanceChange={onMinClearanceChange} dieMeta={dieMeta} chosenNumber={chosenNumber}
          wide={wide} twoColumns={twoColumns} />
      )}
    </section>
  );
}

function FinderResult({ data, onUse, c, tight, onMinClearanceChange, dieMeta, chosenNumber, wide = false, twoColumns = false }) {
  const [showAll, setShowAll] = useState(false);
  const [showGreyed, setShowGreyed] = useState(false);
  const q = data.query || {};
  const chartBasis = data.chart?.basis;
  const tagCtx = { press: q.press, dieSize: q.dieSize, chartBasis };
  const chart = chartSummary(data.chart, q);
  const candidates = data.candidates || [];
  const greyed = similarOnlyCards(data.similar, candidates);
  const summary = rejectedSummary(data.rejected, data.truncated);
  const profilePoints = q.profile?.points || null;
  // The one in use is never hidden behind "Show all".
  const chosenIndex = candidates.findIndex((cand) => cand.number === chosenNumber);
  // The wide window has a column of its own for the fits, so it lists them all.
  const expanded = wide || showAll || chosenIndex >= FIRST_SHOWN;
  const shown = expanded ? candidates : candidates.slice(0, FIRST_SHOWN);
  const canToggle = !wide && candidates.length > FIRST_SHOWN && chosenIndex < FIRST_SHOWN;

  const fits = (
    <>
      {chart && (
        <Note tone={chart.tone === 'ok' ? 'muted' : chart.tone} icon={chart.tone !== 'ok'} c={c}>{chart.text}</Note>
      )}

      {tight && (
        <Note c={c} icon={false}>
          Showing fits down to {q.minClearance ?? 3} mm — every card under 5 mm is marked; check those with the die maker.
        </Note>
      )}

      {candidates.length === 0 && (
        <div style={{ padding: '14px 12px', borderRadius: 10, border: `1px dashed ${c.border}`, background: c.bg, fontSize: 12, color: c.muted }}>
          <div style={{ fontWeight: 600, color: c.text, marginBottom: 2 }}>No tooling fits this profile.</div>
          {tight ? 'Nothing clears it even at 3 mm.' : 'Nothing clears it by 5 mm.'}
          {!tight && onMinClearanceChange && (
            <div><button type="button" onClick={() => onMinClearanceChange(3)} style={linkButton(c)}>Show tighter fits (3 mm)</button></div>
          )}
        </div>
      )}

      {candidates.length > 0 && (
        <div style={wide
          ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 10, alignItems: 'start' }
          : { display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map((cand, i) => (
            <CandidateCard
              key={cand.number}
              candidate={cand}
              best={i === 0}
              inUse={chosenNumber != null && cand.number === chosenNumber}
              profilePoints={profilePoints}
              tagCtx={tagCtx}
              onUse={onUse}
              c={c}
            />
          ))}
          {canToggle && (
            <button type="button" aria-expanded={expanded} onClick={() => setShowAll((v) => !v)} style={{ ...linkButton(c), alignSelf: 'flex-start' }}>
              {expanded
                ? <><ChevronUp size={14} aria-hidden="true" /> Show the first {FIRST_SHOWN}</>
                : <><ChevronDown size={14} aria-hidden="true" /> Show all {candidates.length} fits</>}
            </button>
          )}
        </div>
      )}

      {summary && <div style={{ fontSize: 12, color: c.muted }}>{summary}</div>}

      {greyed.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button type="button" aria-expanded={showGreyed} onClick={() => setShowGreyed((v) => !v)} style={{ ...linkButton(c), alignSelf: 'flex-start', color: c.muted }}>
            {showGreyed ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            {greyed.length} tooling{greyed.length === 1 ? '' : 's'} of similar dies not suggested
          </button>
          {showGreyed && greyed.map((item) => <SimilarOnlyCard key={item.number} item={item} c={c} />)}
        </div>
      )}
    </>
  );
  const timings = data.timings && typeof data.timings.totalMs === 'number'
    ? <div style={{ fontSize: 10, color: c.dim, textAlign: 'right' }}>{data.timings.totalMs} ms</div>
    : null;

  if (!wide) {
    return (
      <>
        {fits}
        <SimilarStrip similar={data.similar} dieMeta={dieMeta} c={c} />
        {timings}
      </>
    );
  }

  // The window: fits on the left, similar profiles on the right, each scrolling on its own.
  // Too narrow for two columns, they stack and scroll as one.
  const hasSimilar = (data.similar || []).length > 0;
  const columnStyle = { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, minHeight: 0, overflowY: twoColumns ? 'auto' : 'visible', paddingRight: twoColumns ? 6 : 0 };
  return (
    <div style={twoColumns
      ? { flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: hasSimilar ? 'minmax(0, 1.25fr) minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: 16 }
      : { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div aria-label="Matching toolings" role="region" tabIndex={twoColumns ? 0 : undefined} style={columnStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, color: c.text }}>Matching toolings</div>
        {fits}
        {timings}
      </div>
      {hasSimilar && (
        <div aria-label="Similar existing profiles" role="region" tabIndex={twoColumns ? 0 : undefined}
          style={{ ...columnStyle, paddingLeft: twoColumns ? 16 : 0, borderLeft: twoColumns ? `1px solid ${c.border}` : 'none' }}>
          <SimilarStrip similar={data.similar} dieMeta={dieMeta} c={c} bare limit={20} />
        </div>
      )}
    </div>
  );
}
