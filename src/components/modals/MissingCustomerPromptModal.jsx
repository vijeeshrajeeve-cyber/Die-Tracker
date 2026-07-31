import React, { useCallback } from 'react';
import useDialog from '../../hooks/useDialog';
import { BRAND, BRAND_ALPHA } from '../../utils/brand';

export default function MissingCustomerPromptModal({ prompt, setPrompt, theme }) {
  const onClose = useCallback(() => setPrompt(null), [setPrompt]);
  const dialogRef = useDialog({ open: !!prompt, onClose });

  if (!prompt) return null;

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Customer names required" tabIndex={-1} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '1rem' }}>
      <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '1.5rem', width: '560px', maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', border: `1px solid ${theme.cardBorder}` }}>
        <div style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: theme.text, margin: 0 }}>Customer Names Required</h3>
          <p style={{ fontSize: '0.85rem', color: theme.textDim, marginTop: '6px', marginBottom: 0 }}>
            These profiles are not in the Profile Master. Provide a customer name for each - they&apos;ll be saved to the master so future imports auto-fill.
          </p>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', border: `1px solid ${theme.cardBorder}`, borderRadius: '10px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: theme.textDim, fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', background: theme.tableBg, position: 'sticky', top: 0 }}>Profile</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: theme.textDim, fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', background: theme.tableBg, position: 'sticky', top: 0 }}>From Die</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: theme.textDim, fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', background: theme.tableBg, position: 'sticky', top: 0 }}>Customer Name</th>
              </tr>
            </thead>
            <tbody>
              {prompt.profiles.map(({ profile, dieNo }) => (
                <tr key={profile}>
                  <td style={{ padding: '8px 12px', borderTop: `1px solid ${theme.cardBorder}`, color: theme.text, fontWeight: 600 }}>{profile}</td>
                  <td style={{ padding: '8px 12px', borderTop: `1px solid ${theme.cardBorder}`, color: theme.textMuted }}>{dieNo || '-'}</td>
                  <td style={{ padding: '6px 12px', borderTop: `1px solid ${theme.cardBorder}` }}>
                    <input
                      type="text"
                      value={prompt.values[profile] || ''}
                      onChange={(e) => setPrompt(prev => prev ? { ...prev, values: { ...prev.values, [profile]: e.target.value } } : prev)}
                      placeholder="Enter customer name"
                      style={{ width: '100%', padding: '6px 10px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '6px', color: theme.text, fontSize: '0.85rem' }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '1rem' }}>
          <button
            onClick={() => prompt.onCancel?.()}
            style={{ padding: '8px 18px', background: 'transparent', color: theme.text, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem' }}
          >
            Cancel Import
          </button>
          <button
            onClick={() => prompt.onResolve?.(prompt.values)}
            style={{ padding: '8px 18px', background: BRAND.navy, color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
          >
            Save &amp; Continue
          </button>
        </div>
      </div>
    </div>
  );
}
