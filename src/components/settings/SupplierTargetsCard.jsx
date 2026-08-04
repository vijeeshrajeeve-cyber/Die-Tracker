import React, { useState, useEffect } from 'react';
import { Target } from 'lucide-react';
import { supplierPerformanceAPI } from '../../api';
import { dialogs } from '../ui/DialogProvider';
import { BRAND } from '../../utils/brand';

// Scoring targets for the supplier scorecard. Editable because the right
// threshold is a business judgement, not something the data dictates — the
// seeds are only a starting point taken from observed performance.
export default function SupplierTargetsCard({ theme, isAdmin }) {
  const [metrics, setMetrics] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supplierPerformanceAPI.getSettings()
      .then((rows) => { if (!cancelled) setMetrics(rows || []); })
      .catch(() => { if (!cancelled) setMetrics([]); });
    return () => { cancelled = true; };
  }, []);

  const scored = metrics.filter((m) => m.scored);
  const weightTotal = scored.reduce((a, m) => a + Number(m.weight || 0), 0);
  const weightOk = Math.round(weightTotal * 1000) / 1000 === 1;

  const edit = (key, field, raw) => {
    const v = raw === '' ? '' : Number(raw);
    setMetrics((prev) => prev.map((m) => (m.key === key ? { ...m, [field]: v } : m)));
  };

  const save = async () => {
    setSaving(true);
    try {
      setMetrics(await supplierPerformanceAPI.saveSettings(metrics));
      dialogs.notify('Scoring targets saved.', 'success');
    } catch (e) {
      dialogs.notify('Failed to save: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const cell = { padding: '8px 10px', fontSize: '0.8rem', color: theme.text };
  const input = { width: 72, padding: '4px 8px', background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 4, color: theme.text, fontSize: '0.75rem' };

  return (
    <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}` }}>
      <div style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: theme.text, margin: 0 }}>
          <Target size={20} /> Supplier Scoring Targets
        </h3>
        <p style={{ fontSize: '0.8rem', color: theme.textDim, marginTop: '4px', marginBottom: 0 }}>
          Drives the rating on the Analytics &rarr; Supplier Report tab. &ldquo;10 at&rdquo; scores full marks, &ldquo;0 at&rdquo; scores nothing; weights must total 100%.
        </p>
      </div>

      <div style={{ background: theme.inputBg, borderRadius: '12px', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Metric', 'Target', '10 at', '0 at', 'Weight %'].map((h) => (
                <th key={h} scope="col" style={{ ...cell, textAlign: 'left', color: theme.textDim, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scored.map((m) => (
              <tr key={m.key} style={{ borderTop: `1px solid ${theme.cardBorder}` }}>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>{m.label} <span style={{ color: theme.textDim }}>{m.unit && `(${m.unit})`}</span></td>
                {['target', 'ten', 'zero'].map((f) => (
                  <td key={f} style={cell}>
                    <input type="number" step="any" aria-label={`${m.label} ${f}`} value={m[f]} disabled={!isAdmin}
                      onChange={(e) => edit(m.key, f, e.target.value)} style={input} />
                  </td>
                ))}
                <td style={cell}>
                  <input type="number" step="1" aria-label={`${m.label} weight`} value={Math.round(m.weight * 100)} disabled={!isAdmin}
                    onChange={(e) => edit(m.key, 'weight', Number(e.target.value) / 100)} style={input} />
                </td>
              </tr>
            ))}
            {scored.length === 0 && (
              <tr><td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: theme.textDim }}>Scoring settings unavailable</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: '1rem' }}>
          <button onClick={save} disabled={saving || !weightOk}
            style={{ padding: '8px 18px', background: weightOk ? BRAND.navy : theme.cardBorder, color: 'white', border: 'none', borderRadius: 8, cursor: weightOk && !saving ? 'pointer' : 'not-allowed', fontSize: '0.85rem' }}>
            Save targets
          </button>
          <span style={{ fontSize: '0.78rem', color: weightOk ? theme.textDim : '#EF4444' }}>
            Weights total {Math.round(weightTotal * 100)}%{weightOk ? '' : ' — must be 100% to save'}
          </span>
        </div>
      )}
    </div>
  );
}
