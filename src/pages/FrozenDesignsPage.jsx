import React, { useEffect, useState, useCallback, useRef, useMemo, useId } from 'react';
import { Snowflake, Download, Upload, FileText, X, ChevronRight, AlertTriangle, Unlock, History, ArrowRight, Pencil, Send, ShieldAlert } from 'lucide-react';
import { frozenDesignsAPI, plantsAPI, pressesAPI } from '../api';
import { dialogs } from '../components/ui/DialogProvider';
import FreezeDesignModal from '../components/FreezeDesignModal';
import useDialog from '../hooks/useDialog';
import { BRAND } from '../utils/brand';

// A design is "Retired" once someone unfreezes it by hand, and "Superseded" when a
// newer freeze for the same Profile + Plant + Press + Cavity replaced it. (The
// database calls both "released"; the page avoids that word because orders are
// also "released" against a design, which means the opposite.)
const statusOf = (r) => r.is_active ? 'Active' : (r.release_reason === 'superseded' ? 'Superseded' : 'Retired');
const keyOf = (r) => `${r.profile_number}|${r.plant}|${r.press}|${r.cavity}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtSize = (b) => {
  const n = Number(b) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return n ? `${n} B` : '';
};
const extOf = (name) => (String(name || '').split('.').pop() || '').toUpperCase().slice(0, 4);
const mono = "'JetBrains Mono', ui-monospace, monospace";
const STATUS_TABS = ['Active', 'Retired', 'Superseded', 'All'];

function usePalette(theme) {
  const isDark = theme.isDark !== false;
  return {
    isDark,
    bg: theme.cardBg || '#131316',
    page: theme.bg || '#09090b',
    border: theme.cardBorder || '#27272a',
    text: theme.text || '#fafafa',
    muted: theme.textMuted || '#a1a1aa',
    dim: theme.textDim || '#8b8b94',
    inset: theme.inputBg || '#18181b',
    rowHover: theme.rowHover || 'rgba(255,255,255,0.06)',
    primary: theme.primary || '#1F6FB0',
    primaryText: theme.primaryText || '#fff',
    primarySoft: theme.primaryLight || 'rgba(31,111,176,0.14)',
    overlay: theme.overlayBg || 'rgba(0,0,0,0.62)',
    shadowLg: theme.shadowLg || '0 16px 40px rgba(0,0,0,0.45)',
    ok: isDark ? '#4ADE80' : '#15803D',
    okBg: isDark ? 'rgba(74,222,128,0.12)' : '#F0FDF4',
    warn: isDark ? '#FBBF24' : '#92400E',
    warnBg: isDark ? 'rgba(245,158,11,0.12)' : '#FFFBEB',
    danger: isDark ? '#FB7185' : '#B42318',
    dangerBg: isDark ? 'rgba(244,63,94,0.12)' : '#FEF3F2',
    link: isDark ? '#7DB8E8' : '#1F6FB0',
  };
}

function StatusPill({ status, c }) {
  if (status === 'Active') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 999, fontSize: 12, fontWeight: 600, color: c.ok, background: c.okBg, whiteSpace: 'nowrap' }}>
        <Snowflake size={12} aria-hidden="true" />Frozen
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 9px', borderRadius: 999, fontSize: 12, fontWeight: 600, color: c.muted, background: c.inset, border: `1px solid ${c.border}`, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
}

// search is the top-bar box, which filters whichever page is open.
export default function FrozenDesignsPage({ user, theme = {}, search = '' }) {
  const c = usePalette(theme);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [plant, setPlant] = useState('All');
  const [status, setStatus] = useState('Active');
  const [showFreeze, setShowFreeze] = useState(false);
  const [openId, setOpenId] = useState(null);
  const isAdmin = user?.role === 'admin';

  // Reloads keep the current rows on screen; only the first load shows "Loading".
  const load = useCallback(() => {
    return frozenDesignsAPI.list()
      .then((r) => { setRows(r); setLoadError(''); })
      .catch((e) => { setRows([]); setLoadError(e.message || 'Could not load frozen designs'); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Versions per match key, oldest first, so each row can say "v2 of 2".
  const versions = useMemo(() => {
    const m = new Map();
    [...rows].sort((a, b) => new Date(a.frozen_at) - new Date(b.frozen_at))
      .forEach(r => { const k = keyOf(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
    return m;
  }, [rows]);

  const plantOptions = useMemo(
    () => Array.from(new Set(rows.map(r => r.plant).filter(Boolean))).sort(),
    [rows]
  );

  const inPlant = useMemo(() => rows.filter(r => plant === 'All' || r.plant === plant), [rows, plant]);

  const matchesSearch = useCallback((r) => {
    const s = search.trim().toLowerCase();
    if (!s) return true;
    const hay = [r.profile_number, r.supplier, r.press, r.plant, r.die_size, r.notes, ...(r.files || []).map(f => f.original_name)];
    return hay.some(v => String(v || '').toLowerCase().includes(s));
  }, [search]);

  const counts = useMemo(() => {
    const out = { All: 0, Active: 0, Retired: 0, Superseded: 0 };
    inPlant.filter(matchesSearch).forEach(r => { out.All += 1; out[statusOf(r)] += 1; });
    return out;
  }, [inPlant, matchesSearch]);

  const view = useMemo(
    () => inPlant.filter(r => (status === 'All' || statusOf(r) === status) && matchesSearch(r)),
    [inPlant, status, matchesSearch]
  );

  const active = rows.filter(r => r.is_active);
  const noDrawing = active.filter(r => !(r.files || []).length).length;
  const reused = rows.reduce((a, r) => a + (Number(r.released_count) || 0), 0);
  const bypassed = rows.reduce((a, r) => a + (Number(r.bypassed_count) || 0), 0);

  const openRow = rows.find(r => r.id === openId) || null;

  const exportCsv = () => {
    const header = ['Profile', 'Plant', 'Press', 'Cavity', 'Version', 'Status', 'Supplier', 'Die Size', 'Frozen At', 'Frozen By', 'Files', 'Reused by orders', 'Bypassed by orders'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = view.map(r => {
      const vs = versions.get(keyOf(r)) || [r];
      return [
        r.profile_number, r.plant, r.press, r.cavity, `v${vs.indexOf(r) + 1}`, statusOf(r), r.supplier, r.die_size,
        fmtDate(r.frozen_at), r.frozen_by_name, (r.files || []).map(f => f.original_name).join('; '),
        r.released_count || 0, r.bypassed_count || 0,
      ].map(esc).join(',');
    });
    const csv = [header.map(esc).join(','), ...lines].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `frozen-designs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Same card recipe as the QD Tracker and Dashboard KPI tiles.
  const kpis = [
    { label: 'Frozen now', value: active.length, sub: `${rows.length - active.length} retired or superseded`, icon: Snowflake, ic: '#fff', ibg: BRAND.navy },
    { label: 'Missing a drawing', value: noDrawing, sub: noDrawing ? 'frozen with no file attached' : 'every frozen design has a file', icon: AlertTriangle, ic: '#FBBF24', ibg: 'rgba(245,158,11,0.14)' },
    { label: 'Reused by orders', value: reused, sub: 'skipped design and simulation', icon: Send, ic: '#34D399', ibg: 'rgba(16,185,129,0.14)' },
    { label: 'Bypassed by orders', value: bypassed, sub: 'went through design anyway', icon: ShieldAlert, ic: '#A78BFA', ibg: 'rgba(139,92,246,0.14)' },
  ];

  const btn = { display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 40, padding: '0 16px', borderRadius: 10, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' };

  return (
    <div className="fd-page" style={{ padding: '32px 28px', color: c.text }}>
      <style>{`
        .fd-row { transition: background-color .15s ease; }
        .fd-row:hover { background: ${c.rowHover}; }
        .fd-row:hover .fd-chev { transform: translateX(2px); color: ${c.text}; }
        .fd-chev { transition: transform .2s cubic-bezier(.16,1,.3,1), color .15s ease; }
        .fd-row:focus-visible, .fd-tab:focus-visible, .fd-btn:focus-visible { outline: 2px solid ${c.primary}; outline-offset: -2px; }
        .fd-btn:hover { filter: brightness(1.08); }
        .fd-grid { display: grid; grid-template-columns: minmax(170px, 1.3fr) minmax(120px, 1fr) 150px 170px 120px 20px; gap: 16px; align-items: center; }
        .fd-kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        @media (max-width: 1280px) { .fd-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 520px) { .fd-kpis { grid-template-columns: 1fr; } }
        @media (max-width: 900px) {
          .fd-page { padding: 20px 16px !important; }
          .fd-grid { grid-template-columns: 1fr auto; row-gap: 8px; }
          .fd-head { display: none !important; }
          .fd-c-supplier, .fd-c-date { display: none !important; }
          .fd-c-files, .fd-c-usage { grid-column: 1 / -1; }
          .fd-c-chev { grid-row: 1; grid-column: 2; }
        }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>Frozen Designs</h1>
          <p style={{ fontSize: '0.875rem', color: c.muted, margin: '6px 0 0', lineHeight: 1.5 }}>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{view.length} of {rows.length} designs</span> · locked to a profile, plant, press and cavity
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" onClick={exportCsv} className="fd-btn" style={{ ...btn, background: c.bg, border: `1px solid ${c.border}`, color: c.text }}>
            <Download size={16} aria-hidden="true" /> Export
          </button>
          <button type="button" onClick={() => setShowFreeze(true)} className="fd-btn" style={{ ...btn, background: c.primary, border: 'none', color: c.primaryText }}>
            <Snowflake size={16} aria-hidden="true" /> Freeze a design
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="fd-kpis" style={{ display: 'grid', gap: 16, marginBottom: 20 }}>
        {kpis.map(kp => (
          <div key={kp.label} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 12, boxShadow: theme.shadowSm, padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{kp.label}</span>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: kp.ibg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: kp.ic }}>
                <kp.icon size={17} />
              </div>
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: 10, lineHeight: 1 }}>{kp.value}</div>
            <div style={{ fontSize: '0.75rem', color: c.dim, marginTop: 6 }}>{kp.sub}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 12 }}>
        <div role="tablist" aria-label="Design status" style={{ display: 'inline-flex', gap: 4, padding: 4, background: c.inset, border: `1px solid ${c.border}`, borderRadius: 10, flexWrap: 'wrap' }}>
          {STATUS_TABS.map(t => {
            const on = status === t;
            return (
              <button key={t} type="button" role="tab" aria-selected={on} onClick={() => setStatus(t)} className="fd-tab"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 32, padding: '0 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: on ? 600 : 500,
                  background: on ? c.bg : 'transparent', color: on ? c.text : c.muted, boxShadow: on ? '0 1px 2px rgba(0,0,0,0.18)' : 'none' }}>
                {t === 'Active' ? 'Frozen' : t}
                <span style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums', color: on ? c.muted : c.dim }}>{counts[t]}</span>
              </button>
            );
          })}
        </div>
        <select aria-label="Filter by plant" value={plant} onChange={(e) => setPlant(e.target.value)}
          style={{ minHeight: 40, padding: '0 12px', background: c.inset, border: `1px solid ${c.border}`, borderRadius: 10, color: c.text, fontSize: '0.85rem', cursor: 'pointer', minWidth: 140 }}>
          <option value="All">All plants</option>
          {plantOptions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Registry */}
      <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: theme.shadowSm }}>
        <div className="fd-grid fd-head" style={{ padding: '10px 18px', borderBottom: `1px solid ${c.border}`, fontSize: 11, fontWeight: 600, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <span>Design</span><span>Supplier · die size</span><span>Drawing</span><span>Orders</span><span>Frozen</span><span />
        </div>

        {view.map(r => {
          const st = statusOf(r);
          const vs = versions.get(keyOf(r)) || [r];
          const vNo = vs.indexOf(r) + 1;
          const files = r.files || [];
          const nReused = Number(r.released_count) || 0;
          const nBypassed = Number(r.bypassed_count) || 0;
          return (
            <button key={r.id} type="button" className="fd-row fd-grid" onClick={() => setOpenId(r.id)}
              aria-label={`Open design ${r.profile_number}, ${r.plant}, ${r.press}, cavity ${r.cavity}`}
              style={{ width: '100%', padding: '14px 18px', border: 'none', borderBottom: `1px solid ${c.border}`, background: 'transparent', color: c.text, textAlign: 'left', cursor: 'pointer', font: 'inherit', opacity: st === 'Active' ? 1 : 0.78 }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>{r.profile_number}</span>
                  {vs.length > 1 && <span style={{ fontSize: 11, fontWeight: 600, color: c.muted, fontVariantNumeric: 'tabular-nums' }}>v{vNo}</span>}
                  {st !== 'Active' && <StatusPill status={st} c={c} />}
                </span>
                <span style={{ display: 'block', fontSize: 12.5, color: c.muted, marginTop: 3 }}>
                  {r.plant} · {r.press} · {r.cavity} cav
                </span>
              </span>
              <span className="fd-c-supplier" style={{ minWidth: 0, fontSize: 13 }}>
                <span style={{ display: 'block', color: r.supplier ? c.text : c.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.supplier || 'No supplier'}</span>
                {r.die_size && <span style={{ display: 'block', fontFamily: mono, fontSize: 12, color: c.dim, marginTop: 2 }}>{r.die_size}</span>}
              </span>
              <span className="fd-c-files" style={{ fontSize: 12.5 }}>
                {files.length > 0 ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: c.muted }}>
                    <FileText size={14} aria-hidden="true" />{files.length} {files.length === 1 ? 'file' : 'files'}
                  </span>
                ) : st === 'Active' ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px', borderRadius: 6, color: c.warn, background: c.warnBg, fontWeight: 600 }}>
                    <AlertTriangle size={13} aria-hidden="true" />No drawing
                  </span>
                ) : (
                  <span style={{ color: c.dim }}>No files</span>
                )}
              </span>
              <span className="fd-c-usage" style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                {nReused + nBypassed === 0 ? (
                  <span style={{ color: c.dim }}>Not used yet</span>
                ) : (
                  <span style={{ display: 'inline-flex', gap: 10 }}>
                    {nReused > 0 && <span style={{ color: c.ok, fontWeight: 600 }}>{nReused} reused</span>}
                    {nBypassed > 0 && <span style={{ color: c.warn, fontWeight: 600 }}>{nBypassed} bypassed</span>}
                  </span>
                )}
              </span>
              <span className="fd-c-date" style={{ fontSize: 12.5, color: c.muted, fontVariantNumeric: 'tabular-nums' }}>
                {fmtDate(r.frozen_at)}
                {r.frozen_by_name && <span style={{ display: 'block', fontSize: 12, color: c.dim, marginTop: 2 }}>{r.frozen_by_name}</span>}
              </span>
              <span className="fd-c-chev" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <ChevronRight size={16} className="fd-chev" style={{ color: c.dim }} aria-hidden="true" />
              </span>
            </button>
          );
        })}

        {!loading && !loadError && view.length === 0 && (
          <div style={{ padding: '48px 16px', textAlign: 'center' }}>
            <Snowflake size={24} style={{ color: c.dim }} aria-hidden="true" />
            <div style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: 10 }}>
              {rows.length === 0 ? 'No designs frozen yet' : `No ${status === 'All' ? '' : (status === 'Active' ? 'frozen' : status.toLowerCase()) + ' '}designs match`}
            </div>
            <div style={{ fontSize: '0.84rem', color: c.muted, marginTop: 4 }}>
              {rows.length === 0
                ? 'Freeze one from an order’s detail drawer, or use Freeze a design above.'
                : 'Try another status or plant, or clear the search box at the top.'}
            </div>
          </div>
        )}
        {loadError && (
          <div role="alert" style={{ padding: '32px 16px', textAlign: 'center', color: c.danger, fontSize: '0.875rem' }}>
            {loadError}. <button type="button" onClick={load} style={{ background: 'none', border: 'none', color: c.link, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Try again</button>
          </div>
        )}
        {loading && <div role="status" style={{ padding: '40px 16px', textAlign: 'center', color: c.dim }}>Loading frozen designs…</div>}
      </div>

      {openRow && (
        <FrozenDesignDrawer
          row={openRow}
          versions={versions.get(keyOf(openRow)) || [openRow]}
          c={c}
          isAdmin={isAdmin}
          onClose={() => setOpenId(null)}
          onSwitch={setOpenId}
          onChanged={load}
        />
      )}

      {showFreeze && (
        <FreezeDesignModal
          theme={theme}
          onClose={() => setShowFreeze(false)}
          onDone={() => load()}
        />
      )}
    </div>
  );
}

const draftOf = (r) => ({
  profile: r.profile_number || '', plant: r.plant || '', press: r.press || '', cavity: String(r.cavity ?? ''),
  supplier: r.supplier || '', dieSize: r.die_size || '', notes: r.notes || '',
});

function FrozenDesignDrawer({ row, versions, c, isAdmin, onClose, onSwitch, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftOf(row));
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [masters, setMasters] = useState({ plants: [], presses: [] });
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(draftOf(row));

  // Closing with unsaved edits asks first, whichever way the drawer is closed.
  const requestClose = async () => {
    if (dirty && !(await dialogs.confirm({ title: 'Discard your changes?', message: 'The edits to this design have not been saved.', confirmLabel: 'Discard', tone: 'warning' }))) return;
    onClose();
  };
  const dialogRef = useDialog({ open: true, onClose: requestClose, closeOnEscape: !saving });
  const titleId = useId();
  const fileInputRef = useRef(null);
  const [usage, setUsage] = useState(null);
  const [usageError, setUsageError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [unfreezing, setUnfreezing] = useState(false);

  const startEdit = () => {
    setDraft(draftOf(row));
    setEditError('');
    setEditing(true);
    if (!masters.plants.length) {
      Promise.all([plantsAPI.getAll().catch(() => []), pressesAPI.getAll().catch(() => [])])
        .then(([pl, pr]) => setMasters({ plants: (pl || []).map(p => p.name).filter(Boolean), presses: pr || [] }));
    }
  };

  const save = async () => {
    const cav = Math.round(Number(draft.cavity));
    if (!draft.profile.trim() || !draft.plant.trim() || !draft.press.trim()) { setEditError('Profile, plant and press are required.'); return; }
    if (!(cav > 0)) { setEditError('Cavity must be 1 or more.'); return; }
    setSaving(true);
    setEditError('');
    try {
      const payload = { supplier: draft.supplier, dieSize: draft.dieSize, notes: draft.notes };
      if (row.is_active) Object.assign(payload, { profile: draft.profile, plant: draft.plant, press: draft.press, cavity: cav });
      await frozenDesignsAPI.update(row.id, payload);
      await onChanged();
      setEditing(false);
      dialogs.notify('Design updated', 'success');
    } catch (err) {
      setEditError(err.message || 'Could not save the changes');
    } finally {
      setSaving(false);
    }
  };

  const st = statusOf(row);
  const vNo = versions.indexOf(row) + 1;
  const current = versions.find(v => v.is_active);
  const files = row.files || [];

  useEffect(() => {
    let live = true;
    setUsage(null);
    setUsageError('');
    frozenDesignsAPI.usage(row.id)
      .then(u => { if (live) setUsage(u); })
      .catch(e => { if (live) setUsageError(e.message || 'Could not load orders'); });
    return () => { live = false; };
  }, [row.id]);

  const upload = async (list) => {
    if (!list || !list.length) return;
    setUploading(true);
    try {
      await frozenDesignsAPI.uploadFiles(row.id, list);
      await onChanged();
      dialogs.notify(`${list.length} ${list.length === 1 ? 'file' : 'files'} added`, 'success');
    } catch (err) {
      dialogs.notify('Upload failed: ' + err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const unfreeze = async () => {
    const ok = await dialogs.confirm({
      title: 'Unfreeze this design?',
      message: `New orders for ${row.profile_number} on ${row.plant} · ${row.press} · ${row.cavity} cav will go through design and simulation again. The design and its files stay here as Retired.`,
      confirmLabel: 'Unfreeze design',
      tone: 'warning',
    });
    if (!ok) return;
    setUnfreezing(true);
    try {
      await frozenDesignsAPI.release(row.id);
      await onChanged();
      dialogs.notify('Design unfrozen', 'success');
    } catch (err) {
      dialogs.notify('Could not unfreeze: ' + err.message, 'error');
    } finally {
      setUnfreezing(false);
    }
  };

  const section = { padding: '18px 22px', borderTop: `1px solid ${c.border}` };
  const h2 = { fontSize: 12, fontWeight: 600, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' };
  const inputStyle = { width: '100%', boxSizing: 'border-box', minHeight: 38, padding: '8px 10px', background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8, color: c.text, fontSize: 13.5 };
  const field = (label, k, opts = {}) => {
    const locked = opts.keyField && !row.is_active;
    const id = `fd-edit-${k}`;
    return (
      <div style={{ minWidth: 0 }}>
        <label htmlFor={id} style={{ display: 'block', fontSize: 12, color: c.muted, marginBottom: 4 }}>{label}{opts.keyField && !locked ? ' *' : ''}</label>
        <input id={id} value={draft[k]} disabled={locked} list={opts.list} type={opts.type || 'text'} min={opts.type === 'number' ? 1 : undefined} autoComplete="off"
          onChange={(e) => setDraft(d => ({ ...d, [k]: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter' && dirty) save(); }}
          style={{ ...inputStyle, fontFamily: opts.mono ? mono : undefined, opacity: locked ? 0.6 : 1, cursor: locked ? 'not-allowed' : 'text' }} />
      </div>
    );
  };
  const fact = (label, value, opts = {}) => (
    <div style={{ minWidth: 0 }}>
      <dt style={{ fontSize: 12, color: c.dim }}>{label}</dt>
      <dd style={{ margin: '2px 0 0', fontSize: 13.5, color: value ? c.text : c.dim, fontFamily: opts.mono ? mono : undefined, overflowWrap: 'anywhere' }}>{value || '—'}</dd>
    </div>
  );

  const reasons = useMemo(() => {
    const m = new Map();
    (usage || []).filter(u => u.action === 'bypassed').forEach(u => {
      const k = u.reason || 'No reason given';
      m.set(k, (m.get(k) || 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [usage]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1050, background: c.overlay, display: 'flex', justifyContent: 'flex-end' }} onClick={requestClose}>
      <style>{`
        @keyframes fd-in { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .fd-drawer { animation: none !important; } }
        .fd-file:hover, .fd-ver:hover { background: ${c.rowHover}; }
        .fd-file:focus-visible, .fd-ver:focus-visible, .fd-dbtn:focus-visible { outline: 2px solid ${c.primary}; outline-offset: -2px; }
      `}</style>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="fd-drawer"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 520, maxWidth: '100%', height: '100%', background: c.bg, borderLeft: `1px solid ${c.border}`, boxShadow: c.shadowLg, display: 'flex', flexDirection: 'column', animation: 'fd-in .28s cubic-bezier(.16,1,.3,1)' }}>

        {/* Head */}
        <div style={{ padding: '20px 22px 16px', display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 id={titleId} style={{ margin: 0, fontFamily: mono, fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>{row.profile_number}</h2>
              <StatusPill status={st} c={c} />
            </div>
            <div style={{ fontSize: 13.5, color: c.muted, marginTop: 6 }}>
              {row.plant} · {row.press} · {row.cavity} cav
              {versions.length > 1 && <span style={{ color: c.dim }}> · version {vNo} of {versions.length}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {isAdmin && !editing && (
              <button type="button" onClick={startEdit} className="fd-dbtn"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 12px', background: 'transparent', border: `1px solid ${c.border}`, borderRadius: 8, color: c.text, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                <Pencil size={14} aria-hidden="true" />Edit
              </button>
            )}
            <button type="button" onClick={requestClose} aria-label="Close" className="fd-dbtn"
              style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: 8, color: c.muted, cursor: 'pointer' }}>
              <X size={20} />
            </button>
          </div>
        </div>

        {st === 'Superseded' && current && (
          <button type="button" onClick={() => onSwitch(current.id)} disabled={editing} className="fd-dbtn"
            style={{ margin: '0 22px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 12px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.inset, color: c.text, fontSize: 13, cursor: 'pointer', textAlign: 'left' }}>
            <span>A newer version of this design was frozen on {fmtDate(current.frozen_at)}.</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: c.link, fontWeight: 600, whiteSpace: 'nowrap' }}>Open it <ArrowRight size={14} aria-hidden="true" /></span>
          </button>
        )}

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* Details */}
          {editing ? (
          <section style={{ ...section, background: c.primarySoft }}>
            <h3 style={h2}>Edit design</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 14px' }}>
              {field('Profile', 'profile', { mono: true, keyField: true })}
              {field('Plant', 'plant', { keyField: true, list: 'fd-edit-plants' })}
              {field('Press', 'press', { keyField: true, list: 'fd-edit-presses' })}
              {field('Cavity', 'cavity', { keyField: true, type: 'number' })}
              {field('Supplier', 'supplier')}
              {field('Die size', 'dieSize', { mono: true })}
            </div>
            <datalist id="fd-edit-plants">{masters.plants.map(p => <option key={p} value={p} />)}</datalist>
            <datalist id="fd-edit-presses">{masters.presses.map(p => <option key={p.press_name} value={p.press_name}>{p.press_code ? `Code ${p.press_code}` : ''}</option>)}</datalist>
            <p style={{ margin: '10px 0 0', fontSize: 12, color: c.muted, lineHeight: 1.45 }}>
              {row.is_active
                ? 'Profile, plant, press and cavity decide which new orders match this design.'
                : `This version is ${st.toLowerCase()}, so its profile, plant, press and cavity stay as they were.`}
            </p>
            <label htmlFor="fd-edit-notes" style={{ display: 'block', fontSize: 12, color: c.muted, margin: '14px 0 4px' }}>Notes</label>
            <textarea id="fd-edit-notes" value={draft.notes} onChange={(e) => setDraft(d => ({ ...d, notes: e.target.value }))} rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.45 }} />
            {editError && <p role="alert" style={{ margin: '10px 0 0', fontSize: 13, color: c.danger }}>{editError}</p>}
          </section>
          ) : (
          <section style={section}>
            <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 18px', margin: 0 }}>
              {fact('Supplier', row.supplier)}
              {fact('Die size', row.die_size, { mono: true })}
              {fact('Frozen', `${fmtDate(row.frozen_at)}${row.frozen_by_name ? ` by ${row.frozen_by_name}` : ''}`)}
              {st !== 'Active'
                ? fact(st === 'Superseded' ? 'Superseded' : 'Unfrozen', `${fmtDate(row.released_at)}${row.released_by_name ? ` by ${row.released_by_name}` : ''}`)
                : fact('Frozen from order', row.source_order_id ? `#${row.source_order_id}` : 'Entered by hand')}
              {row.edited_at && fact('Last edited', `${fmtDate(row.edited_at)}${row.edited_by_name ? ` by ${row.edited_by_name}` : ''}`)}
            </dl>
            {row.notes && (
              <p style={{ margin: '16px 0 0', padding: '10px 12px', background: c.inset, borderRadius: 8, fontSize: 13.5, lineHeight: 1.5, color: c.text, whiteSpace: 'pre-wrap' }}>{row.notes}</p>
            )}
          </section>
          )}

          {/* Files */}
          <section style={section}>
            <h3 style={h2}>Drawing &amp; files</h3>
            {files.length === 0 && st === 'Active' && (
              <p style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '0 0 12px', fontSize: 13, color: c.warn, lineHeight: 1.45 }}>
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                No drawing attached. Orders that reuse this design will have nothing to send the supplier.
              </p>
            )}
            {files.length > 0 && (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {files.map(f => (
                  <li key={f.id}>
                    <button type="button" className="fd-file"
                      onClick={() => frozenDesignsAPI.downloadFile(f.id, f.original_name).catch(e => dialogs.notify(e.message, 'error'))}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent', color: c.text, cursor: 'pointer', textAlign: 'left', font: 'inherit' }}>
                      <span aria-hidden="true" style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 8, background: c.inset, border: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: c.muted, fontFamily: mono }}>{extOf(f.original_name)}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.original_name}</span>
                        <span style={{ display: 'block', fontSize: 12, color: c.dim, marginTop: 1 }}>{[fmtSize(f.size_bytes), fmtDate(f.uploaded_at)].filter(Boolean).join(' · ')}</span>
                      </span>
                      <Download size={16} style={{ color: c.dim, flexShrink: 0 }} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {files.length === 0 && st !== 'Active' && <p style={{ margin: 0, fontSize: 13, color: c.dim }}>No files were attached.</p>}

            {st === 'Active' && (
              <>
                <input ref={fileInputRef} type="file" multiple aria-label="Choose files to add" style={{ display: 'none' }}
                  onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
                <button type="button" className="fd-dbtn" disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files); }}
                  style={{ marginTop: 12, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px 12px', borderRadius: 10,
                    border: `1px dashed ${dragOver ? c.primary : c.border}`, background: dragOver ? c.primarySoft : 'transparent', color: c.link, fontSize: 13, fontWeight: 600, cursor: uploading ? 'wait' : 'pointer' }}>
                  <Upload size={15} aria-hidden="true" />
                  {uploading ? 'Uploading…' : 'Add files — click or drop here'}
                </button>
                <div style={{ fontSize: 12, color: c.dim, marginTop: 6, textAlign: 'center' }}>PDF, images, DWG, DXF, STEP — up to 100 MB each</div>
              </>
            )}
          </section>

          {/* Orders */}
          <section style={section}>
            <h3 style={h2}>Orders that met this design</h3>
            {usageError && <p role="alert" style={{ margin: 0, fontSize: 13, color: c.danger }}>{usageError}</p>}
            {!usage && !usageError && <p role="status" style={{ margin: 0, fontSize: 13, color: c.dim }}>Loading…</p>}
            {usage && usage.length === 0 && (
              <p style={{ margin: 0, fontSize: 13, color: c.dim, lineHeight: 1.5 }}>No order or backup request has matched this design yet.</p>
            )}
            {reasons.length > 0 && (
              <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 8, background: c.warnBg }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: c.warn, marginBottom: 6 }}>Why people bypassed it</div>
                {reasons.map(([reason, n]) => (
                  <div key={reason} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, color: c.text, padding: '2px 0' }}>
                    <span>{reason}</span><span style={{ fontVariantNumeric: 'tabular-nums', color: c.muted }}>{n}×</span>
                  </div>
                ))}
              </div>
            )}
            {usage && usage.length > 0 && (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {usage.map(u => {
                  const isBypass = u.action === 'bypassed';
                  const otherVersion = u.frozen_design_id !== row.id ? versions.findIndex(v => v.id === u.frozen_design_id) + 1 : 0;
                  return (
                    <li key={`${u.kind}-${u.id}`} style={{ display: 'flex', gap: 12, padding: '10px 0', borderTop: `1px solid ${c.border}` }}>
                      <span style={{ flexShrink: 0, alignSelf: 'flex-start', padding: '2px 8px', borderRadius: 6, fontSize: 11.5, fontWeight: 600, color: isBypass ? c.warn : c.ok, background: isBypass ? c.warnBg : c.okBg }}>
                        {isBypass ? 'Bypassed' : 'Reused'}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13.5 }}>
                          <span style={{ fontFamily: mono, fontWeight: 600 }}>{u.die_no || '—'}</span>
                          <span style={{ color: c.dim }}> · {u.kind === 'backup' ? 'Backup request' : `Order ${u.order_no || `#${u.id}`}`}</span>
                        </span>
                        <span style={{ display: 'block', fontSize: 12, color: c.dim, marginTop: 2 }}>
                          {fmtDate(u.created_at)}{u.status ? ` · ${u.status}` : ''}{otherVersion > 0 ? ` · against v${otherVersion}` : ''}
                        </span>
                        {isBypass && (u.reason || u.note) && (
                          <span style={{ display: 'block', fontSize: 13, color: c.muted, marginTop: 4, lineHeight: 1.45 }}>
                            {u.reason}{u.note ? ` — ${u.note}` : ''}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Versions */}
          {versions.length > 1 && (
            <section style={section}>
              <h3 style={{ ...h2, display: 'flex', alignItems: 'center', gap: 6 }}><History size={13} aria-hidden="true" />Version history</h3>
              <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {versions.map((v, i) => ({ v, i })).reverse().map(({ v, i }) => {
                  const here = v.id === row.id;
                  return (
                    <li key={v.id}>
                      <button type="button" className="fd-ver" onClick={() => onSwitch(v.id)} disabled={editing} aria-current={here ? 'true' : undefined}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 8, border: 'none', background: here ? c.primarySoft : 'transparent', color: c.text, cursor: 'pointer', textAlign: 'left', font: 'inherit' }}>
                        <span style={{ width: 28, fontSize: 12.5, fontWeight: 700, color: c.muted, fontVariantNumeric: 'tabular-nums' }}>v{i + 1}</span>
                        <span style={{ flex: 1, fontSize: 13 }}>
                          {fmtDate(v.frozen_at)}{v.frozen_by_name ? ` · ${v.frozen_by_name}` : ''}
                          <span style={{ color: c.dim }}> · {(v.files || []).length} {(v.files || []).length === 1 ? 'file' : 'files'}</span>
                        </span>
                        <StatusPill status={statusOf(v)} c={c} />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </div>

        {editing && (
          <div style={{ padding: '14px 22px', borderTop: `1px solid ${c.border}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" onClick={() => { setEditing(false); setEditError(''); }} disabled={saving} className="fd-dbtn"
              style={{ minHeight: 38, padding: '0 16px', borderRadius: 9, border: `1px solid ${c.border}`, background: 'transparent', color: c.text, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="button" onClick={save} disabled={saving || !dirty} className="fd-dbtn"
              style={{ minHeight: 38, padding: '0 18px', borderRadius: 9, border: 'none', background: c.primary, color: c.primaryText, fontSize: 13, fontWeight: 600, cursor: saving ? 'wait' : (dirty ? 'pointer' : 'not-allowed'), opacity: dirty ? 1 : 0.55 }}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
        {!editing && isAdmin && st === 'Active' && (
          <div style={{ padding: '14px 22px', borderTop: `1px solid ${c.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12.5, color: c.dim }}>New orders will go through design again.</span>
            <button type="button" onClick={unfreeze} disabled={unfreezing} className="fd-dbtn"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 38, padding: '0 14px', borderRadius: 9, border: `1px solid ${c.danger}`, background: 'transparent', color: c.danger, fontSize: 13, fontWeight: 600, cursor: unfreezing ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
              <Unlock size={14} aria-hidden="true" />{unfreezing ? 'Unfreezing…' : 'Unfreeze design'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
