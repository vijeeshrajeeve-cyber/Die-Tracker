import React, { useId, useState } from 'react';
import { X } from 'lucide-react';
import { toolingsAPI } from '../../api';
import { dialogs } from '../ui/DialogProvider';
import useDialog from '../../hooks/useDialog';
import { usePalette } from '../../utils/palette';
import { inferKind } from '../../utils/toolingsView';

// A new tooling (reviewers only): the server checks the number and fills plant/kind/cavities
// from it when they are left out; a drawing, if picked, is uploaded after and read for the opening.
export default function AddToolingModal({ theme = {}, onClose, onCreated }) {
  const c = usePalette(theme);
  const titleId = useId();
  const [form, setForm] = useState({ number: '', plant: '', kind: '', sizeClass: '', cavities: '', location: '', notes: '' });
  const [kindTouched, setKindTouched] = useState(false);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [addedWithoutDrawing, setAddedWithoutDrawing] = useState(false);
  const dialogRef = useDialog({ open: true, onClose, closeOnEscape: !busy });

  const set = (k) => (e) => {
    const value = e.target.value;
    setForm((f) => {
      const next = { ...f, [k]: value };
      if (k === 'number' && !kindTouched) next.kind = inferKind(value);
      return next;
    });
    if (k === 'kind') setKindTouched(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (addedWithoutDrawing) { onClose(); return; }
    if (!form.number.trim()) { setError('The tooling number is required.'); return; }
    setBusy(true);
    setError('');
    let created = null;
    try {
      const body = { number: form.number.trim() };
      for (const k of ['plant', 'kind', 'sizeClass', 'location', 'notes']) if (form[k].trim()) body[k] = form[k].trim();
      if (form.cavities.trim()) body.cavities = Number(form.cavities);
      created = (await toolingsAPI.create(body)).tooling;
      if (file) await toolingsAPI.uploadDrawing(created.number, file);
      dialogs.notify(`Tooling ${created.number} added${file ? ' with its drawing' : ''}`, 'success');
      onCreated?.(created);
      onClose();
    } catch (err) {
      if (created) {
        // The tooling exists; only the drawing failed. Say so and let the list show the new row.
        setError(`${created.number} was added, but the drawing could not be stored: ${err.message}`);
        setAddedWithoutDrawing(true);
        onCreated?.(created);
      } else {
        setError(err.message || 'Could not add the tooling');
      }
    } finally {
      setBusy(false);
    }
  };

  const input = { width: '100%', boxSizing: 'border-box', minHeight: 38, padding: '8px 10px', background: c.inset, border: `1px solid ${c.border}`, borderRadius: 8, color: c.text, fontSize: 13.5, font: 'inherit' };
  const label = { display: 'block', fontSize: 12, color: c.muted, marginBottom: 4 };
  const btn = { display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 38, padding: '0 16px', borderRadius: 8, border: `1px solid ${c.border}`, background: 'transparent', color: c.text, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' };
  const text = (k, lbl, opts = {}) => (
    <label style={{ display: 'block', minWidth: 0 }}>
      <span style={label}>{lbl}</span>
      <input value={form[k]} onChange={set(k)} type={opts.type || 'text'} min={opts.type === 'number' ? 1 : undefined} placeholder={opts.placeholder} autoComplete="off" style={input} />
      {opts.hint && <span style={{ display: 'block', fontSize: 11.5, color: c.dim, marginTop: 3 }}>{opts.hint}</span>}
    </label>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: c.overlay, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => !busy && onClose()}>
      <style>{'.tl-add button:disabled { opacity: .5; cursor: not-allowed; }'}</style>
      <form ref={dialogRef} className="tl-add" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()} onSubmit={submit}
        style={{ width: 560, maxWidth: '100%', maxHeight: '100%', overflowY: 'auto', background: c.bg, border: `1px solid ${c.border}`, borderRadius: 12, boxShadow: c.shadowLg, color: c.text, padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 id={titleId} style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Add tooling</h2>
          <button type="button" onClick={onClose} aria-label="Close" disabled={busy} style={{ background: 'transparent', border: 'none', color: c.muted, cursor: 'pointer' }}><X size={20} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {text('number', 'Number *', { placeholder: 'e.g. I-21599 or 25IC2-030724' })}
          <label style={{ display: 'block' }}>
            <span style={label}>Plant</span>
            <select value={form.plant} onChange={set('plant')} style={input}>
              <option value="">From the number</option>
              <option value="GEX 1">GEX 1</option>
              <option value="GEX 2">GEX 2</option>
            </select>
          </label>
          <label style={{ display: 'block' }}>
            <span style={label}>Kind</span>
            <select value={form.kind} onChange={set('kind')} style={input}>
              <option value="">From the number</option>
              <option value="insert">Insert</option>
              <option value="bolster">Bolster</option>
            </select>
            {!kindTouched && form.kind && <span style={{ display: 'block', fontSize: 11.5, color: c.dim, marginTop: 3 }}>guessed from the number</span>}
          </label>
          {text('sizeClass', 'Size class', { placeholder: 'e.g. 175X80' })}
          {text('cavities', 'Cavities', { type: 'number' })}
          {text('location', 'Location')}
          <label style={{ display: 'block', gridColumn: '1 / -1' }}>
            <span style={label}>Notes</span>
            <textarea value={form.notes} onChange={set('notes')} rows={2} style={{ ...input, resize: 'vertical' }} />
          </label>
          <label style={{ display: 'block', gridColumn: '1 / -1' }}>
            <span style={label}>Drawing (optional, .dxf or .pdf)</span>
            <input type="file" accept=".dxf,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ fontSize: 13, color: c.text }} />
          </label>
        </div>
        {error && <div role="alert" style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: c.dangerBg, color: c.danger, fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" style={btn} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" style={{ ...btn, background: c.primary, color: c.primaryText, border: 'none' }} disabled={busy}>
            {addedWithoutDrawing ? 'Close' : busy ? (file ? 'Adding and reading the drawing…' : 'Adding…') : 'Add tooling'}
          </button>
        </div>
      </form>
    </div>
  );
}
