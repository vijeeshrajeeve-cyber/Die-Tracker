import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldSearch, isSearchShortcut, flattenResults, moveIndex, isAbort, shortcutLabel,
  buildOptions, highlightParts, toRecent, pushRecent, dropRecent, readRecents, writeRecents, recentsKey, RECENT_LIMIT,
} from './searchPalette.js';

test('shouldSearch needs two non-space characters', () => {
  assert.equal(shouldSearch('ab'), true);
  assert.equal(shouldSearch(' a '), false);
  assert.equal(shouldSearch(''), false);
  assert.equal(shouldSearch(null), false);
});

test('Ctrl+K and Cmd+K open the palette; other combinations do not', () => {
  const key = (props) => ({ key: 'k', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...props });
  assert.equal(isSearchShortcut(key({ ctrlKey: true })), true);
  assert.equal(isSearchShortcut(key({ metaKey: true })), true);
  assert.equal(isSearchShortcut(key({ ctrlKey: true, key: 'K' })), true); // caps lock
  assert.equal(isSearchShortcut(key({})), false);
  assert.equal(isSearchShortcut(key({ ctrlKey: true, shiftKey: true })), false);
  assert.equal(isSearchShortcut(key({ ctrlKey: true, altKey: true })), false);
  assert.equal(isSearchShortcut(key({ ctrlKey: true, key: 'j' })), false);
});

test('flattenResults lists orders before QDs and tolerates missing groups', () => {
  const flat = flattenResults({ orders: { items: [{ id: 1 }], total: 1 }, qds: { items: [{ id: 2 }, { id: 3 }], total: 2 } });
  assert.deepEqual(flat.map(r => `${r.kind}:${r.item.id}`), ['order:1', 'qd:2', 'qd:3']);
  assert.deepEqual(flattenResults({ qds: { items: [{ id: 2 }], total: 1 } }).map(r => r.kind), ['qd']);
  assert.deepEqual(flattenResults(null), []);
});

test('moveIndex wraps both ways and starts at the right end', () => {
  assert.equal(moveIndex(-1, 1, 3), 0);
  assert.equal(moveIndex(-1, -1, 3), 2);
  assert.equal(moveIndex(2, 1, 3), 0);
  assert.equal(moveIndex(0, -1, 3), 2);
  assert.equal(moveIndex(1, 1, 0), -1);
});

test('isAbort recognises a cancelled fetch only', () => {
  assert.equal(isAbort(new DOMException('aborted', 'AbortError')), true);
  assert.equal(isAbort(new Error('Search failed')), false);
  assert.equal(isAbort(undefined), false);
});

test('buildOptions adds the orders-page row only when it can open and there are order results', () => {
  const results = { orders: { items: [{ id: 1 }], total: 1 }, qds: { items: [{ id: 2 }], total: 1 } };
  assert.deepEqual(buildOptions(results, ' D-1 ', { canSearchOrdersPage: true }).map(r => r.kind), ['order', 'qd', 'orders-page']);
  assert.equal(buildOptions(results, 'D-1', { canSearchOrdersPage: true }).at(-1).item.query, 'D-1');
  assert.deepEqual(buildOptions(results, 'D-1').map(r => r.kind), ['order', 'qd']);
  assert.deepEqual(buildOptions({ qds: results.qds }, 'D-1', { canSearchOrdersPage: true }).map(r => r.kind), ['qd']);
  assert.deepEqual(buildOptions(null, 'D-1', { canSearchOrdersPage: true }), []);
  assert.deepEqual(buildOptions({ orders: { items: [], total: 0 } }, 'D-1', { canSearchOrdersPage: true }), [], 'no matches, no row');
});

test('highlightParts marks every query word, case-insensitively', () => {
  assert.deepEqual(highlightParts('Hydro Extrusion 30533', 'hydro 305'), [
    { text: 'Hydro', match: true }, { text: ' Extrusion ', match: false }, { text: '305', match: true }, { text: '33', match: false },
  ]);
  assert.deepEqual(highlightParts('D-30533', '305 30533').map(p => p.text), ['D-', '30533'], 'longest word wins');
  assert.deepEqual(highlightParts('a.b(c)', '.b('), [{ text: 'a', match: false }, { text: '.b(', match: true }, { text: 'c)', match: false }]);
  assert.deepEqual(highlightParts('abc', ''), [{ text: 'abc', match: false }]);
  assert.deepEqual(highlightParts(null, 'x'), []);
});

test('toRecent keeps just what the empty-state row needs', () => {
  assert.deepEqual(toRecent('order', { id: 3, 'DIE NO': 'D-3', 'Order No': 'O-3', Supplier: 'ALPHA', STATUS: 'Open' }),
    { kind: 'order', id: 3, label: 'D-3', detail: 'O-3 · ALPHA' });
  assert.deepEqual(toRecent('qd', { id: 9, qd_no: null, approval_state: 'Draft', die_no: 'D-1' }),
    { kind: 'qd', id: 9, label: 'Draft QD', detail: 'D-1' });
});

test('pushRecent moves a reopened entry to the front without duplicating, and caps the list', () => {
  const a = { kind: 'order', id: 1 };
  const b = { kind: 'qd', id: 1 }; // same id, different kind: a different entry
  assert.deepEqual(pushRecent([a, b], { ...a, label: 'new' }), [{ ...a, label: 'new' }, b]);
  const many = Array.from({ length: 20 }, (_, i) => ({ kind: 'order', id: i }));
  assert.equal(many.reduce(pushRecent, []).length, RECENT_LIMIT);
  assert.deepEqual(dropRecent([a, b], { kind: 'qd', id: 1 }), [a]);
});

test('recents survive a round trip and a corrupt or blocked store reads as empty', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const key = recentsKey(5);
  writeRecents(storage, key, [{ kind: 'order', id: 1, label: 'D-1' }, { kind: 'bogus', id: 2 }, { kind: 'qd', id: 'x' }]);
  assert.deepEqual(readRecents(storage, key), [{ kind: 'order', id: 1, label: 'D-1' }]);
  store.set(key, '{not json');
  assert.deepEqual(readRecents(storage, key), []);
  const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.deepEqual(readRecents(blocked, key), []);
  assert.doesNotThrow(() => writeRecents(blocked, key, []));
  assert.notEqual(recentsKey(5), recentsKey(6));
});

test('shortcutLabel shows ⌘K on Mac and Ctrl K elsewhere', () => {
  assert.equal(shortcutLabel('MacIntel'), '⌘K');
  assert.equal(shortcutLabel('Win32'), 'Ctrl K');
  assert.equal(shortcutLabel(''), 'Ctrl K');
});
