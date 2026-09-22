'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deadlineNotifications, shouldDeliver, notificationEmail, createNotificationWorker } = require('./workQueueNotifications.cjs');

const NOW = '2026-09-22T06:30:00Z';
const GO_LIVE = '2026-09-20T06:30:00Z';
const owner = { id: 7, username: 'Owner', role: 'user', email: 'owner@example.test', page_access: ['orders', 'qd-tracker'] };
const item = { id: 1, source_kind: 'order', source_id: 50, stage_key: 'design_approval', stage_label: 'Design Approval',
  die_no: '12345-01', plant: 'GEX 1', state: 'active', owner_id: 7, version: 2,
  due_at: '2026-09-22T13:00:00.000Z', timezone: 'Asia/Dubai', cutoff: '17:00:00',
  policy_snapshot: { escalation_owner_id: 8 }, calendar_snapshot: { weekdays: [1, 2, 3, 4, 5, 6], holidays: [] } };
const reminder = (kind = 'due_today', changes = {}) => ({ id: 1, recipient_id: 7, item_id: 1, kind, payload: { due_at: item.due_at }, ...changes });

test('deadline schedules respect due date, working days, holidays and the notification go-live horizon', () => {
  assert.deepEqual(deadlineNotifications(item, NOW, GO_LIVE).map(n => n.kind), ['due_today']);
  assert.deepEqual(deadlineNotifications({ ...item, due_at: '2026-09-23T13:00:00Z' }, NOW, GO_LIVE).map(n => n.kind), ['due_soon']);
  assert.deepEqual(deadlineNotifications({ ...item, due_at: '2026-09-25T13:00:00Z' }, NOW, GO_LIVE), []);
  assert.deepEqual(deadlineNotifications({ ...item, due_at: '2026-09-19T13:00:00Z' }, NOW, GO_LIVE), []);
  assert.deepEqual(deadlineNotifications({ ...item, state: 'paused' }, NOW, GO_LIVE), []);
  assert.deepEqual(deadlineNotifications({ ...item, setup_reason: 'Missing entry date' }, NOW, GO_LIVE), []);
  assert.deepEqual(deadlineNotifications({ ...item, calendar_snapshot: { ...item.calendar_snapshot, holidays: ['2026-09-22'] } }, NOW, GO_LIVE), []);
  assert.deepEqual(deadlineNotifications(item, '2026-09-20T06:30:00Z', GO_LIVE), []);
});

test('overdue reminders and next-working-day escalation have separate recipients', () => {
  const overdue = { ...item, due_at: '2026-09-21T13:00:00Z' };
  const notices = deadlineNotifications(overdue, NOW, GO_LIVE);
  assert.deepEqual(notices.map(n => [n.kind, n.recipientId]), [['overdue', 7], ['escalation', 8]]);
  assert.deepEqual(deadlineNotifications(overdue, '2026-09-21T13:00:01Z', GO_LIVE).map(n => n.kind), ['overdue']);
  assert.deepEqual(deadlineNotifications({ ...overdue, owner_id: 8 }, NOW, GO_LIVE).map(n => n.kind), ['overdue']);
  assert.equal(notices[0].eventKey, deadlineNotifications({ ...overdue, version: 9 }, NOW, GO_LIVE)[0].eventKey);
});

test('weekend ETA receives a warning on the last working day without changing its promise', () => {
  const eta = { ...item, due_at: '2026-09-27T13:00:00Z' };
  const notices = deadlineNotifications(eta, '2026-09-26T06:30:00Z', GO_LIVE);
  assert.equal(notices[0].kind, 'due_soon');
  assert.equal(notices[0].payload.due_at, '2026-09-27T13:00:00.000Z');
});

test('delivery rechecks ownership, source permissions, QD approver eligibility and current deadline', () => {
  assert.equal(shouldDeliver(reminder(), item, owner, { now: NOW }).action, 'deliver');
  assert.equal(shouldDeliver(reminder(), item, { ...owner, page_access: [] }, { now: NOW }).action, 'cancel');
  assert.equal(shouldDeliver(reminder(), { ...item, owner_id: 8 }, owner, { now: NOW }).action, 'cancel');
  assert.equal(shouldDeliver(reminder(), { ...item, state: 'completed' }, owner, { now: NOW }).action, 'cancel');
  assert.equal(shouldDeliver(reminder(), { ...item, due_at: '2026-09-23T13:00:00Z' }, owner, { now: NOW }).action, 'cancel');
  const qd = { ...item, source_kind: 'qd', stage_key: 'qd_approval' };
  assert.equal(shouldDeliver(reminder(), qd, owner, { now: NOW, approverUserIds: [] }).action, 'cancel');
  assert.equal(shouldDeliver(reminder(), qd, owner, { now: NOW, approverUserIds: [7] }).action, 'deliver');
});

