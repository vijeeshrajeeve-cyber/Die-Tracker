import React, { useState, useEffect, useCallback } from 'react';
import { Target } from 'lucide-react';
import { supplierPerformanceAPI } from '../../api';
import { dialogs } from '../ui/DialogProvider';
import { BRAND } from '../../utils/brand';

// Scoring targets for the supplier scorecard. Editable because the right
// threshold is a business judgement, not something the data dictates — the
// seeds are only a starting point taken from observed performance.
export default function SupplierTargetsCard({ theme, isAdmin }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [metrics, setMetrics] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback((y) => {
    supplierPerformanceAPI.getSettings(y)
      .then((rows) => setMetrics(rows || []))
      .catch(() => setMetrics([]));
  }, []);

  useEffect(() => { load(year); }, [load, year]);

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
      setMetrics(await supplierPerformanceAPI.saveSettings(year, metrics));
      dialogs.notify(`Scoring targets saved for ${year}.`, 'success');
    } catch (e) {
      dialogs.notify('Failed to save: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Copying is a read of the previous year's resolved settings — which already
  // falls back to the nearest earlier year — into this year's unsaved form.
  const copyPrevious = async () => {
    try {
      setMetrics(await supplierPerformanceAPI.getSettings(year - 1));
      dialogs.notify(`Loaded ${year - 1} targets. Review them, then save to apply to ${year}.`, 'info');
    } catch (e) {
      dialogs.notify('Could not load the previous year: ' + e.message, 'error');
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
        <p style={{ fontSize: '0.8rem', color: theme.textDim, marginTop: '4px', marginBottom: '0.75rem' }}>
          Drives the rating on the Analytics &rarr; Supplier Report tab. &ldquo;10 at&rdquo; scores full marks,
          &ldquo;0 at&rdquo; scores nothing; weights must total 100%. Targets are held per year, so a report
          already sent to a supplier keeps the score it was given.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ fontSize: '0.78rem', color: theme.textDim }} htmlFor="st-year">Targets for</label>
          <select id="st-year" value={year} onChange={(e) => setYear(Number(e.target.value))}
            style={{ padding: '6px 10px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, color: theme.text, fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' }}>
            {Array.from({ length: 6 }, (_, i) => thisYear - 3 + i).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          {isAdmin && (
            <button onClick={copyPrevious} type="button"
              style={{ padding: '6px 12px', background: 'transparent', border: `1px solid ${theme.cardBorder}`, borderRadius: 8, color: theme.text, fontSize: '0.78rem', cursor: 'pointer' }}>
              Copy from {year - 1}
            </button>
          )}
        </div>
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
            Save {year} targets
          </button>
          <span style={{ fontSize: '0.78rem', color: weightOk ? theme.textDim : '#EF4444' }}>
            Weights total {Math.round(weightTotal * 100)}%{weightOk ? '' : ' — must be 100% to save'}
          </span>
        </div>
      )}
    </div>
  );
}
