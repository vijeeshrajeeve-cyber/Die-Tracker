import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { X, FileText, Download, Eye, Upload, CheckCircle2, Ban, RotateCcw, Archive } from 'lucide-react';
import { toolingsAPI } from '../../api';
import { dialogs } from '../ui/DialogProvider';
import useDialog from '../../hooks/useDialog';
import PDFViewer from '../PDFViewer';
import OpeningOverlay from './OpeningOverlay';
import { usePalette } from '../../utils/palette';
import { confidenceTone, isToolingReviewer, parsePocketsJson, statusTone } from '../../utils/toolingsView';

const mono = "'JetBrains Mono', ui-monospace, monospace";
const KIND_LABEL = { insert: 'Insert', bolster: 'Bolster' };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtSize = (b) => {
  const n = Number(b) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return n ? `${n} B` : '';
};

function toneColors(tone, c) {
  if (tone === 'ok') return { color: c.ok, background: c.okBg, border: 'transparent' };
  if (tone === 'warn') return { color: c.warn, background: c.warnBg, border: 'transparent' };
  if (tone === 'no') return { color: c.danger, background: c.dangerBg, border: 'transparent' };
  return { color: c.muted, background: c.inset, border: c.border };
}

export function Pill({ text, tone = 'muted', c, title }) {
  const t = toneColors(tone, c);
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', color: t.color, background: t.background, border: `1px solid ${t.border}` }}>
      {text}
    </span>
  );
}

const downloadBlob = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const editDraftOf = (t) => ({
  location: t?.location || '', sizeClass: t?.size_class || '', cavities: t?.cavities == null ? '' : String(t.cavities), notes: t?.notes || '',
});