test('personal snooze delays owner reminders while escalation and notes remain independent', () => {
  const options = { now: NOW, snoozedUntil: '2026-09-22T11:00:00Z' };
  assert.deepEqual(shouldDeliver(reminder(), item, owner, options), { action: 'defer', until: '2026-09-22T11:00:00.000Z', reason: 'Personal reminder snoozed' });
  assert.equal(shouldDeliver(reminder('note'), item, owner, options).action, 'deliver');
  const overdue = { ...item, due_at: '2026-09-21T13:00:00Z' };
  assert.equal(shouldDeliver(reminder('escalation', { payload: { due_at: overdue.due_at } }), overdue, { ...owner, id: 8 }, options).action, 'deliver');
  assert.equal(shouldDeliver(reminder(), { ...item, state: 'paused' }, owner, options).action, 'cancel');
});

test('a retry of an expired due-today reminder cannot send a misleading message after cutoff', () => {
  assert.equal(shouldDeliver(reminder(), item, owner, { now: '2026-09-22T13:00:01Z' }).action, 'cancel');
});

test('SMTP recovery does not replay older daily overdue reminders alongside today\'s reminder', () => {
  const overdue = { ...item, due_at: '2026-09-21T13:00:00Z' };
  const old = reminder('overdue', { payload: { due_at: overdue.due_at, local_date: '2026-09-21' } });
  assert.equal(shouldDeliver(old, overdue, owner, { now: NOW }).action, 'cancel');
});

