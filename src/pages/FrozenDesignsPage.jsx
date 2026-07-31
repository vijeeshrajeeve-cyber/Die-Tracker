import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Snowflake, Download, Upload, Lock, FileText, Layers, Send, ShieldAlert, Search } from 'lucide-react';
import { frozenDesignsAPI } from '../api';
import { dialogs } from '../components/ui/DialogProvider';
import FreezeDesignModal from '../components/FreezeDesignModal';
import { BRAND, BRAND_ALPHA } from '../utils/brand';

const STATUS_CONFIG = {
  Active:     { c: '#16A34A', b: 'rgba(22,163,74,0.14)' },
  Released:   { c: '#0891B2', b: 'rgba(8,145,178,0.14)' },
  Superseded: { c: '#71717a', b: 'rgba(113,113,122,0.16)' },
};
const PLANT_COLORS = { 'GEX 1': '#32a838', 'GEX 2': '#3234a8' };

const statusOf = (r) => r.is_active ? 'Active' : (r.release_reason === 'superseded' ? 'Superseded' : 'Released');
const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';
// Whoever last acted on the row: the releaser once it is no longer active,
// otherwise the person who froze it.
const updatedBy = (r) => (r.is_active ? r.frozen_by_name : (r.released_by_name || r.frozen_by_name)) || '—';

