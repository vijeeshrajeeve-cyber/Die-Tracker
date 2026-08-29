/**
 * Daily Summary Report Service
 * Builds the previous day's activity report, renders it as a signable PDF and
 * emails it to the configured recipients once a day. All knobs live in
 * reminder_settings, alongside the design and FOC reminders.
 *
 * This is the only module in the feature that talks to the mailer.
 */

const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../db.cjs');
const emailService = require('./email.cjs');
const { buildReport } = require('./dailySummaryData.cjs');
const { generateDailySummaryPdf } = require('./dailySummaryPdf.cjs');

let tickInterval = null;

// In-memory status of the most recent run (for the settings UI)
const state = {
    lastRun: null,
    lastResult: null,
    error: null,
    running: false
};

// ── Settings ────────────────────────────────────────────────────────────────

async function getDailySummarySettings() {
    const result = await pool.query('SELECT * FROM reminder_settings ORDER BY id LIMIT 1');
    if (result.rows.length > 0) return result.rows[0];
    // Create the default row on first access so PUT always has a row to update
    const inserted = await pool.query('INSERT INTO reminder_settings DEFAULT VALUES RETURNING *');
    return inserted.rows[0];
}

async function updateDailySummarySettings({ enabled, time, to, cc }) {
    const existing = await getDailySummarySettings();
    const result = await pool.query(`
        UPDATE reminder_settings SET
            daily_summary_enabled = COALESCE($1, daily_summary_enabled),
            daily_summary_time    = COALESCE($2, daily_summary_time),
            daily_summary_to      = COALESCE($3, daily_summary_to),
            daily_summary_cc      = COALESCE($4, daily_summary_cc),
            updated_at            = CURRENT_TIMESTAMP
        WHERE id = $5
        RETURNING *
    `, [enabled, time, to, cc, existing.id]);
    return result.rows[0];
}

// ── Dates ───────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');