test('notification email escapes user-controlled note and record content', () => {
  const email = notificationEmail(reminder('note', { payload: { note: '<img src=x onerror=alert(1)>' } }), { ...item, die_no: '<b>Die</b>' }, owner);
  assert.ok(email.body.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(email.body.includes('&lt;b&gt;Die&lt;/b&gt;'));
  assert.ok(!email.body.includes('<img'));
  assert.equal(email.to, owner.email);
});

// A small stateful store exercises the worker's claim, retry, inbox and stale
// recipient paths together without contacting the real database or SMTP.
function memoryDatabase({ enabled = true, users = [owner], items = [item], clock = () => new Date(NOW) } = {}) {
  const db = { outbox: [], inbox: [], calls: [], items, users, config: { notifications_enabled: enabled, notifications_go_live_at: GO_LIVE } };
  db.query = async (sql, values = []) => {
    db.calls.push(sql);
    const rows = result => ({ rows: result, rowCount: result.length });
    if (sql.startsWith('SELECT notifications_enabled')) return rows([db.config]);
    if (sql.startsWith('SELECT * FROM work_queue_items WHERE id>')) return rows(db.items.filter(i => i.id > values[0] && i.state === 'active' && !i.setup_reason && new Date(i.due_at) >= new Date(values[1])).slice(0, 500));
    if (sql.startsWith('INSERT INTO work_queue_notification_outbox')) {
      const [item_id, recipient_id, kind, deadline_version, event_key, payload, available_at] = values;
      if (db.outbox.some(n => n.item_id === item_id && n.recipient_id === recipient_id && n.kind === kind && n.event_key === event_key)) return rows([]);
      const n = { id: db.outbox.length + 1, item_id, recipient_id, kind, deadline_version, event_key, payload: JSON.parse(payload), available_at, attempts: 0 };
      db.outbox.push(n); return rows([{ id: n.id }]);
    }
    if (sql.startsWith('WITH candidate')) {
      const n = db.outbox.find(n => !n.delivered_at && !n.cancelled_at && new Date(n.available_at) <= new Date(values[0]) && (!n.lease_until || new Date(n.lease_until) < new Date(values[0])));
      if (!n) return rows([]);
      n.lease_token = values[1]; n.lease_until = values[2]; n.attempts++;
      return rows([{ ...n }]);
    }
    if (sql.startsWith('SELECT * FROM work_queue_items WHERE id=')) return rows(db.items.filter(i => i.id === values[0]));
    if (sql.startsWith('SELECT id,username,email')) return rows(db.users.filter(u => u.id === values[0]));
    if (sql.startsWith('SELECT id,role,page_access')) return rows(db.users.filter(u=>u.role==='admin' || values[0].includes(u.id)));
    if (sql.startsWith('SELECT * FROM qd_settings')) return rows([{ approver_user_ids: '[7]' }]);
    if (sql.startsWith('SELECT until_at')) return rows([]);
    if (sql.startsWith('INSERT INTO work_queue_inbox')) {
      if (!db.inbox.some(n => n.outbox_id === values[0])) db.inbox.push({ outbox_id: values[0], recipient_id: values[1], item_id: values[2], kind: values[3], payload: JSON.parse(values[4]) });
      return rows([]);
    }
    if (sql.startsWith('UPDATE work_queue_notification_outbox')) {
      const n = db.outbox.find(n => n.id === values[0] && n.lease_token === values[1]);
      if (!n) return rows([]);
      if (sql.includes('SET delivered_at')) { n.delivered_at = values[2]; n.error = null; }
      else if (sql.includes('SET cancelled_at')) { n.cancelled_at = values[2]; n.error = values[3]; }
      else if (sql.includes('SET available_at')) { n.available_at = values[2]; n.error = values[3]; }
      else if (sql.includes('SET lease_until')) { n.lease_until = values[2]; return rows([]); }
      n.lease_until = null; n.lease_token = null; return rows([]);
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  db.clock = clock;
  return db;
}

test('disabled worker performs no scan, claims, inbox writes or email sends', async () => {
  const db = memoryDatabase({ enabled: false });
  const worker = createNotificationWorker({ db, sendEmail: () => { throw new Error('must not send'); }, now: db.clock });
  assert.deepEqual(await worker.tick(), { skipped: true, reason: 'disabled' });
  assert.equal(db.calls.length, 1);
  assert.equal(db.outbox.length, 0);
});

test('repeated ticks deliver one reminder and one inbox entry for a deadline per day', async () => {
  const db = memoryDatabase();
  const sent = [];
  const worker = createNotificationWorker({ db, sendEmail: async mail => sent.push(mail), now: db.clock });
  assert.equal((await worker.tick()).delivered, 1);
  assert.equal((await worker.tick()).enqueued, 0);
  assert.equal(sent.length, 1);
  assert.equal(db.inbox.length, 1);
  assert.ok(db.outbox[0].delivered_at);
});

test('SMTP failure retains one inbox entry and retries delivery after durable backoff', async () => {
  let instant = new Date(NOW);
  const db = memoryDatabase({ clock: () => instant });
  let calls = 0;
  const worker = createNotificationWorker({ db, now: db.clock, sendEmail: async () => { if (++calls === 1) throw new Error('SMTP temporarily unavailable'); } });
  assert.equal((await worker.tick()).failed, 1);
  assert.equal(db.inbox.length, 1);
  assert.equal(db.outbox[0].delivered_at, undefined);
  assert.equal(db.outbox[0].error, 'SMTP temporarily unavailable');
  assert.equal((await worker.tick()).delivered, 0);
  instant = new Date(instant.getTime() + 61000);
  assert.equal((await worker.tick()).delivered, 1);
  assert.equal(db.inbox.length, 1);
  assert.equal(calls, 2);
});

test('lost source access cancels queued delivery without revealing its content', async () => {
  const db = memoryDatabase({ users: [{ ...owner, page_access: [] }] });
  const worker = createNotificationWorker({ db, now: db.clock, sendEmail: () => { throw new Error('must not send'); } });
  assert.equal((await worker.tick()).cancelled, 1);
  assert.equal(db.inbox.length, 0);
  assert.ok(db.outbox[0].cancelled_at);
});

test('users without an email address still receive a durable inbox notification', async () => {
  const db = memoryDatabase({ users: [{ ...owner, email: null }] });
  const worker = createNotificationWorker({ db, now: db.clock, sendEmail: () => { throw new Error('must not send'); } });
  assert.equal((await worker.tick()).delivered, 1);
  assert.equal(db.inbox.length, 1);
});

test('legacy shared QD approvals notify eligible approvers but exclude other source readers', async () => {
  const admin={...owner,id:8,role:'admin'};
  const reader={...owner,id:9};
  const db=memoryDatabase({items:[{...item,source_kind:'qd',stage_key:'qd_approval',owner_id:null}],users:[owner,admin,reader]});
  const sent=[];
  const worker=createNotificationWorker({db,now:db.clock,sendEmail:async message=>sent.push(message)});
  assert.equal((await worker.tick()).delivered,2);
  assert.deepEqual(db.inbox.map(n=>n.recipient_id).sort(),[7,8]);
  assert.equal(sent.length,2);
});

test('two worker instances claim a message only once and active leases survive competing ticks', async () => {
  const db = memoryDatabase();
  let sent = 0;
  const options = { db, now: db.clock, sendEmail: async () => { sent++; } };
  const a = createNotificationWorker(options);
  const b = createNotificationWorker(options);
  await Promise.all([a.tick(), b.tick()]);
  assert.equal(sent, 1);
  assert.equal(db.inbox.length, 1);
});
