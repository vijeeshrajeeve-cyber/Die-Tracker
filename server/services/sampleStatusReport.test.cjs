const test = require('node:test');
const assert = require('node:assert/strict');
const svc = require('./sampleStatusReport.cjs');

const at = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm);
const ON = { enabled: true, time: '18:00', lastRun: null };

test('isDue: off never runs', () => {
  assert.equal(svc.isDue({ ...ON, enabled: false }, at(2026, 11, 20, 19, 0)), false);
});

test('isDue: Friday before and at the time', () => {
  assert.equal(svc.isDue(ON, at(2026, 11, 20, 17, 59)), false);
  assert.equal(svc.isDue(ON, at(2026, 11, 20, 18, 0)), true);
});

test('isDue: already run today vs yesterday (catch-up)', () => {
  assert.equal(svc.isDue({ ...ON, lastRun: '2026-11-20' }, at(2026, 11, 20, 21, 0)), false);
  assert.equal(svc.isDue({ ...ON, lastRun: '2026-11-19' }, at(2026, 11, 20, 21, 0)), true);
});

test('isDue: never on a Sunday; Monday after a Saturday run is due', () => {
  assert.equal(svc.isDue(ON, at(2026, 11, 22, 19, 0)), false);
  assert.equal(svc.isDue({ ...ON, lastRun: '2026-11-21' }, at(2026, 11, 23, 18, 0)), true);
});

test('isDue: default time is 18:00', () => {
  assert.equal(svc.isDue({ enabled: true, lastRun: null }, at(2026, 11, 20, 17, 59)), false);
  assert.equal(svc.isDue({ enabled: true, lastRun: null }, at(2026, 11, 20, 18, 0)), true);
});

function stub({ to }) {
  const sent = [];
  const queries = [];
  svc._deps.pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/FROM email_templates/.test(sql)) {
        return { rows: [{ subject_template: 'Sample status - {{date}}', body_template: 'Attached {{date}}.', default_to: to, default_cc: '' }] };
      }
      if (/FROM reminder_settings/.test(sql)) return { rows: [{ id: 1 }] };
      return { rows: [] };
    },
  };
  svc._deps.renderPdfFor = async ({ reportDate }) => ({
    report: { reportDate, totals: { listed: 0 }, plants: [] },
    bytes: new Uint8Array([1, 2, 3]),
  });
  svc._deps.sendEmail = async (m) => { sent.push(m); };
  return { sent, queries };
}

test('sendSampleStatus: empty To is skipped, nothing sent, last run still stamped', async () => {
  const { sent, queries } = stub({ to: '  ' });
  const r = await svc.sendSampleStatus({ now: at(2026, 11, 20, 18, 0) });
  assert.equal(r.status, 'skipped');
  assert.equal(r.message, 'No recipients set for "Sample Status" in Settings, so the report was not emailed');
  assert.equal(sent.length, 0);
  assert.ok(queries.some((q) => /UPDATE reminder_settings SET sample_status_last_run/.test(q.sql)));
});

test('sendSampleStatus: one send with one named PDF attachment', async () => {
  const { sent } = stub({ to: 'a@x.com' });
  const r = await svc.sendSampleStatus({ now: at(2026, 11, 20, 18, 0) });
  assert.equal(r.status, 'sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'a@x.com');
  assert.equal(sent[0].subject, 'Sample status - 2026-11-20');
  assert.equal(sent[0].attachments.length, 1);
  assert.equal(sent[0].attachments[0].filename, 'Sample-Status-2026-11-20.pdf');
});

test('sendSampleStatus: a mail error throws and records the error', async () => {
  stub({ to: 'a@x.com' });
  svc._deps.sendEmail = async () => { throw new Error('smtp down'); };
  await assert.rejects(() => svc.sendSampleStatus({ now: at(2026, 11, 20, 18, 0) }), /smtp down/);
  assert.equal(svc.getSampleStatusState().error, 'smtp down');
});

test('fileName: plant without spaces', () => {
  assert.equal(svc.fileName('2026-11-20', 'All'), 'Sample-Status-2026-11-20.pdf');
  assert.equal(svc.fileName('2026-11-20', 'GEX 1'), 'Sample-Status-2026-11-20-GEX1.pdf');
});
