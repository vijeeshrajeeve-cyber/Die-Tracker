// src/components/search/SearchPalette.jsx
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, Package, AlertTriangle, X, Layers, Building2, ArrowUpDown, CornerDownLeft } from 'lucide-react';
import useDialog from '../../hooks/useDialog';
import StatusPill from '../ui/StatusPill';
import ProfileThumb from '../orders/ProfileThumb';
import { searchAPI } from '../../api';
import {
  shouldSearch, buildOptions, moveIndex, isAbort, isSearchShortcut, highlightParts,
  toRecent, pushRecent, dropRecent, readRecents, writeRecents, recentsKey, DEBOUNCE_MS, GROUP_LABELS,
  groupRecents, scopeResults, scopeRecents, SCOPES,
} from '../../utils/searchPalette';

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Reading window.localStorage itself throws when site data is blocked.
const browserStorage = () => {
  try { return window.localStorage; } catch { return null; }
};

const KIND_ICONS = { order: Package, qd: AlertTriangle };
const SCOPE_ICONS = { all: Layers, order: Package, qd: AlertTriangle };
// The small icon in front of a row's secondary text: the supplier for an
// order, the die for a QD.
const DETAIL_ICONS = { order: Building2, qd: Package };

// The typed words picked out in each row, so it is obvious why a row matched.
function Highlight({ text, query }) {
  return highlightParts(text, query).map((part, i) => (part.match
    ? <mark key={i} style={{ background: 'rgba(250, 204, 21, 0.35)', color: 'inherit', borderRadius: 2 }}>{part.text}</mark>
    : <React.Fragment key={i}>{part.text}</React.Fragment>));
}

