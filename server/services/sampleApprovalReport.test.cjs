const test = require('node:test');
const assert = require('node:assert/strict');
const svc = require('./sampleApprovalReport.cjs');

const at = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm);
const ON = { enabled: true, day: 1, time: '08:00', lastMonth: null };

test('sendMonthFor moves Sunday to Monday', () => {
  assert.equal(svc.sendMonthFor('2026-10', 1), '2026-11-02');
  assert.equal(svc.sendMonthFor('2026-11', 1), '2026-12-01');
  assert.equal(svc.sendMonthFor('2026-11', 28), '2026-12-28');
});

test('isDue sends once per month', () => {
  assert.equal(svc.isDue(ON, at(2026, 12, 1, 7, 59)), false);
  assert.equal(svc.isDue(ON, at(2026, 12, 1, 8, 0)), true);
  assert.equal(svc.isDue({ ...ON, lastMonth: '2026-11' }, at(2026, 12, 1, 8, 0)), false);
  assert.equal(svc.isDue({ ...ON, lastMonth: '2026-10' }, at(2026, 12, 10, 9, 0)), true);
  assert.equal(svc.isDue({ ...ON, lastMonth: '2026-11' }, at(2027, 1, 1, 8, 0)), true);
  assert.equal(svc.isDue({ ...ON, enabled: false }, at(2026, 12, 1, 8, 0)), false);
});

test('isDue never fires on the Sunday', () => {
  assert.equal(svc.isDue(ON, at(2026, 11, 1, 9, 0)), false);
  assert.equal(svc.isDue(ON, at(2026, 11, 2, 8, 0)), true);
});

const REPORT = {
  month: '2026-11', monthLabel: 'November 2026', targetDays: 14,
  header: { waiting: 5, overdue: 2, approved: 3, avgDays: 6.5 },
  waiting: [], lastMonth: { rows: [], total: {} }, footnotes: {},
};

function stub({ to }) {
  const sent = [];
  const queries = [];
  svc._deps.pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/FROM email_templates/.test(sql)) {
        return { rows: [{ subject_template: 'Sample approval report - {{month}}', body_template: 'Report for {{month}} is attached.', default_to: to, default_cc: '' }] };
      }
      if (/FROM reminder_settings/.test(sql)) return { rows: [{ id: 1, approval_target_days: 14 }] };
      return { rows: [] };
    },
  };
  svc._deps.renderFor = async ({ month, kind }) => ({ report: { ...REPORT, month }, bytes: new Uint8Array([kind === 'pdf' ? 1 : 2]) });
  svc._deps.sendEmail = async (m) => { sent.push(m); };
  return { sent, queries };
}
const stamps = (queries) => queries.filter((q) => /UPDATE reminder_settings SET approval_report_last_month/.test(q.sql));
const NOW = at(2026, 12, 1, 8, 0);

test('run-now does not stamp, the tick does', async () => {
  for (const to of ['a@x.com', '  ']) {
    let s = stub({ to });
    await svc.sendApprovalReport({ now: NOW });
    assert.equal(stamps(s.queries).length, 0);
    s = stub({ to });
    await svc.sendApprovalReport({ now: NOW, stamp: true });
    const st = stamps(s.queries);
    assert.equal(st.length, 1);
    assert.deepEqual(st[0].params, ['2026-11', 1]);
  }
});

test('email carries both files', async () => {
  const { sent } = stub({ to: 'a@x.com' });
  const r = await svc.sendApprovalReport({ now: NOW });
  assert.equal(r.status, 'sent');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].attachments.map((a) => a.filename), ['Sample-Approval-2026-11.pdf', 'Sample-Approval-2026-11.xlsx']);
  assert.equal(sent[0].subject, 'Sample approval report - November 2026');
  assert.match(sent[0].body, /Waiting now/);
  assert.doesNotMatch(sent[0].body, /[^\x00-\x7F]/);
});

test('empty To is skipped with the message', async () => {
  const { sent } = stub({ to: '' });
  const r = await svc.sendApprovalReport({ now: NOW });
  assert.equal(r.status, 'skipped');
  assert.equal(r.message, 'No recipients set for "Approval Report" in Settings, so the report was not emailed');
  assert.equal(sent.length, 0);
});

test('a mail error throws and stamps nothing', async () => {
  const s = stub({ to: 'a@x.com' });
  svc._deps.sendEmail = async () => { throw new Error('smtp down'); };
  await assert.rejects(() => svc.sendApprovalReport({ now: NOW, stamp: true }), /smtp down/);
  assert.equal(stamps(s.queries).length, 0);
});

test('settings validation', async () => {
  stub({ to: 'a@x.com' });
  await assert.rejects(() => svc.updateApprovalReportSettings({ day: 29 }), (e) => e.status === 400 && /day must be a whole number from 1 to 28/.test(e.message));
  await assert.rejects(() => svc.updateApprovalReportSettings({ targetDays: 0 }), (e) => e.status === 400 && /targetDays must be a whole number from 1 to 90/.test(e.message));
  await assert.rejects(() => svc.updateApprovalReportSettings({ targetDays: 91 }), (e) => e.status === 400);
  await assert.rejects(() => svc.updateApprovalReportSettings({ time: '8am' }), (e) => e.status === 400 && /HH:MM/.test(e.message));
  await svc.updateApprovalReportSettings({ day: 28, targetDays: 90, time: '08:30' });
});

test('a Sunday that would push the send past the month goes to the Saturday before', () => {
  assert.equal(svc.sendMonthFor('2027-01', 28), '2027-02-27');
  assert.equal(svc.sendMonthFor('2026-12', 1), '2027-01-01');
  assert.equal(svc.isDue({ ...ON, day: 28, lastMonth: '2026-12' }, at(2027, 2, 27, 8, 0)), true);
});
