import React, { useEffect, useState } from 'react';
import { FileText, Upload, X, Image as ImageIcon } from 'lucide-react';
import { qualityDiscrepanciesAPI } from '../../api';
import useDialog from '../../hooks/useDialog';

const isPdf = (name) => /\.pdf$/i.test(String(name || ''));

// The file route is behind the bearer token, so each thumbnail is fetched as a
// blob and shown through an object URL that is revoked when the grid unmounts.
function useFileUrl(fileId) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl = null;
    let gone = false;
    qualityDiscrepanciesAPI.fileObjectUrl(fileId)
      .then((u) => { if (gone) URL.revokeObjectURL(u); else { objectUrl = u; setUrl(u); } })
      .catch(() => { if (!gone) setFailed(true); });
    return () => { gone = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [fileId]);
  return { url, failed };
}

function Thumb({ file, theme, onOpen }) {
  const { url, failed } = useFileUrl(file.id);
  const border = theme.cardBorder || '#27272a';
  const dim = theme.textDim || '#71717a';
  const caption = file.category === 'profile_image' ? 'Profile' : file.original_name;
  return (
    <button type="button" onClick={() => url && onOpen(url, caption)} title={file.original_name}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 0, background: 'transparent', border: 'none', cursor: url ? 'zoom-in' : 'default', textAlign: 'left', minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', aspectRatio: '4 / 3', width: '100%', border: `1px solid ${border}`, borderRadius: 8, overflow: 'hidden', background: 'rgba(255,255,255,0.03)' }}>
        {url
          ? <img src={url} alt={caption} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          : <ImageIcon size={20} style={{ color: dim, opacity: failed ? 0.4 : 1 }} />}
      </span>
      <span style={{ fontSize: 11.5, color: dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>{caption}</span>
    </button>
  );
}

function Lightbox({ url, caption, onClose }) {
  const ref = useDialog({ open: true, onClose, closeOnEscape: true });
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={caption} tabIndex={-1} onClick={(e) => e.stopPropagation()}
        style={{ position: 'relative', maxWidth: '92vw', maxHeight: '90vh', outline: 'none' }}>
        <img src={url} alt={caption} style={{ maxWidth: '92vw', maxHeight: '86vh', display: 'block', borderRadius: 8 }} />
        <div style={{ marginTop: 8, fontSize: 12.5, color: '#d4d4d8', textAlign: 'center' }}>{caption}</div>
        <button type="button" onClick={onClose} aria-label="Close"
          style={{ position: 'absolute', top: -14, right: -14, width: 32, height: 32, borderRadius: '50%', background: '#18181b', border: '1px solid #3f3f46', color: '#e4e4e7', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

// Every picture on the QD as a thumbnail, the profile first; PDFs and the
// original form as chips underneath. Add file lives here because this is
// where the result is seen.
export default function QdPhotoGrid({ files = [], theme = {}, onAdd, busy = false, fileRef, onFilesChosen }) {
  const [open, setOpen] = useState(null);
  const border = theme.cardBorder || '#27272a';
  const bg = theme.cardBg || '#09090b';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';

  const images = files.filter((f) => !isPdf(f.original_name) && f.category !== 'original_form');
  const profile = images.filter((f) => f.category === 'profile_image');
  const others = images.filter((f) => f.category !== 'profile_image');
  const docs = files.filter((f) => isPdf(f.original_name) || f.category === 'original_form');

  return (
    <div>
      {images.length === 0 && (
        <div style={{ fontSize: 13, color: dim, marginBottom: 12 }}>No pictures on this QD yet.</div>
      )}
      {images.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 14, marginBottom: 16 }}>
          {[...profile, ...others].map((f) => (
            <Thumb key={f.id} file={f} theme={theme} onOpen={(url, caption) => setOpen({ url, caption })} />
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {docs.map((f) => (
          <button key={f.id} type="button" className="qd-chip" title={f.original_name}
            onClick={() => qualityDiscrepanciesAPI.downloadFile(f.id, f.original_name)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: `1px solid ${border}`, borderRadius: 8, fontSize: 12, color: muted, cursor: 'pointer', background: bg }}>
            <FileText size={15} style={{ color: '#F87171' }} /> {f.category === 'original_form' ? 'Original QD form' : f.original_name}
          </button>
        ))}
        {onAdd && (
          <>
            <input aria-label="Attach evidence to this QD" ref={fileRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp" style={{ display: 'none' }} onChange={onFilesChosen} />
            <button type="button" onClick={onAdd} disabled={busy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: `2px dashed ${border}`, borderRadius: 8, fontSize: 12, color: dim, cursor: busy ? 'wait' : 'pointer', background: 'transparent' }}>
              <Upload size={15} /> {busy ? 'Working…' : 'Add file'}
            </button>
          </>
        )}
      </div>
      {open && <Lightbox url={open.url} caption={open.caption} onClose={() => setOpen(null)} />}
    </div>
  );
}
