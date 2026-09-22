'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const chaser = require('./deliveryChaser.cjs');

const TODAY = '2026-09-22';

test('a die past its ETA is overdue; a future ETA is not chased', () => {
  assert.deepEqual(chaser.classifyDie({ eta: '2026-09-19' }, TODAY, 7), { bucket: 'overdue', daysOverdue: 3 });
  assert.equal(chaser.classifyDie({ eta: '2026-09-22' }, TODAY, 7), null);
  assert.equal(chaser.classifyDie({ eta: '2026-10-30' }, TODAY, 7), null);
});

test('no ETA is chased once the die has been in manufacturing long enough', () => {
  assert.deepEqual(chaser.classifyDie({ eta: 'TBC', design_to_ems_date: '2026-09-15' }, TODAY, 7),
    { bucket: 'no_eta', daysInManufacturing: 7 });
  assert.equal(chaser.classifyDie({ eta: '', design_to_ems_date: '2026-09-16' }, TODAY, 7), null);
  assert.deepEqual(chaser.classifyDie({ eta: null, design_to_ems_date: null }, TODAY, 7),
    { bucket: 'no_eta', daysInManufacturing: null }, 'no anchor still asks for an ETA');
});

test('a supplier is due every N days', () => {
  assert.equal(chaser.isSupplierDue(null, TODAY, 3), true);
  assert.equal(chaser.isSupplierDue('2026-09-20', TODAY, 3), false);
  assert.equal(chaser.isSupplierDue('2026-09-19', TODAY, 3), true);
  assert.equal(chaser.isSupplierDue('2026-09-21', TODAY, 1), true);
  assert.equal(chaser.nextChaseDay('2026-09-20', 3), '2026-09-23');
});

const dies = [
  { id: 1, die_no: 'A-1', order_no: 'O1', plant: 'EXT 1', supplier: 'PHME', eta: '2026-09-10', design_to_ems_date: '2026-08-01', slips: 2 },
  { id: 2, die_no: 'A-2', order_no: 'O2', plant: 'EXT 2', supplier: 'phme ', eta: null, design_to_ems_date: '2026-09-01', slips: 0 },
  { id: 3, die_no: 'B-1', order_no: 'O3', plant: 'EXT 1', supplier: 'EKSTEK', eta: '2026-12-01', design_to_ems_date: '2026-09-01', slips: 0 },
  { id: 4, die_no: 'C-1', order_no: 'O4', plant: 'EXT 1', supplier: 'ALMAX', eta: '2026-09-01', design_to_ems_date: null, slips: 0 },
];

test('planChasers groups by supplier name, ignoring case and spaces', () => {
  const plan = chaser.planChasers({
    dies,
    emails: new Map([['PHME', 'sales@phme.test']]),
    lastSent: new Map([['ALMAX', '2026-09-21']]),
    today: TODAY, intervalDays: 3, noEtaDays: 7,
  });
  assert.deepEqual(plan.map((p) => [p.supplier, p.to, p.due, p.overdue.length, p.noEta.length]), [
    ['ALMAX', null, false, 1, 0],
    ['PHME', 'sales@phme.test', true, 1, 1],
  ]);
  assert.equal(plan[0].nextDay, '2026-09-24');
});

test('the email lists both sections, escaped, and omits an empty one', () => {
  const overdue = [{ die_no: 'A-1<b>', order_no: 'O1', plant: 'EXT 1', eta: '2026-09-10', daysOverdue: 12, slips: 2 }];
  const noEta = [{ die_no: 'A-2', order_no: 'O2', plant: 'EXT 2', daysInManufacturing: null }];
  const html = chaser.buildSupplierBody('PHME', overdue, noEta);
  assert.match(html, /Past the ETA you gave \(1\)/);
  assert.match(html, /ETA not yet given \(1\)/);
  assert.match(html, /A-1&lt;b&gt;/);
  assert.match(html, /—/);
  assert.doesNotMatch(chaser.buildSupplierBody('PHME', overdue, []), /ETA not yet given/);
  assert.equal(chaser.buildSubject('PHME', overdue, noEta), 'Die delivery follow-up — 1 overdue, 1 awaiting ETA - PHME');
});