function localDateString(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// last_run is a DATE, but a timestamp-shaped value has turned up before;
// compare by day rather than by string.
const day = (value) => (value ? String(value).slice(0, 10) : null);

function previousDay(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 1);
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// Run once per day, at or after the configured time. Comparing against
// last_run (a DATE) also catches the case where the server was down at the
// scheduled time — the report then goes out on the next tick.
function isDue({ enabled, time, lastRun }, now = new Date()) {
    if (!enabled) return false;
    const nowHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (nowHHMM < (time || '06:00')) return false;
    return day(lastRun) !== localDateString(now);
}

// ── Email body ──────────────────────────────────────────────────────────────

function escapeHtml(value) {
    return (value === null || value === undefined || value === '' ? '-' : value)
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const TD = 'padding:7px 10px;border:1px solid #CBD5E1;';
const TH = 'padding:8px 10px;border:1px solid #CBD5E1;background:#E2E8F0;color:#0F172A;text-align:left;';

// The numbers are repeated in the body on purpose: the PDF is the record, but
// nobody opens an attachment on a phone at six in the morning.
function buildEmailBody(report) {
    const activityRows = report.activity.map((a) => `
        <tr><td style="${TD}">${escapeHtml(a.label)}</td>
            <td style="${TD}text-align:right;font-weight:600;">${a.count}</td></tr>`).join('');

    const pendingRows = report.pending.map((p) => `
        <tr><td style="${TD}">${escapeHtml(p.label)}</td>
            <td style="${TD}text-align:right;font-weight:600;">${p.count}</td>
            <td style="${TD}text-align:right;">${p.oldestDays === null ? '-' : p.oldestDays}</td></tr>`).join('');

    const lateNote = report.lateTotal > 0
        ? `<p style="font-size:13px;color:#B45309;">${report.lateTotal} entr${report.lateTotal === 1 ? 'y was' : 'ies were'} recorded late and are listed in the attached PDF.</p>`
        : '';

    return `
        <div style="font-family:Arial,sans-serif;font-size:13px;color:#0F172A;">
        <p>Daily die order summary for <strong>${escapeHtml(report.reportDate)}</strong>.</p>

        <h3 style="font-size:13px;margin:18px 0 6px;">Activity recorded for this day</h3>
        <table style="border-collapse:collapse;width:100%;font-size:13px;">
            <thead><tr><th style="${TH}">Stage</th><th style="${TH}text-align:right;">Count</th></tr></thead>
            <tbody>${activityRows}
                <tr><td style="${TD}font-weight:700;">Total movements</td>
                    <td style="${TD}text-align:right;font-weight:700;">${report.activityTotal}</td></tr>
            </tbody>
        </table>
        ${lateNote}

        <h3 style="font-size:13px;margin:18px 0 6px;">Pending at each stage</h3>
        <p style="font-size:11px;color:#64748B;margin:0 0 6px;">
            Position as at the time of generation, not as at the report date.</p>
        <table style="border-collapse:collapse;width:100%;font-size:13px;">
            <thead><tr><th style="${TH}">Stage</th><th style="${TH}text-align:right;">Orders</th>
                <th style="${TH}text-align:right;">Oldest waiting (days)</th></tr></thead>
            <tbody>${pendingRows}</tbody>
        </table>

        <p style="font-size:11px;color:#64748B;margin-top:18px;">
            The attached PDF is the signable copy. Generated automatically by the Die Ordering System.</p>
        </div>`;
}

// ── Generation and sending ──────────────────────────────────────────────────

function readLogo() {
    // server/assets, not public/. Dockerfile.backend copies only server/, so a
    // path into public/ resolves in dev and silently yields an unbranded PDF in
    // the container -- which is where the real reports are generated.
    try {
        return fs.readFileSync(path.join(__dirname, '..', 'assets', 'company-logo.png'));
    } catch {
        return null; // a report without a logo is still a report
    }
}

async function renderPdfFor(reportDate, { commit }) {
    const report = await buildReport(pool, {
        reportDate,
        today: localDateString(),
        commit,
    });
    const bytes = await generateDailySummaryPdf(report, {
        logoBytes: readLogo(),
        generatedAt: new Date(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || 'UTC',
    });
    return { report, bytes };
}

// Commits to the ledger unconditionally: this function sends to the real
// recipient list, so anything it reports has been reported. Only the download
// preview passes commit:false, and it does not come through here.
async function sendDailySummary() {
    if (state.running) return { skipped: 'already running' };
    state.running = true;
    try {
        const settings = await getDailySummarySettings();
        const to = String(settings.daily_summary_to || '').trim();

        // Sending nowhere is not a run. Returning without stamping last_run
        // means configuring recipients later today still produces the report.
        if (!to) {
            state.lastRun = new Date().toISOString();
            state.lastResult = { skipped: 'no recipients configured' };
            state.error = null;
            return state.lastResult;
        }

        const reportDate = previousDay(localDateString());
        const { report, bytes } = await renderPdfFor(reportDate, { commit: true });

        await emailService.sendEmail({
            to,
            cc: String(settings.daily_summary_cc || '').trim() || null,
            subject: `Daily Die Order Summary - ${reportDate}`,
            body: buildEmailBody(report),
            attachments: [{
                filename: `Daily-Die-Summary-${reportDate}.pdf`,
                content: Buffer.from(bytes),
                contentType: 'application/pdf',
            }],
        });

        await pool.query(
            'UPDATE reminder_settings SET daily_summary_last_run = CURRENT_DATE WHERE id = $1',
            [settings.id]
        );

        state.lastRun = new Date().toISOString();
        state.lastResult = {
            reportDate,
            movements: report.activityTotal,
            late: report.lateTotal,
            recipients: to,
        };
        state.error = null;
        return state.lastResult;
    } catch (error) {
        state.lastRun = new Date().toISOString();
        state.error = error.message;
        console.error('Daily summary run error:', error.message);
        throw error;
    } finally {
        state.running = false;
    }
}

// ── Scheduler ───────────────────────────────────────────────────────────────

async function dailySummaryTick() {
    try {
        const settings = await getDailySummarySettings();
        if (!isDue({
            enabled: settings.daily_summary_enabled,
            time: settings.daily_summary_time,
            lastRun: settings.daily_summary_last_run,
        })) return;
        await sendDailySummary();
    } catch {
        // Already logged in sendDailySummary; never let the tick throw
    }
}

function scheduleDailySummary() {
    if (tickInterval) clearInterval(tickInterval);
    tickInterval = setInterval(dailySummaryTick, 60 * 1000); // Check every minute
    // Print the clock the scheduler compares against — a container without TZ
    // set runs on UTC, which silently shifts when the report goes out.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || 'UTC';
    console.log(`Daily summary scheduler started (checks every minute; ` +
        `server time ${new Date().toLocaleTimeString('en-GB')} ${tz})`);
}

function getDailySummaryState() {
    return { ...state };
}

module.exports = {
    getDailySummarySettings,
    updateDailySummarySettings,
    isDue,
    localDateString,
    previousDay,
    buildEmailBody,
    renderPdfFor,
    sendDailySummary,
    scheduleDailySummary,
    getDailySummaryState
};
