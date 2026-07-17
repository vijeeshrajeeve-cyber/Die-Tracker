import React, { useState, useRef } from 'react';
import { X, AlertTriangle, Upload } from 'lucide-react';
import { qualityDiscrepanciesAPI } from '../../api';
import { QD_OUTCOMES } from '../../utils/constants';

const GRADIENT = 'linear-gradient(135deg,#3B82F6,#8B5CF6)';

export default function RaiseQDModal({ theme = {}, suppliers = [], onClose, onCreated }) {
  const [dieNo, setDieNo] = useState('');
  const [plant, setPlant] = useState('GEX 2');
  const [supplier, setSupplier] = useState(suppliers[0] || '');
  const [corrector, setCorrector] = useState('');
  const [issue, setIssue] = useState('');
  const [outcome, setOutcome] = useState('Supplier rework');
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const bg = theme.cardBg || '#09090b';
  const border = theme.cardBorder || '#27272a';
  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';
  const inputBg = theme.inputBg || '#09090b';
  const mono = "'JetBrains Mono', ui-monospace, monospace";

  const label = { fontSize: 11, fontWeight: 700, color: dim, textTransform: 'uppercase', letterSpacing: '0.06em' };
  const field = { padding: '10px 14px', background: inputBg, border: `1px solid ${border}`, borderRadius: 8, color: text, fontSize: 14, outline: 'none', boxSizing: 'border-box' };
  const group = { display: 'flex', flexDirection: 'column', gap: 6 };

  const canSubmit = !!dieNo.trim() && !!supplier.trim() && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const { id } = await qualityDiscrepanciesAPI.create({
        dieNo: dieNo.trim(), plant, supplier: supplier.trim(),
        corrector: corrector.trim(), issue: issue.trim(), outcome,
      });
      if (files.length) await qualityDiscrepanciesAPI.uploadFiles(id, files);
      onCreated(id);
    } catch (e) {
      setError(e.message || 'Failed to raise QD');
      setSubmitting(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <style>{`@keyframes qdModalIn { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } }
        .qd-cta:hover { filter: brightness(1.06); }`}</style>

      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 20, width: 640, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 60px rgba(0,0,0,0.5)', animation: 'qdModalIn 0.2s ease-out', color: text }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '24px 28px', borderBottom: `1px solid ${border}` }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, background: GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <AlertTriangle size={18} style={{ color: '#fff' }} />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>Raise Quality Discrepancy</div>
            {/* The server assigns the QD number on submit — no client-side guess. */}
            <div style={{ fontSize: 12.5, color: dim, marginTop: 2 }}>Against a received die · QD no assigned automatically</div>
          </div>
          <button onClick={onClose} style={{ width: 34, height: 34, background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={group}>
              <label style={label}>Die No</label>
              <input value={dieNo} onChange={(e) => setDieNo(e.target.value)} placeholder="e.g. 029780-2502" style={{ ...field, fontFamily: mono }} />
            </div>
            <div style={group}>
              <label style={label}>Plant</label>
              <select value={plant} onChange={(e) => setPlant(e.target.value)} style={{ ...field, cursor: 'pointer' }}>
                <option>GEX 2</option><option>GEX 1</option>
              </select>
            </div>
            <div style={group}>
              <label style={label}>Supplier</label>
              {/* Fall back to free text so the very first QD can still be raised. */}
              {suppliers.length ? (
                <select value={supplier} onChange={(e) => setSupplier(e.target.value)} style={{ ...field, cursor: 'pointer' }}>
                  {suppliers.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. PDTMC" style={field} />
              )}
            </div>
            <div style={group}>
              <label style={label}>Corrector</label>
              <input value={corrector} onChange={(e) => setCorrector(e.target.value)} placeholder="e.g. Sijith" style={field} />
            </div>
          </div>

          <div style={group}>
            <label style={label}>Quality issue</label>
            <textarea value={issue} onChange={(e) => setIssue(e.target.value)} rows={4}
              placeholder="Describe the discrepancy — what differs from the approved design or expected performance"
              style={{ ...field, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
          </div>

          <div style={group}>
            <label style={label}>Outcome sought</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {QD_OUTCOMES.map(o => {
                const on = outcome === o;
                return (
                  <button key={o} type="button" onClick={() => setOutcome(o)}
                    style={{ padding: '7px 14px', borderRadius: 20, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s ease', border: `1px solid ${on ? 'rgba(139,92,246,0.4)' : border}`, background: on ? 'rgba(139,92,246,0.15)' : bg, color: on ? '#A78BFA' : muted }}>
                    {o}
                  </button>
                );
              })}
            </div>
          </div>

          <input ref={fileRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp" style={{ display: 'none' }}
            onChange={(e) => setFiles(Array.from(e.target.files || []))} />
          <div onClick={() => fileRef.current && fileRef.current.click()}
            style={{ border: `2px dashed ${border}`, borderRadius: 8, padding: 20, textAlign: 'center', color: dim, fontSize: 13, cursor: 'pointer' }}>
            <Upload size={18} style={{ marginBottom: 6 }} />
            <div>
              {files.length
                ? `${files.length} file${files.length === 1 ? '' : 's'} ready to attach`
                : <>Drop images or PDF reports here, or <span style={{ color: '#60A5FA', fontWeight: 600 }}>Browse Files</span></>}
            </div>
          </div>

          {error && <div style={{ fontSize: 12.5, color: '#FCA5A5' }}>{error}</div>}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '18px 28px', borderTop: `1px solid ${border}` }}>
          <button onClick={onClose} style={{ padding: '10px 18px', background: bg, border: `1px solid ${border}`, borderRadius: 10, color: muted, fontWeight: 500, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
          <button onClick={submit} disabled={!canSubmit} className="qd-cta"
            style={{ padding: '10px 20px', background: GRADIENT, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.55, boxShadow: '0 4px 12px rgba(59,130,246,0.3)' }}>
            {submitting ? 'Raising…' : 'Raise QD'}
          </button>
        </div>
      </div>
    </div>
  );
}