export default function ToolingDrawer({ number, user, theme = {}, onClose, onChanged }) {
  const c = usePalette(theme);
  const reviewer = isToolingReviewer(user);
  const titleId = useId();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [viewing, setViewing] = useState(null);
  const [correcting, setCorrecting] = useState(false);
  const [pocketsText, setPocketsText] = useState('');
  const [pocketsError, setPocketsError] = useState('');
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState(editDraftOf(null));
  const fileRef = useRef(null);
  const dialogRef = useDialog({ open: true, onClose, closeOnEscape: !busy && !viewing });

  const load = useCallback(() => toolingsAPI.get(number)
    .then((d) => { setDetail(d); setDraft(editDraftOf(d.tooling)); setError(''); })
    .catch((e) => setError(e.message || 'Could not load the tooling')), [number]);
  useEffect(() => { load(); }, [load]);

  // Every write: run it, reload the drawer, tell the list.
  const run = async (label, fn, done) => {
    setBusy(label);
    setActionError('');
    try {
      const out = await fn();
      await load();
      onChanged?.();
      if (done) dialogs.notify(typeof done === 'function' ? done(out) : done, 'success');
      return true;
    } catch (e) {
      setActionError(e.message || 'Something went wrong');
      return false;
    } finally {
      setBusy('');
    }
  };

  const t = detail?.tooling;
  const opening = detail?.opening;
  const hasPockets = Array.isArray(opening?.pockets) && opening.pockets.length > 0;

  const openDrawing = async (d) => {
    setActionError('');
    try {
      const blob = await toolingsAPI.downloadDrawing(t.number, d.id);
      if (d.format === 'pdf') setViewing({ file: new File([blob], d.original_name, { type: 'application/pdf' }), name: d.original_name });
      else downloadBlob(blob, d.original_name);
    } catch (e) {
      setActionError(e.message || 'Could not load the drawing');
    }
  };

  const review = (action, extra = {}) => run(action, () => toolingsAPI.reviewOpening(t.number, { action, ...(note.trim() ? { note: note.trim() } : {}), ...extra }), {
    confirm: 'Opening confirmed', correct: 'Pockets corrected', none: 'Opening marked not known',
  }[action]).then((ok) => { if (ok) { setNote(''); setCorrecting(false); } });

  const submitCorrection = () => {
    const { pockets, error: bad } = parsePocketsJson(pocketsText);
    setPocketsError(bad || '');
    if (bad) return;
    review('correct', { pockets });
  };

  const changedFields = () => {
    const base = editDraftOf(t);
    const patch = {};
    if (draft.location !== base.location) patch.location = draft.location.trim() || null;
    if (draft.sizeClass !== base.sizeClass) patch.sizeClass = draft.sizeClass.trim() || null;
    if (draft.cavities !== base.cavities) patch.cavities = draft.cavities.trim() === '' ? null : Number(draft.cavities);
    if (draft.notes !== base.notes) patch.notes = draft.notes.trim() || null;
    return patch;
  };
  const saveEdits = () => {
    const patch = changedFields();
    if (!Object.keys(patch).length) return;
    run('save', () => toolingsAPI.update(t.number, patch), 'Tooling updated');
  };

  const setStatus = async (status) => {
    if (status === 'retired' && !(await dialogs.confirm({
      title: `Retire ${t.number}?`, message: 'A retired tooling is left out of the finder. You can reactivate it later.', confirmLabel: 'Retire', tone: 'warning',
    }))) return;
    run('status', () => toolingsAPI.update(t.number, { status }), status === 'retired' ? 'Tooling retired' : 'Tooling set active');
  };

  const upload = (file) => {
    if (!file) return;
    run('upload', () => toolingsAPI.uploadDrawing(t.number, file), (out) => (out?.openingKept
      ? 'Drawing added — the reviewed opening was kept'
      : `Drawing added — opening ${out?.extraction?.confidence || 'read'}`));
  };

  const section = { padding: '16px 22px', borderTop: `1px solid ${c.border}` };
  const h3 = { fontSize: 12, fontWeight: 600, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' };
  const input = { width: '100%', boxSizing: 'border-box', minHeight: 36, padding: '6px 10px', background: c.inset, border: `1px solid ${c.border}`, borderRadius: 8, color: c.text, fontSize: 13.5, font: 'inherit' };
  const btn = { display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 34, padding: '0 12px', borderRadius: 8, border: `1px solid ${c.border}`, background: 'transparent', color: c.text, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
  const primaryBtn = { ...btn, background: c.primary, color: c.primaryText, border: 'none' };
  const th = { textAlign: 'left', fontWeight: 600, color: c.muted, padding: '6px 8px', borderBottom: `1px solid ${c.border}`, fontSize: 12 };
  const td = { padding: '6px 8px', borderBottom: `1px solid ${c.border}`, fontSize: 12.5 };
  const field = (label, k, opts = {}) => (
    <label style={{ display: 'block', minWidth: 0 }}>
      <span style={{ display: 'block', fontSize: 12, color: c.muted, marginBottom: 4 }}>{label}</span>
      {opts.area
        ? <textarea value={draft[k]} rows={2} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} style={{ ...input, resize: 'vertical' }} />
        : <input value={draft[k]} type={opts.type || 'text'} min={opts.type === 'number' ? 1 : undefined} placeholder={opts.placeholder} autoComplete="off"
          onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} style={{ ...input, fontFamily: opts.mono ? mono : undefined }} />}
    </label>
  );
  const dirty = t ? Object.keys(changedFields()).length > 0 : false;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1050, background: c.overlay, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <style>{'.tl-drawer button:disabled { opacity: .5; cursor: not-allowed; }'}</style>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="tl-drawer" onClick={(e) => e.stopPropagation()}
        style={{ width: 560, maxWidth: '100%', height: '100%', background: c.bg, borderLeft: `1px solid ${c.border}`, boxShadow: c.shadowLg, display: 'flex', flexDirection: 'column', color: c.text }}>
        <div style={{ padding: '20px 22px 14px', display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0 }}>
            <h2 id={titleId} style={{ margin: 0, fontFamily: mono, fontSize: 22, fontWeight: 700 }}>{number}</h2>
            {t && (
              <>
                <div style={{ fontSize: 13.5, color: c.muted, marginTop: 6 }}>
                  {KIND_LABEL[t.kind] || t.kind} · {t.plant}{t.cavities ? ` · ${t.cavities} cav` : ''}{t.location ? ` · ${t.location}` : ''}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  <Pill c={c} text={t.size_class ? `${t.size_class}${t.size_class_confidence ? ` · ${t.size_class_confidence}` : ''}` : 'size unknown'}
                    tone={t.size_class ? confidenceTone(t.size_class_confidence) : 'no'} title="Size class" />
                  <Pill c={c} text={t.status} tone={statusTone(t.status)} title="Status" />
                  <Pill c={c} text={`opening ${t.opening_confidence || 'none'}`} tone={confidenceTone(t.opening_confidence)} title="Opening confidence" />
                </div>
              </>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: 8, color: c.muted, cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {error && <div role="alert" style={{ ...section, color: c.danger, fontSize: 13.5 }}>{error}</div>}
          {!detail && !error && <div role="status" style={{ ...section, color: c.dim }}>Loading…</div>}
          {actionError && <div role="alert" style={{ margin: '0 22px 12px', padding: '8px 12px', borderRadius: 8, background: c.dangerBg, color: c.danger, fontSize: 13 }}>{actionError}</div>}

          {t && (
            <>
              <section style={section} aria-label="Drawings">
                <h3 style={h3}>Drawings</h3>
                {(detail.drawings || []).length === 0 && <div style={{ fontSize: 13, color: c.dim }}>No drawing stored.</div>}
                {(detail.drawings || []).map((d) => (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                    <FileText size={15} style={{ color: c.muted, flexShrink: 0 }} aria-hidden="true" />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.original_name}>{d.original_name}</span>
                    <span style={{ fontSize: 12, color: c.dim, whiteSpace: 'nowrap' }}>{String(d.format).toUpperCase()} · {fmtSize(d.byte_size)}{d.is_primary ? ' · primary' : ''}</span>
                    <button type="button" style={btn} onClick={() => openDrawing(d)} aria-label={`${d.format === 'pdf' ? 'View' : 'Download'} ${d.original_name}`}>
                      {d.format === 'pdf' ? <><Eye size={14} aria-hidden="true" />View</> : <><Download size={14} aria-hidden="true" />Download</>}
                    </button>
                  </div>
                ))}
                {reviewer && (
                  <div style={{ marginTop: 8 }}>
                    <input ref={fileRef} type="file" accept=".dxf,.pdf" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
                    <button type="button" style={btn} disabled={!!busy} onClick={() => fileRef.current?.click()}>
                      <Upload size={14} aria-hidden="true" />{busy === 'upload' ? 'Reading the drawing…' : 'Upload drawing'}
                    </button>
                    <span style={{ fontSize: 12, color: c.dim, marginLeft: 8 }}>.dxf or .pdf; the opening is read from it.</span>
                  </div>
                )}
              </section>

              <section style={section} aria-label="Opening">
                <h3 style={h3}>Opening</h3>
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <OpeningOverlay pockets={hasPockets ? opening.pockets : []} outer={opening?.outer_outline || null} size={{ w: 320, h: 220 }} c={c} />
                  <dl style={{ margin: 0, fontSize: 13, display: 'grid', gap: 6, minWidth: 140, flex: 1 }}>
                    {!opening && <div style={{ color: c.dim }}>Opening not known — no opening has been read for this tooling.</div>}
                    {opening && (
                      <>
                        <div><dt style={{ color: c.dim, fontSize: 12 }}>Confidence</dt><dd style={{ margin: 0 }}><Pill c={c} text={opening.confidence} tone={confidenceTone(opening.confidence)} /></dd></div>
                        <div><dt style={{ color: c.dim, fontSize: 12 }}>Read from</dt><dd style={{ margin: 0 }}>{opening.extraction_source || '—'}</dd></div>
                        <div><dt style={{ color: c.dim, fontSize: 12 }}>Pockets</dt><dd style={{ margin: 0 }}>{hasPockets ? opening.pockets.length : 'opening not known'}{opening.pocket_gap_mm != null ? ` · gap ${Number(opening.pocket_gap_mm).toFixed(1)} mm` : ''}</dd></div>
                        {opening.extraction_note && <div><dt style={{ color: c.dim, fontSize: 12 }}>Note</dt><dd style={{ margin: 0, color: c.muted, overflowWrap: 'anywhere' }}>{opening.extraction_note}</dd></div>}
                        {opening.reviewed_at && <div><dt style={{ color: c.dim, fontSize: 12 }}>Reviewed</dt><dd style={{ margin: 0 }}>{fmtDate(opening.reviewed_at)}{opening.review_note ? ` — ${opening.review_note}` : ''}</dd></div>}
                      </>
                    )}
                  </dl>
                </div>

                {reviewer && (
                  <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Review note (optional)" aria-label="Review note" style={input} />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" style={primaryBtn} disabled={!!busy || !opening} title={opening ? undefined : 'No opening to confirm'} onClick={() => review('confirm')}>
                        <CheckCircle2 size={14} aria-hidden="true" />Confirm opening
                      </button>
                      <button type="button" style={btn} disabled={!!busy} onClick={() => { setCorrecting((v) => !v); setPocketsText(hasPockets ? JSON.stringify(opening.pockets) : ''); setPocketsError(''); setActionError(''); }}>
                        Correct pockets
                      </button>
                      <button type="button" style={btn} disabled={!!busy || !opening} title={opening ? undefined : 'No opening to mark'} onClick={() => review('none')}>
                        <Ban size={14} aria-hidden="true" />Mark opening not known
                      </button>
                    </div>
                    {correcting && (
                      <div style={{ display: 'grid', gap: 6 }}>
                        <label htmlFor={`${titleId}-pockets`} style={{ fontSize: 12, color: c.muted }}>
                          Pockets in mm, tooling frame, y up: <code style={{ fontFamily: mono }}>[[[x,y],[x,y],[x,y],…],…]</code> — one polygon per cavity.
                        </label>
                        <textarea id={`${titleId}-pockets`} value={pocketsText} onChange={(e) => setPocketsText(e.target.value)} rows={5} spellCheck={false} style={{ ...input, fontFamily: mono, fontSize: 12, resize: 'vertical' }} />
                        {pocketsError && <div role="alert" style={{ fontSize: 12.5, color: c.danger }}>{pocketsError}</div>}
                        <div><button type="button" style={primaryBtn} disabled={!!busy} onClick={submitCorrection}>Save pockets</button></div>
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section style={section} aria-label="Linked dies">
                <h3 style={h3}>Linked dies ({(detail.links || []).length})</h3>
                {(detail.links || []).length === 0 ? <div style={{ fontSize: 13, color: c.dim }}>Not linked to a die.</div> : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr><th style={th}>Die</th><th style={th}>Plant</th><th style={th}>Source</th><th style={th}>Seen</th><th style={th}>Die size</th><th style={th}>Press</th><th style={th}>Cav</th></tr></thead>
                      <tbody>
                        {detail.links.map((l, i) => (
                          <tr key={`${l.die_no}-${i}`}>
                            <td style={{ ...td, fontFamily: mono }}>{l.die_no}</td>
                            <td style={td}>{l.plant || '—'}</td>
                            <td style={td}>{l.source}</td>
                            <td style={td}>{fmtDate(l.seen_at)}</td>
                            <td style={td}>{l.die?.die_size || '—'}</td>
                            <td style={td}>{l.die?.press || '—'}</td>
                            <td style={td}>{l.die?.cavity ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {reviewer && (
                <section style={section} aria-label="Edit tooling">
                  <h3 style={h3}>Edit</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {field('Location', 'location')}
                    {field('Size class', 'sizeClass', { mono: true, placeholder: 'e.g. 175X80' })}
                    {field('Cavities', 'cavities', { type: 'number' })}
                    <div />
                    <div style={{ gridColumn: '1 / -1' }}>{field('Notes', 'notes', { area: true })}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <button type="button" style={primaryBtn} disabled={!!busy || !dirty} onClick={saveEdits}>{busy === 'save' ? 'Saving…' : 'Save changes'}</button>
                    {t.status === 'retired'
                      ? <button type="button" style={btn} disabled={!!busy} onClick={() => setStatus('active')}><RotateCcw size={14} aria-hidden="true" />Reactivate</button>
                      : <button type="button" style={btn} disabled={!!busy} onClick={() => setStatus('retired')}><Archive size={14} aria-hidden="true" />Retire</button>}
                    {t.status === 'unverified' && (
                      <button type="button" style={btn} disabled={!!busy} onClick={() => setStatus('active')}><CheckCircle2 size={14} aria-hidden="true" />Mark verified (active)</button>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
      {viewing && <PDFViewer file={viewing.file} name={viewing.name} onClose={() => setViewing(null)} />}
    </div>
  );
}
