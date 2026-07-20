import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Download, Plus, ClipboardList, Factory, Search, X,
  AlertTriangle, Truck, CheckCircle, CheckCircle2, Clock, Wrench, RefreshCcw, FileText, Eye,
} from 'lucide-react';
import { qualityDiscrepanciesAPI, suppliersAPI } from '../api';
import { QD_STATUS_CONFIG, QD_STATUSES } from '../utils/constants';
import QDDetailPanel from '../components/qd/QDDetailPanel';
import RaiseQDModal from '../components/qd/RaiseQDModal';

const OUTCOME_ICON = {
  'Supplier rework': Truck,
  'FOC replacement': RefreshCcw,
  'In-house correction': Wrench,
  'Credit note': FileText,
  'Reference only': Eye,
};
const PLANT_COLORS = { 'GEX 1': '#32a838' };
const GRADIENT = 'linear-gradient(135deg,#3B82F6,#8B5CF6)';
const SUP_COLS = '1.4fr 60px 60px 60px 70px 70px 90px';

// Rendered from the real trend the server derives (90-day QD rate vs the prior
// 90 days) — the design's arrows were fixed strings.
const TREND = {
  up:   { label: '↑ QD rate', bg: 'rgba(239,68,68,0.15)', fg: '#FCA5A5' },
  down: { label: '↓ improving', bg: 'rgba(16,185,129,0.15)', fg: '#34D399' },
  flat: { label: 'flat', bg: 'rgba(161,161,170,0.14)', fg: '#A1A1AA' },
};

// The stages an OPEN QD can sit in. Rejected and Reference are settled, so they
// are not stages here — the supplier table's Rejected column still surfaces those.
const PIPELINE_STAGES = [
  ['Open', 'Open', '#FBBF24'],
  ['At supplier', 'Sent to Supplier', '#60A5FA'],
  ['FOC accepted', 'FOC Accepted', '#34D399'],
  ['Rework in-house', 'Rework In-house', '#A78BFA'],
];

const ageColor = (age, muted) => (age > 40 ? '#FCA5A5' : age > 20 ? '#FBBF24' : muted);

