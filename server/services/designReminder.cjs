/**
 * Design Reminder Service
 * Automatically emails suppliers about orders stuck in AWAITING FOR DESIGN
 * for more than the configured number of days. Sends one email per supplier,
 * once per day at the configured time. All knobs live in reminder_settings.
 */

const { pool } = require('../db.cjs');
const emailService = require('./email.cjs');

let reminderInterval = null;

// In-memory status of the most recent run (for the settings UI)
const reminderState = {
    lastRun: null,
    lastResult: null,
    error: null,
    running: false
};

// ── Settings ────────────────────────────────────────────────────────────────

async function getReminderSettings() {
    const result = await pool.query('SELECT * FROM reminder_settings ORDER BY id LIMIT 1');
    if (result.rows.length > 0) return result.rows[0];
    // Create the default row on first access so PUT always has a row to update
    const inserted = await pool.query(
        'INSERT INTO reminder_settings DEFAULT VALUES RETURNING *'
    );
    return inserted.rows[0];
}

async function updateReminderSettings({ enabled, days, time }) {
    const existing = await getReminderSettings();
    const result = await pool.query(`
        UPDATE reminder_settings SET
            design_reminder_enabled = COALESCE($1, design_reminder_enabled),
            design_reminder_days    = COALESCE($2, design_reminder_days),
            design_reminder_time    = COALESCE($3, design_reminder_time),
            updated_at              = CURRENT_TIMESTAMP
        WHERE id = $4
        RETURNING *
    `, [enabled, days, time, existing.id]);
    return result.rows[0];
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

function buildReminderBody(supplier, orders, days) {
    const tableRows = orders.map((o, index) => `
        <tr>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;text-align:center;">${index + 1}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;font-weight:600;">${escapeHtml(o.die_no)}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;">${escapeHtml(o.order_no)}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;">${escapeHtml(o.ordered_date)}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;text-align:center;">${escapeHtml(o.days_pending)}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;">${escapeHtml(o.plant)}</td>
        </tr>`).join('');

    return `
        <p>Dear ${escapeHtml(supplier)} Team,</p>
        <p>This is an automated reminder that the following die order(s) have been awaiting design for more than ${days} day(s):</p>
        <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px;color:#0F172A;">
            <thead>
                <tr style="background:#E2E8F0;color:#0F172A;">
                    <th style="padding:9px 10px;border:1px solid #CBD5E1;text-align:center;">SL No</th>
                    <th style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">Die Number</th>
                    <th style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">Order Number</th>
                    <th style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">Order Date</th>
                    <th style="padding:9px 10px;border:1px solid #CBD5E1;text-align:center;">Days Pending</th>
                    <th style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">Plant</th>
                </tr>
            </thead>
            <tbody>${tableRows}</tbody>
        </table>
        <p>Please provide the design drawings at the earliest to avoid further delays in production.</p>
        <p>Best regards,<br/>Die Ordering Team</p>`;
}

// ── Sending ─────────────────────────────────────────────────────────────────

async function sendDesignReminders() {
    if (reminderState.running) return { skipped: true, reason: 'A reminder run is already in progress' };
    reminderState.running = true;

    try {
        const settings = await getReminderSettings();
        const days = settings.design_reminder_days || 2;

        const emailConfig = await emailService.getEmailConfig();
        if (!emailConfig || !emailConfig.send_enabled) {
            throw new Error('SMTP sending is not enabled. Configure it in Email Settings.');
        }

        // Orders stuck in AWAITING FOR DESIGN beyond the threshold, grouped by supplier
        const ordersResult = await pool.query(`
            SELECT die_no, order_no, plant, supplier, ordered_date,
                   (CURRENT_DATE - ordered_date) AS days_pending
            FROM die_orders
            WHERE status = 'AWAITING FOR DESIGN'
              AND ordered_date IS NOT NULL
              AND ordered_date <= CURRENT_DATE - $1::int
            ORDER BY supplier, ordered_date
        `, [days]);

        const supplierGroups = {};
        for (const order of ordersResult.rows) {
            const supplier = (order.supplier || '').trim();
            if (!supplier) continue;
            if (!supplierGroups[supplier]) supplierGroups[supplier] = [];
            supplierGroups[supplier].push(order);
        }

        // Recipient fallbacks from the Design Reminder template
        const templates = await emailService.getEmailTemplates();
        const template = templates.find(t => t.category === 'design_reminder') || {};

        const suppliersResult = await pool.query('SELECT name, contact_email FROM suppliers');
        const supplierEmails = Object.fromEntries(
            suppliersResult.rows.map(s => [s.name, (s.contact_email || '').trim()])
        );

        const summary = { sent: 0, failed: 0, skippedNoEmail: [], totalOrders: ordersResult.rows.length };

        for (const [supplier, orders] of Object.entries(supplierGroups)) {
            const to = supplierEmails[supplier] || (template.default_to || '').trim();
            if (!to) {
                summary.skippedNoEmail.push(supplier);
                continue;
            }
            try {
                await emailService.sendEmail({
                    to,
                    cc: (template.default_cc || '').trim() || null,
                    subject: `URGENT: Design Pending for ${orders.length} Die Order(s) - ${supplier}`,
                    body: buildReminderBody(supplier, orders, days),
                    importance: 'high'
                });
                summary.sent++;
            } catch (err) {
                console.error(`Design reminder: failed to send to ${supplier}:`, err.message);
                summary.failed++;
            }
        }

        // Use the app server's local date (not the DB's CURRENT_DATE) so the
        // once-per-day check in reminderTick compares dates from the same clock
        await pool.query(
            'UPDATE reminder_settings SET design_reminder_last_run = $2 WHERE id = $1',
            [settings.id, localDateString()]
        );

        reminderState.lastRun = new Date().toISOString();
        reminderState.lastResult = summary;
        reminderState.error = null;
        console.log(`Design reminders: ${summary.sent} sent, ${summary.failed} failed, ` +
            `${summary.skippedNoEmail.length} supplier(s) without recipient, ${summary.totalOrders} overdue order(s)`);
        return summary;
    } catch (error) {
        reminderState.lastRun = new Date().toISOString();
        reminderState.error = error.message;
        console.error('Design reminder run error:', error.message);
        throw error;
    } finally {
        reminderState.running = false;
    }
}

// ── Scheduler ───────────────────────────────────────────────────────────────

function localDateString(d = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function reminderTick() {
    try {
        const settings = await getReminderSettings();
        if (!settings.design_reminder_enabled) return;

        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const nowHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const sendTime = settings.design_reminder_time || '08:00';

        // Run once per day, at or after the configured time. Comparing against
        // last_run (a DATE) also catches the case where the server was down at
        // the scheduled time — the reminder then goes out on the next tick.
        if (nowHHMM < sendTime) return;
        if (settings.design_reminder_last_run === localDateString(now)) return;

        await sendDesignReminders();
    } catch (error) {
        // Already logged in sendDesignReminders; never let the tick throw
    }
}

function scheduleDesignReminders() {
    if (reminderInterval) clearInterval(reminderInterval);
    reminderInterval = setInterval(reminderTick, 60 * 1000); // Check every minute
    console.log('Design reminder scheduler started (checks every minute)');
}

function getReminderState() {
    return { ...reminderState };
}

module.exports = {
    getReminderSettings,
    updateReminderSettings,
    sendDesignReminders,
    scheduleDesignReminders,
    getReminderState
};
