import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { supplierPerformanceAPI, plantsAPI } from '../../api';
import { MONTHS } from '../../utils/constants';
import { dialogs } from '../../components/ui/DialogProvider';
import { BRAND } from '../../utils/brand';
import { COUNT_FIELDS, calculatedFor, supplierKey, formatDieLife, rowErrors } from '../../utils/dieLifeCalc';

// Manual monthly die life entry, per plant. Nothing in this system records
// tonnage, so these counts per supplier and plant are typed in once a month.
//
// Die life, failure % and the three trial ratios are never typed: they are
// calculated here (src/utils/dieLifeCalc.js, a mirror of the server module)
// so the person entering counts sees the numbers the supplier will be judged
// on while they can still correct the counts.
//
// "All plants" shows the summed counts read-only. Rows typed before figures
// were split by plant are listed apart as "Plant not set" and never counted.
const ALL = 'all';
const FIELD_LABELS = {
  tonnageMt: 'tonnage (MT)',
  diesScrapped: 'dies scrapped',
  diesInService: 'dies run',
  diesFailed: 'dies unloaded',
  newDiesReceived: 'new dies received',
  newDieTrials: 'new die trials',
  backupDiesReceived: 'backup dies received',
  backupDieTrials: 'backup die trials',
};
const GROUPS = [
  { title: 'Die life', span: 3 },
  { title: 'Failure', span: 3 },
  { title: 'New dies', span: 3 },
  { title: 'Backup dies', span: 3 },
];
const COLUMNS = [
  { input: 'tonnageMt', head: 'Tonnage (MT)' },
  { input: 'diesScrapped', head: 'Dies scrapped' },
  { calc: 'life', head: 'Die life (MT)' },
  { input: 'diesInService', head: 'Dies run' },
  { input: 'diesFailed', head: 'Dies unloaded' },
  { calc: 'failure', head: 'Failure %' },
  { input: 'newDiesReceived', head: 'New dies received' },
  { input: 'newDieTrials', head: 'New die trials' },
  { calc: 'newRatio', head: 'New trial ratio' },
  { input: 'backupDiesReceived', head: 'Backup dies received' },
  { input: 'backupDieTrials', head: 'Backup die trials' },
  { calc: 'backupRatio', head: 'Backup trial ratio' },
];

const blankCounts = () => Object.fromEntries(COUNT_FIELDS.map((f) => [f, null]));
const countsOf = (r) => {
  const out = blankCounts();
  if (r) for (const f of COUNT_FIELDS) out[f] = r[f] == null ? null : Number(r[f]);
  return out;
};
const sameCounts = (a, b) => {
  const x = countsOf(a);
  const y = countsOf(b);
  return COUNT_FIELDS.every((f) => x[f] === y[f]);
};
const two = (v) => (v == null ? null : Number(v).toFixed(2));
// `calculated` is the server's own result for the row. It is what All plants
// shows, because it is worked out per plant before the counts are summed.
const withStamp = (r) => ({ ...countsOf(r), calculated: r.calculated, updatedBy: r.updatedBy, updatedAt: r.updatedAt });
const indexRows = (list) => {
  const next = {};
  for (const r of list || []) next[supplierKey(r.supplier)] = withStamp(r);
  return next;
};