export default function QDTrackerPage({ user, theme = {}, onCompose }) {
  const [tab, setTab] = useState('qds');
  const [data, setData] = useState({ qds: [], kpis: null, suppliers: [], years: [] });
  const [year, setYear] = useState('All');
  // Supplier master — the source for the Raise dropdown and for contact_email.
  const [supplierMaster, setSupplierMaster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [plant, setPlant] = useState('All');
  const [supplier, setSupplier] = useState('All');
  const [status, setStatus] = useState('All');
  const [selectedId, setSelectedId] = useState(null);
  const [showRaise, setShowRaise] = useState(false);
  const [pickedSuppliers, setPickedSuppliers] = useState([]);

  // Theme tokens (defaults match the app's zinc dark theme / the design mockup).
  const bg = theme.cardBg || '#09090b';
  const border = theme.cardBorder || '#27272a';
  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';
  const surfaceHover = theme.rowHover || 'rgba(255,255,255,0.06)';
  const inputBg = theme.inputBg || '#09090b';

  // State is only set after the await so nothing is set synchronously inside the
  // effect (react-hooks/set-state-in-effect); `loading` starts true instead.
  const load = useCallback(async () => {
    try {
      // Keep the known years when a scoped fetch returns none, so the filter
      // does not empty itself and strand the user on a year with no QDs.
      const next = await qualityDiscrepanciesAPI.list(year);
      setData(prev => ({ ...next, years: next.years?.length ? next.years : prev.years }));
    } catch {
      setData(prev => ({ qds: [], kpis: null, suppliers: [], years: prev.years }));
    } finally {
      setLoading(false);
    }
  }, [year]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    suppliersAPI.getAll()
      .then(rows => { if (!cancelled) setSupplierMaster(rows || []); })
      .catch(() => { if (!cancelled) setSupplierMaster([]); });
    return () => { cancelled = true; };
  }, []);

  // Filter dropdown lists only suppliers that actually have QDs…
  const supplierOptions = useMemo(
    () => Array.from(new Set(data.qds.map(q => q.supplier).filter(Boolean))).sort(),
    [data.qds]
  );
  // …while raising a QD offers the full master, so names stay canonical and
  // keep matching the supplier's contact_email.
  const raiseSupplierOptions = useMemo(
    () => supplierMaster.map(s => s.name).filter(Boolean).sort(),
    [supplierMaster]
  );

  const filtered = useMemo(() => data.qds.filter(q => {
    if (search) {
      const s = search.toLowerCase();
      const hit = String(q.qd_no).toLowerCase().includes(s)
        || String(q.die_no).toLowerCase().includes(s)
        || String(q.corrector || '').toLowerCase().includes(s)
        || String(q.issue_summary || '').toLowerCase().includes(s);
      if (!hit) return false;
    }
    if (plant !== 'All' && q.plant !== plant) return false;
    if (supplier !== 'All' && q.supplier !== supplier) return false;
    if (status !== 'All' && q.status !== status) return false;
    return true;
  }), [data.qds, search, plant, supplier, status]);

  const supplierTabQds = useMemo(
    () => data.qds.filter(q => pickedSuppliers.length === 0 || pickedSuppliers.includes(q.supplier)),
    [data.qds, pickedSuppliers]
  );
  const visibleSuppliers = useMemo(
    () => data.suppliers.filter(s => pickedSuppliers.length === 0 || pickedSuppliers.includes(s.name)),
    [data.suppliers, pickedSuppliers]
  );

  const pipeline = useMemo(() => {
    const rows = PIPELINE_STAGES.map(([label, st, color]) => ({
      label, color, count: supplierTabQds.filter(q => q.status === st).length,
    }));
    const max = Math.max(1, ...rows.map(r => r.count)); // guard: all-zero pipeline
    return rows.map(r => ({ ...r, pct: `${Math.round((r.count / max) * 100)}%` }));
  }, [supplierTabQds]);

  const toggleSupplier = (name) => {
    if (name === 'All') return setPickedSuppliers([]);
    setPickedSuppliers(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name]);
  };

  const selected = data.qds.find(q => q.id === selectedId) || null;
  const hasFilters = !!(search || plant !== 'All' || supplier !== 'All' || status !== 'All' || year !== 'All');
  const k = data.kpis;

  const countLine = tab === 'qds'
    ? `${filtered.length} of ${data.qds.length} QDs · raised against received dies`
    : `${visibleSuppliers.length} supplier${visibleSuppliers.length === 1 ? '' : 's'} · ${supplierTabQds.length} QD${supplierTabQds.length === 1 ? '' : 's'}`;

  const scope = year === 'All' ? 'all years' : `in ${year}`;
  const kpis = k ? [
    { label: 'Total QDs', value: k.total, sub: `raised · ${scope}`, icon: ClipboardList, ic: '#fff', ibg: GRADIENT },
    { label: 'Open QDs', value: k.openCount, sub: `${k.atSupplier} awaiting supplier action`, icon: AlertTriangle, ic: '#FBBF24', ibg: 'rgba(245,158,11,0.14)' },
    { label: 'Closed QDs', value: k.closedCount, sub: 'settled and signed off', icon: CheckCircle2, ic: '#22D3EE', ibg: 'rgba(6,182,212,0.14)' },
    { label: 'At supplier', value: k.atSupplier, sub: 'sent back for rework / FOC', icon: Truck, ic: '#60A5FA', ibg: 'rgba(59,130,246,0.14)' },
    { label: 'FOC recovered', value: k.focRecovered, sub: 'dies + mandrels this FY', icon: CheckCircle, ic: '#34D399', ibg: 'rgba(16,185,129,0.14)' },
    { label: 'Avg resolution', value: k.avgResolution === null ? '—' : `${k.avgResolution}d`, sub: 'raised → closed', icon: Clock, ic: '#A78BFA', ibg: 'rgba(139,92,246,0.14)' },
  ] : [];

  const exportCsv = () => {
    const header = ['QD No', 'Die No', 'Plant', 'Supplier', 'Corrector', 'Quality issue', 'Status', 'Outcome', 'Raised', 'Age (days)'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = filtered.map(q => [
      q.qd_no, q.die_no, q.plant, q.supplier, q.corrector, q.issue_summary,
      q.status, q.outcome, q.raised_date, q.age_days,
    ].map(esc).join(','));
    const csv = [header.map(esc).join(','), ...lines].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `quality-discrepancies-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Styling follows the app's existing pages (see FrozenDesignsPage), not the
  // standalone design prototype — the prototype had no sidebar, so its centred
  // 1400px canvas left dead gutters once dropped into the app shell.
  const selectStyle = { padding: '9px 12px', background: inputBg, border: `1px solid ${border}`, borderRadius: 8, color: text, fontSize: '0.85rem', cursor: 'pointer', outline: 'none' };
  const th = { padding: '13px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: `1px solid ${border}` };
  const td = { padding: '14px 16px', borderBottom: `1px solid ${border}` };
  const mono = "'JetBrains Mono', ui-monospace, monospace";
  const sectionLabel = { fontSize: '0.75rem', fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' };
  const panel = { background: bg, border: `1px solid ${border}`, borderRadius: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' };

  return (
    <div style={{ padding: '32px 28px', color: text }}>
      <style>{`
        .qd-row { transition: background .15s ease; cursor: pointer; }
        .qd-row:hover { background: ${surfaceHover}; }
        .qd-btn { transition: all .15s ease; }
        .qd-btn:hover { background: ${surfaceHover}; color: ${text}; }
        .qd-primary:hover { filter: brightness(1.06); }
      `}</style>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20, gap: 24, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>Quality Discrepancies</h1>
          <p style={{ fontSize: '0.85rem', color: dim, margin: '6px 0 0' }}>{countLine}</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={exportCsv} className="qd-btn" style={{ padding: '10px 16px', background: bg, border: `1px solid ${border}`, borderRadius: 10, color: text, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Download size={16} /> Export
          </button>
          <button onClick={() => setShowRaise(true)} className="qd-primary" style={{ padding: '10px 18px', background: GRADIENT, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 12px rgba(59,130,246,0.3)' }}>
            <Plus size={16} /> Raise QD
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${border}`, marginBottom: 20 }}>
        {[{ key: 'qds', label: 'QD Register', Icon: ClipboardList }, { key: 'suppliers', label: 'Supplier Summary', Icon: Factory }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '10px 16px', background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === t.key ? '#8B5CF6' : 'transparent'}`, color: tab === t.key ? text : muted, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, marginBottom: -1 }}>
            <t.Icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'qds' && (
        <>
          {/* KPI cards — every value derived server-side from real rows */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(196px, 1fr))', gap: 16, marginBottom: 20 }}>
            {kpis.map(kp => (
              <div key={kp.label} style={{ ...panel, padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={sectionLabel}>{kp.label}</span>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: kp.ibg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: kp.ic }}>
                    <kp.icon size={17} />
                  </div>
                </div>
                <div style={{ fontSize: '2rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: 10, lineHeight: 1 }}>{kp.value}</div>
                <div style={{ fontSize: '0.75rem', color: dim, marginTop: 6 }}>{kp.sub}</div>
              </div>
            ))}
          </div>

          {/* Filter bar */}
          <div style={{ ...panel, padding: '14px 16px', marginBottom: 18, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240, position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={16} style={{ position: 'absolute', left: 13, color: dim, pointerEvents: 'none' }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by QD no, die number, corrector, or issue…"
                style={{ width: '100%', padding: '9px 12px 9px 38px', background: inputBg, border: `1px solid ${border}`, borderRadius: 8, color: text, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            {/* Year scopes the whole page (KPIs + supplier tab), unlike the
                row filters beside it, so it is fetched rather than filtered. */}
            <select value={year} onChange={(e) => setYear(e.target.value)} style={{ ...selectStyle, minWidth: 120 }}>
              <option value="All">All years</option>
              {(data.years || []).map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={plant} onChange={(e) => setPlant(e.target.value)} style={{ ...selectStyle, minWidth: 130 }}>
              <option value="All">All plants</option><option value="GEX 1">GEX 1</option><option value="GEX 2">GEX 2</option>
            </select>
            <select value={supplier} onChange={(e) => setSupplier(e.target.value)} style={{ ...selectStyle, minWidth: 150 }}>
              <option value="All">All suppliers</option>
              {supplierOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...selectStyle, minWidth: 160 }}>
              <option value="All">All statuses</option>
              {QD_STATUSES.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            {hasFilters && (
              <button onClick={() => { setSearch(''); setPlant('All'); setSupplier('All'); setStatus('All'); setYear('All'); }}
                style={{ padding: '9px 12px', background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <X size={14} /> Clear
              </button>
            )}
          </div>

          {/* Register table */}
          <div style={{ ...panel, borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['QD No', 'Die No', 'Plant', 'Supplier', 'Corrector', 'Quality issue', 'Status', 'Outcome', 'Age'].map(h => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map(q => {
                  const sc = QD_STATUS_CONFIG[q.status] || QD_STATUS_CONFIG.Open;
                  const OIcon = OUTCOME_ICON[q.outcome] || Eye;
                  return (
                    <tr key={q.id} className="qd-row" onClick={() => setSelectedId(q.id)}>
                      <td style={td}><span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600 }}>{q.qd_no}</span></td>
                      <td style={td}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontFamily: mono, fontSize: 13.5, fontWeight: 600 }}>{q.die_no}</span>
                          <span style={{ fontSize: 11, color: dim }}>{q.raised_date}</span>
                        </div>
                      </td>
                      <td style={td}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: PLANT_COLORS[q.plant] || '#6366F1' }} />{q.plant}
                        </span>
                      </td>
                      <td style={{ ...td, fontSize: 13, color: muted }}>{q.supplier}</td>
                      <td style={{ ...td, fontSize: 13, color: q.corrector ? muted : dim, whiteSpace: 'nowrap' }}>{q.corrector || '—'}</td>
                      <td style={{ ...td, maxWidth: 320 }}>
                        <span style={{ fontSize: 13, color: muted, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.4 }}>{q.issue_summary}</span>
                      </td>
                      <td style={td}>
                        <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', background: sc.bg, color: sc.fg }}>{q.status}</span>
                      </td>
                      <td style={td}>
                        <span style={{ fontSize: 12, color: muted, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                          <OIcon size={14} style={{ color: dim }} />{q.outcome || '—'}
                        </span>
                      </td>
                      <td style={td}>
                        <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, color: ageColor(q.age_days, muted) }}>{q.age_days}d</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && filtered.length === 0 && (
              <div style={{ padding: '56px 16px', textAlign: 'center' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, borderRadius: 12, background: surfaceHover, color: dim, marginBottom: 14 }}>
                  <AlertTriangle size={24} />
                </div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, color: text }}>
                  {data.qds.length === 0 ? 'No QDs raised yet' : 'No QDs match your filters'}
                </div>
                <div style={{ fontSize: '0.82rem', color: dim, marginTop: 4 }}>
                  {data.qds.length === 0 ? 'Raise a QD against a received die to start tracking it here.' : 'Try clearing the search or filters.'}
                </div>
              </div>
            )}
            {loading && <div style={{ padding: '40px 16px', textAlign: 'center', color: dim, fontSize: '0.85rem' }}>Loading…</div>}
          </div>
        </>
      )}

      {tab === 'suppliers' && (
        <>
          {/* Supplier filter chips */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
            <span style={{ ...sectionLabel, marginRight: 4 }}>Suppliers</span>
            {[{ name: 'All', label: 'All' }, ...data.suppliers.map(s => ({ name: s.name, label: s.name }))].map(c => {
              const on = c.name === 'All' ? pickedSuppliers.length === 0 : pickedSuppliers.includes(c.name);
              return (
                <button key={c.name} onClick={() => toggleSupplier(c.name)}
                  style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s ease', border: `1px solid ${on ? 'rgba(139,92,246,0.4)' : border}`, background: on ? 'rgba(139,92,246,0.15)' : bg, color: on ? '#A78BFA' : muted }}>
                  {c.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.8fr', gap: 16, marginBottom: 20 }}>
            {/* Open QDs by stage */}
            <div style={{ ...panel, padding: '18px 20px' }}>
              <div style={{ ...sectionLabel, marginBottom: 14 }}>Open QDs by stage</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pipeline.map(p => (
                  <div key={p.label} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 24px', gap: 10, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: muted }}>{p.label}</span>
                    <span style={{ height: 8, borderRadius: 4, background: theme.primaryLight || '#27272a', position: 'relative', display: 'block' }}>
                      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4, background: p.color, width: p.pct }} />
                    </span>
                    <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Supplier performance */}
            <div style={{ ...panel, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '14px 20px', borderBottom: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={sectionLabel}>Supplier performance</span>
                <span style={{ fontSize: '0.72rem', color: dim }}>Sorted by open QDs · click to filter</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: SUP_COLS, gap: 8, alignItems: 'center', padding: '8px 20px', borderBottom: `1px solid ${border}` }}>
                {['Supplier', 'QDs', 'Open', 'FOC', 'Rejected', 'Avg res.', 'Trend'].map((h, i) => (
                  <span key={h} style={{ fontSize: 10.5, fontWeight: 700, color: dim, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: i === 0 ? 'left' : 'right' }}>{h}</span>
                ))}
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 196 }}>
                {visibleSuppliers.map(s => {
                  const tr = TREND[s.trend] || TREND.flat;
                  const openDot = s.open > 1 ? '#FBBF24' : s.open === 1 ? '#60A5FA' : '#34D399';
                  const openCol = s.open > 1 ? '#FBBF24' : s.open === 1 ? text : dim;
                  const num = { fontFamily: mono, fontSize: 12.5, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
                  return (
                    <div key={s.name} className="qd-row" onClick={() => toggleSupplier(s.name)}
                      style={{ display: 'grid', gridTemplateColumns: SUP_COLS, gap: 8, alignItems: 'center', padding: '8px 20px', borderBottom: `1px solid ${border}`, background: pickedSuppliers.includes(s.name) ? surfaceHover : bg }}>
                      <span style={{ fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: openDot, flexShrink: 0 }} />{s.name}
                      </span>
                      <span style={num}>{s.total}</span>
                      <span style={{ ...num, color: openCol }}>{s.open}</span>
                      <span style={{ ...num, color: '#34D399' }}>{s.foc}</span>
                      <span style={{ ...num, color: '#F87171' }}>{s.rejected}</span>
                      <span style={num}>{s.avg === null ? '—' : `${s.avg}d`}</span>
                      <span style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: tr.bg, color: tr.fg, whiteSpace: 'nowrap' }}>{tr.label}</span>
                      </span>
                    </div>
                  );
                })}
                {visibleSuppliers.length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', color: dim, fontSize: 13 }}>No supplier data yet</div>
                )}
              </div>
            </div>
          </div>

          {/* QDs for the selected suppliers */}
          <div style={{ ...panel, borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${border}` }}>
              <span style={sectionLabel}>QDs for selected suppliers</span>
            </div>
            {supplierTabQds.map(q => {
              const sc = QD_STATUS_CONFIG[q.status] || QD_STATUS_CONFIG.Open;
              return (
                <div key={q.id} className="qd-row" onClick={() => setSelectedId(q.id)}
                  style={{ display: 'grid', gridTemplateColumns: '100px 130px 100px 1fr 160px 70px', gap: 12, alignItems: 'center', padding: '13px 20px', borderBottom: `1px solid ${border}` }}>
                  <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 600 }}>{q.qd_no}</span>
                  <span style={{ fontFamily: mono, fontSize: 12.5, color: muted }}>{q.die_no}</span>
                  <span style={{ fontSize: 12, color: muted }}>{q.supplier}</span>
                  <span style={{ fontSize: 12.5, color: muted, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{q.issue_summary}</span>
                  <span>
                    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.fg }}>{q.status}</span>
                  </span>
                  <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 600, color: ageColor(q.age_days, muted), textAlign: 'right' }}>{q.age_days}d</span>
                </div>
              );
            })}
            {supplierTabQds.length === 0 && (
              <div style={{ padding: 32, textAlign: 'center', color: dim, fontSize: 13 }}>No QDs recorded for the selected suppliers</div>
            )}
          </div>
        </>
      )}

      {selected && (
        <QDDetailPanel
          qd={selected}
          theme={theme}
          user={user}
          supplier={supplierMaster.find(s => (s.name || '').toLowerCase() === (selected.supplier || '').toLowerCase()) || null}
          onCompose={onCompose}
          onClose={() => setSelectedId(null)}
          onChanged={load}
        />
      )}
      {showRaise && (
        <RaiseQDModal theme={theme} suppliers={raiseSupplierOptions} onClose={() => setShowRaise(false)}
          onCreated={(id) => { setShowRaise(false); load(); setSelectedId(id); }} />
      )}
    </div>
  );
}
