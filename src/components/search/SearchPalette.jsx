// src/components/search/SearchPalette.jsx
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, Package, AlertTriangle } from 'lucide-react';
import useDialog from '../../hooks/useDialog';
import StatusPill from '../ui/StatusPill';
import { searchAPI } from '../../api';
import {
  shouldSearch, flattenResults, moveIndex, isAbort, DEBOUNCE_MS, GROUP_LABELS,
} from '../../utils/searchPalette';

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function SearchPalette({ open, onClose, theme, onOpenOrder, onOpenQd }) {
  const dialogRef = useDialog({ open, onClose });
  const titleId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [active, setActive] = useState(-1);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');
  const listRef = useRef(null);

  // Fresh palette every time it opens.
  useEffect(() => {
    if (!open) return;
    setQuery(''); setResults(null); setStatus('idle'); setActive(-1); setOpening(false); setOpenError('');
  }, [open]);

  // Debounced search; aborting the previous request keeps a slow, older
  // answer from replacing a newer one.
  useEffect(() => {
    if (!open || !shouldSearch(query)) { setResults(null); setStatus('idle'); return undefined; }
    const controller = new AbortController();
    setStatus('loading');
    const timer = setTimeout(() => {
      searchAPI.query(query.trim(), { signal: controller.signal })
        .then((body) => { setResults(body); setStatus('done'); setActive(flattenResults(body).length ? 0 : -1); })
        .catch((error) => { if (!isAbort(error)) setStatus('error'); });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, query]);

  const flat = useMemo(() => flattenResults(results), [results]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = async (entry) => {
    if (!entry || opening) return;
    setOpenError('');
    if (entry.kind === 'order') { onOpenOrder(entry.item); onClose(); return; }
    setOpening(true);
    try {
      await onOpenQd(entry.item);
      onClose();
    } catch (error) {
      setOpenError(error?.message || 'Could not open that QD');
    } finally {
      setOpening(false);
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => moveIndex(i, 1, flat.length)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => moveIndex(i, -1, flat.length)); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(flat[active]); }
  };

  if (!open) return null;

  const muted = { color: theme.textMuted, fontSize: '0.8rem' };
  const groups = [
    { kind: 'order', group: results?.orders, Icon: Package },
    { kind: 'qd', group: results?.qds, Icon: AlertTriangle },
  ].filter(({ group }) => group && group.items.length);

  let index = -1;
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '12vh 16px 16px' }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}
        style={{ width: '100%', maxWidth: 640, background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 14, boxShadow: theme.shadowLg, overflow: 'hidden', color: theme.text }}>
        <h2 id={titleId} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Search</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${theme.cardBorder}` }}>
          <Search size={18} style={{ color: theme.textDim, flexShrink: 0 }} />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
            role="combobox" aria-expanded={flat.length > 0} aria-controls={`${titleId}-list`}
            aria-activedescendant={active >= 0 ? `${titleId}-opt-${active}` : undefined}
            aria-label="Search die orders and QDs" placeholder="Search die no, order no, QD no, supplier…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: theme.text, fontSize: '1rem' }} />
          <kbd style={{ ...muted, border: `1px solid ${theme.cardBorder}`, borderRadius: 6, padding: '2px 6px' }}>Esc</kbd>
        </div>

        <div ref={listRef} id={`${titleId}-list`} role="listbox" style={{ maxHeight: '55vh', overflowY: 'auto', padding: '6px 0' }}>
          {status === 'idle' && <p style={{ ...muted, padding: '14px 16px' }}>Type at least 2 characters to search die orders and Quality Discrepancies.</p>}
          {status === 'loading' && !results && <p style={{ ...muted, padding: '14px 16px' }}>Searching…</p>}
          {status === 'error' && <p role="alert" style={{ padding: '14px 16px', color: '#ef4444', fontSize: '0.85rem' }}>Search failed — try again.</p>}
          {status === 'done' && flat.length === 0 && <p style={{ ...muted, padding: '14px 16px' }}>No matches for “{query.trim()}”.</p>}

          {groups.map((entry) => {
            const { kind, group } = entry;
            const Icon = entry.Icon; // capitalised const so the JSX use below is accepted by no-unused-vars
            return (
            <div key={kind} role="group" aria-label={GROUP_LABELS[kind]}>
              <div style={{ ...muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '8px 16px 4px' }}>{GROUP_LABELS[kind]}</div>
              {group.items.map((item) => {
                index += 1;
                const i = index;
                const isActive = i === active;
                return (
                  <div key={`${kind}-${item.id}`} id={`${titleId}-opt-${i}`} data-index={i} role="option" aria-selected={isActive}
                    onMouseMove={() => setActive(i)} onClick={() => choose({ kind, item })}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', cursor: 'pointer', background: isActive ? theme.rowHover : 'transparent' }}>
                    <Icon size={16} style={{ color: theme.textDim, flexShrink: 0 }} />
                    {kind === 'order' ? (
                      <>
                        <span style={{ fontWeight: 600 }}>{item['DIE NO'] || '—'}</span>
                        <span style={muted}>{item['Order No'] || 'No order no'}</span>
                        <span style={{ ...muted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.Supplier || ''}</span>
                        {item.STATUS && <StatusPill status={item.STATUS} theme={theme} />}
                      </>
                    ) : (
                      <>
                        <span style={{ fontWeight: 600 }}>{item.qd_no || (item.approval_state === 'Draft' ? 'Draft QD' : `QD #${item.id}`)}</span>
                        <span style={muted}>{item.die_no}</span>
                        <span style={{ ...muted, flex: 1 }}>{formatDate(item.raised_date)}</span>
                        <span style={{ ...muted, fontWeight: 600 }}>{item.approval_state === 'Draft' ? 'Draft' : item.status}</span>
                      </>
                    )}
                  </div>
                );
              })}
              {group.total > group.items.length && (
                <div style={{ ...muted, padding: '4px 16px 8px' }}>Showing {group.items.length} of {group.total} — type more to narrow it down.</div>
              )}
            </div>
            );
          })}
        </div>

        {(opening || openError) && (
          <div role={openError ? 'alert' : 'status'} style={{ padding: '10px 16px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.85rem', color: openError ? '#ef4444' : theme.textMuted }}>
            {openError || 'Opening…'}
          </div>
        )}
      </div>
    </div>
  );
}
