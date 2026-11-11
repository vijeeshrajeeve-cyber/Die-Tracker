import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Save, Pencil } from 'lucide-react';
import { supplierPerformanceAPI } from '../../api';
import { MONTHS } from '../../utils/constants';
import { dialogs } from '../../components/ui/DialogProvider';
import { BRAND } from '../../utils/brand';

// Manual monthly die life entry. Nothing in this system records tonnage, so
// these numbers per supplier are typed in once a month.
//
// The failure percentage is shown but never typed: it is derived here exactly
// as the server derives it, so the person entering counts can see the number
// the supplier will be judged on while they can still correct the counts.
//
// Trial Ratio is the other exception: it is calculated from the orders and
// only shown here. An admin can correct a month's figure, with a reason, when
// the calculated one is known to be wrong. That saves on its own, straight
// away -- it is not part of the grid's Save.
const FIELDS = ['avgDieLifeMt', 'diesInService', 'diesFailed', 'diesScrapped'];
const FIELD_NAMES = {
  avgDieLifeMt: 'average die life',
  diesInService: 'dies extruded',
  diesFailed: 'dies failed',
  diesScrapped: 'dies scrapped',
};
const HEADERS = ['Supplier', 'Avg Die Life (MT)', 'Dies Extruded', 'Dies Failed', 'Dies Scrapped', 'Failure %', 'Trial Ratio', 'Last updated'];
const keyOf = (s) => String(s || '').trim().toUpperCase();
const indexRatios = (list) => {
  const next = {};
  for (const r of list || []) next[r.supplierKey] = r;
  return next;
};

