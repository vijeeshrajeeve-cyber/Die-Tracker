'use strict';

// What happens around a published plan: the PDF schedule, and the email that
// takes it to the plant's mailing list. Kept out of trialPlans.cjs so the plan
// rules stay free of the mailer and the PDF library.
//
// The email never decides whether a plan is published. Publishing commits
// first; a missing recipient list or a mail server that is down is reported
// back to the page, and the PDF can still be downloaded and sent by hand.

const fs = require('node:fs');
const path = require('node:path');
const emailService = require('./email.cjs');
const { generateTrialPlanPdf } = require('./trialPlanPdf.cjs');

// The recipients for each plant live on an email template, edited in Settings
// with every other email's recipients.
const templateName = (plant) => `Trial Plan - ${plant}`;

function readLogo() {
  // server/assets, not public/: the backend image copies only server/.
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'assets', 'company-logo.png'));
  } catch {
    return null;
  }
}

async function publisherName(client, userId) {
  if (!userId) return '';
  const { rows } = await client.query(
    'SELECT COALESCE(NULLIF(trim(full_name), \'\'), username) AS name FROM users WHERE id = $1',
    [userId]
  );
  return rows[0]?.name || '';
}

// view: what trialPlans.planView returns.
async function renderPlanPdf(client, view, { logoBytes = readLogo(), generatedAt = new Date() } = {}) {
  const publishedBy = await publisherName(client, view.plan?.published_by);
  return generateTrialPlanPdf(view, { publishedBy, logoBytes, generatedAt });
}

const fileName = (view) => `Trial-schedule-${String(view.plant).replace(/\s+/g, '-')}-${view.date}.pdf`;

function escapeHtml(value) {
  return String(value === null || value === undefined || value === '' ? '-' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const TD = 'padding:6px 9px;border:1px solid #E4E4E7;';
const TH = 'padding:7px 9px;border:1px solid #E4E4E7;background:#F4F4F5;text-align:left;font-size:12px;';

// The plan is repeated in the body: the PDF is the record, but the press
// floor reads this on a phone.
function emailBody(view, intro) {
  const sorted = [...view.entries].sort((a, b) =>
    String(a.press || '').localeCompare(String(b.press || ''), 'en', { numeric: true })
    || (a.position || 0) - (b.position || 0));
  const rows = (list) => list.map((e) => `
      <tr><td style="${TD}">${escapeHtml(e.press)}</td>
          <td style="${TD}font-family:monospace;">${escapeHtml(e.die_no)}${e.urgent ? ' <strong style="color:#B91C1C;">URGENT</strong>' : ''}</td>
          <td style="${TD}">${escapeHtml(e.customer)}</td>
          <td style="${TD}">${escapeHtml(e.alloy)}</td>
          <td style="${TD}">${escapeHtml(e.tooling)}</td>
          <td style="${TD}">${escapeHtml(e.corrector)}</td></tr>`).join('');
  const table = (list) => `
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <thead><tr><th style="${TH}">Press</th><th style="${TH}">Die</th><th style="${TH}">Customer</th>
        <th style="${TH}">Alloy</th><th style="${TH}">Tooling</th><th style="${TH}">Corrector</th></tr></thead>
      <tbody>${rows(list)}</tbody>
    </table>`;
  const trials = sorted.filter((e) => e.entry_type !== 'Supervised');
  const supervised = sorted.filter((e) => e.entry_type === 'Supervised');
  const revision = view.plan?.revision > 1
    ? `<p style="color:#B45309;">Revision ${view.plan.revision}: this replaces the schedule sent earlier.</p>`
    : '';
  return `
    <div style="font-family:Arial,sans-serif;font-size:13px;color:#09090B;">
      <p>${escapeHtml(intro)}</p>
      ${revision}
      <h3 style="font-size:13px;margin:16px 0 6px;">Trials (${trials.length})</h3>
      ${trials.length ? table(trials) : '<p>No trials on this plan.</p>'}
      ${supervised.length ? `<h3 style="font-size:13px;margin:16px 0 6px;">Supervised runs - day shift only (${supervised.length})</h3>${table(supervised)}` : ''}
      <p style="font-size:11px;color:#57575E;margin-top:16px;">The attached PDF is the printable schedule. Sent by Die Tracker when the plan was published.</p>
    </div>`;
}

// Returns what happened, for the page to show: sent, skipped (no list), failed.
async function emailPlan(client, view, bytes, { send = emailService.sendEmail, sentBy = null } = {}) {
  const name = templateName(view.plant);
  const { rows } = await client.query(
    'SELECT subject_template, body_template, default_to, default_cc FROM email_templates WHERE name = $1',
    [name]
  );
  const template = rows[0];
  const to = String(template?.default_to || '').trim();
  if (!to) {
    return { status: 'skipped', message: `No recipients set for "${name}" in Settings, so the schedule was not emailed` };
  }
  const vars = { plant: view.plant, date: view.date };
  const subject = emailService.applyTemplate(template.subject_template || 'Trial schedule {{plant}} - {{date}}', vars);
  const intro = emailService.applyTemplate(template.body_template || '', vars);
  try {
    await send({
      to,
      cc: String(template.default_cc || '').trim() || null,
      subject: view.plan?.revision > 1 ? `${subject} (revision ${view.plan.revision})` : subject,
      body: emailBody(view, intro),
      sentBy,
      attachments: [{ filename: fileName(view), content: Buffer.from(bytes), contentType: 'application/pdf' }],
    });
    return { status: 'sent', to, message: `Schedule emailed to ${to}` };
  } catch (error) {
    return { status: 'failed', message: `The plan is published but the email failed: ${error.message}` };
  }
}

module.exports = { templateName, renderPlanPdf, emailPlan, emailBody, fileName };
