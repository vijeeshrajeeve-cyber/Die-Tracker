'use strict';

const { randomUUID } = require('node:crypto');
const calendar = require('./workQueueCalendar.cjs');
const permissions = require('./workQueuePermissions.cjs');
const qdSettings = require('./qdSettings.cjs');

const DEADLINE_KINDS = new Set(['due_soon', 'due_today', 'overdue', 'escalation']);
const LEASE_MS = 300000;
const normalizeInstant = value => value == null ? null : new Date(value).toISOString();
const sameID = (a, b) => a != null && b != null && String(a) === String(b);

function itemCalendar(item) {
  const saved = item.calendar_snapshot || {};
  return calendar.validateCalendar({ ...saved, timezone: item.timezone || saved.timezone,
    cutoff: String(item.cutoff || saved.cutoff || '17:00').slice(0, 5) });
}

function isWorkingDate(date, cal) {
  return cal.weekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay()) && !cal.holidays.includes(date);
}

// Each deadline/date/recipient has a stable key. A note or reassignment may
// increment item.version, but cannot manufacture another reminder that day.
function deadlineNotifications(item, now, goLiveAt) {
  if (!item || item.state !== 'active' || item.setup_reason || !item.due_at || item.source_deleted_at || !goLiveAt) return [];
  const current = new Date(now);
  const due = new Date(item.due_at);
  if (!Number.isFinite(due.getTime()) || due < new Date(goLiveAt)) return [];
  const cal = itemCalendar(item);
  const today = calendar.localDate(current, cal.timezone);
  if (!isWorkingDate(today, cal)) return [];
  const dueDate = calendar.localDate(due, cal.timezone);
  const candidates = [];
  const add = (kind, recipientId) => {
    if (recipientId == null) return;
    candidates.push({ itemId: item.id, recipientId, kind, deadlineVersion: item.version,
      eventKey: `deadline:${due.toISOString()}:${today}`,
      payload: { due_at: due.toISOString(), local_date: today, owner_id: item.owner_id }, availableAt: current.toISOString() });
  };
  if (current > due) {
    add('overdue', item.owner_id);
    const escalation = item.policy_snapshot?.escalation_owner_id;
    const firstEscalationDay = calendar.dueDate(dueDate, 1, 'working', cal);
    if (today >= firstEscalationDay && !sameID(escalation, item.owner_id)) add('escalation', escalation);
  } else if (today === dueDate) {
    add('due_today', item.owner_id);
  } else {
    // The day before an ETA outside the calendar still deserves a warning.
    const next = calendar.dueDate(today, 1, 'working', cal);
    if (dueDate > today && dueDate <= next) add('due_soon', item.owner_id);
  }
  return candidates;
}

