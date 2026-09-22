import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  CAUSES, CHANNELS, normalizeEta, etaChip, compareByUrgency, countBuckets,
  needsCause, validateFollowUpForm, formatSlip, causeLabel,
} from './deliveryFollowup.js';

const server = createRequire(import.meta.url)('../../server/services/deliveryFollowup.cjs');
const TODAY = '2026-09-22';

// Two copies of the ETA rules, one ESM for Vite and one CommonJS for the
// server. These checks are what stop them drifting.
test('the client and server agree on what an ETA is', () => {
  for (const v of ['2026-10-01', '2026-10-01T00:00:00Z', '1/10/2026', '01.10.2026', 'TBC', '', null, '31/02/2026']) {
    assert.equal(normalizeEta(v), server.normalizeEta(v), String(v));
  }
  assert.deepEqual(CAUSES.map((c) => c.value), [...server.CAUSES]);
  assert.deepEqual(CHANNELS.map((c) => c.value), [...server.CHANNELS]);
});

test('chips put each die in one bucket', () => {
  assert.deepEqual(etaChip('2026-09-10', TODAY), { bucket: 'overdue', tone: 'danger', text: '12d overdue' });
  assert.deepEqual(etaChip('2026-09-22', TODAY), { bucket: 'due_soon', tone: 'warning', text: 'Due today' });
  assert.deepEqual(etaChip('2026-09-29', TODAY), { bucket: 'due_soon', tone: 'warning', text: 'Due in 7d' });
  assert.deepEqual(etaChip('2026-09-30', TODAY, () => '30 Sep'), { bucket: 'later', tone: 'neutral', text: '30 Sep' });
  assert.deepEqual(etaChip('TBC', TODAY), { bucket: 'no_eta', tone: 'muted', text: 'No ETA' });
});

test('urgency order: most overdue, soonest due, later, then no ETA', () => {
  const rows = [
    { 'DIE NO': 'N-2', ETA: '' }, { 'DIE NO': 'L', ETA: '2026-12-01' }, { 'DIE NO': 'O-new', ETA: '2026-09-20' },
    { 'DIE NO': 'S', ETA: '2026-09-24' }, { 'DIE NO': 'O-old', ETA: '2026-09-01' }, { 'DIE NO': 'N-1', ETA: 'TBC' },
  ];
  assert.deepEqual(rows.sort((a, b) => compareByUrgency(a, b, TODAY)).map((r) => r['DIE NO']),
    ['O-old', 'O-new', 'S', 'L', 'N-1', 'N-2']);
  assert.deepEqual(countBuckets(rows, TODAY), { overdue: 2, due_soon: 1, later: 1, no_eta: 2 });
});

test('a cause is needed only when a real ETA changes', () => {
  assert.equal(needsCause('2026-10-01', '2026-10-15'), true);
  assert.equal(needsCause('2026-10-01', ''), true);
  assert.equal(needsCause('2026-10-01', '01/10/2026'), false);
  assert.equal(needsCause('TBC', '2026-10-15'), false);
  assert.equal(needsCause('', '2026-10-15'), false);
});

test('the follow-up form mirrors the server rules', () => {
  const ok = { contactDate: TODAY, channel: 'phone', note: 'Friday', newEta: '', cause: '', causeNote: '' };
  assert.equal(validateFollowUpForm(ok, '2026-10-01', TODAY), null);
  assert.match(validateFollowUpForm({ ...ok, contactDate: '2026-09-23' }, '2026-10-01', TODAY), /future/);
  assert.match(validateFollowUpForm({ ...ok, note: '' }, '2026-10-01', TODAY), /reply or give a new ETA/);
  assert.match(validateFollowUpForm({ ...ok, newEta: '2026-10-15' }, '2026-10-01', TODAY), /cause/);
  assert.match(validateFollowUpForm({ ...ok, newEta: '2026-10-15', cause: 'other' }, '2026-10-01', TODAY), /other cause/);
  assert.equal(validateFollowUpForm({ ...ok, newEta: '2026-10-15', cause: 'logistics' }, '2026-10-01', TODAY), null);
  assert.equal(validateFollowUpForm({ ...ok, note: '', newEta: '2026-10-15' }, '', TODAY), null, 'a first ETA needs no cause');
});

test('labels and slip text', () => {
  assert.equal(formatSlip(14), '+14d');
  assert.equal(formatSlip(-3), '−3d');
  assert.equal(formatSlip(0), '0d');
  assert.equal(causeLabel('logistics'), 'Shipping / logistics');
});
