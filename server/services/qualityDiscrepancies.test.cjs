'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const q = require('./qualityDiscrepancies.cjs');

const NOW = new Date('2026-07-17T00:00:00Z');

test('exposes exactly the 7 agreed statuses and 4 open statuses', () => {
  assert.deepEqual(q.STATUSES, [
    'Open', 'Sent to Supplier', 'FOC Accepted', 'Rejected', 'Reference', 'Rework In-house', 'Closed',
  ]);
  assert.deepEqual(q.OPEN_STATUSES, ['Open', 'Sent to Supplier', 'Rework In-house', 'Rejected']);
});

test('mapSheetStatus maps the legacy Excel vocabulary onto the new one', () => {
  assert.equal(q.mapSheetStatus('OPEN'), 'Open');
  assert.equal(q.mapSheetStatus('Rejected '), 'Rejected');
  assert.equal(q.mapSheetStatus('Refrance'), 'Reference');   // sheet typo
  assert.equal(q.mapSheetStatus('info'), 'Reference');
  assert.equal(q.mapSheetStatus('Completed'), 'Closed');
  assert.equal(q.mapSheetStatus('Hold '), 'Open');
  assert.equal(q.mapSheetStatus('nonsense'), 'Open');        // safe default
});

test('ageDays counts days open, and is 0 once closed', () => {
  assert.equal(q.ageDays({ raised_date: '2026-07-01', closed_at: null }, NOW), 16);
  assert.equal(q.ageDays({ raised_date: '2026-01-05', closed_at: '2026-03-05' }, NOW), 0);
});

test('resolutionDays is raised to closed, null when still open', () => {
  assert.equal(q.resolutionDays({ raised_date: '2026-01-05', closed_at: '2026-02-04' }), 30);
  assert.equal(q.resolutionDays({ raised_date: '2026-01-05', closed_at: null }), null);
});

test('etaDisplay shows dash, the date, or Overdue', () => {
  assert.equal(q.etaDisplay({ eta_date: null, closed_at: null }, NOW), '—');
  assert.equal(q.etaDisplay({ eta_date: '2026-08-29', closed_at: null }, NOW), '2026-08-29');
  assert.equal(q.etaDisplay({ eta_date: '2026-01-01', closed_at: null }, NOW), 'Overdue');
  // a closed QD is never "overdue"
  assert.equal(q.etaDisplay({ eta_date: '2026-01-01', closed_at: '2026-02-01' }, NOW), '2026-01-01');
});

test('computeKpis derives every tile from real rows, with no invented numbers', () => {
  const rows = [
    { status: 'Open',             raised_date: '2026-07-01', closed_at: null },
    { status: 'Sent to Supplier', raised_date: '2026-06-01', closed_at: null },
    { status: 'FOC Accepted',     raised_date: '2026-05-01', closed_at: '2026-06-01' },
    { status: 'Closed',           raised_date: '2026-01-01', closed_at: '2026-01-31' },
    { status: 'FOC Accepted',     raised_date: '2025-05-01', closed_at: '2025-06-01' }, // prior FY
  ];
  const k = q.computeKpis(rows, NOW);
  assert.equal(k.openCount, 2);        // Open + Sent to Supplier
  assert.equal(k.atSupplier, 1);
  assert.equal(k.focRecovered, 1);     // only the current-calendar-year one
  // resolutions are 31 (May 1 -> Jun 1) and 30 (Jan 1 -> Jan 31); mean 30.5 rounds to 31
  assert.equal(k.avgResolution, 31);
});

test('computeKpis reports avgResolution null when nothing has closed', () => {
  const k = q.computeKpis([{ status: 'Open', raised_date: '2026-07-01', closed_at: null }], NOW);
  assert.equal(k.avgResolution, null);
});

test('computeTrend compares recent vs prior QD counts', () => {
  assert.equal(q.computeTrend(5, 2), 'up');
  assert.equal(q.computeTrend(2, 5), 'down');
  assert.equal(q.computeTrend(3, 3), 'flat');
  assert.equal(q.computeTrend(0, 0), 'flat');
});

test('summarizeSuppliers aggregates real rows and omits suppliers with no QDs', () => {
  const rows = [
    { supplier: 'PDTMC',   status: 'Sent to Supplier', outcome: 'Supplier rework', raised_date: '2026-07-01', closed_at: null },
    { supplier: 'PDTMC',   status: 'Closed',           outcome: 'In-house correction', raised_date: '2026-01-01', closed_at: '2026-01-21' },
    { supplier: 'Phoenix', status: 'Rejected',         outcome: 'FOC requested', raised_date: '2026-06-01', closed_at: null },
  ];
  const out = q.summarizeSuppliers(rows, NOW);
  const pdtmc = out.find(s => s.name === 'PDTMC');
  const phoenix = out.find(s => s.name === 'Phoenix');
  assert.equal(out.length, 2);                 // no fabricated Kompass/Almax/etc.
  assert.equal(pdtmc.total, 2);
  assert.equal(pdtmc.open, 1);
  assert.equal(pdtmc.avg, 20);                 // one closed QD, 20 days
  assert.equal(phoenix.rejected, 1);
  assert.equal(phoenix.avg, null);             // nothing closed -> not derivable
  assert.equal(out[0].name, 'PDTMC');          // sorted by open desc, then total desc
});