// A fake pool: remembers chasers it records so a second run sees them.
function fakeDb({ failRecord = false } = {}) {
  const chasers = [];
  const events = [];
  const settings = { id: 1, delivery_chaser_interval_days: 3, delivery_chaser_no_eta_days: 7, delivery_chaser_cc: 'buyer@us.test' };
  const query = async (sql, params = []) => {
    const q = sql.trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
    if (q.startsWith('SELECT * FROM reminder_settings')) return { rows: [settings] };
    if (q.startsWith('SELECT o.id, o.die_no')) return { rows: dies };
    if (q.startsWith('SELECT name, contact_email FROM suppliers')) {
      return { rows: [{ name: 'PHME', contact_email: 'sales@phme.test' }, { name: 'ALMAX', contact_email: '' }] };
    }
    if (q.startsWith('SELECT upper(trim(supplier)) AS key')) {
      return { rows: chasers.map((c) => ({ key: c.supplier.trim().toUpperCase(), last_sent: c.sent_at })) };
    }
    if (q.startsWith('INSERT INTO die_delivery_chasers')) {
      if (failRecord) throw new Error('disk full');
      chasers.push({ supplier: params[0], sent_at: new Date('2026-09-22T09:00:00') });
      return { rows: [{ id: chasers.length }] };
    }
    if (q.startsWith('INSERT INTO die_delivery_events')) { events.push(params); return { rows: [] }; }
    if (q.startsWith('UPDATE reminder_settings SET delivery_chaser_last_run')) return { rows: [] };
    throw new Error(`chaser test: unexpected query ${q}`);
  };
  return { query, connect: async () => ({ query, release() {} }), chasers, events };
}

const NOW = new Date('2026-09-22T09:00:00');

test('a run mails each due supplier with an email, records it, and skips the rest', async () => {
  const db = fakeDb();
  const sent = [];
  const summary = await chaser.sendDeliveryChasers({ db, now: NOW, checkSendable: async () => {}, send: async (m) => { sent.push(m); } });
  assert.deepEqual(sent.map((m) => [m.to, m.cc]), [['sales@phme.test', 'buyer@us.test']]);
  assert.deepEqual(summary.skippedNoEmail, ['ALMAX']);
  assert.equal(summary.sent, 1);
  assert.deepEqual(db.events[0], [[1, 2], 1, 'Chaser emailed to sales@phme.test']);
});

test('Send now twice in a day does not mail a supplier twice', async () => {
  const db = fakeDb();
  const sent = [];
  const opts = { db, now: NOW, checkSendable: async () => {}, send: async (m) => { sent.push(m); } };
  await chaser.sendDeliveryChasers(opts);
  const second = await chaser.sendDeliveryChasers(opts);
  assert.equal(sent.length, 1);
  assert.equal(second.sent, 0);
  assert.equal(second.notDue, 1, 'PHME was chased today');
  assert.deepEqual(second.skippedNoEmail, ['ALMAX'], 'never chased, still has no email');
});

test('a failed send records nothing, so the next run retries', async () => {
  const db = fakeDb();
  const summary = await chaser.sendDeliveryChasers({ db, now: NOW, checkSendable: async () => {}, send: async () => { throw new Error('SMTP down'); } });
  assert.equal(summary.failed, 1);
  assert.equal(db.chasers.length, 0);
});

test('preview sends and writes nothing', async () => {
  const db = fakeDb();
  const preview = await chaser.previewDeliveryChasers({ db, now: NOW });
  assert.equal(preview.today, TODAY);
  assert.deepEqual(preview.suppliers.map((s) => [s.supplier, s.due, s.to]), [['ALMAX', true, null], ['PHME', true, 'sales@phme.test']]);
  assert.match(preview.suppliers[1].html, /Dear PHME Team/);
  assert.equal(db.chasers.length, 0);
});
