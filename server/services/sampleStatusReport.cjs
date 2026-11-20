/**
 * Sample Status report service: renders the daily Sample Status PDF and emails
 * it once a day (Monday to Saturday). Recipients live on the "Sample Status"
 * email template; the schedule lives in reminder_settings.
 */

const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../db.cjs');
const emailService = require('./email.cjs');
const { todayLocal } = require('./dates.cjs');
const { loadSampleStatus } = require('./sampleStatusReportData.cjs');
const { generateSampleStatusPdf, summaryText } = require('./sampleStatusReportPdf.cjs');

const TEMPLATE_NAME = 'Sample Status';
const DEFAULT_TIME = '18:00';

let tickInterval = null;

// In-memory status of the most recent run (for the settings UI)
const state = { lastRun: null, lastResult: null, error: null, running: false };

// Swappable in tests.
const _deps = {
  pool,
  sendEmail: (message) => emailService.sendEmail(message),
  renderPdfFor: (args) => renderPdfFor(args),
};

// ── Settings ────────────────────────────────────────────────────────────────

async function getSampleStatusSettings() {
  const result = await _deps.pool.query('SELECT * FROM reminder_settings ORDER BY id LIMIT 1');
  if (result.rows.length > 0) return result.rows[0];
  const inserted = await _deps.pool.query('INSERT INTO reminder_settings DEFAULT VALUES RETURNING *');
  return inserted.rows[0];
}

async function updateSampleStatusSettings({ enabled, time }) {
  const existing = await getSampleStatusSettings();
  const result = await _deps.pool.query(`
    UPDATE reminder_settings SET
      sample_status_enabled = COALESCE($1, sample_status_enabled),
      sample_status_time    = COALESCE($2, sample_status_time),
      updated_at            = CURRENT_TIMESTAMP
    WHERE id = $3
    RETURNING *
  `, [enabled, time, existing.id]);
  return result.rows[0];
}

// ── Schedule ────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');
// last_run is a DATE, but a timestamp-shaped value has turned up before.
const day = (value) => (value ? String(value).slice(0, 10) : null);

// Once per day at or after the time, Monday to Saturday. Comparing with
// last_run also catches a server that was down at the scheduled time.
function isDue({ enabled, time, lastRun }, now = new Date()) {
  if (!enabled) return false;
  if (now.getDay() === 0) return false; // Sunday
  const nowHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (nowHHMM < (time || DEFAULT_TIME)) return false;
  return day(lastRun) !== todayLocal(now);
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

function fileName(reportDate, plant) {
  const safe = String(plant || '').replace(/[^A-Za-z0-9-]/g, '');
  const suffix = safe && safe !== 'All' ? `-${safe}` : '';
  return `Sample-Status-${reportDate}${suffix}.pdf`;
}

async function renderPdfFor({ reportDate, plant = 'All' }) {
  const report = await loadSampleStatus(pool, { reportDate, plant });
  const bytes = await generateSampleStatusPdf(report, { generatedAt: new Date(), logoBytes: readLogo() });
  return { report, bytes };
}

// ── Sending ─────────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value ?? '-').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildEmailBody(intro, report) {
  const line = (report.plants || [])
    .map((p) => `<p style="font-size:13px;margin:2px 0;"><strong>${escapeHtml(p.plant)}</strong>: ${escapeHtml(summaryText(p.counts || {})).replace(/ - /g, ' &middot; ')}</p>`)
    .join('');
  return `
    <div style="font-family:Arial,sans-serif;font-size:13px;color:#0F172A;">
      <p>${escapeHtml(intro)}</p>
      ${line}
      <p style="font-size:11px;color:#64748B;margin-top:16px;">Generated automatically by the Die Ordering System.</p>
    </div>`;
}

// stamp: true only from the scheduler tick. Send now must not mark the day as
// done, or it would suppress that day's scheduled email.
async function sendSampleStatus({ now = new Date(), stamp: stampDay = false } = {}) {
  if (state.running) return { status: 'skipped', message: 'Already running' };
  state.running = true;
  try {
    const db = _deps.pool;
    const settings = await getSampleStatusSettings();
    const reportDate = todayLocal(now);
    const { rows } = await db.query(
      'SELECT subject_template, body_template, default_to, default_cc FROM email_templates WHERE name = $1',
      [TEMPLATE_NAME]
    );
    const template = rows[0];
    const to = String(template?.default_to || '').trim();
    const stamp = () => !stampDay ? null : db.query(
      'UPDATE reminder_settings SET sample_status_last_run = $1 WHERE id = $2', [reportDate, settings.id]
    );

    if (!to) {
      // Stamp the day so a missing list does not retry every minute.
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

    const { report, bytes } = await _deps.renderPdfFor({ reportDate, plant: 'All' });
    const vars = { date: reportDate };
    const subject = emailService.applyTemplate(template.subject_template || 'Sample status - {{date}}', vars);
    const intro = emailService.applyTemplate(template.body_template || '', vars);

    await _deps.sendEmail({
      to,
      cc: String(template.default_cc || '').trim() || null,
      subject,
      body: buildEmailBody(intro, report),
      attachments: [{ filename: fileName(reportDate), content: Buffer.from(bytes), contentType: 'application/pdf' }],
    });
    await stamp();

    const result = { status: 'sent', message: `Sample status emailed to ${to}`, reportDate, recipients: to };
    state.lastRun = new Date().toISOString();
    state.lastResult = result;
    state.error = null;
    return result;
  } catch (error) {
    state.lastRun = new Date().toISOString();
    state.error = error.message;
    console.error('Sample status run error:', error.message);
    throw error;
  } finally {
    state.running = false;
  }
}

// ── Scheduler ───────────────────────────────────────────────────────────────

async function sampleStatusTick() {
  try {
    const s = await getSampleStatusSettings();
    if (!isDue({ enabled: s.sample_status_enabled, time: s.sample_status_time, lastRun: s.sample_status_last_run })) return;
    await sendSampleStatus({ stamp: true });
  } catch {
    // Logged in sendSampleStatus; never let the tick throw
  }
}

function scheduleSampleStatus() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(sampleStatusTick, 60 * 1000);
  console.log('Sample status scheduler started (checks every minute, Monday to Saturday)');
}

function getSampleStatusState() {
  return { ...state };
}

module.exports = {
  getSampleStatusSettings,
  updateSampleStatusSettings,
  isDue,
  fileName,
  renderPdfFor,
  sendSampleStatus,
  scheduleSampleStatus,
  getSampleStatusState,
  _deps,
};
