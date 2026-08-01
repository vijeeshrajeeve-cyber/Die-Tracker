import React, { useEffect, useState } from 'react';
import { PenTool, Upload, Trash2, X } from 'lucide-react';
import { signaturesAPI } from '../../api';
import useDialog from '../../hooks/useDialog';
import { BRAND, BRAND_ALPHA } from '../../utils/brand';

// Manage your own scanned signature — the one printed in the Signature column
// of the QD form. This lives in the user menu rather than on the Settings page
// because Settings is behind page access that ordinary users do not have, and
// every user needs to be able to sign the QDs they raise.
const SignatureModal = ({ theme, onClose }) => {
  const dialogRef = useDialog({ open: true, onClose });
  const [dataUrl, setDataUrl] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { text, tone: 'ok' | 'error' }

  useEffect(() => {
    let cancelled = false;
    signaturesAPI.getMine()
      .then((res) => {
        if (cancelled) return;
        setDataUrl(res.dataUrl || null);
        setUpdatedAt(res.updatedAt || null);
      })
      .catch((err) => { if (!cancelled) setMessage({ text: err.message || 'Failed to load your signature', tone: 'error' }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so picking the same file again still fires change
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await signaturesAPI.upload(file);
      setDataUrl(res.dataUrl || null);
      setUpdatedAt(res.updatedAt || null);
      setMessage({ text: 'Signature saved', tone: 'ok' });
    } catch (err) {
      setMessage({ text: err.message || 'Failed to save signature', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await signaturesAPI.remove();
      setDataUrl(null);
      setUpdatedAt(null);
      setMessage({ text: 'Signature removed', tone: 'ok' });
    } catch (err) {
      setMessage({ text: err.message || 'Failed to remove signature', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: theme.cardBg, borderRadius: '20px', width: '100%', maxWidth: '520px',
          border: `1px solid ${theme.cardBorder}`, overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem 1.5rem', borderBottom: `1px solid ${theme.cardBorder}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <PenTool size={20} color={theme.accent || '#3B82F6'} />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: theme.text, margin: 0 }}>My Signature</h3>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: theme.textMuted, display: 'flex' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '1.5rem' }}>
          <p style={{ fontSize: '0.82rem', color: theme.textDim, marginTop: 0, marginBottom: '1rem', lineHeight: 1.6 }}>
            Printed in the Signature column of the QD form — beside <strong style={{ color: theme.textMuted }}>Prepared By</strong> on
            the QDs you raise, and beside <strong style={{ color: theme.textMuted }}>Authorized By</strong> on the ones you approve.
          </p>

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: theme.textDim, fontSize: '0.875rem' }}>Loading…</div>
          ) : (
            <>
              {/* Always on white: this is how it prints on the form. */}
              <div style={{ background: '#ffffff', border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', height: '130px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
                {dataUrl
                  ? <img src={dataUrl} alt="Your signature" style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }} />
                  : <span style={{ color: '#9CA3AF', fontSize: '0.85rem' }}>No signature uploaded</span>}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <label style={{ padding: '9px 18px', background: busy ? theme.cardBorder : BRAND.navy, color: 'white', borderRadius: '8px', cursor: busy ? 'wait' : 'pointer', fontWeight: 600, fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <Upload size={16} /> {dataUrl ? 'Replace' : 'Upload signature'}
                  <input aria-label="Choose a signature image" type="file" accept="image/png,image/jpeg" disabled={busy} onChange={handleFile} style={{ display: 'none' }} />
                </label>
                {dataUrl && (
                  <button disabled={busy} onClick={remove}
                    style={{ padding: '9px 16px', background: 'transparent', color: '#EF4444', border: '1px solid #EF4444', borderRadius: '8px', cursor: busy ? 'wait' : 'pointer', fontWeight: 600, fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <Trash2 size={16} /> Remove
                  </button>
                )}
                {updatedAt && (
                  <span style={{ fontSize: '0.75rem', color: theme.textDim }}>
                    Updated {new Date(updatedAt).toLocaleString()}
                  </span>
                )}
              </div>

              {message && (
                <div style={{ marginTop: '1rem', fontSize: '0.82rem', color: message.tone === 'error' ? '#EF4444' : '#10B981' }}>
                  {message.text}
                </div>
              )}

              <p style={{ fontSize: '0.72rem', color: theme.textDim, marginTop: '1.25rem', marginBottom: 0, lineHeight: 1.6 }}>
                PNG or JPG, up to 1 MB. A PNG with a transparent background, cropped close to the signature, gives the best result — the cell on the form is wide and short.
                <br />
                QD PDFs are generated fresh each time they are downloaded or emailed, so replacing or removing your signature changes every QD you have signed, including ones already approved.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SignatureModal;
