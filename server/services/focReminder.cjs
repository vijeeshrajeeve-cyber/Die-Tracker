/**
 * FOC Reminder Service
 *
 * Two chasers for the two things that can be pending against an accepted FOC:
 *
 *   outward — to the supplier, listing replacements they promised and have not
 *             delivered by the ETA they themselves gave.
 *   inward  — to our own FOC owner, listing replacements that have arrived and
 *             are sitting untrialled, plus the overdue promises, so a die that
 *             reached the plant cannot quietly go unproven.
 *
 * Each runs once a day at its own configured time. All knobs live in
 * reminder_settings, alongside the design reminder's.
 */

const { pool } = require('../db.cjs');
const emailService = require('./email.cjs');
const signature = require('./emailSignature.cjs');

let focInterval = null;

// In-memory status of the most recent run of each chaser (for the settings UI)
const focState = {
    supplier: { lastRun: null, lastResult: null, error: null, running: false },
    internal: { lastRun: null, lastResult: null, error: null, running: false },
};

// QDs that have been settled are nobody's to chase, whatever their last round
// says. Drafts are not yet real QDs and must never reach a supplier.
const CHASEABLE = `q.status NOT IN ('Closed', 'Rejected', 'Reference')
                   AND q.approval_state <> 'Draft'`;

// Only the newest round is live; earlier ones are closed history.
const LATEST_ROUND = `r.round_no = (SELECT MAX(r2.round_no) FROM qd_foc_rounds r2 WHERE r2.qd_id = q.id)`;

// ── Settings ────────────────────────────────────────────────────────────────

async function getFocSettings() {
    const result = await pool.query('SELECT * FROM reminder_settings ORDER BY id LIMIT 1');
    if (result.rows.length > 0) return result.rows[0];
    const inserted = await pool.query('INSERT INTO reminder_settings DEFAULT VALUES RETURNING *');
    return inserted.rows[0];
}

async function updateFocSettings({
    supplierEnabled, supplierTime, internalEnabled, internalTime, internalTo, idleDays,
}) {
    const existing = await getFocSettings();
    const result = await pool.query(`
        UPDATE reminder_settings SET
            foc_supplier_enabled = COALESCE($1, foc_supplier_enabled),
            foc_supplier_time    = COALESCE($2, foc_supplier_time),
            foc_internal_enabled = COALESCE($3, foc_internal_enabled),
            foc_internal_time    = COALESCE($4, foc_internal_time),
            foc_internal_to      = COALESCE($5, foc_internal_to),
            foc_idle_days        = COALESCE($6, foc_idle_days),
            updated_at           = CURRENT_TIMESTAMP
        WHERE id = $7
        RETURNING *
    `, [supplierEnabled, supplierTime, internalEnabled, internalTime, internalTo, idleDays, existing.id]);
    return result.rows[0];
}

// ── Queries ─────────────────────────────────────────────────────────────────

// Promised, past its ETA, and nothing has arrived.
async function overdueReceipts(db = pool) {
    const { rows } = await db.query(`
        SELECT q.id, q.qd_no, q.die_no, q.profile_number, q.plant, q.supplier,
               r.round_no, r.promised_eta,
               (CURRENT_DATE - r.promised_eta) AS days_overdue
          FROM quality_discrepancies q
          JOIN qd_foc_rounds r ON r.qd_id = q.id
         WHERE ${CHASEABLE}
           AND ${LATEST_ROUND}
           AND r.trial_result IS NULL
           AND r.received_date IS NULL
           AND r.promised_eta IS NOT NULL
           AND r.promised_eta < CURRENT_DATE
         ORDER BY q.supplier, r.promised_eta
    `);
    return rows;
}

