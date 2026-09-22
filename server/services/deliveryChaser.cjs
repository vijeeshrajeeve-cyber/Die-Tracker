'use strict';
/**
 * Die Delivery Chaser
 *
 * One email per supplier listing the dies in manufacturing that are past the
 * ETA the supplier gave, or have sat in manufacturing for a while with no ETA
 * at all. The check runs once a day at the configured time; a supplier is
 * mailed at most once every interval_days, so "Send now" twice cannot mail
 * anyone twice. Internal reminders are the Work Queue's job, not this one's.
 */

const { pool } = require('../db.cjs');
const emailService = require('./email.cjs');
const signature = require('./emailSignature.cjs');
const { localDay, todayLocal } = require('./dates.cjs');
const { isDue, escapeHtml, table } = require('./focReminder.cjs');
const { normalizeEta, daysBetween } = require('./deliveryFollowup.cjs');

let timer = null;
const state = { lastRun: null, lastResult: null, error: null, running: false };

// ── Settings ────────────────────────────────────────────────────────────────

async function getChaserSettings(db = pool) {
  const result = await db.query('SELECT * FROM reminder_settings ORDER BY id LIMIT 1');
  if (result.rows.length > 0) return result.rows[0];
  return (await db.query('INSERT INTO reminder_settings DEFAULT VALUES RETURNING *')).rows[0];
}

async function updateChaserSettings({ enabled, time, intervalDays, noEtaDays, cc }, db = pool) {
  const existing = await getChaserSettings(db);
  const result = await db.query(`
    UPDATE reminder_settings SET
      delivery_chaser_enabled       = COALESCE($1, delivery_chaser_enabled),
      delivery_chaser_time          = COALESCE($2, delivery_chaser_time),
      delivery_chaser_interval_days = COALESCE($3, delivery_chaser_interval_days),
      delivery_chaser_no_eta_days   = COALESCE($4, delivery_chaser_no_eta_days),
      delivery_chaser_cc            = COALESCE($5, delivery_chaser_cc),
      updated_at                    = CURRENT_TIMESTAMP
    WHERE id = $6
    RETURNING *
  `, [enabled, time, intervalDays, noEtaDays, cc, existing.id]);
  return result.rows[0];
}

// ── Rules ───────────────────────────────────────────────────────────────────

const supplierKey = (name) => String(name || '').trim().toUpperCase();

// Overdue when the real ETA is before today. No ETA once the die has been in
// manufacturing noEtaDays since Design to EMS — or at once when that date is
// missing, because asking for an ETA is never wrong.
function classifyDie(row, today, noEtaDays) {
  const eta = normalizeEta(row.eta);
  if (eta) return eta < today ? { bucket: 'overdue', daysOverdue: daysBetween(eta, today) } : null;
  const since = normalizeEta(row.design_to_ems_date);
  if (!since) return { bucket: 'no_eta', daysInManufacturing: null };
  const days = daysBetween(since, today);
  return days >= noEtaDays ? { bucket: 'no_eta', daysInManufacturing: days } : null;
}

function isSupplierDue(lastDay, today, intervalDays) {
  return !lastDay || daysBetween(lastDay, today) >= intervalDays;
}

