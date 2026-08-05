import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Save } from 'lucide-react';
import { supplierPerformanceAPI } from '../../api';
import { MONTHS } from '../../utils/constants';
import { dialogs } from '../../components/ui/DialogProvider';
import { BRAND } from '../../utils/brand';

// Manual monthly die life entry. Nothing in this system records tonnage, so
// these three numbers per supplier are typed in once a month.
//
// The failure percentage is shown but never typed: it is derived here exactly
// as the server derives it, so the person entering counts can see the number
// the supplier will be judged on while they can still correct the counts.
export default function DieLifeTab({ theme }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [suppliers, setSuppliers] = useState([]);
  const [rows, setRows] = useState({});
  const [saved, setSaved] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    supplierPerformanceAPI.getSuppliers()
      .then((list) => { if (!cancelled) setSuppliers(list || []); })
      .catch(() => { if (!cancelled) setError('Could not load the supplier list.'); });
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await supplierPerformanceAPI.getDieLife({ year, month });
      const next = {};
      for (const r of data || []) next[r.supplier] = r;
      setRows(next);
      setSaved(next);
    } catch (e) {
      setError(e.message || 'Could not load die life data.');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  // '' is how an empty box reaches the server, where it becomes NULL. A typed
  // 0 stays 0. The two must never collapse into one another.
  const edit = (supplier, field, raw) => {
    setRows((prev) => ({ ...prev, [supplier]: { ...(prev[supplier] || { supplier }), [field]: raw === '' ? null : Number(raw) } }));
  };

  const failureOf = (r) => {
    if (!r) return null;
    const svc = r.diesInService;
    const bad = r.diesFailed;
    if (svc == null || svc <= 0 || bad == null) return null;
    return (bad / svc) * 100;
  };

  const dirty = useMemo(() => JSON.stringify(rows) !== JSON.stringify(saved), [rows, saved]);

  const save = async () => {
    setSaving(true);
    try {
      // Only send rows with something in them. An untouched supplier should not
      // get a row of nulls written against its name.
      const entries = suppliers
        .map((s) => rows[s])
        .filter((r) => r && (r.avgDieLifeMt != null || r.diesInService != null || r.diesFailed != null))
        .map((r) => ({ supplier: r.supplier, avgDieLifeMt: r.avgDieLifeMt, diesInService: r.diesInService, diesFailed: r.diesFailed }));
      const data = await supplierPerformanceAPI.saveDieLife({ year, month, entries });
      const next = {};
      for (const r of data || []) next[r.supplier] = r;
      setRows(next); setSaved(next);
      dialogs.notify('Die life data saved.', 'success');
    } catch (e) {
      dialogs.notify('Failed to save: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const years = Array.from({ length: 6 }, (_, i) => thisYear - 4 + i);
  const select = { padding: '8px 12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, color: theme.text, fontSize: '0.85rem', cursor: 'pointer' };
  const label = { fontSize: 9.5, fontWeight: 600, color: theme.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 };
  const cell = { padding: '8px 10px', fontSize: '0.8rem', color: theme.text };
  const input = { width: 90, padding: '5px 8px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 4, color: theme.text, fontSize: '0.78rem' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1.25rem' }}>
        <div>
          <label style={label} htmlFor="dl-year">Year</label>
          <select id="dl-year" value={year} onChange={(e) => setYear(Number(e.target.value))} style={select}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label style={label} htmlFor="dl-month">Month</label>
          <select id="dl-month" value={month} onChange={(e) => setMonth(Number(e.target.value))} style={select}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <button onClick={save} disabled={saving || !dirty}
          style={{ marginLeft: 'auto', padding: '9px 16px', background: dirty ? BRAND.navy : theme.cardBorder, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: dirty && !saving ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Save size={15} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <p style={{ fontSize: 12, color: theme.textDim, marginTop: 0, marginBottom: '1rem', lineHeight: 1.6, maxWidth: 720 }}>
        Leave a box empty where you have no figure. An empty box means <em>not recorded</em> and is
        left out of the supplier&rsquo;s rating — it is not read as zero. Failure&nbsp;% is worked out
        from the counts and cannot be typed.
      </p>

      {error && <div style={{ padding: 16, borderRadius: 10, border: '1px solid #EF4444', color: '#EF4444', fontSize: '0.85rem', marginBottom: '1.25rem' }}>{error}</div>}
      {loading && <div style={{ color: theme.textDim, fontSize: '0.85rem' }}>Loading…</div>}

      {!loading && (
        <div style={{ background: theme.cardBg, borderRadius: 12, border: `1px solid ${theme.cardBorder}`, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Supplier', 'Avg Die Life (MT)', 'Dies In Service', 'Dies Failed', 'Failure %', 'Last updated'].map((h) => (
                  <th key={h} scope="col" style={{ ...cell, textAlign: 'left', color: theme.textDim, whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => {
                const r = rows[s] || {};
                const pct = failureOf(r);
                return (
                  <tr key={s} style={{ borderTop: `1px solid ${theme.cardBorder}` }}>
                    <td style={{ ...cell, whiteSpace: 'nowrap', fontWeight: 600 }}>{s}</td>
                    {['avgDieLifeMt', 'diesInService', 'diesFailed'].map((f) => (
                      <td key={f} style={cell}>
                        <input type="number" step="any" min="0" aria-label={`${s} ${f}`}
                          value={r[f] == null ? '' : r[f]}
                          onChange={(e) => edit(s, f, e.target.value)} style={input} />
                      </td>
                    ))}
                    <td style={{ ...cell, fontVariantNumeric: 'tabular-nums', color: pct == null ? theme.textDim : theme.text }}>
                      {pct == null ? '—' : `${pct.toFixed(1)}%`}
                    </td>
                    <td style={{ ...cell, color: theme.textDim, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                      {r.updatedBy ? `${r.updatedBy} · ${new Date(r.updatedAt).toLocaleDateString()}` : '—'}
                    </td>
                  </tr>
                );
              })}
              {suppliers.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: theme.textDim }}>No suppliers found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
