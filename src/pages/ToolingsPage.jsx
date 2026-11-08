import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Wrench, Plus, ChevronRight, ChevronLeft, ImageOff } from 'lucide-react';
import { toolingsAPI, profileShapesAPI } from '../api';
import { dialogs } from '../components/ui/DialogProvider';
import ToolingDrawer, { Pill } from '../components/tooling/ToolingDrawer';
import AddToolingModal from '../components/tooling/AddToolingModal';
import { usePalette } from '../utils/palette';
import { confidenceTone, filtersToParams, isToolingReviewer, matchesConfidence, queueRowsFromApi, statusTone } from '../utils/toolingsView';

const mono = "'JetBrains Mono', ui-monospace, monospace";
const PAGE_SIZE = 50;
const KIND_LABEL = { insert: 'Insert', bolster: 'Bolster' };
const EMPTY_FILTERS = { plant: '', press: '', kind: '', sizeClass: '', status: 'active', confidence: '' };

// A flagged profile picture. The image route needs the Bearer header, so it is fetched as a blob.
// A profile-drawing shape's stored file is the drawing PDF, which an <img> cannot show.
const PDF_THUMB_TITLE = 'drawing PDF — open the form to view';

function ProfileThumb({ row, c }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const [notImage, setNotImage] = useState(false);
  useEffect(() => {
    if (!row.has_image) return undefined;
    let live = true;
    let made = null;
    profileShapesAPI.image(row.die_no, row.id, row.plant)
      .then((blob) => {
        if (!live) return;
        if (!/^image\//i.test(blob?.type || '')) { setNotImage(true); return; }
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [row.die_no, row.id, row.plant, row.has_image]);
  const box = { width: 72, height: 54, borderRadius: 6, border: `1px solid ${c.border}`, background: '#fff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' };
  if (url) return <img src={url} alt={`Profile picture of ${row.die_no}`} style={{ ...box, objectFit: 'contain' }} />;
  if (notImage) {
    return (
      <div style={{ ...box, background: c.inset, color: c.dim }} title={PDF_THUMB_TITLE} aria-label={PDF_THUMB_TITLE} role="img">
        <ImageOff size={16} aria-hidden="true" />
      </div>
    );
  }
  return (
    <div style={{ ...box, background: c.inset, color: c.dim, fontSize: 10.5, textAlign: 'center' }} aria-label="No picture">
      {row.has_image && !failed ? '…' : <ImageOff size={16} aria-hidden="true" />}
    </div>
  );
}

export default function ToolingsPage({ user, theme = {}, search = '' }) {
  const c = usePalette(theme);
  const reviewer = isToolingReviewer(user);
  const [tab, setTab] = useState('list');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [openNumber, setOpenNumber] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [queue, setQueue] = useState({ openings: [], profiles: [], openingsTotal: 0, profilesTotal: 0 });
  const [queuePlant, setQueuePlant] = useState('');
  const [queueKind, setQueueKind] = useState('');
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState('');
  const [notes, setNotes] = useState({});
  const [reviewing, setReviewing] = useState(null);

  const q = search.trim();
  // A filter or search change starts again from the first page.
  useEffect(() => { setOffset(0); }, [filters, q]);

  // Only the latest request may write the list (typing in the filters fires several).
  const listSeq = useRef(0);
  const loadList = useCallback(() => {
    const seq = ++listSeq.current;
    setLoading(true);
    return toolingsAPI.list(filtersToParams({ ...filters, q, limit: PAGE_SIZE, offset }))
      .then((r) => { if (seq === listSeq.current) { setList({ items: r.items || [], total: r.total || 0 }); setLoadError(''); } })
      .catch((e) => { if (seq === listSeq.current) { setList({ items: [], total: 0 }); setLoadError(e.message || 'Could not load toolings'); } })
      .finally(() => { if (seq === listSeq.current) setLoading(false); });
  }, [filters, q, offset]);
  useEffect(() => { if (tab === 'list') loadList(); }, [tab, loadList]);

  // Same guard as the list: a slower answer for an earlier plant must not overwrite a newer one.
  const queueSeq = useRef(0);
  const loadQueue = useCallback(() => {
    const seq = ++queueSeq.current;
    setQueueLoading(true);
    const params = filtersToParams({ plant: queuePlant, limit: PAGE_SIZE });
    return Promise.all([toolingsAPI.reviewQueue(params), profileShapesAPI.reviewQueue(params)])
      .then(([o, p]) => {
        if (seq !== queueSeq.current) return;
        setQueue({ openings: o.items || [], profiles: p.items || [], openingsTotal: o.total || 0, profilesTotal: p.total || 0 });
        setQueueError('');
      })
      .catch((e) => { if (seq === queueSeq.current) setQueueError(e.message || 'Could not load the review queue'); })
      .finally(() => { if (seq === queueSeq.current) setQueueLoading(false); });
  }, [queuePlant]);
  useEffect(() => { if (tab === 'queue') loadQueue(); }, [tab, loadQueue]);

  const onChanged = () => (tab === 'queue' ? loadQueue() : loadList());

  // The list route has no confidence filter: it is applied to the loaded page.
  const items = useMemo(() => list.items.filter((r) => matchesConfidence(r, filters.confidence)), [list.items, filters.confidence]);
  const queueRows = useMemo(
    () => queueRowsFromApi(queue.openings, queue.profiles).filter((r) => !queueKind || r.kind === queueKind),
    [queue, queueKind],
  );

  const reviewPicture = async (row, action) => {
    setReviewing(row.key);
    try {
      const note = (notes[row.key] || '').trim();
      await profileShapesAPI.review(row.raw.id, { action, ...(note ? { note } : {}) });
      dialogs.notify(action === 'clear' ? `Picture for ${row.title} cleared` : `Picture for ${row.title} kept flagged`, 'success');
      setNotes((n) => { const { [row.key]: _drop, ...rest } = n; return rest; });
      await loadQueue();
    } catch (e) {
      dialogs.notify(`Could not review the picture: ${e.message}`, 'error');
    } finally {
      setReviewing(null);
    }
  };

  const setFilter = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const control = { minHeight: 38, padding: '0 10px', background: c.inset, border: `1px solid ${c.border}`, borderRadius: 10, color: c.text, fontSize: '0.85rem', font: 'inherit' };
  const btn = { display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 38, padding: '0 14px', borderRadius: 10, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', border: `1px solid ${c.border}`, background: c.bg, color: c.text };
  const smallBtn = { ...btn, minHeight: 30, padding: '0 10px', fontSize: 12.5, borderRadius: 8 };
  const head = { fontSize: 11, fontWeight: 600, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.05em' };
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));

  return (
    <div className="tl-page" style={{ padding: '32px 28px', color: c.text }}>
      <style>{`
        .tl-row { transition: background-color .15s ease; }
        .tl-row:hover { background: ${c.rowHover}; }
        .tl-page button:disabled { opacity: .5; cursor: not-allowed; }
        .tl-row:focus-visible, .tl-tab:focus-visible { outline: 2px solid ${c.primary}; outline-offset: -2px; }
        .tl-grid { display: grid; grid-template-columns: minmax(140px,1.2fr) 80px 64px minmax(140px,1fr) 48px minmax(90px,.8fr) minmax(90px,.8fr) 130px 56px 90px 16px; gap: 12px; align-items: center; }
        @media (max-width: 1100px) {
          .tl-page { padding: 20px 16px !important; }
          .tl-grid { grid-template-columns: 1fr auto; row-gap: 6px; }
          .tl-head { display: none !important; }
          .tl-hide-sm { display: none !important; }
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Toolings</h1>
          <p style={{ fontSize: '0.875rem', color: c.muted, margin: '6px 0 0' }}>Inserts and bolsters, their drawings and openings, and the dies they serve</p>
        </div>
        {reviewer && (
          <button type="button" onClick={() => setShowAdd(true)} style={{ ...btn, background: c.primary, color: c.primaryText, border: 'none' }}>
            <Plus size={16} aria-hidden="true" /> Add tooling
          </button>
        )}
      </div>

      <div role="tablist" aria-label="Toolings view" style={{ display: 'inline-flex', gap: 4, padding: 4, background: c.inset, border: `1px solid ${c.border}`, borderRadius: 10, marginBottom: 14 }}>
        {[['list', 'Toolings'], ['queue', 'Review queue']].map(([id, label]) => {
          const on = tab === id;
          return (
            <button key={id} type="button" role="tab" aria-selected={on} onClick={() => setTab(id)} className="tl-tab"
              style={{ minHeight: 32, padding: '0 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: on ? 600 : 500, background: on ? c.bg : 'transparent', color: on ? c.text : c.muted }}>
              {label}
            </button>
          );
        })}
      </div>

      {tab === 'list' && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <select aria-label="Plant" value={filters.plant} onChange={setFilter('plant')} style={control}>
              <option value="">All plants</option><option value="GEX 1">GEX 1</option><option value="GEX 2">GEX 2</option>
            </select>
            <input aria-label="Press" placeholder="Press (e.g. P7)" value={filters.press} onChange={setFilter('press')} style={{ ...control, width: 130 }} />
            <select aria-label="Kind" value={filters.kind} onChange={setFilter('kind')} style={control}>
              <option value="">All kinds</option><option value="insert">Inserts</option><option value="bolster">Bolsters</option>
            </select>
            <input aria-label="Size class" placeholder="Size class (e.g. 175X80)" value={filters.sizeClass} onChange={setFilter('sizeClass')} style={{ ...control, width: 180 }} />
            <select aria-label="Status" value={filters.status} onChange={setFilter('status')} style={control}>
              <option value="active">Active</option><option value="retired">Retired</option><option value="unverified">Unverified</option><option value="all">All statuses</option>
            </select>
            <select aria-label="Opening confidence" value={filters.confidence} onChange={setFilter('confidence')} style={control}
              title="Applied to the page loaded">
              <option value="">Any opening</option><option value="confirmed">Confirmed</option><option value="likely">Likely</option><option value="uncertain">Uncertain</option><option value="none">Not known</option>
            </select>
            {JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS) && (
              <button type="button" style={btn} onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>
            )}
          </div>

          <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div className="tl-grid tl-head" style={{ ...head, padding: '10px 16px', borderBottom: `1px solid ${c.border}` }}>
              <span>Number</span><span>Kind</span><span>Plant</span><span>Size class</span><span>Cav</span><span>Held at</span><span>Location</span><span>Opening</span><span>Dies</span><span>Status</span><span />
            </div>
            {items.map((r) => (
              <button key={r.number} type="button" className="tl-row tl-grid" onClick={() => setOpenNumber(r.number)} aria-label={`Open tooling ${r.number}`}
                style={{ width: '100%', padding: '11px 16px', border: 'none', borderBottom: `1px solid ${c.border}`, background: 'transparent', color: c.text, textAlign: 'left', cursor: 'pointer', font: 'inherit', fontSize: 13 }}>
                <span style={{ fontFamily: mono, fontWeight: 700, overflowWrap: 'anywhere' }}>{r.number}</span>
                <span className="tl-hide-sm">{KIND_LABEL[r.kind] || r.kind}</span>
                <span className="tl-hide-sm">{r.plant}</span>
                <span className="tl-hide-sm" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {r.size_class ? <span style={{ fontFamily: mono }}>{r.size_class}</span> : <span style={{ color: c.dim }}>unknown</span>}
                  {r.size_class && r.size_class_confidence && <Pill c={c} text={r.size_class_confidence} tone={confidenceTone(r.size_class_confidence)} />}
                </span>
                <span className="tl-hide-sm">{r.cavities ?? '—'}</span>
                <span className="tl-hide-sm" style={{ color: (r.held_presses || []).length ? c.text : c.dim }}>{(r.held_presses || []).join(', ') || '—'}</span>
                <span className="tl-hide-sm" style={{ color: r.location ? c.text : c.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.location || '—'}</span>
                <span><Pill c={c} text={r.opening_confidence === 'none' ? 'not known' : r.opening_confidence} tone={confidenceTone(r.opening_confidence)} /></span>
                <span className="tl-hide-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>{r.linked_dies || 0}</span>
                <span className="tl-hide-sm"><Pill c={c} text={r.status} tone={statusTone(r.status)} /></span>
                <ChevronRight className="tl-hide-sm" size={15} style={{ color: c.dim }} aria-hidden="true" />
              </button>
            ))}
            {!loading && !loadError && items.length === 0 && (
              <div style={{ padding: '44px 16px', textAlign: 'center' }}>
                <Wrench size={22} style={{ color: c.dim }} aria-hidden="true" />
                <div style={{ fontWeight: 600, marginTop: 8 }}>No toolings match</div>
                <div style={{ fontSize: '0.84rem', color: c.muted, marginTop: 4 }}>Try other filters, or clear the search box at the top.</div>
              </div>
            )}
            {loadError && (
              <div role="alert" style={{ padding: '28px 16px', textAlign: 'center', color: c.danger, fontSize: '0.875rem' }}>
                {loadError}. <button type="button" onClick={loadList} style={{ background: 'none', border: 'none', color: c.link, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Try again</button>
              </div>
            )}
            {loading && items.length === 0 && <div role="status" style={{ padding: '36px 16px', textAlign: 'center', color: c.dim }}>Loading toolings…</div>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10, fontSize: 13, color: c.muted, flexWrap: 'wrap' }}>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {list.total === 0 ? 'No toolings' : `${offset + 1}–${Math.min(offset + PAGE_SIZE, list.total)} of ${list.total}`}
              {filters.confidence && ` · ${items.length} on this page with that opening confidence`}
            </span>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <button type="button" style={smallBtn} disabled={offset === 0 || loading} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))} aria-label="Previous page"><ChevronLeft size={14} aria-hidden="true" />Prev</button>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>Page {page} of {pages}</span>
              <button type="button" style={smallBtn} disabled={offset + PAGE_SIZE >= list.total || loading} onClick={() => setOffset((o) => o + PAGE_SIZE)} aria-label="Next page">Next<ChevronRight size={14} aria-hidden="true" /></button>
            </span>
          </div>
        </>
      )}

      {tab === 'queue' && (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <select aria-label="Queue plant" value={queuePlant} onChange={(e) => setQueuePlant(e.target.value)} style={control}>
              <option value="">All plants</option><option value="GEX 1">GEX 1</option><option value="GEX 2">GEX 2</option>
            </select>
            <select aria-label="Queue items" value={queueKind} onChange={(e) => setQueueKind(e.target.value)} style={control}>
              <option value="">Openings and pictures</option><option value="opening">Openings only</option><option value="profile">Pictures only</option>
            </select>
            <span style={{ fontSize: 13, color: c.muted, fontVariantNumeric: 'tabular-nums' }}>
              {queue.openingsTotal} tooling{queue.openingsTotal === 1 ? '' : 's'} · {queue.profilesTotal} picture{queue.profilesTotal === 1 ? '' : 's'} need review
              {(queue.openingsTotal > queue.openings.length || queue.profilesTotal > queue.profiles.length) && ` (first ${PAGE_SIZE} of each shown)`}
            </span>
          </div>
          <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden' }}>
            {queueRows.map((row) => (
              <div key={row.key} className="tl-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: `1px solid ${c.border}`, flexWrap: 'wrap' }}>
                {row.kind === 'profile' ? <ProfileThumb row={row.raw} c={c} /> : <Wrench size={18} style={{ color: c.muted, width: 72, flexShrink: 0 }} aria-hidden="true" />}
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: mono, fontWeight: 700 }}>{row.title}</span>
                    <Pill c={c} text={row.kind === 'profile' ? 'Picture' : 'Opening'} />
                    {row.plant && <span style={{ fontSize: 12, color: c.muted }}>{row.plant}</span>}
                    <Pill c={c} text={row.reason} tone="warn" />
                  </div>
                  <div style={{ fontSize: 12.5, color: c.muted, marginTop: 3 }}>{row.subtitle}</div>
                </div>
                {row.kind === 'opening' && (
                  <button type="button" style={smallBtn} onClick={() => setOpenNumber(row.title)} aria-label={`Open tooling ${row.title}`}>Open<ChevronRight size={14} aria-hidden="true" /></button>
                )}
                {row.kind === 'profile' && reviewer && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input value={notes[row.key] || ''} onChange={(e) => setNotes((n) => ({ ...n, [row.key]: e.target.value }))} placeholder="Note (optional)" aria-label={`Note for ${row.title}`}
                      style={{ ...control, minHeight: 30, width: 160, fontSize: 12.5 }} />
                    <button type="button" style={{ ...smallBtn, background: c.primary, color: c.primaryText, border: 'none' }} disabled={reviewing === row.key} onClick={() => reviewPicture(row, 'clear')} aria-label={`Clear picture for ${row.title}`}
                      title="The picture is right: it joins the similarity index">Clear</button>
                    <button type="button" style={smallBtn} disabled={reviewing === row.key} onClick={() => reviewPicture(row, 'keep')} aria-label={`Keep picture for ${row.title} flagged`}
                      title="Leave it flagged and out of the similarity index">Keep</button>
                  </div>
                )}
              </div>
            ))}
            {!queueLoading && !queueError && queueRows.length === 0 && (
              <div style={{ padding: '44px 16px', textAlign: 'center', color: c.muted }}>Nothing waiting for review.</div>
            )}
            {queueError && <div role="alert" style={{ padding: '28px 16px', textAlign: 'center', color: c.danger, fontSize: '0.875rem' }}>{queueError}</div>}
            {queueLoading && queueRows.length === 0 && <div role="status" style={{ padding: '36px 16px', textAlign: 'center', color: c.dim }}>Loading the review queue…</div>}
          </div>
        </>
      )}

      {openNumber && (
        <ToolingDrawer number={openNumber} user={user} theme={theme} onClose={() => setOpenNumber(null)} onChanged={onChanged} />
      )}
      {showAdd && (
        <AddToolingModal user={user} theme={theme} onClose={() => setShowAdd(false)} onCreated={() => loadList()} />
      )}
    </div>
  );
}