function nextChaseDay(lastDay, intervalDays) {
  const d = new Date(`${lastDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + intervalDays);
  return d.toISOString().slice(0, 10);
}

// Everything a run would send, one entry per supplier with at least one die
// to list, in supplier order. Pure: the queries live in loadPlan.
function planChasers({ dies, emails, lastSent, today, intervalDays, noEtaDays }) {
  const groups = new Map();
  for (const die of dies) {
    const verdict = classifyDie(die, today, noEtaDays);
    if (!verdict) continue;
    const key = supplierKey(die.supplier);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { supplier: String(die.supplier).trim(), key, overdue: [], noEta: [] });
    const group = groups.get(key);
    if (verdict.bucket === 'overdue') group.overdue.push({ ...die, eta: normalizeEta(die.eta), daysOverdue: verdict.daysOverdue });
    else group.noEta.push({ ...die, daysInManufacturing: verdict.daysInManufacturing });
  }
  return [...groups.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((group) => {
      const last = lastSent.get(group.key) || null;
      return {
        ...group,
        to: emails.get(group.key) || null,
        due: isSupplierDue(last, today, intervalDays),
        lastDay: last,
        nextDay: last ? nextChaseDay(last, intervalDays) : today,
      };
    });
}

// ── Email ───────────────────────────────────────────────────────────────────

const dash = (v) => (v === null || v === undefined ? '—' : v);

function buildSubject(supplier, overdue, noEta) {
  return `Die delivery follow-up — ${overdue.length} overdue, ${noEta.length} awaiting ETA - ${supplier}`;
}

// Sent to the supplier. States only their own dates and what is outstanding.
function buildSupplierBody(supplier, overdue, noEta) {
  const h3 = (text) => `<h3 style="font-family:Arial,sans-serif;color:#0F172A;margin:18px 0 8px;">${text}</h3>`;
  const overdueSection = overdue.length ? `
    ${h3(`Past the ETA you gave (${overdue.length})`)}
    ${table([
      { label: 'SL No', align: 'center' }, { label: 'Die Number' }, { label: 'Order No' }, { label: 'Plant' },
      { label: 'ETA Given' }, { label: 'Days Overdue', align: 'center' }, { label: 'Times Revised', align: 'center' },
    ], overdue.map((r, i) => [i + 1, r.die_no, r.order_no, r.plant, r.eta, r.daysOverdue, r.slips || 0]))}` : '';
  const noEtaSection = noEta.length ? `
    ${h3(`ETA not yet given (${noEta.length})`)}
    ${table([
      { label: 'SL No', align: 'center' }, { label: 'Die Number' }, { label: 'Order No' }, { label: 'Plant' },
      { label: 'Days in Manufacturing', align: 'center' },
    ], noEta.map((r, i) => [i + 1, r.die_no, r.order_no, r.plant, dash(r.daysInManufacturing)]))}` : '';
  const ask = noEta.length && overdue.length
    ? 'Please reply with the dispatch date for each overdue die and an ETA for each die listed without one'
    : noEta.length ? 'Please reply with an ETA for each die listed' : 'Please reply with the dispatch date for each die listed';
  return `
    <p>Dear ${escapeHtml(supplier)} Team,</p>
    <p>This is an automated follow-up on die orders we are waiting to receive from you.</p>
    ${overdueSection}
    ${noEtaSection}
    <p>${ask}, or let us know if any has already shipped.</p>
    ${signature.dieDesignSignature()}`;
}

// ── Queries ─────────────────────────────────────────────────────────────────

async function loadPlan(db, settings, today) {
  const [dies, suppliers, sent] = await Promise.all([
    db.query(`
      SELECT o.id, o.die_no, o.order_no, o.plant, trim(o.supplier) AS supplier, o.eta,
             o.design_to_ems_date::text AS design_to_ems_date,
             (SELECT COUNT(*) FROM die_delivery_events e
               WHERE e.order_id = o.id AND e.kind = 'eta_revised')::int AS slips
        FROM die_orders o
       WHERE o.status = 'DONE' AND o.die_received_date IS NULL
         AND NULLIF(trim(o.supplier), '') IS NOT NULL
       ORDER BY o.die_no`),
    db.query('SELECT name, contact_email FROM suppliers'),
    db.query(`SELECT upper(trim(supplier)) AS key, MAX(sent_at) AS last_sent
                FROM die_delivery_chasers GROUP BY 1`),
  ]);
  return planChasers({
    dies: dies.rows,
    emails: new Map(suppliers.rows
      .filter((s) => (s.contact_email || '').trim())
      .map((s) => [supplierKey(s.name), s.contact_email.trim()])),
    lastSent: new Map(sent.rows.map((r) => [r.key, localDay(new Date(r.last_sent))])),
    today,
    intervalDays: Number(settings.delivery_chaser_interval_days) || 3,
    noEtaDays: Number(settings.delivery_chaser_no_eta_days) || 7,
  });
}

// The chaser row and a timeline event per listed die, together or not at all.
async function recordChaser(db, chaser, cc) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO die_delivery_chasers (supplier, recipients, cc, overdue_count, no_eta_count)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [chaser.supplier, chaser.to, cc || null, chaser.overdue.length, chaser.noEta.length]);
    await client.query(
      `INSERT INTO die_delivery_events (order_id, kind, chaser_id, note)
       SELECT unnest($1::int[]), 'chaser_sent', $2, $3`,
      [[...chaser.overdue, ...chaser.noEta].map((d) => d.id), rows[0].id, `Chaser emailed to ${chaser.to}`]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function assertSendable() {
  const emailConfig = await emailService.getEmailConfig();
  if (!emailConfig || !emailConfig.send_enabled) {
    throw new Error('SMTP sending is not enabled. Configure it in Email Settings.');
  }
}

// ── Runs ────────────────────────────────────────────────────────────────────

async function previewDeliveryChasers({ db = pool, now = new Date() } = {}) {
  const settings = await getChaserSettings(db);
  const today = todayLocal(now);
  const plan = await loadPlan(db, settings, today);
  return {
    today,
    cc: settings.delivery_chaser_cc || '',
    suppliers: plan.map((p) => ({
      supplier: p.supplier, to: p.to, due: p.due, lastDay: p.lastDay, nextDay: p.nextDay,
      overdueCount: p.overdue.length, noEtaCount: p.noEta.length,
      subject: buildSubject(p.supplier, p.overdue, p.noEta),
      html: buildSupplierBody(p.supplier, p.overdue, p.noEta),
    })),
  };
}

async function sendDeliveryChasers({
  db = pool, send = emailService.sendEmail, now = new Date(), checkSendable = assertSendable,
} = {}) {
  if (state.running) return { skipped: true, reason: 'A delivery chaser run is already in progress' };
  state.running = true;
  try {
    const settings = await getChaserSettings(db);
    await checkSendable();
    const today = todayLocal(now);
    const plan = await loadPlan(db, settings, today);
    const cc = (settings.delivery_chaser_cc || '').trim();
    const summary = { sent: 0, failed: 0, recordFailed: 0, notDue: 0, skippedNoEmail: [], overdue: 0, noEta: 0 };

    for (const chaser of plan) {
      if (!chaser.due) { summary.notDue++; continue; }
      if (!chaser.to) { summary.skippedNoEmail.push(chaser.supplier); continue; }
      try {
        await send({
          to: chaser.to,
          cc: cc || undefined,
          subject: buildSubject(chaser.supplier, chaser.overdue, chaser.noEta),
          body: buildSupplierBody(chaser.supplier, chaser.overdue, chaser.noEta),
          importance: chaser.overdue.length ? 'high' : 'normal',
        });
      } catch (err) {
        console.error(`Delivery chaser: failed to send to ${chaser.supplier}:`, err.message);
        summary.failed++;
        continue;
      }
      try {
        await recordChaser(db, chaser, cc);
      } catch (err) {
        // Sent but not recorded: the next due run mails this supplier again.
        console.error(`Delivery chaser: sent to ${chaser.supplier} but could not record it:`, err.message);
        summary.recordFailed++;
      }
      summary.sent++;
      summary.overdue += chaser.overdue.length;
      summary.noEta += chaser.noEta.length;
    }

    await db.query('UPDATE reminder_settings SET delivery_chaser_last_run = $2 WHERE id = $1', [settings.id, today]);
    state.lastRun = new Date().toISOString();
    state.lastResult = summary;
    state.error = null;
    console.log(`Delivery chasers: ${summary.sent} sent, ${summary.failed} failed, ${summary.notDue} not due, ` +
      `${summary.skippedNoEmail.length} supplier(s) without an email`);
    return summary;
  } catch (error) {
    state.lastRun = new Date().toISOString();
    state.error = error.message;
    console.error('Delivery chaser run error:', error.message);
    throw error;
  } finally {
    state.running = false;
  }
}

// ── Scheduler ───────────────────────────────────────────────────────────────

async function tick() {
  try {
    const s = await getChaserSettings();
    if (isDue({ enabled: s.delivery_chaser_enabled, time: s.delivery_chaser_time, lastRun: s.delivery_chaser_last_run })) {
      await sendDeliveryChasers().catch(() => {});
    }
  } catch {
    // Already logged by the sender; never let the tick throw
  }
}

function scheduleDeliveryChasers() {
  if (timer) clearInterval(timer);
  timer = setInterval(tick, 60 * 1000);
  console.log('Delivery chaser scheduler started (checks every minute)');
}

const getChaserState = () => ({ ...state });

module.exports = {
  getChaserSettings, updateChaserSettings,
  classifyDie, isSupplierDue, nextChaseDay, planChasers,
  buildSubject, buildSupplierBody,
  previewDeliveryChasers, sendDeliveryChasers, scheduleDeliveryChasers, getChaserState,
};