export default function DieLifeTab({ theme, isAdmin, onSaved }) {
  const thisYear = new Date().getFullYear();
  const [plants, setPlants] = useState(null); // null = still loading
  const [plant, setPlant] = useState('');
  const [year, setYear] = useState(thisYear);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [suppliers, setSuppliers] = useState([]);
  const [rows, setRows] = useState({});
  const [saved, setSaved] = useState({});
  const [legacy, setLegacy] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [plantsFailed, setPlantsFailed] = useState(false);
  const requestId = useRef(0);

  const readOnly = plant === ALL;

  useEffect(() => {
    let cancelled = false;
    supplierPerformanceAPI.getSuppliers()
      .then((list) => { if (!cancelled) setSuppliers(list || []); })
      .catch(() => { if (!cancelled) setError('Could not load the supplier list.'); });
    plantsAPI.getAll()
      .then((list) => {
        if (cancelled) return;
        const names = (list || []).map((p) => p.name).filter(Boolean);
        setPlants(names);
        setPlant((cur) => cur || names[0] || '');
      })
      .catch(() => { if (!cancelled) { setPlants([]); setPlantsFailed(true); setError('Could not load the plant list.'); } });
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    if (!plant) return;
    const mine = ++requestId.current;
    setLoading(true); setError(''); setLoadFailed(false);
    // Nothing from the previous selection may stay on screen or be saved
    // against the new one, whether or not this load succeeds.
    setRows({}); setSaved({}); setLegacy([]);
    try {
      const data = await supplierPerformanceAPI.getDieLife({ year, month, plant });
      if (mine !== requestId.current) return;
      const next = indexRows(data && data.rows);
      setRows(next);
      setSaved(next);
      setLegacy((data && data.legacy) || []);
    } catch (e) {
      if (mine !== requestId.current) return;
      setError(e.message || 'Could not load die life data.'); setLoadFailed(true);
    } finally {
      if (mine === requestId.current) setLoading(false);
    }
  }, [plant, year, month]);

  useEffect(() => { load(); }, [load]);

  // '' is how an empty box is stored: null, "not recorded". A typed 0 stays 0.
  const edit = (supplier, field, raw) => {
    const key = supplierKey(supplier);
    setRows((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), [field]: raw === '' ? null : Number(raw) },
    }));
  };

  const changedSuppliers = useMemo(
    () => suppliers.filter((s) => !sameCounts(rows[supplierKey(s)], saved[supplierKey(s)])),
    [suppliers, rows, saved],
  );
  const dirty = !readOnly && changedSuppliers.length > 0;
  const errorsBySupplier = useMemo(() => {
    const out = {};
    for (const s of suppliers) {
      const e = rowErrors(countsOf(rows[supplierKey(s)]));
      if (Object.keys(e).length) out[s] = e;
    }
    return out;
  }, [suppliers, rows]);
  const hasErrors = Object.keys(errorsBySupplier).length > 0;

  // Switching plant, year or month reloads the grid, which would throw away
  // typed figures. Ask first.
  const guarded = (apply) => async (e) => {
    const value = e.target.value;
    if (dirty) {
      const ok = await dialogs.confirm({
        title: 'Discard unsaved figures',
        message: 'You have figures that are not saved. Switching will discard them.',
        confirmLabel: 'Discard',
      });
      if (!ok) return;
    }
    apply(value);
  };

  const save = async () => {
    if (hasErrors) return;
    // A save outlives a plant switch only if the response is ignored for the
    // grid: the figures belong to the plant that was saved, not the one shown.
    const mine = ++requestId.current;
    setSaving(true);
    try {
      // Only suppliers that changed. A supplier whose boxes were all cleared is
      // sent with every count null, which the server reads as "remove the row".
      const entries = changedSuppliers.map((s) => ({ supplier: s, ...countsOf(rows[supplierKey(s)]) }));
      const data = await supplierPerformanceAPI.saveDieLife({ year, month, plant, entries });
      if (mine === requestId.current) {
        const next = indexRows(data && data.rows);
        setRows(next); setSaved(next);
        if (data && data.legacy) setLegacy(data.legacy);
      }
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

  const removeLegacy = async (r) => {
    const ok = await dialogs.confirm({
      title: 'Delete figures with no plant',
      message: `The ${MONTHS[month - 1]} ${year} figures typed for ${r.supplier} before plants existed will be permanently removed. This cannot be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await supplierPerformanceAPI.deleteLegacyDieLife(r.id);
      setLegacy((list) => list.filter((x) => x.id !== r.id));
      dialogs.notify('Figures deleted.', 'success');
    } catch (e) {
      dialogs.notify('Failed to delete: ' + e.message, 'error');
    }
  };

  const years = Array.from({ length: 6 }, (_, i) => thisYear - 4 + i);
  const select = { padding: '8px 12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, color: theme.text, fontSize: '0.85rem', cursor: 'pointer' };
  const label = { fontSize: 9.5, fontWeight: 600, color: theme.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 };
  const cell = { padding: '8px 8px', fontSize: '0.8rem', color: theme.text, verticalAlign: 'top' };
  const input = { width: 72, padding: '5px 8px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 4, color: theme.text, fontSize: '0.78rem' };
  const groupHead = { ...cell, textAlign: 'center', color: theme.textDim, fontWeight: 700, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderLeft: `1px solid ${theme.cardBorder}` };

  const calcCell = (kind, res) => {
    let text = null;
    if (kind === 'life') text = formatDieLife(res);
    else if (kind === 'failure') text = res.dieFailure == null ? null : `${res.dieFailure.toFixed(1)}%`;
    else if (kind === 'newRatio') text = two(res.newTrialRatio);
    else text = two(res.backupTrialRatio);
    if (text == null) text = 'not recorded';
    const dim = text === 'not recorded' || text === 'no dies scrapped';
    return (
      <span style={{ fontVariantNumeric: 'tabular-nums', color: dim ? theme.textDim : theme.text, fontSize: dim ? '0.72rem' : undefined, whiteSpace: 'nowrap' }}>
        {text}
      </span>
    );
  };

  const noPlants = plants !== null && plants.length === 0 && !plantsFailed;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1.25rem' }}>
        <div>
          <label style={label} htmlFor="dl-plant">Plant</label>
          <select id="dl-plant" value={plant} disabled={!plants || noPlants || saving} onChange={guarded(setPlant)} style={select}>
            {(plants || []).map((p) => <option key={p} value={p}>{p}</option>)}
            {plants && plants.length > 0 && <option value={ALL}>All plants</option>}
          </select>
        </div>
        <div>
          <label style={label} htmlFor="dl-year">Year</label>
          <select id="dl-year" disabled={saving} value={year} onChange={guarded((v) => setYear(Number(v)))} style={select}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label style={label} htmlFor="dl-month">Month</label>
          <select id="dl-month" disabled={saving} value={month} onChange={guarded((v) => setMonth(Number(v)))} style={select}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        {!readOnly && (
          <button onClick={save} disabled={saving || !dirty || hasErrors || !plant}
            style={{ marginLeft: 'auto', padding: '9px 16px', background: dirty && !hasErrors ? BRAND.navy : theme.cardBorder, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: dirty && !hasErrors && !saving ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 7 }}>
            <Save size={15} /> {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>

      {noPlants ? (
        <div style={{ padding: 24, textAlign: 'center', color: theme.textDim, fontSize: '0.85rem' }}>
          Add a plant in Settings to enter die life figures
        </div>
      ) : (
        <>
          <p style={{ fontSize: 12, color: theme.textDim, marginTop: 0, marginBottom: '1rem', lineHeight: 1.6, maxWidth: 720 }}>
            {readOnly
              ? 'Combined figures for all plants. Choose a plant to enter or change figures.'
              : 'Leave a box empty where you have no figure. An empty box means not recorded and is left out of the supplier’s rating. It is not read as zero. Die life, failure % and the trial ratios are worked out from the counts and cannot be typed.'}
          </p>

          {error && <div style={{ padding: 16, borderRadius: 10, border: '1px solid #EF4444', color: '#EF4444', fontSize: '0.85rem', marginBottom: '1.25rem' }}>{error}</div>}
          {loading && <div style={{ color: theme.textDim, fontSize: '0.85rem' }}>Loading…</div>}

          {!loading && !loadFailed && plant && (
            <div style={{ background: theme.cardBg, borderRadius: 12, border: `1px solid ${theme.cardBorder}`, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th rowSpan={2} scope="col" style={{ ...cell, textAlign: 'left', color: theme.textDim, fontWeight: 600, verticalAlign: 'bottom' }}>Supplier</th>
                    {GROUPS.map((g) => <th key={g.title} colSpan={g.span} scope="colgroup" style={groupHead}>{g.title}</th>)}
                    {!readOnly && <th rowSpan={2} scope="col" style={{ ...cell, textAlign: 'left', color: theme.textDim, fontWeight: 600, whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>Last updated</th>}
                  </tr>
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c.head} scope="col" style={{ ...cell, textAlign: 'left', color: theme.textDim, fontWeight: 600, fontSize: '0.72rem', maxWidth: 84 }}>{c.head}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => {
                    const row = rows[supplierKey(s)];
                    const counts = countsOf(row);
                    const res = calculatedFor({ readOnly, row, counts });
                    const errs = errorsBySupplier[s] || {};
                    const r = row || {};
                    return (
                      <tr key={s} style={{ borderTop: `1px solid ${theme.cardBorder}` }}>
                        <td style={{ ...cell, whiteSpace: 'nowrap', fontWeight: 600 }}>{s}</td>
                        {COLUMNS.map((c) => (
                          <td key={c.input || c.calc} style={cell}>
                            {c.calc ? calcCell(c.calc, res) : readOnly ? (
                              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{counts[c.input] == null ? '' : counts[c.input]}</span>
                            ) : (
                              <>
                                <input type="number" step={c.input === 'tonnageMt' ? 'any' : '1'} min="0"
                                  aria-label={`${s} ${FIELD_LABELS[c.input]}`}
                                  aria-invalid={errs[c.input] ? true : undefined}
                                  value={counts[c.input] == null ? '' : counts[c.input]}
                                  onChange={(e) => edit(s, c.input, e.target.value)}
                                  style={{ ...input, ...(errs[c.input] ? { borderColor: '#EF4444' } : null) }} />
                                {errs[c.input] && (
                                  <div role="alert" style={{ color: '#EF4444', fontSize: 10.5, marginTop: 3, maxWidth: 110, lineHeight: 1.35 }}>{errs[c.input]}</div>
                                )}
                              </>
                            )}
                          </td>
                        ))}
                        {!readOnly && (
                          <td style={{ ...cell, color: theme.textDim, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                            {r.updatedBy && r.updatedAt ? `${r.updatedBy} · ${new Date(r.updatedAt).toLocaleDateString()}` : '—'}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {suppliers.length === 0 && (
                    <tr><td colSpan={COLUMNS.length + 2} style={{ padding: 24, textAlign: 'center', color: theme.textDim }}>No suppliers found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !loadFailed && legacy.length > 0 && (
            <div style={{ marginTop: '1.5rem', background: theme.cardBg, borderRadius: 12, border: `1px solid ${theme.cardBorder}`, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>Plant not set</div>
              <div style={{ fontSize: 12, color: theme.textDim, margin: '2px 0 10px' }}>
                Entered before figures were split by plant. Not used in any calculation.
              </div>
              <table style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Supplier', 'Avg die life (MT)', 'Dies run', 'Dies unloaded', 'Dies scrapped'].map((h) => (
                      <th key={h} scope="col" style={{ ...cell, textAlign: 'left', color: theme.textDim, fontWeight: 600, fontSize: '0.72rem' }}>{h}</th>
                    ))}
                    {isAdmin && <th scope="col" style={cell}><span style={{ position: 'absolute', left: -9999 }}>Delete</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {legacy.map((r) => (
                    <tr key={r.id} style={{ borderTop: `1px solid ${theme.cardBorder}` }}>
                      <td style={{ ...cell, fontWeight: 600 }}>{r.supplier}</td>
                      {[r.avgDieLifeMt, r.diesInService, r.diesFailed, r.diesScrapped].map((v, i) => (
                        <td key={i} style={{ ...cell, fontVariantNumeric: 'tabular-nums' }}>{v == null ? '—' : v}</td>
                      ))}
                      {isAdmin && (
                        <td style={cell}>
                          <button type="button" onClick={() => removeLegacy(r)} aria-label={`Delete figures with no plant for ${r.supplier}`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: 'transparent', border: `1px solid ${theme.cardBorder}`, borderRadius: 4, color: '#EF4444', fontSize: 11, cursor: 'pointer' }}>
                            <Trash2 size={11} /> Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
