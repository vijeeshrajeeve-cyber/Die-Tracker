import React, { useMemo, useState } from 'react';
import { ClipboardCopy, Bookmark, X } from 'lucide-react';
import useDialog from '../../hooks/useDialog';
import { buildOracleBatch, batchSummary } from '../../utils/oracleEntry';
import { bookmarkletHref } from '../../utils/oracleFill';

/**
 * Oracle Entry page: copy the ticked dies as one batch for the "Fill die"
 * bookmark, and show how to set that bookmark up. The bookmark itself runs in
 * Oracle (src/utils/oracleFill.js); nothing here talks to Oracle.
 */
export default function OracleBatchBar({ selectedOrders, theme, copyToClipboard, setToast }) {
  const [showSetup, setShowSetup] = useState(false);
  const setupRef = useDialog({ open: showSetup, onClose: () => setShowSetup(false) });
  const href = useMemo(() => bookmarkletHref(), []);

  const copyBatch = async () => {
    const batch = buildOracleBatch(selectedOrders);
    if (!batch.dies.length) {
      setToast({ message: batchSummary(batch), type: 'error' });
      setTimeout(() => setToast(null), 6000);
      return;
    }
    try {
      await copyToClipboard(batch.text);
      setToast({ message: batchSummary(batch), type: 'success' });
    } catch (error) {
      setToast({ message: 'Could not copy the batch: ' + error.message, type: 'error' });
    }
    setTimeout(() => setToast(null), 8000);
  };

  const copyLink = async () => {
    await copyToClipboard(href);
    setToast({ message: 'Bookmark address copied. Paste it as the URL of a new bookmark named "Fill die".', type: 'success' });
    setTimeout(() => setToast(null), 6000);
  };

  const button = (primary) => ({
    display: 'flex', alignItems: 'center', gap: '7px', padding: '10px 16px', borderRadius: '10px', fontWeight: 600,
    fontSize: '0.875rem', cursor: 'pointer', whiteSpace: 'nowrap',
    background: primary ? '#C2410C' : 'transparent', color: primary ? 'white' : theme.text,
    border: primary ? 'none' : `1px solid ${theme.border || '#334155'}`,
  });

  return (
    <>
      <button type="button" onClick={copyBatch} style={button(true)} title="Copy the ticked dies for the Fill die bookmark in Oracle">
        <ClipboardCopy size={16} /> Copy batch for Oracle ({selectedOrders.length})
      </button>
      <button type="button" onClick={() => setShowSetup(true)} style={button(false)}>
        <Bookmark size={16} /> Set up Fill die
      </button>

      {showSetup && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
          onClick={() => setShowSetup(false)}>
          <div ref={setupRef} role="dialog" aria-modal="true" aria-labelledby="oracle-setup-title" onClick={(e) => e.stopPropagation()}
            style={{ background: theme.cardBg || '#1E293B', color: theme.text, border: `1px solid ${theme.border || '#334155'}`, borderRadius: '14px', padding: '20px 22px', maxWidth: '520px', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <h2 id="oracle-setup-title" style={{ margin: 0, fontSize: '1.1rem' }}>Set up the Fill die bookmark</h2>
              <button type="button" aria-label="Close" onClick={() => setShowSetup(false)} style={{ background: 'transparent', border: 'none', color: theme.textMuted, cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <ol style={{ margin: 0, paddingLeft: '20px', lineHeight: 1.6, fontSize: '0.9rem' }}>
              <li>Show the bookmarks bar: <b>Ctrl+Shift+B</b>.</li>
              <li>
                Drag this button onto the bookmarks bar:{' '}
                {/* React refuses javascript: hrefs in JSX, so the link is set on the element directly. */}
                <a ref={(el) => { if (el) el.setAttribute('href', href); }} onClick={(e) => e.preventDefault()} draggable="true"
                  style={{ display: 'inline-block', padding: '4px 12px', borderRadius: '8px', background: '#C2410C', color: 'white', fontWeight: 700, textDecoration: 'none', cursor: 'grab' }}>
                  Fill die
                </a>
                <div style={{ fontSize: '0.8rem', color: theme.textMuted }}>
                  Drag not working? <button type="button" onClick={copyLink} style={{ background: 'none', border: 'none', padding: 0, color: '#F97316', cursor: 'pointer', textDecoration: 'underline', font: 'inherit' }}>Copy the bookmark address</button> and paste it as a new bookmark&apos;s URL.
                </div>
              </li>
              <li>Here, click <b>Copy batch for Oracle</b>. In Oracle open GEX PIM Engineer → Create Item and click <b>Fill die</b>; the first click asks you to paste the batch (Ctrl+V).</li>
              <li>Click <b>Fill die</b> on each screen (Create Item, Number/Description, Update), check what it filled, then press Oracle&apos;s own Continue / Finish / Apply yourself.</li>
            </ol>
            <p style={{ margin: '12px 0 0', fontSize: '0.8rem', color: theme.textMuted }}>
              Fixed values: status Active (Die available), die life 55 mT hollow / 50 mT solid, correctors IMRAN, presses row priority 1. Toolings are never in a batch.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
