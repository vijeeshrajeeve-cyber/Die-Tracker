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

export const moveIndex = (current, delta, length) => {
  if (!length) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return (current + delta + length) % length;
};

export const isAbort = (error) => error?.name === 'AbortError';

export const shortcutLabel = (platform = globalThis.navigator?.platform) =>
  (/mac/i.test(platform || '') ? '⌘K' : 'Ctrl K');
