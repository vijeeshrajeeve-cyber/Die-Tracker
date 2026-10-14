import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldSearch, isSearchShortcut, flattenResults, moveIndex, isAbort, shortcutLabel,
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

test('shortcutLabel shows ⌘K on Mac and Ctrl K elsewhere', () => {
  assert.equal(shortcutLabel('MacIntel'), '⌘K');
  assert.equal(shortcutLabel('Win32'), 'Ctrl K');
  assert.equal(shortcutLabel(undefined), 'Ctrl K');
});