test('listQDs decorates rows with derived age, resolution and eta', async () => {
  const client = {
    query: async (sql) => {
      if (sql.includes('FROM quality_discrepancies')) {
        return { rows: [{ id: 1, raised_date: '2026-07-01', closed_at: null, eta_date: null }] };
      }
      return { rows: [] };
    },
  };
  const [row] = await q.listQDs(client);
  assert.equal(row.age_days, q.ageDays({ raised_date: '2026-07-01', closed_at: null }, new Date()));
  assert.equal(row.resolution_days, null);
  assert.equal(row.eta_display, '—');
  assert.deepEqual(row.files, []);
  assert.deepEqual(row.activity, []);
});

test('ACTIVITY_KINDS maps each kind to the design\'s icon and tone', () => {
  assert.deepEqual(q.ACTIVITY_KINDS.note, { icon: 'message-square', tone: 'neutral' });
  assert.deepEqual(q.ACTIVITY_KINDS.email, { icon: 'send', tone: 'send' });
  assert.deepEqual(q.ACTIVITY_KINDS.reminder, { icon: 'bell', tone: 'send' });
});

test('addActivityOfKind writes the icon/tone for the kind, not client-supplied ones', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push(params); return { rows: [] }; } };
  await q.addActivityOfKind(client, { qdId: 5, kind: 'reminder', actor: 'admin', note: 'reminder sent to PDTMC — no response after 31 days' });
  // params: [qdId, actor, action, icon, tone, userId, occurredAt]
  assert.equal(calls[0][3], 'bell');
  assert.equal(calls[0][4], 'send');
  assert.equal(calls[0][2], 'reminder sent to PDTMC — no response after 31 days');
});

test('addActivityOfKind rejects an unknown kind', async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    () => q.addActivityOfKind(client, { qdId: 1, kind: 'sneaky', actor: 'x', note: 'n' }),
    /Invalid activity kind: sneaky/
  );
});

test('updateFields writes only whitelisted columns', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; } };
  await q.updateFields(client, {
    id: 4,
    fields: { outcome: 'FOC replacement', input_at_failure: '3,417 kg', status: 'Closed', qd_no: 'HACK' },
    actor: 'Sijith',
  });
  const sql = calls[0].sql;
  assert.match(sql, /outcome = /);
  assert.match(sql, /input_at_failure = /);
  // status and qd_no are not editable through this path
  assert.doesNotMatch(sql, /status = /);
  assert.doesNotMatch(sql, /qd_no = /);
});

test('updateFields validates the outcome against the agreed list', async () => {
  const client = { query: async () => ({ rowCount: 1 }) };
  await assert.rejects(
    () => q.updateFields(client, { id: 1, fields: { outcome: 'Free money' }, actor: 'x' }),
    /Invalid outcome: Free money/
  );
});

test('updateFields validates the ETA date format', async () => {
  const client = { query: async () => ({ rowCount: 1 }) };
  await assert.rejects(
    () => q.updateFields(client, { id: 1, fields: { eta_date: '29-08-2026' }, actor: 'x' }),
    /Invalid ETA date/
  );
});

test('updateFields clears a field when given an empty value', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; } };
  await q.updateFields(client, { id: 4, fields: { eta_date: '' }, actor: 'x' });
  assert.equal(calls[0].params[0], null); // stored as NULL, not an empty string
});

test('updateFields logs what changed on the timeline', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; } };
  await q.updateFields(client, { id: 4, fields: { eta_date: '2026-08-29' }, actor: 'Sijith' });
  const activity = calls.find(c => /INSERT INTO quality_discrepancy_activity/.test(c.sql));
  assert.ok(activity, 'expected an activity row');
  assert.equal(activity.params[1], 'Sijith');
  assert.equal(activity.params[2], 'set ETA from supplier to 2026-08-29');
});

test('updateFields is a no-op when nothing editable was sent', async () => {
  let called = false;
  const client = { query: async () => { called = true; return { rowCount: 1 }; } };
  const ok = await q.updateFields(client, { id: 4, fields: { nonsense: 'x' }, actor: 'y' });
  assert.equal(ok, false);
  assert.equal(called, false);
});

test('updateStatus rejects a status outside the agreed vocabulary', async () => {
  const client = { query: async () => ({ rowCount: 1 }) };
  await assert.rejects(
    () => q.updateStatus(client, { id: 1, status: 'Bogus', actor: 'Tester' }),
    /Invalid status: Bogus/
  );
});

test('updateStatus stamps closed_at when closing and logs the change', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; },
  };
  const ok = await q.updateStatus(client, { id: 7, status: 'Closed', actor: 'Sijith', userId: 3 });
  assert.equal(ok, true);
  assert.match(calls[0].sql, /UPDATE quality_discrepancies/);
  assert.equal(calls[0].params[0], 'Closed');
  // the activity row records who changed it and to what
  assert.match(calls[1].sql, /INSERT INTO quality_discrepancy_activity/);
  assert.equal(calls[1].params[1], 'Sijith');
  assert.equal(calls[1].params[2], 'changed status to Closed');
});

test('updateStatus returns false when the QD does not exist', async () => {
  const client = { query: async () => ({ rowCount: 0 }) };
  assert.equal(await q.updateStatus(client, { id: 999, status: 'Open', actor: 'X' }), false);
});
