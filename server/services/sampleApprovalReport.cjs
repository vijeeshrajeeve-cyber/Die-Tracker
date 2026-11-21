/**
 * Sample Approval Followup report service: renders the monthly PDF + Excel and
 * emails both once a month. Recipients live on the "Approval Report" email
 * template; the schedule and the overdue target live in reminder_settings.
 */

const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../db.cjs');
const emailService = require('./email.cjs');
const { todayLocal } = require('./dates.cjs');
const { loadSampleApproval, previousMonth, monthLabel } = require('./sampleApprovalReportData.cjs');
const { generateSampleApprovalPdf } = require('./sampleApprovalReportPdf.cjs');
const { generateSampleApprovalXlsx } = require('./sampleApprovalReportXlsx.cjs');

const TEMPLATE_NAME = 'Approval Report';
const DEFAULT_TIME = '08:00';
const DEFAULT_DAY = 1;
const DEFAULT_TARGET_DAYS = 14;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let tickInterval = null;

// In-memory status of the most recent run (for the settings UI)
const state = { lastRun: null, lastResult: null, error: null, running: false };

// Swappable in tests.
const _deps = {
  pool,
  sendEmail: (message) => emailService.sendEmail(message),
  renderFor: (args) => renderFor(args),
};

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const wholeIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

// ── Settings ────────────────────────────────────────────────────────────────

async function getApprovalReportSettings() {
  const result = await _deps.pool.query('SELECT * FROM reminder_settings ORDER BY id LIMIT 1');
  if (result.rows.length > 0) return result.rows[0];
  const inserted = await _deps.pool.query('INSERT INTO reminder_settings DEFAULT VALUES RETURNING *');
  return inserted.rows[0];
}

async function updateApprovalReportSettings({ enabled, day, time, targetDays } = {}) {
  if (enabled !== undefined && typeof enabled !== 'boolean') throw badRequest('enabled must be a boolean');
  if (time !== undefined && !HHMM.test(time)) throw badRequest('time must be in HH:MM (24-hour) format');
  if (day !== undefined && !wholeIn(day, 1, 28)) throw badRequest('day must be a whole number from 1 to 28');
  if (targetDays !== undefined && !wholeIn(targetDays, 1, 90)) throw badRequest('targetDays must be a whole number from 1 to 90');
  const existing = await getApprovalReportSettings();
  const result = await _deps.pool.query(`
    UPDATE reminder_settings SET
      approval_report_enabled = COALESCE($1, approval_report_enabled),
      approval_report_day     = COALESCE($2, approval_report_day),
      approval_report_time    = COALESCE($3, approval_report_time),
      approval_target_days    = COALESCE($4, approval_target_days),
      updated_at              = CURRENT_TIMESTAMP
    WHERE id = $5
    RETURNING *
  `, [enabled ?? null, day ?? null, time ?? null, targetDays ?? null, existing.id]);
  return result.rows[0];
}

// ── Schedule ────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');

// The send date for the report of `month`: `day` of the next calendar month,
// a Sunday moved to the Monday. `now` is accepted for symmetry and unused.
function sendMonthFor(month, day, now = new Date()) { // eslint-disable-line no-unused-vars
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, Number(day) || DEFAULT_DAY)); // month index m = next month
  if (d.getUTCDay() === 0) {
    // Sunday goes to Monday, unless that leaves the send month: then the Saturday before.
    const monday = new Date(d.getTime() + 86400000);
    d.setTime(monday.getUTCMonth() === d.getUTCMonth() ? monday.getTime() : d.getTime() - 86400000);
  }
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Once per report month, on or after the send date and time, and only within
// the send date's own calendar month (a server down for longer skips that month).
function isDue({ enabled, day, time, lastMonth }, now = new Date()) {
  if (!enabled) return false;
  const today = todayLocal(now);
  const month = previousMonth(today);
  if (lastMonth === month) return false;
  const sendDate = sendMonthFor(month, day || DEFAULT_DAY, now);
  if (today < sendDate) return false;
  // Same-month check is defensive: sendMonthFor always stays in the month after the report month.
  if (today.slice(0, 7) !== sendDate.slice(0, 7)) return false;
  if (today === sendDate) {
    const nowHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (nowHHMM < (time || DEFAULT_TIME)) return false;
  }
  return true;
}

// ── Rendering ───────────────────────────────────────────────────────────────

function readLogo() {
  // server/assets, not public/: the container copies only server/.
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'assets', 'company-logo.png'));
  } catch {
    return null;
  }
}

function fileName(month, kind) {
  return `Sample-Approval-${month}.${kind === 'xlsx' ? 'xlsx' : 'pdf'}`;
}