export default function FrozenDesignsPage({ user, theme = {} }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState(null);
  const [search, setSearch] = useState('');
  const [plant, setPlant] = useState('All');
  const [status, setStatus] = useState('All');
  const [showFreeze, setShowFreeze] = useState(false);
  const fileInputRef = useRef(null);
  const pendingUploadId = useRef(null);
  const isAdmin = user?.role === 'admin';

  // Theme tokens (defaults match the app's zinc dark theme / the design mockup).
  const bg = theme.cardBg || '#09090b';
  const border = theme.cardBorder || '#27272a';
  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';
  const surfaceHover = theme.tableHeaderBg || '#18181b';
  const rowHover = theme.rowHover || 'rgba(255,255,255,0.06)';
  const inputBg = theme.inputBg || '#09090b';

  const load = useCallback(() => {
    setLoading(true);
    frozenDesignsAPI.list()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const release = async (id) => {
    const ok = await dialogs.confirm({
      title: 'Release frozen design',
      message: 'Future orders against this design will no longer be flagged as frozen.',
      confirmLabel: 'Release design',
      tone: 'warning',
    });
    if (!ok) return;
    await frozenDesignsAPI.release(id);
    load();
  };

  const pickFiles = (id) => {
    pendingUploadId.current = id;
    if (fileInputRef.current) { fileInputRef.current.value = ''; fileInputRef.current.click(); }
  };
  const onFilesChosen = async (e) => {
    const id = pendingUploadId.current;
    const chosen = e.target.files;
    if (!id || !chosen || !chosen.length) return;
    setUploadingId(id);
    try { await frozenDesignsAPI.uploadFiles(id, chosen); load(); }
    catch (err) { dialogs.notify('Upload failed: ' + err.message, 'error'); }
    finally { setUploadingId(null); pendingUploadId.current = null; }
  };

  const plantOptions = useMemo(
    () => Array.from(new Set(rows.map(r => r.plant).filter(Boolean))).sort(),
    [rows]
  );

  const view = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter(r => {
      if (plant !== 'All' && r.plant !== plant) return false;
      if (status !== 'All' && statusOf(r) !== status) return false;
      if (!s) return true;
      const inFiles = (r.files || []).some(f => (f.original_name || '').toLowerCase().includes(s));
      return String(r.profile_number || '').toLowerCase().includes(s)
        || String(r.supplier || '').toLowerCase().includes(s)
        || String(r.press || '').toLowerCase().includes(s)
        || inFiles;
    });
  }, [rows, search, plant, status]);

  const kTotal = rows.length;
  const kActive = rows.filter(r => r.is_active).length;
  const kReleased = rows.reduce((a, r) => a + (Number(r.released_count) || 0), 0);
  const kBypassed = rows.reduce((a, r) => a + (Number(r.bypassed_count) || 0), 0);

  const exportCsv = () => {
    const header = ['Profile', 'Supplier', 'Plant', 'Press', 'Cavity', 'Status', 'Frozen At', 'Updated By', 'Files', 'Released', 'Bypassed'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = view.map(r => [
      r.profile_number, r.supplier, r.plant, r.press, r.cavity, statusOf(r), fmtDate(r.frozen_at), updatedBy(r),
      (r.files || []).map(f => f.original_name).join('; '),
      r.released_count || 0, r.bypassed_count || 0,
    ].map(esc).join(','));
    const csv = [header.map(esc).join(','), ...lines].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `frozen-designs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const chip = (on, color, bg2) => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 34, padding: '3px 10px',
    borderRadius: 6, fontSize: 12.5, fontWeight: 600, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontVariantNumeric: 'tabular-nums',
    ...(on ? { color, background: bg2, border: `1px solid ${color}33` }
          : { color: dim, background: surfaceHover, border: `1px solid ${border}` }),
  });

  const card = { background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: '18px 20px', boxShadow: theme.shadowSm };
  const th = { padding: '13px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.04em' };
  const td = { padding: '14px 16px' };
  const mono = "'JetBrains Mono', ui-monospace, monospace";
  const selectStyle = { padding: '9px 12px', background: inputBg, border: `1px solid ${border}`, borderRadius: 8, color: text, fontSize: '0.85rem', cursor: 'pointer', minWidth: 140, outline: 'none' };

  const kpis = [
    { label: 'Total Frozen', value: kTotal, sub: 'across all plants', icon: Layers, ic: '#fff', ibg: BRAND.navy },
    { label: 'Active', value: kActive, sub: 'currently locked', icon: Snowflake, ic: '#16A34A', ibg: 'rgba(22,163,74,0.14)' },
    { label: 'Released', value: kReleased, sub: 'to production, lifetime', icon: Send, ic: '#0891B2', ibg: 'rgba(8,145,178,0.14)' },
    { label: 'Bypassed', value: kBypassed, sub: 'released without freeze', icon: ShieldAlert, ic: '#D97706', ibg: 'rgba(217,119,6,0.14)' },
  ];

  return (
    <div style={{ padding: '32px 28px', color: text }}>
      <style>{`
        .fd-row { transition: background .15s ease; }
        .fd-row:hover { background: ${rowHover}; }
        .fd-hoverbtn { transition: all .15s ease; }
        .fd-hoverbtn:hover { background: ${surfaceHover}; }
        .fd-filechip:hover { border-color: #2563EB !important; }
        .fd-add:hover { border-color: #2563EB !important; background: rgba(37,99,235,0.06) !important; }
        .fd-release:hover { background: rgba(220,38,38,0.08) !important; }
        .fd-primary:hover { filter: brightness(1.06); }
      `}</style>

      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={onFilesChosen} />

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: text, margin: 0, letterSpacing: '-0.01em' }}>Frozen Designs</h1>
          <p style={{ fontSize: '0.85rem', color: dim, margin: '6px 0 0' }}>
            Locked die designs ready for release to production · <span style={{ fontVariantNumeric: 'tabular-nums' }}>{view.length} of {rows.length} designs</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={exportCsv} className="fd-hoverbtn" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: bg, border: `1px solid ${border}`, borderRadius: 10, color: text, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}>
            <Download size={16} /> Export
          </button>
          <button onClick={() => setShowFreeze(true)} className="fd-primary" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', background: BRAND.navy, border: 'none', borderRadius: 10, color: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', boxShadow: `0 4px 12px ${BRAND_ALPHA.navyGlow}` }}>
            <Snowflake size={16} /> Freeze Design
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
        {kpis.map(k => (
          <div key={k.label} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k.label}</span>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: k.ibg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: k.ic }}>
                <k.icon size={17} />
              </div>
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: text, marginTop: 10, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: '0.75rem', color: dim, marginTop: 6 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '14px 16px', marginBottom: 18, boxShadow: theme.shadowSm }}>
        <div style={{ flex: 1, minWidth: 240, position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: dim }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by profile, supplier, press, or file…"
            style={{ width: '100%', padding: '9px 12px 9px 38px', background: inputBg, border: `1px solid ${border}`, borderRadius: 8, color: text, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <select value={plant} onChange={(e) => setPlant(e.target.value)} style={selectStyle}>
          <option value="All">All plants</option>
          {plantOptions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...selectStyle, minWidth: 150 }}>
          <option value="All">All statuses</option>
          <option value="Active">Active</option>
          <option value="Released">Released</option>
          <option value="Superseded">Superseded</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden', boxShadow: theme.shadowSm }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${border}` }}>
              <th style={th}>Profile</th><th style={th}>Supplier</th><th style={th}>Plant</th><th style={th}>Press</th><th style={th}>Cavity</th>
              <th style={th}>Status</th><th style={th}>Frozen At</th><th style={th}>Updated By</th><th style={th}>Files</th>
              <th style={th}>Released</th><th style={th}>Bypassed</th>
              <th style={{ ...th, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {view.map(r => {
              const st = statusOf(r);
              const sc = STATUS_CONFIG[st] || STATUS_CONFIG.Superseded;
              const released = Number(r.released_count) || 0;
              const bypassed = Number(r.bypassed_count) || 0;
              return (
                <tr key={r.id} className="fd-row" style={{ borderBottom: `1px solid ${border}` }}>
                  <td style={{ ...td, fontFamily: mono, fontSize: 13.5, fontWeight: 600, color: text }}>{r.profile_number}</td>
                  <td style={{ ...td, fontSize: 13, color: r.supplier ? text : dim }}>{r.supplier || '—'}</td>
                  <td style={td}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: text }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: PLANT_COLORS[r.plant] || '#3B82F6', flexShrink: 0 }} />
                      {r.plant}
                    </span>
                  </td>
                  <td style={{ ...td, fontFamily: mono, fontSize: 13, color: muted }}>{r.press}</td>
                  <td style={{ ...td, fontFamily: mono, fontSize: 13, color: muted, fontVariantNumeric: 'tabular-nums' }}>{r.cavity}</td>
                  <td style={td}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: sc.b, color: sc.c, whiteSpace: 'nowrap' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: sc.c, flexShrink: 0 }} />{st}
                    </span>
                  </td>
                  <td style={{ ...td, fontFamily: mono, fontSize: 12.5, color: muted, fontVariantNumeric: 'tabular-nums' }}>{fmtDate(r.frozen_at)}</td>
                  <td style={{ ...td, fontSize: 13, color: updatedBy(r) === '—' ? dim : text }}>{updatedBy(r)}</td>
                  <td style={td}>
                    {(r.files || []).length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {r.files.map(f => (
                          <button key={f.id} type="button" className="fd-filechip" onClick={() => frozenDesignsAPI.downloadFile(f.id, f.original_name)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 6, background: surfaceHover, border: `1px solid ${border}`, fontSize: 12, color: '#2563EB', fontWeight: 500, cursor: 'pointer' }}>
                            <FileText size={13} />{f.original_name}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span style={{ fontSize: 13, color: dim }}>—</span>
                    )}
                  </td>
                  <td style={td}><span style={chip(released > 0, '#16A34A', 'rgba(22,163,74,0.12)')}>×{released}</span></td>
                  <td style={td}><span style={chip(bypassed > 0, '#D97706', 'rgba(217,119,6,0.12)')}>×{bypassed}</span></td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button type="button" className="fd-add" onClick={() => pickFiles(r.id)} disabled={uploadingId === r.id}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: bg, border: `1px solid ${border}`, borderRadius: 8, color: '#2563EB', fontSize: 12.5, fontWeight: 600, cursor: uploadingId === r.id ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
                        <Upload size={13} />{uploadingId === r.id ? 'Uploading…' : 'Add files'}
                      </button>
                      {isAdmin && r.is_active && (
                        <button type="button" className="fd-release" onClick={() => release(r.id)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: bg, border: '1px solid rgba(220,38,38,0.4)', borderRadius: 8, color: '#DC2626', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          <Lock size={13} />Release
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!loading && view.length === 0 && (
          <div style={{ padding: '56px 16px', textAlign: 'center' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 12, background: surfaceHover, color: dim, marginBottom: 14 }}>
              <Snowflake size={24} />
            </div>
            <div style={{ fontSize: '0.95rem', fontWeight: 600, color: text }}>
              {rows.length === 0 ? 'No frozen designs yet' : 'No frozen designs match'}
            </div>
            <div style={{ fontSize: '0.82rem', color: dim, marginTop: 4 }}>
              {rows.length === 0 ? 'Freeze a design from an order, or use the Freeze Design button.' : 'Try clearing the search or filters.'}
            </div>
          </div>
        )}
        {loading && <div style={{ padding: '40px 16px', textAlign: 'center', color: dim }}>Loading…</div>}
      </div>

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
