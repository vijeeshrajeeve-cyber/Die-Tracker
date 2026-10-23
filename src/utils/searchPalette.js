// Pure helpers for the Ctrl+K search palette, kept out of the component so
// they can be tested under plain node.

export const MIN_QUERY_LENGTH = 2;
export const DEBOUNCE_MS = 200;
export const GROUP_LABELS = { order: 'Die orders', qd: 'Quality Discrepancies' };

export const shouldSearch = (q) => (q || '').trim().length >= MIN_QUERY_LENGTH;

// Shift and Alt are left alone so Ctrl+Shift+K (browser devtools) still works.
export const isSearchShortcut = (event) => (event.ctrlKey || event.metaKey)
  && !event.altKey && !event.shiftKey && (event.key === 'k' || event.key === 'K');

// One list in display order, so arrow keys move across both groups.
export const flattenResults = (results) => [
  ...(results?.orders?.items || []).map((item) => ({ kind: 'order', item })),
  ...(results?.qds?.items || []).map((item) => ({ kind: 'qd', item })),
];

// The selectable rows: the results, then one last row that hands the query to
// the orders page's own filter — the "Search for … in Notes" escape hatch at
// the foot of Evernote's switcher.
export const buildOptions = (results, query, { canSearchOrdersPage = false } = {}) => {
  const flat = flattenResults(results);
  const q = (query || '').trim();
  return canSearchOrdersPage && results?.orders?.items?.length && q ? [...flat, { kind: 'orders-page', item: { id: 'orders-page', query: q } }] : flat;
};

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Splits text into plain and matched runs, matching each query word on its
// own so "hydro 305" lights up both words. Longest word first, so "30533"
// wins over "305" where they overlap.
export const highlightParts = (text, query) => {
  const value = text == null ? '' : String(text);
  const words = [...new Set((query || '').trim().split(/\s+/).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!value || !words.length) return value ? [{ text: value, match: false }] : [];
  const pattern = new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'gi');
  return value.split(pattern).filter(Boolean).map((part) => ({ text: part, match: words.some((w) => w.toLowerCase() === part.toLowerCase()) }));
};

// Recently opened results, shown before anything is typed. Kept per user in
// this browser only: a convenience, so a missing or corrupt list is just empty.
export const RECENT_LIMIT = 8;
export const recentsKey = (userId) => `dieTracker.search.recents.${userId ?? 'anon'}`;

export const toRecent = (kind, item) => (kind === 'order'
  ? { kind, id: item.id, label: item['DIE NO'] || '—', detail: [item['Order No'], item.Supplier].filter(Boolean).join(' · ') }
  : { kind, id: item.id, label: item.qd_no || (item.approval_state === 'Draft' ? 'Draft QD' : `QD #${item.id}`), detail: item.die_no || '' });

const sameEntry = (a, b) => a.kind === b.kind && a.id === b.id;

export const pushRecent = (list, entry) => [entry, ...(list || []).filter((e) => !sameEntry(e, entry))].slice(0, RECENT_LIMIT);
export const dropRecent = (list, entry) => (list || []).filter((e) => !sameEntry(e, entry));

export const readRecents = (storage, key) => {
  try {
    const parsed = JSON.parse(storage?.getItem(key) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((e) => e && (e.kind === 'order' || e.kind === 'qd') && Number.isInteger(e.id)).slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
};

export const writeRecents = (storage, key, list) => {
  try { storage?.setItem(key, JSON.stringify(list)); } catch { /* storage blocked or full: recents just won't persist */ }
};

export const moveIndex = (current, delta, length) => {
  if (!length) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return (current + delta + length) % length;
};

export const isAbort = (error) => error?.name === 'AbortError';

export const shortcutLabel = (platform = globalThis.navigator?.platform) =>
  (/mac/i.test(platform || '') ? '⌘K' : 'Ctrl K');