async function renderFor({ month, kind, reportDate = todayLocal() }) {
  const settings = await getApprovalReportSettings();
  const targetDays = settings.approval_target_days || DEFAULT_TARGET_DAYS;
  const report = await loadSampleApproval(pool, { reportDate, month, targetDays });
  const generatedAt = new Date();
  const bytes = kind === 'xlsx'
    ? await generateSampleApprovalXlsx(report, { generatedAt })
    : await generateSampleApprovalPdf(report, { generatedAt, logoBytes: readLogo() });
  return { report, bytes };
}

// ── Sending ─────────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value ?? '-').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildEmailBody(intro, report) {
  const h = report.header || {};
  const avg = h.avgDays === null || h.avgDays === undefined ? '-' : `${h.avgDays} days`;
  // Escape first, then insert entities, so the body stays pure ASCII.
  const line = [
    `Waiting now: ${h.waiting ?? 0}`,
    `Overdue (over ${report.targetDays ?? DEFAULT_TARGET_DAYS} days): ${h.overdue ?? 0}`,
    `Approved in ${report.monthLabel || monthLabel(report.month)}: ${h.approved ?? 0}`,
    `Average days to approval: ${avg}`,
  ].map(escapeHtml).join(' &middot; ');
  return `
    <div style="font-family:Arial,sans-serif;font-size:13px;color:#0F172A;">
      <p>${escapeHtml(intro)}</p>
      <p style="font-size:13px;margin:2px 0;">${line}</p>
      <p style="font-size:11px;color:#64748B;margin-top:16px;">Generated automatically by the Die Ordering System.</p>
    </div>`;
}

// stamp: true only from the scheduler tick. Send now must not mark the month
// as done, or it would suppress the scheduled email.
async function sendApprovalReport({ now = new Date(), stamp: stampMonth = false } = {}) {
  if (state.running) return { status: 'skipped', message: 'Already running' };
  state.running = true;
  try {
    const db = _deps.pool;
    const settings = await getApprovalReportSettings();
    const reportDate = todayLocal(now);
    const month = previousMonth(reportDate);
    const { rows } = await db.query(
      'SELECT subject_template, body_template, default_to, default_cc FROM email_templates WHERE name = $1',
      [TEMPLATE_NAME]
    );
    const template = rows[0];
    const to = String(template?.default_to || '').trim();
    const stamp = () => !stampMonth ? null : db.query(
      'UPDATE reminder_settings SET approval_report_last_month = $1 WHERE id = $2', [month, settings.id]
    );

    if (!to) {
      // Stamp the month so a missing list does not retry every minute.
      await stamp();
      const result = {
        status: 'skipped',
        message: `No recipients set for "${TEMPLATE_NAME}" in Settings, so the report was not emailed`,
      };
      state.lastRun = new Date().toISOString();
      state.lastResult = result;
      state.error = null;
      return result;
    }

    const pdf = await _deps.renderFor({ month, kind: 'pdf', reportDate });
    const xlsx = await _deps.renderFor({ month, kind: 'xlsx', reportDate });
    const vars = { month: monthLabel(month) };
    const subject = emailService.applyTemplate(template.subject_template || 'Sample approval report - {{month}}', vars);
    const intro = emailService.applyTemplate(template.body_template || '', vars);

    await _deps.sendEmail({
      to,
      cc: String(template.default_cc || '').trim() || null,
      subject,
      body: buildEmailBody(intro, pdf.report),
      attachments: [
        { filename: fileName(month, 'pdf'), content: Buffer.from(pdf.bytes), contentType: 'application/pdf' },
        { filename: fileName(month, 'xlsx'), content: Buffer.from(xlsx.bytes), contentType: XLSX_TYPE },
      ],
    });
    await stamp();

    const result = { status: 'sent', message: `Sample approval report emailed to ${to}`, month, recipients: to };
    state.lastRun = new Date().toISOString();
    state.lastResult = result;
    state.error = null;
    return result;
  } catch (error) {
    state.lastRun = new Date().toISOString();
    state.error = error.message;
    console.error('Sample approval report run error:', error.message);
    throw error;
  } finally {
    state.running = false;
  }
}

// ── Scheduler ───────────────────────────────────────────────────────────────

async function approvalReportTick() {
  try {
    const s = await getApprovalReportSettings();
    if (!isDue({
      enabled: s.approval_report_enabled,
      day: s.approval_report_day,
      time: s.approval_report_time,
      lastMonth: s.approval_report_last_month,
    })) return;
    await sendApprovalReport({ stamp: true });
  } catch {
    // Logged in sendApprovalReport; never let the tick throw
  }
}

function scheduleApprovalReport() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(approvalReportTick, 60 * 1000);
  console.log('Sample approval report scheduler started (checks every minute, monthly)');
}

function getApprovalReportState() {
  return { ...state };
}

module.exports = {
  getApprovalReportSettings,
  updateApprovalReportSettings,
  sendMonthFor,
  isDue,
  fileName,
  renderFor,
  sendApprovalReport,
  scheduleApprovalReport,
  getApprovalReportState,
  _deps,
};