// Arrived, and has been sitting untrialled for longer than the threshold.
async function idleReceipts(idleDays, db = pool) {
    const { rows } = await db.query(`
        SELECT q.id, q.qd_no, q.die_no, q.profile_number, q.plant, q.supplier,
               r.round_no, r.received_date,
               (CURRENT_DATE - r.received_date) AS days_idle
          FROM quality_discrepancies q
          JOIN qd_foc_rounds r ON r.qd_id = q.id
         WHERE ${CHASEABLE}
           AND ${LATEST_ROUND}
           AND r.trial_result IS NULL
           AND r.received_date IS NOT NULL
           AND r.received_date <= CURRENT_DATE - $1::int
         ORDER BY r.received_date
    `, [idleDays]);
    return rows;
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

const day = (v) => (v ? String(v).slice(0, 10) : null);

const TH = 'padding:9px 10px;border:1px solid #CBD5E1;';
const TD = 'padding:8px 10px;border:1px solid #CBD5E1;';

function table(headers, rows) {
    const head = headers.map((h) => `<th style="${TH}text-align:${h.align || 'left'};">${h.label}</th>`).join('');
    const body = rows.map((cells, i) => `<tr>${
        cells.map((c, j) => `<td style="${TD}text-align:${headers[j].align || 'left'};${j === 1 ? 'font-weight:600;' : ''}">${
            escapeHtml(c === '#' ? i + 1 : c)}</td>`).join('')
    }</tr>`).join('');
    return `<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px;color:#0F172A;">
        <thead><tr style="background:#E2E8F0;color:#0F172A;">${head}</tr></thead>
        <tbody>${body}</tbody>
    </table>`;
}

// Sent to the supplier. Deliberately states only what they told us and what has
// happened since — the ETA is their own commitment, so there is nothing to argue
// about. Round number is shown so a second or third attempt is not glossed over.
function buildSupplierBody(supplier, rows) {
    const body = rows.map((r, i) => [
        i + 1, r.qd_no, r.die_no, r.profile_number, day(r.promised_eta), r.days_overdue, r.round_no,
    ]);
    const anyRepeat = rows.some((r) => Number(r.round_no) > 1);
    return `
        <p>Dear ${escapeHtml(supplier)} Team,</p>
        <p>This is an automated reminder that the following free-of-charge replacement(s)
           you accepted have not yet reached us, and are now past the delivery date you provided:</p>
        ${table([
            { label: 'SL No', align: 'center' },
            { label: 'QD No' },
            { label: 'Die Number' },
            { label: 'Profile' },
            { label: 'Promised ETA' },
            { label: 'Days Overdue', align: 'center' },
            { label: 'Attempt', align: 'center' },
        ], body)}
        ${anyRepeat ? '<p><b>Note:</b> an attempt number above 1 means an earlier replacement against the same QD did not pass its trial.</p>' : ''}
        <p>Please confirm the revised dispatch date for each of the above, or advise if any has already shipped.</p>
        ${signature.dieDesignSignature()}`;
}

// Sent inward. Covers both buckets, because the question the owner actually
// needs answered each morning is "what is outstanding against our FOC claims",
// not "what is late at the supplier" alone.
function buildInternalBody(overdue, idle, idleDays) {
    const overdueRows = overdue.map((r, i) => [
        i + 1, r.qd_no, r.die_no, r.supplier, r.plant, day(r.promised_eta), r.days_overdue,
    ]);
    const idleRows = idle.map((r, i) => [
        i + 1, r.qd_no, r.die_no, r.supplier, r.plant, day(r.received_date), r.days_idle,
    ]);
    const overdueSection = overdue.length ? `
        <h3 style="font-family:Arial,sans-serif;color:#0F172A;margin:18px 0 8px;">Awaiting receipt — past the supplier's ETA (${overdue.length})</h3>
        ${table([
            { label: 'SL No', align: 'center' },
            { label: 'QD No' },
            { label: 'Die Number' },
            { label: 'Supplier' },
            { label: 'Plant' },
            { label: 'Promised ETA' },
            { label: 'Days Overdue', align: 'center' },
        ], overdueRows)}` : '';
    const idleSection = idle.length ? `
        <h3 style="font-family:Arial,sans-serif;color:#0F172A;margin:18px 0 8px;">In plant, awaiting trial for more than ${idleDays} day(s) (${idle.length})</h3>
        ${table([
            { label: 'SL No', align: 'center' },
            { label: 'QD No' },
            { label: 'Die Number' },
            { label: 'Supplier' },
            { label: 'Plant' },
            { label: 'Received' },
            { label: 'Days Idle', align: 'center' },
        ], idleRows)}
        <p style="font-size:13px;color:#475569;">These replacements have arrived but have not been trialled, so the QDs behind them cannot be closed.</p>` : '';
    return `
        <p>Dear Team,</p>
        <p>Automated status of the free-of-charge replacements outstanding against accepted QDs:</p>
        ${overdueSection}
        ${idleSection}
        <p>Record receipts and trial results in the QD Tracker so this list stays accurate.</p>
        ${signature.dieDesignSignature()}`;
}

// ── Sending ─────────────────────────────────────────────────────────────────

async function assertSendable() {
    const emailConfig = await emailService.getEmailConfig();
    if (!emailConfig || !emailConfig.send_enabled) {
        throw new Error('SMTP sending is not enabled. Configure it in Email Settings.');
    }
}

async function sendSupplierFocReminders() {
    const state = focState.supplier;
    if (state.running) return { skipped: true, reason: 'A supplier FOC reminder run is already in progress' };
    state.running = true;

    try {
        const settings = await getFocSettings();
        await assertSendable();

        const rows = await overdueReceipts();
        const groups = {};
        for (const row of rows) {
            const supplier = (row.supplier || '').trim();
            if (!supplier) continue;
            if (!groups[supplier]) groups[supplier] = [];
            groups[supplier].push(row);
        }

        const suppliersResult = await pool.query('SELECT name, contact_email FROM suppliers');
        const supplierEmails = Object.fromEntries(
            suppliersResult.rows.map((s) => [s.name, (s.contact_email || '').trim()])
        );

        const summary = { sent: 0, failed: 0, skippedNoEmail: [], totalOverdue: rows.length };

        for (const [supplier, list] of Object.entries(groups)) {
            const to = supplierEmails[supplier];
            if (!to) {
                summary.skippedNoEmail.push(supplier);
                continue;
            }
            try {
                await emailService.sendEmail({
                    to,
                    subject: `FOC replacement overdue — ${list.length} QD(s) - ${supplier}`,
                    body: buildSupplierBody(supplier, list),
                    importance: 'high',
                });
                summary.sent++;
            } catch (err) {
                console.error(`FOC supplier reminder: failed to send to ${supplier}:`, err.message);
                summary.failed++;
            }
        }

        await pool.query(
            'UPDATE reminder_settings SET foc_supplier_last_run = $2 WHERE id = $1',
            [settings.id, localDateString()]
        );
        state.lastRun = new Date().toISOString();
        state.lastResult = summary;
        state.error = null;
        console.log(`FOC supplier reminders: ${summary.sent} sent, ${summary.failed} failed, ` +
            `${summary.skippedNoEmail.length} supplier(s) without recipient, ${summary.totalOverdue} overdue FOC(s)`);
        return summary;
    } catch (error) {
        state.lastRun = new Date().toISOString();
        state.error = error.message;
        console.error('FOC supplier reminder run error:', error.message);
        throw error;
    } finally {
        state.running = false;
    }
}

async function sendInternalFocReminder() {
    const state = focState.internal;
    if (state.running) return { skipped: true, reason: 'An internal FOC reminder run is already in progress' };
    state.running = true;

    try {
        const settings = await getFocSettings();
        const to = (settings.foc_internal_to || '').trim();
        if (!to) throw new Error('No internal FOC recipient is set. Add one in Reminder Settings.');
        await assertSendable();

        const idleDays = Number(settings.foc_idle_days) || 3;
        const [overdue, idle] = await Promise.all([overdueReceipts(), idleReceipts(idleDays)]);

        // Nothing outstanding is good news, not a reason for a daily email.
        if (!overdue.length && !idle.length) {
            const summary = { sent: 0, overdue: 0, idle: 0, quiet: true };
            await markInternalRun(settings.id, state, summary);
            return summary;
        }

        await emailService.sendEmail({
            to,
            subject: `FOC status — ${overdue.length} overdue, ${idle.length} awaiting trial`,
            body: buildInternalBody(overdue, idle, idleDays),
            importance: overdue.length ? 'high' : 'normal',
        });

        const summary = { sent: 1, overdue: overdue.length, idle: idle.length, quiet: false };
        await markInternalRun(settings.id, state, summary);
        console.log(`FOC internal reminder: ${overdue.length} overdue, ${idle.length} awaiting trial`);
        return summary;
    } catch (error) {
        state.lastRun = new Date().toISOString();
        state.error = error.message;
        console.error('FOC internal reminder run error:', error.message);
        throw error;
    } finally {
        state.running = false;
    }
}

// A quiet day still counts as a run, or the tick would retry every minute.
async function markInternalRun(settingsId, state, summary) {
    await pool.query(
        'UPDATE reminder_settings SET foc_internal_last_run = $2 WHERE id = $1',
        [settingsId, localDateString()]
    );
    state.lastRun = new Date().toISOString();
    state.lastResult = summary;
    state.error = null;
}

// ── Scheduler ───────────────────────────────────────────────────────────────

function localDateString(d = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Run once per day, at or after the configured time. Comparing against last_run
// (a DATE) also catches a server that was down at the scheduled moment — the
// mail then goes out on the next tick rather than being skipped for the day.
function isDue({ enabled, time, lastRun }, now = new Date()) {
    if (!enabled) return false;
    const pad = (n) => String(n).padStart(2, '0');
    const nowHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (nowHHMM < (time || '08:00')) return false;
    return day(lastRun) !== localDateString(now);
}

async function focTick() {
    try {
        const settings = await getFocSettings();
        const now = new Date();
        if (isDue({
            enabled: settings.foc_supplier_enabled,
            time: settings.foc_supplier_time,
            lastRun: settings.foc_supplier_last_run,
        }, now)) {
            await sendSupplierFocReminders().catch(() => {});
        }
        if (isDue({
            enabled: settings.foc_internal_enabled,
            time: settings.foc_internal_time,
            lastRun: settings.foc_internal_last_run,
        }, now)) {
            await sendInternalFocReminder().catch(() => {});
        }
    } catch (error) {
        // Already logged by the senders; never let the tick throw
    }
}

function scheduleFocReminders() {
    if (focInterval) clearInterval(focInterval);
    focInterval = setInterval(focTick, 60 * 1000);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || 'UTC';
    console.log(`FOC reminder scheduler started (checks every minute; ` +
        `server time ${new Date().toLocaleTimeString('en-GB')} ${tz})`);
}

function getFocReminderState() {
    return { supplier: { ...focState.supplier }, internal: { ...focState.internal } };
}

module.exports = {
    getFocSettings,
    updateFocSettings,
    overdueReceipts,
    idleReceipts,
    buildSupplierBody,
    buildInternalBody,
    isDue,
    localDateString,
    sendSupplierFocReminders,
    sendInternalFocReminder,
    scheduleFocReminders,
    getFocReminderState,
};
