import React, { useId, useMemo, useState } from 'react';
import { X, FileSpreadsheet, FileText, Download } from 'lucide-react';
import useDialog from '../../hooks/useDialog';
import DatePickerField from '../DatePickerField';
import { dialogs } from '../ui/DialogProvider';
import { exportToExcel } from '../../utils/exportExcel';
import {
  orderExportColumns, defaultColumnIds, pickColumns, exportRows, describeFilters,
} from '../../utils/orderExport';

// The viewer's last format and columns. A convenience only: the dialog works
// the same when storage is blocked or empty.
const STORE_KEY = 'die-tracker.order-export.v1';
const loadPrefs = () => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') || {}; } catch { return {}; }
};
const savePrefs = (prefs) => {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); } catch { /* storage blocked */ }
};

const FORMATS = [
  { id: 'xlsx', label: 'Excel', hint: 'Real date cells, sized columns', icon: <FileSpreadsheet size={18} /> },
  { id: 'csv', label: 'CSV', hint: 'Plain text for other tools', icon: <FileText size={18} /> },
];

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/**
 * Export die orders: format, Requested date range, the columns to include and
 * whether the Orders page filters apply. Opened by the Orders page's Export to
 * Excel button and by the top bar's Export.
 */
export default function ExportDialog({
  theme, onClose, allRows, filteredRows, filters, searchTerm, dateOf, dieReceivedDateMap,
}) {
  const titleId = useId();
  const [exporting, setExporting] = useState(false);
  const dialogRef = useDialog({ open: true, onClose, closeOnEscape: !exporting });

  const columns = useMemo(() => orderExportColumns({ dieReceivedDateMap }), [dieReceivedDateMap]);
  const [prefs] = useState(loadPrefs);
  const [format, setFormat] = useState(prefs.format === 'csv' ? 'csv' : 'xlsx');
  const [chosen, setChosen] = useState(() => {
    const known = new Set(columns.map((c) => c.id));
    const saved = Array.isArray(prefs.columns) ? prefs.columns.filter((id) => known.has(id)) : [];
    return new Set(saved.length ? saved : defaultColumnIds(columns));
  });
  const activeFilters = useMemo(() => describeFilters(filters, searchTerm), [filters, searchTerm]);
  const [applyFilters, setApplyFilters] = useState(activeFilters.length > 0);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const rows = useMemo(
    () => exportRows({ allRows, filteredRows, applyFilters, from, to, dateOf }),
    [allRows, filteredRows, applyFilters, from, to, dateOf],
  );
  const picked = pickColumns(columns, [...chosen]);
  const rangeBackwards = from && to && from > to;
  const ready = !exporting && rows.length > 0 && picked.length > 0 && !rangeBackwards;

  const toggle = (id) => setChosen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allChosen = chosen.size === columns.length;

  const runExport = async () => {
    setExporting(true);
    try {
      await exportToExcel({ rows, columns: picked, filename: 'die_orders', sheetName: 'Die Orders', format });
      savePrefs({ format, columns: picked.map((c) => c.id) });
      onClose();
    } catch (error) {
      console.error('Export failed:', error);
      dialogs.notify(`Export failed: ${error.message}`, 'error');
      setExporting(false);
    }
  };

  const c = {
    text: theme?.text || '#F1F5F9',
    muted: theme?.textMuted || '#94A3B8',
    dim: theme?.textDim || '#64748B',
    card: theme?.cardBg || '#1E293B',
    border: theme?.cardBorder || '#334155',
    inset: theme?.inputBg || '#0F172A',
    primary: theme?.primary || '#3B82F6',
    primaryText: theme?.primaryText || '#FFFFFF',
    primarySoft: theme?.primaryLight || 'rgba(59,130,246,0.15)',
    danger: theme?.isDark === false ? '#B42318' : '#FB7185',
  };
  const label = { margin: '0 0 8px', fontSize: '0.8rem', fontWeight: 600, color: c.text };
  const linkButton = { padding: 0, background: 'none', border: 'none', color: c.primary, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '16px' }}
      onClick={() => { if (!exporting) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}
        style={{ background: c.card, color: c.text, border: `1px solid ${c.border}`, borderRadius: '16px', width: '100%', maxWidth: '640px', maxHeight: 'calc(100dvh - 32px)', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.35)' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', padding: '20px 24px 0' }}>
          <div style={{ minWidth: 0 }}>
            <h2 id={titleId} style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Export die orders</h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: c.dim }}>
              {plural(rows.length, 'order')} · {from || to ? `Requested ${from || '…'} to ${to || '…'}` : 'All requested dates'}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={exporting} aria-label="Close"
            style={{ width: '36px', height: '36px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', border: `1px solid ${c.border}`, background: 'transparent', color: c.muted, cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </header>

        <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            <legend style={label}>Format</legend>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              {FORMATS.map(({ id, label: name, hint, icon }) => {
                const on = format === id;
                return (
                  <label key={id} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '14px', borderRadius: '12px', cursor: 'pointer', border: `${on ? 2 : 1}px solid ${on ? c.primary : c.border}`, margin: on ? 0 : '1px', background: on ? c.primarySoft : 'transparent' }}>
                    <span aria-hidden="true" style={{ width: '34px', height: '34px', borderRadius: '8px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.inset, color: on ? c.primary : c.muted }}>{icon}</span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{name}</span>
                      <span style={{ fontSize: '0.75rem', color: c.dim }}>{hint}</span>
                    </span>
                    <input type="radio" name={`${titleId}-format`} value={id} checked={on} onChange={() => setFormat(id)}
                      style={{ width: '18px', height: '18px', margin: 0, accentColor: c.primary, cursor: 'pointer' }} />
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div>
            <p style={label}>Requested date range</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <DatePickerField theme={theme} aria-label="Requested from" value={from} placeholder="From (any)" onChange={setFrom} />
              <DatePickerField theme={theme} aria-label="Requested to" value={to} placeholder="To (any)" onChange={setTo} />
            </div>
            {rangeBackwards && <p role="alert" style={{ margin: '6px 0 0', fontSize: '0.78rem', color: c.danger }}>The From date is after the To date.</p>}
            {(from || to) && !rangeBackwards && (
              <button type="button" onClick={() => { setFrom(''); setTo(''); }} style={{ ...linkButton, marginTop: '6px' }}>Clear dates</button>
            )}
          </div>

          <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            <legend style={{ ...label, display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
              <span>Columns <span style={{ fontWeight: 400, color: c.dim }}>{chosen.size} of {columns.length} selected</span></span>
            </legend>
            <div style={{ display: 'flex', gap: '16px', margin: '-4px 0 8px' }}>
              <button type="button" style={linkButton} onClick={() => setChosen(new Set(allChosen ? [] : columns.map((col) => col.id)))}>
                {allChosen ? 'Clear all' : 'Select all'}
              </button>
              <button type="button" style={linkButton} onClick={() => setChosen(new Set(defaultColumnIds(columns)))}>Standard columns</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '2px 12px', padding: '12px 14px', borderRadius: '12px', background: c.inset, border: `1px solid ${c.border}` }}>
              {columns.map((col) => (
                <label key={col.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', minHeight: '34px', fontSize: '0.84rem', color: chosen.has(col.id) ? c.text : c.muted, cursor: 'pointer' }}>
                  <input type="checkbox" checked={chosen.has(col.id)} onChange={() => toggle(col.id)}
                    style={{ width: '16px', height: '16px', margin: 0, flexShrink: 0, accentColor: c.primary, cursor: 'pointer' }} />
                  {col.label}
                </label>
              ))}
            </div>
            {picked.length === 0 && <p role="alert" style={{ margin: '6px 0 0', fontSize: '0.78rem', color: c.danger }}>Pick at least one column.</p>}
          </fieldset>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: activeFilters.length ? 'pointer' : 'default' }}>
            <input type="checkbox" role="switch" checked={applyFilters} disabled={activeFilters.length === 0}
              onChange={(e) => setApplyFilters(e.target.checked)}
              style={{ width: '18px', height: '18px', margin: '2px 0 0', flexShrink: 0, accentColor: c.primary, cursor: 'inherit' }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
              <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Apply current filters</span>
              <span style={{ fontSize: '0.78rem', color: c.dim, overflowWrap: 'anywhere' }}>
                {activeFilters.length ? `Orders page · ${activeFilters.join(' · ')}` : 'No filters are set on the Orders page'}
              </span>
            </span>
          </label>
        </div>

        <footer style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '16px 24px', borderTop: `1px solid ${c.border}` }}>
          <span style={{ fontSize: '0.8rem', color: c.dim, marginRight: 'auto' }}>
            {rows.length === 0 ? 'No orders match' : `${plural(rows.length, 'row')} × ${plural(picked.length, 'column')}`}
          </span>
          <button type="button" onClick={onClose} disabled={exporting}
            style={{ padding: '10px 18px', borderRadius: '999px', border: `1px solid ${c.border}`, background: 'transparent', color: c.text, fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="button" onClick={runExport} disabled={!ready}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 18px', borderRadius: '999px', border: 'none', background: c.primary, color: c.primaryText, fontWeight: 600, fontSize: '0.875rem', cursor: ready ? 'pointer' : 'not-allowed', opacity: ready ? 1 : 0.5 }}>
            <Download size={16} aria-hidden="true" /> {exporting ? 'Exporting…' : `Export ${format === 'csv' ? 'CSV' : 'Excel'}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
