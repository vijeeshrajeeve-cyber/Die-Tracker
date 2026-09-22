'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const d = require('./deliveryFollowup.cjs');

test('normalizeEta accepts the date forms the order routes accept', () => {
  assert.equal(d.normalizeEta('2026-10-01'), '2026-10-01');
  assert.equal(d.normalizeEta('2026-10-01T00:00:00.000Z'), '2026-10-01');
  assert.equal(d.normalizeEta('1/10/2026'), '2026-10-01');
  assert.equal(d.normalizeEta('01.10.2026'), '2026-10-01');
  assert.equal(d.normalizeEta(' 01-10-2026 '), '2026-10-01');
});

test('normalizeEta treats anything else as no ETA', () => {
  for (const v of [null, undefined, '', '  ', 'TBC', 'next week', '2026-02-30', '31/02/2026', 'Oct 1 2026']) {
    assert.equal(d.normalizeEta(v), null, String(v));
  }
});

test('a first ETA is recorded as set, with no cause needed', () => {
  assert.deepEqual(d.planEtaChange(null, '2026-10-01'), { kind: 'eta_set', before: null, after: '2026-10-01' });
  assert.deepEqual(d.planEtaChange('TBC', '2026-10-01'), { kind: 'eta_set', before: null, after: '2026-10-01' });
});

test('an unchanged date records nothing, even in another format', () => {
  assert.equal(d.planEtaChange('2026-10-01', '01/10/2026'), null);
  assert.equal(d.planEtaChange('', 'TBC'), null);
});

test('moving a set ETA needs a cause', () => {
  assert.throws(() => d.planEtaChange('2026-10-01', '2026-10-15'),
    (e) => e instanceof d.DeliveryRuleError && e.code === 'ETA_CAUSE_REQUIRED' && e.status === 400);
  assert.throws(() => d.planEtaChange('2026-10-01', '2026-10-15', { cause: 'weather' }), { code: 'ETA_CAUSE_REQUIRED' });
  assert.throws(() => d.planEtaChange('2026-10-01', '2026-10-15', { cause: 'other' }), { code: 'ETA_CAUSE_REQUIRED' });
  assert.deepEqual(d.planEtaChange('2026-10-01', '2026-10-15', { cause: 'supplier_delay', note: ' Heat treatment ' }),
    { kind: 'eta_revised', before: '2026-10-01', after: '2026-10-15', cause: 'supplier_delay', note: 'Heat treatment' });
});

test('clearing a set ETA is a revision too', () => {
  assert.throws(() => d.planEtaChange('2026-10-01', ''), { code: 'ETA_CAUSE_REQUIRED' });
  assert.deepEqual(d.planEtaChange('2026-10-01', 'TBC', { cause: 'logistics' }),
    { kind: 'eta_revised', before: '2026-10-01', after: null, cause: 'logistics', note: null });
});

test('a follow-up needs a date, a channel and a reply or a new ETA', () => {
  const ok = { contactDate: '2026-09-22', channel: 'phone', note: 'Dispatching Friday' };
  assert.deepEqual(d.validateFollowUp(ok, '2026-09-22'),
    { contactDate: '2026-09-22', channel: 'phone', note: 'Dispatching Friday', newEta: null, change: { cause: undefined, note: undefined } });
  assert.throws(() => d.validateFollowUp({ ...ok, contactDate: '' }, '2026-09-22'), d.DeliveryRuleError);
  assert.throws(() => d.validateFollowUp({ ...ok, contactDate: '2026-09-23' }, '2026-09-22'), /future/);
  assert.throws(() => d.validateFollowUp({ ...ok, channel: 'fax' }, '2026-09-22'), /contacted/);
  assert.throws(() => d.validateFollowUp({ ...ok, note: ' ' }, '2026-09-22'), /reply or give a new ETA/);
  assert.throws(() => d.validateFollowUp({ ...ok, newEta: 'soon' }, '2026-09-22'), /Invalid new ETA/);
  assert.equal(d.validateFollowUp({ ...ok, note: '', newEta: '2026-10-09' }, '2026-09-22').newEta, '2026-10-09');
});

test('summaries derive the original ETA and slips from the revisions', () => {
  assert.deepEqual(d.summarize({ id: 1, eta: '2026-10-15', first_revised_from: '2026-10-01', slips: 2,
    last_contact_date: '2026-09-20', last_contact_channel: 'email', last_chased_at: new Date('2026-09-21T04:00:00Z') }),
  { originalEta: '2026-10-01', slips: 2, daysSlipped: 14,
    lastContact: { date: '2026-09-20', channel: 'email' }, lastChasedAt: '2026-09-21T04:00:00.000Z' });
  assert.deepEqual(d.summarize({ id: 2, eta: '2026-10-01', first_revised_from: null, slips: 0 }),
    { originalEta: '2026-10-01', slips: 0, daysSlipped: 0, lastContact: null, lastChasedAt: null });
  assert.equal(d.summarize({ id: 3, eta: 'TBC', first_revised_from: null, slips: 0 }).originalEta, null);
});

test('event inserts carry who did it', async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: 9 }] }; } };
  await d.insertEtaEvent(db, 4, { kind: 'eta_revised', before: '2026-10-01', after: '2026-10-15', cause: 'our_change', note: null }, { id: 2, username: 'amal' });
  assert.match(calls[0].sql, /INSERT INTO die_delivery_events/);
  assert.deepEqual(calls[0].params, [4, 'eta_revised', '2026-10-01', '2026-10-15', 'our_change', null, 2, 'amal']);
  await d.insertContactEvent(db, 4, { contactDate: '2026-09-22', channel: 'phone', note: 'Friday' }, null);
  assert.deepEqual(calls[1].params, [4, '2026-09-22', 'phone', 'Friday', null, null]);
});