export default function DieLifeTab({ theme, isAdmin, onSaved }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [suppliers, setSuppliers] = useState([]);
  const [rows, setRows] = useState({});
  const [saved, setSaved] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ratios, setRatios] = useState({});
  // The correction being edited: { supplier, value, reason }, or null.
  const [fixing, setFixing] = useState(null);
  const [fixSaving, setFixSaving] = useState(false);

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
      // Separate from the grid on purpose: a failure here must not hide the
      // figures somebody came to type.
      try {
        setRatios(indexRatios(await supplierPerformanceAPI.getTrialRatios({ year, month })));
      } catch { setRatios({}); }
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
        .filter((r) => r && FIELDS.some((f) => r[f] != null))
        .map((r) => ({
          supplier: r.supplier, avgDieLifeMt: r.avgDieLifeMt, diesInService: r.diesInService,
          diesFailed: r.diesFailed, diesScrapped: r.diesScrapped,
        }));
      const data = await supplierPerformanceAPI.saveDieLife({ year, month, entries });
      const next = {};
      for (const r of data || []) next[r.supplier] = r;
      setRows(next); setSaved(next);
      // Tells the Supplier Report tab its report is out of date. It stays
      // mounted while hidden, so it would otherwise keep the figures it
      // fetched on page load.
      if (onSaved) onSaved();
      dialogs.notify('Die life data saved.', 'success');
    } catch (e) {
      dialogs.notify('Failed to save: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // remove = go back to the calculated figure. Both need a reason.
  const saveFix = async (remove) => {
    if (!fixing) return;
    const reason = fixing.reason.trim();
    if (!reason) { dialogs.notify('Give a reason for the change.', 'error'); return; }
    if (!remove && (fixing.value === '' || !Number.isFinite(Number(fixing.value)) || Number(fixing.value) < 0)) {
      dialogs.notify('Enter the corrected trial ratio.', 'error');
      return;
    }
    setFixSaving(true);
    try {
      const list = await supplierPerformanceAPI.saveTrialRatioCorrection({
        supplier: fixing.supplier, year, month, value: remove ? null : Number(fixing.value), reason,
      });
      setRatios(indexRatios(list));
      setFixing(null);
      // The trial ratio is scored, so the Supplier Report is now out of date.
      if (onSaved) onSaved();
      dialogs.notify(remove ? 'Correction removed.' : 'Trial ratio corrected.', 'success');
    } catch (e) {
      dialogs.notify('Failed to save: ' + e.message, 'error');
    } finally {
      setFixSaving(false);
    }
  };

  const years = Array.from({ length: 6 }, (_, i) => thisYear - 4 + i);
  const select = { padding: '8px 12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, color: theme.text, fontSize: '0.85rem', cursor: 'pointer' };
  const label = { fontSize: 9.5, fontWeight: 600, color: theme.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 };
  const cell = { padding: '8px 10px', fontSize: '0.8rem', color: theme.text };
  const input = { width: 90, padding: '5px 8px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 4, color: theme.text, fontSize: '0.78rem' };
  const field = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 6, color: theme.text, fontSize: 13, fontFamily: 'inherit' };
  const ghost = { padding: '8px 14px', background: 'transparent', border: `1px solid ${theme.cardBorder}`, borderRadius: 8, color: theme.text, fontWeight: 600, fontSize: 13, cursor: 'pointer' };
  const fixingRatio = fixing ? (ratios[keyOf(fixing.supplier)] || {}) : {};
  const two = (v) => (v == null ? '—' : Number(v).toFixed(2));

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
        from the counts and cannot be typed. Trial Ratio is worked out from the orders placed in the
        month; {isAdmin ? 'use Change to correct a figure that is wrong.' : 'an admin can correct a figure that is wrong.'}
      </p>

      {error && <div style={{ padding: 16, borderRadius: 10, border: '1px solid #EF4444', color: '#EF4444', fontSize: '0.85rem', marginBottom: '1.25rem' }}>{error}</div>}
      {loading && <div style={{ color: theme.textDim, fontSize: '0.85rem' }}>Loading…</div>}

      {!loading && (
        <div style={{ background: theme.cardBg, borderRadius: 12, border: `1px solid ${theme.cardBorder}`, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {HEADERS.map((h) => (
                  <th key={h} scope="col" style={{ ...cell, textAlign: 'left', color: theme.textDim, whiteSpace: 'nowrap', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => {
                const r = rows[s] || {};
                const pct = failureOf(r);
                const tr = ratios[keyOf(s)] || {};
                const corrected = tr.corrected != null;
                const ratio = corrected ? tr.corrected : tr.calculated;
                return (
                  <tr key={s} style={{ borderTop: `1px solid ${theme.cardBorder}` }}>
                    <td style={{ ...cell, whiteSpace: 'nowrap', fontWeight: 600 }}>{s}</td>
                    {FIELDS.map((f) => (
                      <td key={f} style={cell}>
                        <input type="number" step="any" min="0" aria-label={`${s} ${FIELD_NAMES[f]}`}
                          value={r[f] == null ? '' : r[f]}
                          onChange={(e) => edit(s, f, e.target.value)} style={input} />
                      </td>
                    ))}
                    <td style={{ ...cell, fontVariantNumeric: 'tabular-nums', color: pct == null ? theme.textDim : theme.text }}>
                      {pct == null ? '—' : `${pct.toFixed(1)}%`}
                    </td>
                    <td style={cell}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                        <span style={{ fontVariantNumeric: 'tabular-nums', color: ratio == null ? theme.textDim : theme.text }}>
                          {two(ratio)}
                        </span>
                        {corrected && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: 'rgba(245,158,11,0.15)', color: '#D97706' }}>
                            Corrected
                          </span>
                        )}
                        {isAdmin && (
                          <button type="button" aria-label={`Change trial ratio for ${s}`}
                            onClick={() => setFixing({ supplier: s, value: ratio == null ? '' : String(Number(Number(ratio).toFixed(2))), reason: '' })}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: 'transparent', border: `1px solid ${theme.cardBorder}`, borderRadius: 4, color: theme.textDim, fontSize: 11, cursor: 'pointer' }}>
                            <Pencil size={11} /> Change
                          </button>
                        )}
                      </div>
                      {corrected && (
                        <div style={{ fontSize: 10.5, color: theme.textDim, marginTop: 3, maxWidth: 260, lineHeight: 1.4 }}>
                          Calculated {two(tr.calculated)} · {tr.reason}
                          {tr.correctedBy ? ` · ${tr.correctedBy}` : ''}
                          {tr.correctedAt ? ` · ${new Date(tr.correctedAt).toLocaleDateString()}` : ''}
                        </div>
                      )}
                    </td>
                    <td style={{ ...cell, color: theme.textDim, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                      {r.updatedBy ? `${r.updatedBy} · ${new Date(r.updatedAt).toLocaleDateString()}` : '—'}
                    </td>
                  </tr>
                );
              })}
              {suppliers.length === 0 && (
                <tr><td colSpan={HEADERS.length} style={{ padding: 24, textAlign: 'center', color: theme.textDim }}>No suppliers found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {fixing && (
        <div onMouseDown={(e) => { if (e.target === e.currentTarget && !fixSaving) setFixing(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div role="dialog" aria-modal="true" aria-labelledby="tr-fix-title"
            onKeyDown={(e) => { if (e.key === 'Escape' && !fixSaving) setFixing(null); }}
            style={{ width: '100%', maxWidth: 420, background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 12, padding: 20 }}>
            <div id="tr-fix-title" style={{ fontSize: 15, fontWeight: 700, color: theme.text }}>
              Correct trial ratio — {fixing.supplier}
            </div>
            <div style={{ fontSize: 12, color: theme.textDim, margin: '4px 0 16px' }}>
              {MONTHS[month - 1]} {year} · calculated from orders: {fixingRatio.calculated == null ? 'no figure' : two(fixingRatio.calculated)}
            </div>
            <label style={label} htmlFor="tr-fix-value">Corrected trial ratio</label>
            <input id="tr-fix-value" type="number" step="any" min="0" autoFocus value={fixing.value}
              onChange={(e) => setFixing((f) => ({ ...f, value: e.target.value }))} style={{ ...field, marginBottom: 12 }} />
            <label style={label} htmlFor="tr-fix-reason">Reason for the change</label>
            <textarea id="tr-fix-reason" rows={3} value={fixing.reason} maxLength={500}
              onChange={(e) => setFixing((f) => ({ ...f, reason: e.target.value }))} style={{ ...field, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              {fixingRatio.corrected != null && (
                <button type="button" disabled={fixSaving} onClick={() => saveFix(true)} style={ghost}>
                  Use calculated figure
                </button>
              )}
              <button type="button" disabled={fixSaving} onClick={() => setFixing(null)} style={{ ...ghost, marginLeft: 'auto' }}>Cancel</button>
              <button type="button" disabled={fixSaving} onClick={() => saveFix(false)}
                style={{ padding: '8px 16px', background: BRAND.navy, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: fixSaving ? 'not-allowed' : 'pointer' }}>
                {fixSaving ? 'Saving…' : 'Save correction'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
