import React, { useState, useRef } from 'react';
import { X, Upload, FileText, Image as ImageIcon } from 'lucide-react';
import { qualityDiscrepanciesAPI } from '../../api';
import { QD_STATUS_CONFIG } from '../../utils/constants';
import DatePickerField from '../DatePickerField';
import useDialog from '../../hooks/useDialog';
import { BRAND, BRAND_ALPHA } from '../../utils/brand';
import { todayLocal } from '../../utils/today.js';

const isPdf = (name) => /\.pdf$/i.test(String(name || ''));

const today = () => todayLocal();

// Every status change needs a recorded reason; moving to FOC Accepted also
// needs the ETA the supplier committed to, and moving to FOC Received the date
// the replacement actually turned up.
export default function StatusChangeModal({ qd, nextStatus, theme = {}, onClose, onDone }) {
  const dialogRef = useDialog({ open: true, onClose });
  const [reason, setReason] = useState('');
  const [etaDate, setEtaDate] = useState(qd.eta_date ? String(qd.eta_date).slice(0, 10) : '');
  const [receivedDate, setReceivedDate] = useState(today());
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

  const needsEta = nextStatus === 'FOC Accepted';
  const needsReceived = nextStatus === 'FOC Received';
  const from = QD_STATUS_CONFIG[qd.status] || QD_STATUS_CONFIG.Open;
  const to = QD_STATUS_CONFIG[nextStatus] || QD_STATUS_CONFIG.Open;

  const label = { fontSize: '0.72rem', fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' };
  const field = { padding: '9px 12px', background: inputBg, border: `1px solid ${border}`, borderRadius: 8, color: text, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box', width: '100%' };
  const pill = (c) => ({ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: c.bg, color: c.fg, whiteSpace: 'nowrap' });

  const canSubmit = !!reason.trim() && (!needsEta || !!etaDate)
    && (!needsReceived || !!receivedDate) && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      // Only send the date the chosen status actually asks for, so a stray
      // default can never be written against an unrelated change.
      await qualityDiscrepanciesAPI.setStatus(
        qd.id, nextStatus, reason.trim(),
        needsEta ? etaDate : undefined,
        needsReceived ? receivedDate : undefined);
      // Attachments are supporting evidence for the change — upload after the
      // status lands so a failed upload cannot leave the status unchanged.
      if (files.length) {
        try {
          await qualityDiscrepanciesAPI.uploadFiles(qd.id, files);
        } catch (up) {
          await onDone();
          return setError(`Status updated, but the attachment failed: ${up.message}`);
        }
      }
      await onDone();
      onClose();
    } catch (e) {
      setError(e.message || 'Could not change the status');
      setSubmitting(false);
    }
  };

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}>
      <style>{`@keyframes qdStatusIn { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } }
        .qd-status-cta:hover { filter: brightness(1.06); }`}</style>

      <div onClick={(e) => e.stopPropagation()}
        style={{ background: bg, border: `1px solid ${border}`, borderRadius: 16, width: 520, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', animation: 'qdStatusIn 0.2s ease-out', color: text }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '20px 24px', borderBottom: `1px solid ${border}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '1rem', fontWeight: 700 }}>Change status</div>
            <div style={{ fontSize: '0.8rem', color: dim, marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              QD {qd.qd_no}
              <span style={pill(from)}>{qd.status}</span>
              <span style={{ color: dim }}>→</span>
              <span style={pill(to)}>{nextStatus}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={label} htmlFor="statuschangemodal-reason">Reason <span style={{ color: '#FCA5A5' }}>*</span></label>
            <textarea id="statuschangemodal-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="Why is the status changing? e.g. supplier confirmed rework, HOD rejected the claim"
              style={{ ...field, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
          </div>

          {needsEta && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={label} htmlFor="statuschangemodal-eta-from-supplier">ETA from supplier <span style={{ color: '#FCA5A5' }}>*</span></label>
              <DatePickerField id="statuschangemodal-eta-from-supplier" value={etaDate} theme={theme} onChange={setEtaDate} placeholder="Select ETA" />
              <span style={{ fontSize: '0.72rem', color: dim }}>When the free-of-charge replacement is expected.</span>
            </div>
          )}

          {needsReceived && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={label} htmlFor="statuschangemodal-date-received">Date received <span style={{ color: '#FCA5A5' }}>*</span></label>
              <DatePickerField id="statuschangemodal-date-received" value={receivedDate} theme={theme} onChange={setReceivedDate} placeholder="Select date received" />
              <span style={{ fontSize: '0.72rem', color: dim }}>
                When the replacement physically reached the plant. It is stamped on the open FOC round — record the trial result next.
              </span>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={label} htmlFor="statuschangemodal-supporting-documents">Supporting documents</label>
            <input id="statuschangemodal-supporting-documents" ref={fileRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp" style={{ display: 'none' }}
              onChange={(e) => setFiles(Array.from(e.target.files || []))} />
            <button type="button" className="row-open press-soft" onClick={() => fileRef.current && fileRef.current.click()}
              style={{ border: `2px dashed ${border}`, borderRadius: 8, padding: 16, textAlign: 'center', color: dim, fontSize: '0.8rem', cursor: 'pointer' }}>
              <Upload size={16} style={{ marginBottom: 6 }} />
              <div>Attach evidence, or <span style={{ color: '#60A5FA', fontWeight: 600 }}>Browse Files</span> <span style={{ color: dim }}>· optional</span></div>
            </button>
            {files.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
                {files.map((f) => (
                  <span key={f.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', border: `1px solid ${border}`, borderRadius: 8, fontSize: 12, color: muted }}>
                    {isPdf(f.name) ? <FileText size={13} style={{ color: '#F87171' }} /> : <ImageIcon size={13} style={{ color: '#60A5FA' }} />}
                    {f.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {error && <div style={{ fontSize: '0.78rem', color: '#FCA5A5' }}>{error}</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: `1px solid ${border}` }}>
          <button onClick={onClose} style={{ padding: '9px 16px', background: bg, border: `1px solid ${border}`, borderRadius: 10, color: muted, fontWeight: 500, fontSize: '0.85rem', cursor: 'pointer' }}>Cancel</button>
          <button onClick={submit} disabled={!canSubmit} className="qd-status-cta"
            style={{ padding: '9px 18px', background: BRAND.navy, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: '0.85rem', cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.55, boxShadow: `0 4px 12px ${BRAND_ALPHA.navyGlow}` }}>
            {submitting ? 'Saving…' : 'Confirm change'}
          </button>
        </div>
      </div>
    </div>
  );
}