export default function SearchPalette({ open, onClose, theme, userId, onOpenOrder, onOpenQd, onSearchOrdersPage }) {
  const dialogRef = useDialog({ open, onClose });
  const titleId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [active, setActive] = useState(-1);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');
  const storageKey = recentsKey(userId);
  const [recents, setRecents] = useState(() => readRecents(browserStorage(), storageKey));
  const [scope, setScope] = useState('all');
  // Read inside the search effect, which must not refetch when only the scope changes.
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const listRef = useRef(null);
  const inputRef = useRef(null);
  // An Enter pressed before the results for the typed query have arrived.
  const pendingEnter = useRef(false);

  // The palette is mounted fresh on every open (see DieOrderingSystem), so state
  // starts clean. Focus the input directly rather than waiting for useDialog's
  // requestAnimationFrame; declared after useDialog so its effect has already
  // recorded the trigger to restore focus to.
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced search; aborting the previous request keeps a slow, older
  // answer from replacing a newer one.
  useEffect(() => {
    pendingEnter.current = false;
    if (!open || !shouldSearch(query)) { setResults(null); setActive(-1); setStatus('idle'); return undefined; }
    const controller = new AbortController();
    // Drop the previous query's rows so nothing stale is selectable while loading.
    setResults(null);
    setActive(-1);
    setStatus('loading');
    const timer = setTimeout(() => {
      searchAPI.query(query.trim(), { signal: controller.signal })
        .then((body) => { setResults(body); setStatus('done'); setActive(buildOptions(scopeResults(body, scopeRef.current), query).length ? 0 : -1); })
        .catch((error) => {
          if (isAbort(error)) return;
          setResults(null);
          setActive(-1);
          setStatus('error');
        });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, query]);

  // Nothing typed yet: the recently opened list stands in for results.
  const scopedRecents = useMemo(() => scopeRecents(recents, scope), [recents, scope]);
  const scopedResults = useMemo(() => scopeResults(results, scope), [results, scope]);
  const showingRecents = status === 'idle' && scopedRecents.length > 0;
  const options = useMemo(() => (showingRecents
    ? scopedRecents.map((entry) => ({ kind: entry.kind, item: entry, recent: true }))
    : buildOptions(scopedResults, query, { canSearchOrdersPage: Boolean(onSearchOrdersPage) })),
  [showingRecents, scopedRecents, scopedResults, query, onSearchOrdersPage]);

  const pickScope = (key) => {
    setScope(key);
    setActive(status === 'done' && buildOptions(scopeResults(results, key), query).length ? 0 : -1);
    inputRef.current?.focus();
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const saveRecents = (next) => { setRecents(next); writeRecents(browserStorage(), storageKey, next); };
  const remember = (kind, item) => saveRecents(pushRecent(recents, toRecent(kind, item)));
  const forget = (entry) => {
    saveRecents(dropRecent(recents, entry));
    setActive(-1);
  };

  const choose = async (entry) => {
    if (!entry || opening) return;
    setOpenError('');
    if (entry.kind === 'orders-page') { onSearchOrdersPage(entry.item.query); onClose(); return; }
    if (entry.kind === 'order' && !entry.recent) { remember('order', entry.item); onOpenOrder(entry.item); onClose(); return; }
    setOpening(true);
    try {
      if (entry.kind === 'order') {
        // A recent is only a label: re-read it so the drawer gets today's order.
        const order = await searchAPI.order(entry.item.id);
        remember('order', order);
        onOpenOrder(order);
      } else {
        const record = await onOpenQd(entry.item);
        // The opened record relabels the recent, e.g. a draft that now has a QD no.
        if (record) remember('qd', record);
        else if (!entry.recent) remember('qd', entry.item);
      }
      onClose();
    } catch (error) {
      // Gone, or no longer yours to open: stop offering it.
      if (entry.recent && (error?.status === 404 || error?.status === 403)) forget(entry.item);
      setOpenError(error?.message || (entry.kind === 'order' ? 'Could not open that order' : 'Could not open that QD'));
    } finally {
      setOpening(false);
    }
  };

  // Enter typed ahead of the answer opens the top result once it lands; an
  // empty or failed answer drops it.
  useEffect(() => {
    if (!pendingEnter.current || (status !== 'done' && status !== 'error')) return;
    pendingEnter.current = false;
    if (status === 'done' && options[0]) choose(options[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, options]);

  const onKeyDown = (event) => {
    // The shortcut that opened the palette also closes it. Stopped here so the
    // page-level listener doesn't reopen it once this one has unmounted.
    if (isSearchShortcut(event)) { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    const step = event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey) ? 1
      : event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey) ? -1 : 0;
    if (step) { event.preventDefault(); setActive((i) => moveIndex(i, step, options.length)); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      if (options[active]) choose(options[active]);
      else if (shouldSearch(query) && status !== 'done' && status !== 'error') pendingEnter.current = true;
    }
  };

  if (!open) return null;

  const muted = { color: theme.textMuted, fontSize: '0.8rem' };
  const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  const groupLabel = { color: theme.textMuted, fontSize: '0.78rem', fontWeight: 600, padding: '14px 20px 6px' };
  const notice = { ...muted, fontSize: '0.85rem', padding: '18px 20px' };
  const rowProps = (i, entry) => ({
    id: `${titleId}-opt-${i}`, 'data-index': i, role: 'option', 'aria-selected': i === active,
    onMouseMove: () => setActive(i), onClick: () => choose(entry),
    style: { display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, padding: '8px 20px', cursor: 'pointer', background: i === active ? theme.rowHover : 'transparent' },
  });
  const kbd = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: theme.textMuted };
  const title = { fontSize: '0.95rem', fontWeight: 500, color: theme.text, flexShrink: 0, maxWidth: '45%', ...ellipsis };
  // Secondary text after the title, led by a small icon like Evernote's notebook name.
  const detail = (kind, children) => {
    const Icon = DETAIL_ICONS[kind];
    return (
      <span style={{ ...muted, display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0 }}>
        <Icon size={13} style={{ color: theme.textDim, flexShrink: 0 }} />
        <span style={ellipsis}>{children}</span>
      </span>
    );
  };

  const groups = [
    { kind: 'order', group: scopedResults?.orders },
    { kind: 'qd', group: scopedResults?.qds },
  ].filter(({ group }) => group && group.items.length);
  const q = query.trim();
  const resultCount = groups.reduce((n, { group }) => n + group.total, 0);
  const scopeNoun = scope === 'all' ? null : SCOPES.find((s) => s.key === scope).label.toLowerCase();

  let index = -1;
  const pageEntry = options.find((entry) => entry.kind === 'orders-page');
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: theme.overlayBg || 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '9vh 16px 16px' }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}
        style={{ width: '100%', maxWidth: 760, background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 12, boxShadow: theme.shadowLg, overflow: 'hidden', color: theme.text }}>
        <h2 id={titleId} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Search</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px' }}>
          <Search size={20} style={{ color: theme.textMuted, flexShrink: 0 }} />
          <input ref={inputRef} className="search-palette-input" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
            role="combobox" aria-expanded={options.length > 0} aria-controls={`${titleId}-list`}
            aria-activedescendant={active >= 0 ? `${titleId}-opt-${active}` : undefined}
            aria-label="Search die orders and QDs" placeholder="Search die no, order no, QD no, supplier…"
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: theme.text, fontSize: '1.1rem' }} />
          {query && (
            <button type="button" tabIndex={-1} aria-label="Clear search" onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              style={{ border: 'none', background: 'transparent', color: theme.textDim, cursor: 'pointer', padding: 2, display: 'flex' }}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* Mouse-only like the row buttons, so Tab keeps moving through the rows. */}
        <div role="toolbar" aria-label="Search in" style={{ display: 'flex', gap: 4, padding: '5px 12px', background: theme.inputBg, borderTop: `1px solid ${theme.cardBorder}`, borderBottom: `1px solid ${theme.cardBorder}`, overflowX: 'auto' }}>
          {SCOPES.map(({ key, label }) => {
            const Icon = SCOPE_ICONS[key];
            const on = scope === key;
            return (
              <button key={key} type="button" tabIndex={-1} aria-pressed={on} onClick={() => pickScope(key)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap', fontSize: '0.85rem', fontWeight: on ? 600 : 400, background: on ? theme.rowHover : 'transparent', color: on ? theme.text : theme.textMuted }}>
                <Icon size={14} />
                {label}
              </button>
            );
          })}
        </div>

        <div ref={listRef} id={`${titleId}-list`} role="listbox" style={{ maxHeight: '58vh', overflowY: 'auto', paddingBottom: 8 }}>
          {status === 'idle' && !showingRecents && <p style={notice}>Type at least 2 characters to search {scopeNoun || 'die orders and Quality Discrepancies'}. Several words match across fields, e.g. “hydro 30533”.</p>}
          {status === 'loading' && !results && <p style={notice}>Searching…</p>}
          {status === 'error' && <p role="alert" style={{ ...notice, color: '#ef4444' }}>Search failed — try again.</p>}
          {status === 'done' && options.length === 0 && <p style={notice}>No {scopeNoun || 'matches'} for “{q}”.</p>}

          {showingRecents && groupRecents(scopedRecents).map(({ label, entries }) => (
            <div key={label} role="group" aria-label={`Opened ${label.toLowerCase()}`}>
              <div style={groupLabel}>{label}</div>
              {entries.map(({ entry: item, index: i }) => {
                const Icon = KIND_ICONS[item.kind];
                return (
                  <div key={`recent-${item.kind}-${item.id}`} {...rowProps(i, options[i])}>
                    <Icon size={17} style={{ color: theme.textMuted, flexShrink: 0 }} />
                    <span style={title}>{item.label}</span>
                    {item.detail ? detail(item.kind, item.detail) : <span style={{ flex: 1 }} />}
                    <button type="button" tabIndex={-1} aria-label={`Remove ${item.label} from recently opened`}
                      onClick={(e) => { e.stopPropagation(); forget(item); }}
                      style={{ border: 'none', background: 'transparent', color: theme.textDim, cursor: 'pointer', padding: 2, display: 'flex', visibility: i === active ? 'visible' : 'hidden' }}>
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}

          {groups.map((entry) => {
            const { kind, group } = entry;
            const Icon = KIND_ICONS[kind];
            return (
            <div key={kind} role="group" aria-label={GROUP_LABELS[kind]}>
              <div style={groupLabel}>{GROUP_LABELS[kind]}</div>
              {group.items.map((item) => {
                index += 1;
                return (
                  <div key={`${kind}-${item.id}`} {...rowProps(index, { kind, item })}>
                    {kind === 'order' && item.profileImageId
                      ? <ProfileThumb orderId={item.id} fileId={item.profileImageId} size={28} alt={`Profile of ${item['DIE NO']}`} theme={theme} />
                      : <Icon size={17} style={{ color: theme.textMuted, flexShrink: 0 }} />}
                    {kind === 'order' ? (
                      <>
                        <span style={title}><Highlight text={item['DIE NO'] || '—'} query={q} /></span>
                        <span style={{ ...muted, flexShrink: 0 }}><Highlight text={item['Order No'] || 'No order no'} query={q} /></span>
                        {detail('order', <Highlight text={item.Supplier || '—'} query={q} />)}
                        {item.STATUS && <StatusPill status={item.STATUS} theme={theme} />}
                      </>
                    ) : (
                      <>
                        <span style={title}><Highlight text={item.qd_no || (item.approval_state === 'Draft' ? 'Draft QD' : `QD #${item.id}`)} query={q} /></span>
                        {detail('qd', <Highlight text={item.die_no || '—'} query={q} />)}
                        <span style={{ ...muted, flexShrink: 0 }}>{formatDate(item.raised_date)}</span>
                        <span style={{ ...muted, fontWeight: 600, flexShrink: 0 }}>{item.approval_state === 'Draft' ? 'Draft' : item.status}</span>
                      </>
                    )}
                  </div>
                );
              })}
              {group.total > group.items.length && (
                <div style={{ ...muted, padding: '4px 20px 6px' }}>Showing {group.items.length} of {group.total} — type more to narrow it down.</div>
              )}
            </div>
            );
          })}

          {pageEntry && (
            <div {...rowProps(options.length - 1, pageEntry)} style={{ ...rowProps(options.length - 1, pageEntry).style, borderTop: `1px solid ${theme.cardBorder}`, marginTop: 8 }}>
              <Search size={16} style={{ color: theme.textMuted, flexShrink: 0 }} />
              <span style={{ fontSize: '0.9rem' }}>Filter the die orders page by “<b>{pageEntry.item.query}</b>”</span>
            </div>
          )}
        </div>

        {(opening || openError) && (
          <div role={openError ? 'alert' : 'status'} style={{ padding: '10px 20px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.85rem', color: openError ? '#ef4444' : theme.textMuted }}>
            {openError || 'Opening…'}
          </div>
        )}

        <div aria-hidden="true" style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '10px 20px', borderTop: `1px solid ${theme.cardBorder}`, background: theme.inputBg }}>
          <span style={kbd}><ArrowUpDown size={12} /> Select</span>
          <span style={kbd}><CornerDownLeft size={12} /> Open</span>
          <span style={kbd}><b style={{ fontWeight: 600 }}>Esc</b> Close</span>
          <span style={{ ...kbd, marginLeft: 'auto' }}>
            {status === 'done' ? `${resultCount} result${resultCount === 1 ? '' : 's'}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
