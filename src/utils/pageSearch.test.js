import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROLLABLE_PAGES, pageSearchHint } from './constants.js';

test('every process-flow page gets a search hint', () => {
  for (const page of CONTROLLABLE_PAGES.filter(p => p.id.startsWith('flow-'))) {
    assert.ok(pageSearchHint(page.id), `${page.id} has no search hint`);
  }
});

test('sample followup keeps its own hint, not the generic flow one', () => {
  assert.match(pageSearchHint('flow-sample-followup'), /corrector/);
});

test('pages with nothing to filter have no hint, so the box hides', () => {
  for (const id of ['dashboard', 'analytics', 'email-inbox', 'settings', 'users', undefined]) {
    assert.equal(pageSearchHint(id), null);
  }
});