async function enqueueNotification(db, { itemId, recipientId, kind, deadlineVersion = 0, eventKey, payload = {}, availableAt = new Date() }) {
  const result = await db.query(`INSERT INTO work_queue_notification_outbox
    (item_id,recipient_id,kind,deadline_version,event_key,payload,available_at)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
  [itemId, recipientId, kind, deadlineVersion, eventKey, JSON.stringify(payload), availableAt]);
  return result.rows[0]?.id || null;
}

function shouldDeliver(notification, item, user, { now = new Date(), approverUserIds = [], snoozedUntil = null } = {}) {
  if (!item || !user || item.source_deleted_at || !['active', 'paused'].includes(item.state)) return { action: 'cancel', reason: 'Work is no longer active' };
  if (!permissions.canReadSource(user, item.source_kind)) return { action: 'cancel', reason: 'Recipient no longer has source access' };
  if (user.is_active === false || user.active === false || user.disabled === true || user.deleted_at) return { action: 'cancel', reason: 'Recipient is inactive' };
  const escalation = notification.kind === 'escalation';
  if (escalation) {
    if (!sameID(item.policy_snapshot?.escalation_owner_id, user.id)) return { action: 'cancel', reason: 'Escalation contact changed' };
  } else if (!permissions.isMine(item, user, { isQdApprover: qdSettings.isApprover(user, approverUserIds) })) {
    return { action: 'cancel', reason: 'Work is no longer assigned to this recipient' };
  }
  if (DEADLINE_KINDS.has(notification.kind)) {
    if (item.state === 'paused' || item.setup_reason || !item.due_at) return { action: 'cancel', reason: 'Deadline is paused or incomplete' };
    if (normalizeInstant(notification.payload?.due_at) !== normalizeInstant(item.due_at)) return { action: 'cancel', reason: 'Deadline changed' };
    if (notification.payload?.local_date && notification.payload.local_date !== calendar.localDate(now, item.timezone || 'Asia/Dubai')) {
      return { action: 'cancel', reason: 'A newer daily reminder replaces this one' };
    }
    const currentKind = calendar.classify(item, now);
    if ((notification.kind === 'due_today' && currentKind !== 'today') || (notification.kind === 'due_soon' && currentKind !== 'upcoming')
      || (['overdue', 'escalation'].includes(notification.kind) && currentKind !== 'overdue')) {
      return { action: 'cancel', reason: 'Reminder is no longer current' };
    }
    // A person's snooze never silences the separately addressed escalation.
    if (!escalation && snoozedUntil && new Date(snoozedUntil) > new Date(now)) return { action: 'defer', until: normalizeInstant(snoozedUntil), reason: 'Personal reminder snoozed' };
  }
  return { action: 'deliver' };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function notificationEmail(notification, item, user) {
  const labels = { due_soon: 'Due soon', due_today: 'Due today', overdue: 'Overdue', escalation: 'Escalated work', assignment: 'Assigned to you', note: 'New work note' };
  const label = labels[notification.kind] || 'Work update';
  const due = item.due_at ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: item.timezone || 'Asia/Dubai' }).format(new Date(item.due_at)) : 'Needs setup';
  return { to: user.email, subject: `Die Tracker · ${label}: ${item.die_no || 'Work item'} · ${item.stage_label}`,
    body: `<p>${escapeHtml(label)}: <strong>${escapeHtml(item.die_no || 'Work item')}</strong></p>`
      + `<p>${escapeHtml(item.stage_label)} · ${escapeHtml(item.plant)}<br>Due: ${escapeHtml(due)} (${escapeHtml(item.timezone || 'Asia/Dubai')})</p>`
      + (notification.payload?.note ? `<p>${escapeHtml(notification.payload.note)}</p>` : '')
      + '<p>Open Work Queue in Die Tracker to view the source record and take the next action.</p>',
    importance: notification.kind === 'escalation' ? 'high' : 'normal',
    orderId: item.source_kind === 'order' ? item.source_id : null };
}

function createNotificationWorker({ db, sendEmail = args => require('./email.cjs').sendEmail(args), now = () => new Date(), logger = console } = {}) {
  if (!db?.query) throw new Error('A database is required for the work queue worker');
  let running = false;
  let interval;

  async function settings() {
    return (await db.query('SELECT notifications_enabled,notifications_go_live_at FROM work_queue_config WHERE id=1')).rows[0];
  }

  async function scan(config) {
    const instant = now();
    // Keyset pages avoid an arbitrary frontend-sized cap on notifications.
    let afterId = 0;
    let enqueued = 0;
    for (;;) {
      const { rows } = await db.query(`SELECT * FROM work_queue_items WHERE id>$1 AND state='active'
        AND due_at IS NOT NULL AND setup_reason IS NULL AND due_at >= $2 ORDER BY id LIMIT 500`, [afterId, config.notifications_go_live_at]);
      for (const item of rows) {
        let recipients=[item];
        if (item.stage_key==='qd_approval' && item.owner_id==null) {
          const { approverUserIds }=await qdSettings.getQdSettings(db);
          const users=(await db.query("SELECT id,role,page_access FROM users WHERE role='admin' OR id=ANY($1::int[])",[approverUserIds])).rows;
          recipients=users.filter(user=>permissions.canReadSource(user,'qd')).map(user=>({...item,owner_id:user.id}));
        }
        for (const notification of recipients.flatMap(recipient=>deadlineNotifications(recipient, instant, config.notifications_go_live_at))) {
          if (await enqueueNotification(db, notification)) enqueued++;
        }
      }
      if (rows.length < 500) break;
      afterId = rows[rows.length - 1].id;
    }
    return enqueued;
  }

  async function settle(id, token, action, data = null) {
    if (action === 'delivered') {
      await db.query(`UPDATE work_queue_notification_outbox SET delivered_at=$3,lease_until=NULL,lease_token=NULL,error=NULL
        WHERE id=$1 AND lease_token=$2`, [id, token, now()]);
    } else if (action === 'cancel') {
      await db.query(`UPDATE work_queue_notification_outbox SET cancelled_at=$3,lease_until=NULL,lease_token=NULL,error=$4
        WHERE id=$1 AND lease_token=$2`, [id, token, now(), data]);
    } else {
      await db.query(`UPDATE work_queue_notification_outbox SET available_at=$3,lease_until=NULL,lease_token=NULL,error=$4
        WHERE id=$1 AND lease_token=$2`, [id, token, data.until, data.reason]);
    }
  }

  async function deliver(notification) {
    const token = notification.lease_token;
    const config = await settings();
    if (!config?.notifications_enabled) {
      await settle(notification.id, token, 'defer', { until: new Date(new Date(now()).getTime() + 60000), reason: 'Notifications disabled' });
      return 'deferred';
    }
    if (!config.notifications_go_live_at || (notification.created_at && new Date(notification.created_at) < new Date(config.notifications_go_live_at))) {
      await settle(notification.id, token, 'cancel', 'Notification predates the current enablement');
      return 'cancelled';
    }
    const item = (await db.query('SELECT * FROM work_queue_items WHERE id=$1', [notification.item_id])).rows[0];
    const user = (await db.query('SELECT id,username,email,role,page_access FROM users WHERE id=$1', [notification.recipient_id])).rows[0];
    const { approverUserIds } = await qdSettings.getQdSettings(db);
    const snooze = (await db.query('SELECT until_at FROM work_queue_snoozes WHERE item_id=$1 AND user_id=$2', [notification.item_id, notification.recipient_id])).rows[0]?.until_at;
    const decision = shouldDeliver(notification, item, user, { now: now(), approverUserIds, snoozedUntil: snooze });
    if (decision.action !== 'deliver') {
      await settle(notification.id, token, decision.action, decision.action === 'defer' ? decision : decision.reason);
      return decision.action === 'cancel' ? 'cancelled' : 'deferred';
    }
    // Inbox insertion is idempotent even after an SMTP failure or worker crash.
    await db.query(`INSERT INTO work_queue_inbox(outbox_id,recipient_id,item_id,kind,payload)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(outbox_id) DO NOTHING`,
    [notification.id, user.id, item.id, notification.kind, JSON.stringify({ ...notification.payload, die_no: item.die_no, stage_label: item.stage_label, plant: item.plant, due_at: item.due_at })]);
    if (user.email?.trim()) {
      // SMTP itself has no idempotency key. Delivery is at least once; a crash
      // after SMTP acceptance but before the DB acknowledgement can resend.
      await sendEmail(notificationEmail(notification, item, user));
    }
    await settle(notification.id, token, 'delivered');
    return 'delivered';
  }

  async function tick() {
    if (running) return { skipped: true, reason: 'running' };
    running = true;
    try {
      const config = await settings();
      if (!config?.notifications_enabled || !config.notifications_go_live_at) return { skipped: true, reason: 'disabled' };
      const enqueued = await scan(config);
      const summary = { enqueued, delivered: 0, cancelled: 0, deferred: 0, failed: 0 };
      // Claim one message immediately before delivery; no batch waits while an
      // earlier SMTP call consumes another message's lease.
      for (let count = 0; count < 50; count++) {
        const token = randomUUID();
        const instant = new Date(now());
        const { rows } = await db.query(`WITH candidate AS (
          SELECT id FROM work_queue_notification_outbox WHERE delivered_at IS NULL AND cancelled_at IS NULL
            AND available_at <= $1 AND (lease_until IS NULL OR lease_until < $1)
          ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1
        ) UPDATE work_queue_notification_outbox n SET lease_token=$2,lease_until=$3,attempts=attempts+1
          FROM candidate c WHERE n.id=c.id RETURNING n.*`, [instant, token, new Date(instant.getTime() + LEASE_MS)]);
        if (!rows.length) break;
        const notification = rows[0];
        const heartbeat = setInterval(() => {
          db.query('UPDATE work_queue_notification_outbox SET lease_until=$3 WHERE id=$1 AND lease_token=$2',
            [notification.id, token, new Date(new Date(now()).getTime() + LEASE_MS)]).catch(error => logger.error('Work Queue lease renewal failed:', error.message));
        }, 60000);
        heartbeat.unref?.();
        try {
          summary[await deliver(notification)]++;
        } catch (error) {
          const delay = Math.min(21600000, 60000 * 2 ** Math.min(8, Math.max(0, Number(notification.attempts) - 1)));
          await settle(notification.id, token, 'defer', { until: new Date(new Date(now()).getTime() + delay), reason: String(error.message || error).slice(0, 2000) });
          summary.failed++;
        } finally {
          clearInterval(heartbeat);
        }
      }
      return summary;
    } finally {
      running = false;
    }
  }

  function start() {
    if (!interval) {
      interval = setInterval(() => tick().catch(error => logger.error('Work Queue notifications failed:', error.message)), 60000);
      interval.unref?.();
    }
    return stop;
  }
  function stop() { clearInterval(interval); interval = undefined; }
  return { tick, start, stop };
}

function scheduleWorkQueueNotifications(pool, options = {}) {
  return createNotificationWorker({ ...options, db: pool }).start();
}

module.exports = { deadlineNotifications, enqueueNotification, shouldDeliver, notificationEmail, createNotificationWorker, scheduleWorkQueueNotifications };
