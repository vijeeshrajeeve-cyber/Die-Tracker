/**
 * Ordering Reminder Service
 *
 * Emails the Purchasing team about die orders that have sat in
 * PENDING FOR ORDERING for more than the configured number of days, counted
 * from the Die Requested Date. One email per plant, once a day at the
 * configured time. Recipients come from the "Ordering Reminder" template
 * (default To / CC) — the same address list the manual notification uses.
 * All knobs live in reminder_settings, alongside the design reminder's.
 */

const { pool } = require('../db.cjs');
const emailService = require('./email.cjs');
const signature = require('./emailSignature.cjs');

let orderingInterval = null;

// In-memory status of the most recent run (for the settings UI)
const orderingState = { lastRun: null, lastResult: null, error: null, running: false };

// ── Settings ────────────────────────────────────────────────────────────────

async function getOrderingSettings(db = pool) {
    const result = await db.query('SELECT * FROM reminder_settings ORDER BY id LIMIT 1');
    if (result.rows.length > 0) return result.rows[0];
    const inserted = await db.query('INSERT INTO reminder_settings DEFAULT VALUES RETURNING *');
    return inserted.rows[0];
}

async function updateOrderingSettings({ enabled, days, time }, db = pool) {
    const existing = await getOrderingSettings(db);
    const result = await db.query(`
        UPDATE reminder_settings SET
            ordering_reminder_enabled = COALESCE($1, ordering_reminder_enabled),
            ordering_reminder_days    = COALESCE($2, ordering_reminder_days),
            ordering_reminder_time    = COALESCE($3, ordering_reminder_time),
            updated_at                = CURRENT_TIMESTAMP
        WHERE id = $4
        RETURNING *
    `, [enabled, days, time, existing.id]);
    return result.rows[0];
}

// ── Selection ───────────────────────────────────────────────────────────────

const localDateString = (d = new Date()) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// die_requested_date is a TEXT column. Only an ISO date is trusted: anything
// else is reported as undated rather than guessed at, so a malformed value
// can never make an order look older (or younger) than it is.
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

function daysSince(value, today) {
    const m = ISO_DAY.exec(String(value || '').trim());
    if (!m) return null;
    const then = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    const [ty, tm, td] = today.split('-').map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - then) / 86400000);
}

// Orders pending for ordering for more than `days` days. "More than" matches
// the existing wording ("pending ordering for more than N"): requested exactly
// `days` days ago is not yet overdue.
function selectOverdue(rows, days, today = localDateString()) {
    const overdue = [];
    let undated = 0;
    for (const row of rows) {
        const age = daysSince(row.die_requested_date, today);
        if (age === null) { undated++; continue; }
        if (age > days) overdue.push({ ...row, days_pending: age });
    }
    overdue.sort((a, b) => b.days_pending - a.days_pending);
    return { overdue, undated };
}

function groupByPlant(orders) {
    const groups = {};
    for (const o of orders) {
        const plant = (o.plant || '').trim() || 'Unassigned plant';
        (groups[plant] = groups[plant] || []).push(o);
    }
    return groups;
}

// ── Scheduling ──────────────────────────────────────────────────────────────

// Due once a day, at or after the configured time. Comparing against last_run
// also catches a server that was down at the scheduled time: the reminder
// then goes out on the next tick.
function isDue({ enabled, time, lastRun }, now = new Date()) {
    if (!enabled) return false;
    const pad = (n) => String(n).padStart(2, '0');
    if (`${pad(now.getHours())}:${pad(now.getMinutes())}` < (time || '08:00')) return false;
    return !lastRun || String(lastRun).slice(0, 10) !== localDateString(now);
}

// ── Email building ──────────────────────────────────────────────────────────

