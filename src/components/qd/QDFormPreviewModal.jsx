import React, { useEffect, useState } from 'react';
import { X, Download, RefreshCw, Check, CornerUpLeft } from 'lucide-react';
import { qualityDiscrepanciesAPI } from '../../api';
import useDialog from '../../hooks/useDialog';

// The QD form as it will actually be issued, shown where the decision is made.
//
// It renders the real PDF rather than re-drawing the fields in HTML on purpose:
// the QD is a certification record, and a preview that can disagree with the
// document Purchase receives would be worse than no preview at all.
export default function QDFormPreviewModal({
  qd, theme = {}, mayApprove = false, busy = false, onApprove, onSendBack, onClose,
}) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0); // bumped by Retry to refetch

  const dialogRef = useDialog({ open: true, onClose });

  const bg = theme.cardBg || '#09090b';
  const border = theme.cardBorder || '#27272a';
  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';

  // One fetch per open (or per Retry). The object URL is revoked on teardown —
  // without that, every re-open would strand another copy of the PDF in memory.
  //
  // The loading/error reset lives in `retry` below rather than here: resetting
  // state in the effect body is a re-render the component does not need, and the
  // only thing that re-runs this effect is that button.
  useEffect(() => {
    let cancelled = false;
    let created = '';
    qualityDiscrepanciesAPI.documentUrl(qd.id)
      .then((u) => {
        created = u;
        if (cancelled) { URL.revokeObjectURL(u); return; }
        setUrl(u);
      })
      .catch((e) => { if (!cancelled) setError(e.message || 'Could not render the QD form'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [qd.id, attempt]);

  const retry = () => {
    setLoading(true);
    setError('');
    setAttempt((a) => a + 1);
  };

  const download = async () => {
    try {
      await qualityDiscrepanciesAPI.downloadDocument(qd.id, qd.qd_no);
    } catch (e) {
      setError(e.message || 'Could not download the QD form');
    }
  };

  const btn = {
    padding: '8px 14px', background: bg, border: `1px solid ${border}`, borderRadius: 8,
    color: muted, fontWeight: 500, fontSize: 13, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 6,
  };
  const centre = {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
    justifyContent: 'center', flexDirection: 'column', gap: 12, color: muted, fontSize: 13.5,
  };

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}
        aria-label={`QD form preview ${qd.qd_no || 'draft'}`}
        onClick={(e) => e.stopPropagation()}
        style={{ width: '92vw', height: '92vh', background: bg, border: `1px solid ${border}`, borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', color: text, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px', borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>QD form — {qd.qd_no || 'Draft'}</div>
            <div style={{ fontSize: 12.5, color: muted, marginTop: 2 }}>
              {qd.status}{qd.approval_state ? ` · ${qd.approval_state}` : ''} · Die {qd.die_no} · {qd.supplier}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {/* Always available: a browser that will not render a PDF inline shows
                an empty frame rather than firing an error, so the way out must not
                live behind the error state. */}
            <button type="button" onClick={download} style={btn}>
              <Download size={15} /> Download PDF
            </button>
            <button type="button" onClick={onClose} aria-label="Close preview"
              style={{ width: 34, height: 34, background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative', background: '#334155' }}>
          {loading && <div style={centre}>Rendering the QD form…</div>}
          {!loading && error && (
            <div style={centre}>
              <span style={{ color: '#FCA5A5' }}>{error}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={retry} style={btn}>
                  <RefreshCw size={15} /> Retry
                </button>
                <button type="button" onClick={download} style={btn}>
                  <Download size={15} /> Download instead
                </button>
              </div>
            </div>
          )}
          {!loading && !error && url && (
            <iframe src={`${url}#view=FitH`} title="QD form preview"
              style={{ width: '100%', height: '100%', border: 'none' }} />
          )}
        </div>

        {/* Reading the form and acting on it are one task — an approver who has
            to close the preview to decide is back where they started. */}
        {mayApprove && qd.approval_state === 'Pending' && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '14px 20px', borderTop: `1px solid ${border}`, flexShrink: 0 }}>
            <button type="button" onClick={onSendBack} disabled={busy}
              style={{ ...btn, cursor: busy ? 'wait' : 'pointer' }}>
              <CornerUpLeft size={15} /> Send back
            </button>
            <button type="button" onClick={onApprove} disabled={busy}
              style={{ padding: '8px 14px', background: '#22C55E', border: 'none', borderRadius: 8, color: '#052e16', fontWeight: 600, fontSize: 13, cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Check size={15} /> Approve &amp; send to Purchase
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