function escapeHtml(value) {
    return (value === null || value === undefined || value === '' ? 'N/A' : value)
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const TH = 'padding:9px 10px;border:1px solid #CBD5E1;';
const TD = 'padding:8px 10px;border:1px solid #CBD5E1;';

function buildBody(plant, orders, days) {
    const rows = orders.map((o, i) => `
        <tr>
            <td style="${TD}text-align:center;">${i + 1}</td>
            <td style="${TD}font-weight:600;">${escapeHtml(o.die_no)}</td>
            <td style="${TD}">${escapeHtml(o.order_no)}</td>
            <td style="${TD}">${escapeHtml(String(o.die_requested_date).slice(0, 10))}</td>
            <td style="${TD}text-align:center;">${escapeHtml(o.days_pending)}</td>
            <td style="${TD}">${escapeHtml(o.plant)}</td>
        </tr>`).join('');

    return `
        <p>Dear Purchase Team,</p>
        <p>The following die order(s) for ${escapeHtml(plant)} have been pending ordering for more than ${days} day(s):</p>
        <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px;color:#0F172A;">
            <thead>
                <tr style="background:#E2E8F0;color:#0F172A;">
                    <th scope="col" style="${TH}text-align:center;">SL No</th>
                    <th scope="col" style="${TH}text-align:left;">Die Number</th>
                    <th scope="col" style="${TH}text-align:left;">Order Number</th>
                    <th scope="col" style="${TH}text-align:left;">Die Requested</th>
                    <th scope="col" style="${TH}text-align:center;">Days Pending</th>
                    <th scope="col" style="${TH}text-align:left;">Plant</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        <p>Please process these orders at the earliest to avoid production delays.</p>
        ${signature.dieDesignSignature()}`;
}

// ── Sending ─────────────────────────────────────────────────────────────────

async function sendOrderingReminders() {
    if (orderingState.running) return { skipped: true, reason: 'An ordering reminder run is already in progress' };
    orderingState.running = true;

    try {
        const settings = await getOrderingSettings();
        const days = settings.ordering_reminder_days ?? 2;

        const emailConfig = await emailService.getEmailConfig();
        if (!emailConfig || !emailConfig.send_enabled) {
            throw new Error('SMTP sending is not enabled. Configure it in Email Settings.');
        }

        const templates = await emailService.getEmailTemplates();
        const template = templates.find((t) => t.category === 'ordering_reminder') || {};
        const to = (template.default_to || '').trim();
        if (!to) {
            throw new Error('No recipients: set the default To address on the "Ordering Reminder" email template.');
        }
        const cc = (template.default_cc || '').trim() || null;

        const { rows } = await pool.query(`
            SELECT die_no, order_no, plant, die_requested_date
              FROM die_orders
             WHERE status = 'PENDING FOR ORDERING'
        `);
        const { overdue, undated } = selectOverdue(rows, days);

        const summary = { sent: 0, failed: 0, totalOrders: overdue.length, undated };

        for (const [plant, orders] of Object.entries(groupByPlant(overdue))) {
            try {
                await emailService.sendEmail({
                    to,
                    cc,
                    subject: `URGENT: ${orders.length} Die Order(s) Pending Ordering - ${plant}`,
                    body: buildBody(plant, orders, days),
                    importance: 'high'
                });
                summary.sent++;
            } catch (err) {
                console.error(`Ordering reminder: failed to send for ${plant}:`, err.message);
                summary.failed++;
            }
        }

        // The app server's local date, not the DB's CURRENT_DATE, so the
        // once-a-day check in the tick compares dates from the same clock.
        await pool.query(
            'UPDATE reminder_settings SET ordering_reminder_last_run = $2 WHERE id = $1',
            [settings.id, localDateString()]
        );

        orderingState.lastRun = new Date().toISOString();
        orderingState.lastResult = summary;
        orderingState.error = null;
        console.log(`Ordering reminders: ${summary.sent} sent, ${summary.failed} failed, ` +
            `${summary.totalOrders} overdue order(s), ${summary.undated} without a usable requested date`);
        return summary;
    } catch (error) {
        orderingState.lastRun = new Date().toISOString();
        orderingState.error = error.message;
        console.error('Ordering reminder run error:', error.message);
        throw error;
    } finally {
        orderingState.running = false;
    }
}

async function orderingTick() {
    try {
        const s = await getOrderingSettings();
        if (isDue({
            enabled: s.ordering_reminder_enabled,
            time: s.ordering_reminder_time,
            lastRun: s.ordering_reminder_last_run,
        })) {
            await sendOrderingReminders();
        }
    } catch (_error) {
        // Already logged in sendOrderingReminders; never let the tick throw
    }
}

function scheduleOrderingReminders() {
    if (orderingInterval) clearInterval(orderingInterval);
    orderingInterval = setInterval(orderingTick, 60 * 1000);
    console.log('Ordering reminder scheduler started (checks every minute)');
}

function getOrderingState() {
    return { ...orderingState };
}

module.exports = {
    getOrderingSettings,
    updateOrderingSettings,
    sendOrderingReminders,
    scheduleOrderingReminders,
    getOrderingState,
    // exported for tests
    isDue,
    selectOverdue,
    groupByPlant,
    buildBody,
    daysSince,
};
