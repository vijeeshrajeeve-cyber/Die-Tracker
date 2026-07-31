'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const q = require('./qualityDiscrepancies.cjs');

const NOW = new Date('2026-07-17T00:00:00Z');

test('exposes exactly the 8 agreed statuses', () => {
  assert.deepEqual(q.STATUSES, [
    'Open', 'Sent to Supplier', 'FOC Accepted', 'FOC Received',
    'Rejected', 'Reference', 'Rework In-house', 'Closed',
  ]);
});

test('a QD counts as open unless it is Closed, Rejected or Reference', () => {
  assert.deepEqual(q.NOT_OPEN_STATUSES, ['Closed', 'Rejected', 'Reference']);
  assert.deepEqual(q.OPEN_STATUSES, ['Open', 'Sent to Supplier', 'FOC Accepted', 'FOC Received', 'Rework In-house']);
  // derived from STATUSES, so a status added later counts as open by default
  assert.equal(q.OPEN_STATUSES.length + q.NOT_OPEN_STATUSES.length, q.STATUSES.length);
});

test('a received FOC is still open — it has yet to prove itself on a trial', () => {
  const rows = [{ status: 'FOC Received', raised_date: '2026-07-01', closed_at: null }];
  assert.equal(q.computeKpis(rows, NOW).openCount, 1);
  assert.equal(q.computeKpis(rows, NOW).closedCount, 0);
});

test('an accepted FOC still awaiting delivery counts as open', () => {
  const rows = [
    { status: 'FOC Accepted', raised_date: '2026-07-01', closed_at: null },
    { status: 'Rejected',     raised_date: '2026-07-01', closed_at: null },
    { status: 'Reference',    raised_date: '2026-07-01', closed_at: null },
    { status: 'Closed',       raised_date: '2026-01-01', closed_at: '2026-02-01' },
  ];
  assert.equal(q.computeKpis(rows, NOW).openCount, 1);
});

test('deriveQdCode takes the first two letters, ignoring non-letters', () => {
  assert.equal(q.deriveQdCode('PDTMC'), 'PD');
  assert.equal(q.deriveQdCode('Ekstek'), 'EK');
  assert.equal(q.deriveQdCode('  wefa '), 'WE');
  assert.equal(q.deriveQdCode('3M Tools'), 'MT');   // digits skipped
  assert.equal(q.deriveQdCode('A'), null);          // too short to be a code
  assert.equal(q.deriveQdCode(''), null);
});

test('formatQdNo builds YYYY + supplier code + zero-padded sequence', () => {
  assert.equal(q.formatQdNo(2026, 'PD', 1), '2026PD-01');
  assert.equal(q.formatQdNo(2026, 'pd', 2), '2026PD-02');
  assert.equal(q.formatQdNo(2025, 'PH', 12), '2025PH-12');
  // a supplier busy enough to pass 99 keeps counting rather than wrapping
  assert.equal(q.formatQdNo(2026, 'PD', 100), '2026PD-100');
});

test('nextSequence continues that supplier-year series, ignoring others', () => {
  // only 2026 + PD numbers count towards the next PD number for 2026
  const existing = ['2026PD-01', '2026PD-02', '2026PH-09', '2025PD-07', '2026-01', 'junk'];
  assert.equal(q.nextSequence(existing, 2026, 'PD'), 3);
  assert.equal(q.nextSequence(existing, 2026, 'PH'), 10);
  assert.equal(q.nextSequence(existing, 2025, 'PD'), 8);
  // a supplier with no QDs this year starts at 1
  assert.equal(q.nextSequence(existing, 2026, 'EK'), 1);
  assert.equal(q.nextSequence([], 2026, 'PD'), 1);
});

test('nextSequence fills from the highest number, not the count', () => {
  // deleting 2026PD-02 must not hand 03 out twice
  assert.equal(q.nextSequence(['2026PD-01', '2026PD-03'], 2026, 'PD'), 4);
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
  // Open + Sent to Supplier + both FOC Accepted rows; only Closed is excluded here
  assert.equal(k.openCount, 4);
  assert.equal(k.atSupplier, 1);
  // resolutions are 31 (May 1 -> Jun 1) and 30 (Jan 1 -> Jan 31); mean 30.5 rounds to 31
  assert.equal(k.avgResolution, 31);
});

// ── FOC recovery and the two pending buckets ───────────────────────────────

// Rows arrive from listQDs with a `foc` summary already attached.
const withFoc = (row, foc) => ({ raised_date: '2026-05-01', closed_at: null, ...row, foc });
const noFoc = { state: 'none', roundCount: 0, rounds: [], promisedEta: null, receivedDate: null, daysOverdue: null, daysIdle: null };

test('focRecovered counts replacements that arrived and passed, not promises', () => {
  const rows = [
    // promised only — the supplier has committed to nothing that has landed
    withFoc({ status: 'FOC Accepted' }, {
      ...noFoc, state: 'awaiting-receipt', roundCount: 1, promisedEta: '2026-08-01', daysOverdue: -15,
    }),
    // arrived but untrialled — in the plant, still unproven
    withFoc({ status: 'FOC Received' }, {
      ...noFoc, state: 'awaiting-trial', roundCount: 1, receivedDate: '2026-07-10', daysIdle: 7,
    }),
    // arrived and passed this year — the only real recovery
    withFoc({ status: 'Closed', closed_at: '2026-06-05' }, {
      ...noFoc, state: 'trial-passed', roundCount: 1, receivedDate: '2026-06-01', trialResult: 'Pass',
    }),
    // passed, but received in a prior calendar year
    withFoc({ status: 'Closed', closed_at: '2025-06-05' }, {
      ...noFoc, state: 'trial-passed', roundCount: 1, receivedDate: '2025-06-01', trialResult: 'Pass',
    }),
  ];
  const k = q.computeKpis(rows, NOW);
  assert.equal(k.focRecovered, 1);
  assert.equal(k.focAwaitingReceipt, 1);
  assert.equal(k.focAwaitingTrial, 1);
  assert.equal(k.focOverdue, 0, 'the one outstanding promise is not yet due');
});

test('a QD with no FOC rounds contributes nothing to the FOC tiles', () => {
  const rows = [
    { status: 'Open', raised_date: '2026-07-01', closed_at: null },
    withFoc({ status: 'Open' }, noFoc),
  ];
  const k = q.computeKpis(rows, NOW);
  assert.equal(k.focRecovered, 0);
  assert.equal(k.focAwaitingReceipt, 0);
  assert.equal(k.focAwaitingTrial, 0);
});

test('pendingFoc sorts the most overdue promise first and counts only real overruns', () => {
  const rows = [
    withFoc({ id: 1, qd_no: '2026PD-01', status: 'FOC Accepted' }, {
      ...noFoc, state: 'awaiting-receipt', roundCount: 1, promisedEta: '2026-07-14', daysOverdue: 3,
    }),
    withFoc({ id: 2, qd_no: '2026PD-02', status: 'FOC Accepted' }, {
      ...noFoc, state: 'awaiting-receipt', roundCount: 2, promisedEta: '2026-06-17', daysOverdue: 30,
    }),
    withFoc({ id: 3, qd_no: '2026PD-03', status: 'FOC Accepted' }, {
      ...noFoc, state: 'awaiting-receipt', roundCount: 1, promisedEta: '2026-08-17', daysOverdue: -31,
    }),
  ];
  const { awaitingReceipt, overdueCount } = q.pendingFoc(rows, NOW);
  assert.deepEqual(awaitingReceipt.map((r) => r.qd_no), ['2026PD-02', '2026PD-01', '2026PD-03']);
  assert.equal(overdueCount, 2, 'the one still in time is pending but not overdue');
  assert.equal(awaitingReceipt[0].round_count, 2);
});

test('pendingFoc sorts the longest-idle received die first', () => {
  const rows = [
    withFoc({ id: 1, qd_no: '2026PD-01', status: 'FOC Received' }, {
      ...noFoc, state: 'awaiting-trial', roundCount: 1, receivedDate: '2026-07-14', daysIdle: 3,
    }),
    withFoc({ id: 2, qd_no: '2026PD-02', status: 'FOC Received' }, {
      ...noFoc, state: 'awaiting-trial', roundCount: 1, receivedDate: '2026-06-01', daysIdle: 46,
    }),
  ];
  const { awaitingTrial } = q.pendingFoc(rows, NOW);
  assert.deepEqual(awaitingTrial.map((r) => r.qd_no), ['2026PD-02', '2026PD-01']);
});

test('a settled QD is nobody\'s to chase, whatever its last round says', () => {
  const stuck = { ...noFoc, state: 'awaiting-receipt', roundCount: 1, promisedEta: '2026-01-01', daysOverdue: 197 };
  const rows = [
    withFoc({ id: 1, qd_no: '2026PD-01', status: 'Rejected', closed_at: '2026-02-01' }, stuck),
    withFoc({ id: 2, qd_no: '2026PD-02', status: 'Closed', closed_at: '2026-02-01' }, stuck),
    withFoc({ id: 3, qd_no: '2026PD-03', status: 'Reference' }, stuck),
    withFoc({ id: 4, qd_no: '2026PD-04', status: 'FOC Accepted' }, stuck),
  ];
  const { awaitingReceipt } = q.pendingFoc(rows, NOW);
  assert.deepEqual(awaitingReceipt.map((r) => r.qd_no), ['2026PD-04']);
});

test('a promise with no ETA is still pending, and sorts last', () => {
  const rows = [
    withFoc({ id: 1, qd_no: '2026PD-01', status: 'FOC Accepted' }, {
      ...noFoc, state: 'awaiting-receipt', roundCount: 1, promisedEta: null, daysOverdue: null,
    }),
    withFoc({ id: 2, qd_no: '2026PD-02', status: 'FOC Accepted' }, {
      ...noFoc, state: 'awaiting-receipt', roundCount: 1, promisedEta: '2026-07-10', daysOverdue: 7,
    }),
  ];
  const { awaitingReceipt, overdueCount } = q.pendingFoc(rows, NOW);
  assert.deepEqual(awaitingReceipt.map((r) => r.qd_no), ['2026PD-02', '2026PD-01']);
  assert.equal(overdueCount, 1, 'an unknown ETA is not evidence of an overrun');
});

test('a rejected QD is settled, so it counts towards avg resolution', () => {
  const rows = [
    { status: 'Closed',   raised_date: '2026-01-01', closed_at: '2026-01-31' }, // 30
    { status: 'Rejected', raised_date: '2026-02-01', closed_at: '2026-02-11' }, // 10
    { status: 'Open',     raised_date: '2026-07-01', closed_at: null },         // excluded
  ];
  const k = q.computeKpis(rows, NOW);
  assert.equal(k.avgResolution, 20);   // (30 + 10) / 2 — the rejection counts
  assert.equal(k.openCount, 1);        // …but a rejection is still not open
  assert.equal(k.closedCount, 1);      // …and it is not a "Closed" QD either
});

test('SETTLED_STATUSES are the ones that conclude a QD', () => {
  assert.deepEqual(q.SETTLED_STATUSES, ['Closed', 'Rejected']);
});

test('updateStatus stamps closed_at for Rejected as well as Closed', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; } };
  await q.updateStatus(client, { id: 7, status: 'Rejected', reason: 'HOD refused the claim', actor: 'X' });
  assert.match(calls[0].sql, /IN \('Closed', 'Rejected'\)/);
  // an accepted FOC is still in flight, so it must not appear here
  assert.doesNotMatch(calls[0].sql, /FOC Accepted/);
});

test('handoffDelays measures raised→purchase and purchase→supplier', () => {
  assert.deepEqual(
    q.handoffDelays({ raised_date: '2026-01-01', sent_to_purchase_date: '2026-01-05', sent_to_supplier_date: '2026-01-12' }),
    { toPurchase: 4, purchaseToSupplier: 7, toSupplier: 11 }
  );
  // missing dates give null rather than a misleading zero
  assert.deepEqual(
    q.handoffDelays({ raised_date: '2026-01-01', sent_to_purchase_date: null, sent_to_supplier_date: null }),
    { toPurchase: null, purchaseToSupplier: null, toSupplier: null }
  );
  // sent straight to the supplier without a recorded purchase hand-off
  assert.deepEqual(
    q.handoffDelays({ raised_date: '2026-01-01', sent_to_purchase_date: null, sent_to_supplier_date: '2026-01-09' }),
    { toPurchase: null, purchaseToSupplier: null, toSupplier: 8 }
  );
});

test('the hand-off dates are editable and validated as dates', async () => {
  const client = { query: async () => ({ rowCount: 1 }) };
  await assert.rejects(
    () => q.updateFields(client, { id: 1, fields: { sent_to_purchase_date: '05-01-2026' }, actor: 'x' }),
    /Invalid Sent to purchase/
  );
  const calls = [];
  const ok = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; } };
  await q.updateFields(ok, { id: 1, fields: { sent_to_supplier_date: '2026-01-12' }, actor: 'x' });
  assert.match(calls[0].sql, /sent_to_supplier_date = /);
});

test('computeKpis reports the total and the closed count', () => {
  const rows = [
    { status: 'Open',         raised_date: '2026-07-01', closed_at: null },
    { status: 'Closed',       raised_date: '2026-01-01', closed_at: '2026-01-31' },
    { status: 'Closed',       raised_date: '2025-01-01', closed_at: '2025-02-01' },
    { status: 'Rejected',     raised_date: '2026-06-01', closed_at: null },
  ];
  const k = q.computeKpis(rows, NOW);
  assert.equal(k.total, 4);
  assert.equal(k.closedCount, 2);
});

test('availableYears lists the years QDs were raised in, newest first', () => {
  const rows = [
    { raised_date: '2026-07-01' }, { raised_date: '2025-03-04' },
    { raised_date: '2026-01-01' }, { raised_date: '2024-11-30' },
  ];
  assert.deepEqual(q.availableYears(rows), [2026, 2025, 2024]);
  assert.deepEqual(q.availableYears([]), []);
});

test('filterByYear scopes rows to one year, or passes everything through', () => {
  const rows = [
    { id: 1, raised_date: '2026-07-01' },
    { id: 2, raised_date: '2025-03-04' },
  ];
  assert.deepEqual(q.filterByYear(rows, 2026).map(r => r.id), [1]);
  assert.deepEqual(q.filterByYear(rows, '2025').map(r => r.id), [2]);
  // no year, 'All', or junk means no scoping
  assert.equal(q.filterByYear(rows, null).length, 2);
  assert.equal(q.filterByYear(rows, 'All').length, 2);
  assert.equal(q.filterByYear(rows, 'abc').length, 2);
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
  const { client, calls } = editMock('Draft');
  await q.updateFields(client, {
    id: 4,
    fields: { outcome: 'FOC replacement', input_at_failure: '3,417 kg', status: 'Closed', qd_no: 'HACK' },
    actor: 'Sijith',
  });
  const sql = calls.find((c) => /UPDATE quality_discrepancies SET/.test(c.sql)).sql;
  assert.match(sql, /outcome = /);
  assert.match(sql, /input_at_failure = /);
  // status and qd_no are not editable through this path
  assert.doesNotMatch(sql, /status = /);
  assert.doesNotMatch(sql, /qd_no = /);
});

test('updateFields validates the outcome against the agreed list', async () => {
  const { client } = editMock('Draft');
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
    () => q.updateStatus(client, { id: 1, status: 'Bogus', reason: 'r', actor: 'Tester' }),
    /Invalid status: Bogus/
  );
});

test('updateStatus requires a reason for every status change', async () => {
  const client = { query: async () => ({ rowCount: 1 }) };
  await assert.rejects(
    () => q.updateStatus(client, { id: 1, status: 'Rejected', reason: '   ', actor: 'X' }),
    /Reason is required/
  );
});

test('updateStatus requires an ETA when accepting a FOC', async () => {
  const client = { query: async () => ({ rowCount: 1 }) };
  await assert.rejects(
    () => q.updateStatus(client, { id: 1, status: 'FOC Accepted', reason: 'supplier agreed', actor: 'X' }),
    /ETA is required/
  );
  await assert.rejects(
    () => q.updateStatus(client, { id: 1, status: 'FOC Accepted', reason: 'supplier agreed', etaDate: '02-09-2026', actor: 'X' }),
    /Invalid ETA date/
  );
});

test('updateStatus stamps closed_at for settled statuses only', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; } };
  await q.updateStatus(client, { id: 7, status: 'Closed', reason: 'corrected in-house', actor: 'Sijith' });
  assert.match(calls[0].sql, /IN \('Closed', 'Rejected'\)/);
  // a FOC that is still awaiting delivery is in flight, not settled
  assert.doesNotMatch(calls[0].sql, /FOC Accepted/);
  // nor is Reference, which was never a claim to resolve
  assert.doesNotMatch(calls[0].sql, /Reference/);
});

test('updateStatus records the reason on the timeline', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; } };
  const ok = await q.updateStatus(client, { id: 7, status: 'Closed', reason: 'corrected in-house, ran 50 mT', actor: 'Sijith', userId: 3 });
  assert.equal(ok, true);
  const act = calls.find(c => /INSERT INTO quality_discrepancy_activity/.test(c.sql));
  assert.equal(act.params[1], 'Sijith');
  assert.equal(act.params[2], 'changed status to Closed — corrected in-house, ran 50 mT');
});

// Mock client that also answers the round lookups updateStatus now makes.
function statusMock(rounds = []) {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM qd_foc_rounds/.test(sql)) return { rows: rounds, rowCount: rounds.length };
      return { rowCount: 1 };
    },
  };
  const activity = () => calls.find(c => /INSERT INTO quality_discrepancy_activity/.test(c.sql));
  return { calls, client, activity };
}

test('updateStatus saves the ETA, opens a FOC round and notes it on the timeline', async () => {
  const { calls, client, activity } = statusMock();
  await q.updateStatus(client, { id: 7, status: 'FOC Accepted', reason: 'supplier agreed to replace', etaDate: '2026-09-02', actor: 'Kailash' });
  assert.match(calls[0].sql, /eta_date = /);
  assert.ok(calls[0].params.includes('2026-09-02'));
  const opened = calls.find(c => /INSERT INTO qd_foc_rounds/.test(c.sql));
  assert.ok(opened, 'accepting a FOC must start a round');
  assert.deepEqual(opened.params.slice(0, 3), [7, 1, '2026-09-02']);
  assert.equal(activity().params[2],
    'changed status to FOC Accepted — supplier agreed to replace · FOC round 1, ETA 2026-09-02');
});

test('updateStatus refuses FOC Received without the arrival date', async () => {
  const { client } = statusMock([{ id: 11, qd_id: 7, round_no: 1, promised_eta: '2026-09-02' }]);
  await assert.rejects(
    () => q.updateStatus(client, { id: 7, status: 'FOC Received', reason: 'die arrived', actor: 'Kailash' }),
    /Received date is required/);
});

test('updateStatus stamps the receipt on the open round', async () => {
  const { calls, client, activity } = statusMock([{ id: 11, qd_id: 7, round_no: 1, promised_eta: '2026-09-02' }]);
  const ok = await q.updateStatus(client, {
    id: 7, status: 'FOC Received', reason: 'landed at GEX 01',
    receivedDate: '2026-09-05', actor: 'Kailash', userId: 3,
  });
  assert.equal(ok, true);
  const receipt = calls.find(c => /SET received_date/.test(c.sql));
  assert.deepEqual(receipt.params, ['2026-09-05', 3, 11]);
  assert.equal(activity().params[2],
    'changed status to FOC Received — landed at GEX 01 · FOC round 1 received 2026-09-05');
});

test('updateStatus refuses a receipt when no FOC was ever promised', async () => {
  const { client } = statusMock([]);
  await assert.rejects(
    () => q.updateStatus(client, {
      id: 7, status: 'FOC Received', reason: 'die arrived', receivedDate: '2026-09-05', actor: 'X',
    }),
    /No FOC round is awaiting receipt/);
});

test('recordFocTrial closes the round and logs the verdict, leaving the status alone', async () => {
  const { calls, client, activity } = statusMock([
    { id: 11, qd_id: 7, round_no: 1, promised_eta: '2026-09-02', received_date: '2026-09-05' },
  ]);
  const ok = await q.recordFocTrial(client, {
    id: 7, trialDate: '2026-09-09', result: 'Fail', notes: 'same weld line', actor: 'Sijith', userId: 3,
  });
  assert.equal(ok, true);
  const trial = calls.find(c => /SET trial_date/.test(c.sql));
  assert.deepEqual(trial.params, ['2026-09-09', 'Fail', 'same weld line', 11]);
  assert.equal(activity().params[2], 'FOC round 1 trialled 2026-09-09 — Fail — same weld line');
  assert.equal(calls.some(c => /UPDATE quality_discrepancies\s+SET status/.test(c.sql)), false,
    'the next status is the user\'s decision, taken separately with its own reason');
});

test('updateStatus returns false when the QD does not exist', async () => {
  const client = { query: async () => ({ rowCount: 0 }) };
  assert.equal(await q.updateStatus(client, { id: 999, status: 'Open', reason: 'r', actor: 'X' }), false);
});

// ── editQdDetails (bulk edit, allowed only in Draft/SentBack) ───────────────
function editMock(approvalState) {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/SELECT id, qd_no, approval_state/.test(sql)) {
        return { rows: approvalState ? [{ id: params[0], qd_no: 'x', approval_state: approvalState, supplier: 'S' }] : [] };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  return { client, calls };
}

test('editQdDetails updates whitelisted fields + billets and logs, in an editable state', async () => {
  const { client, calls } = editMock('SentBack');
  const ok = await q.editQdDetails(client, {
    id: 5, actor: 'Veera', userId: 3,
    fields: { press: 'P2', issue_detail: 'heavy blend on the profile' },
    billets: { first: { billet_temp: '502' }, last: {} },
  });
  assert.equal(ok, true);
  const upd = calls.find((c) => /UPDATE quality_discrepancies SET/.test(c.sql));
  assert.match(upd.sql, /press = /);
  assert.match(upd.sql, /issue_detail = /);
  assert.ok(calls.some((c) => /INSERT INTO qd_billet_parameters/.test(c.sql)), 'first billet upserted');
  assert.ok(calls.some((c) => /DELETE FROM qd_billet_parameters/.test(c.sql)), 'empty last billet cleared');
  assert.ok(calls.some((c) => /INSERT INTO quality_discrepancy_activity/.test(c.sql)), 'change logged');
});

test('editQdDetails refuses to edit a QD that is not Draft or SentBack', async () => {
  for (const state of ['Pending', 'Approved']) {
    const { client } = editMock(state);
    await assert.rejects(
      () => q.editQdDetails(client, { id: 1, fields: { press: 'P2' }, actor: 'x' }),
      /Cannot edit a QD/,
      `state ${state} must be rejected`
    );
  }
});

test('editQdDetails validates fields the same way as the fact-card path', async () => {
  const { client } = editMock('Draft');
  await assert.rejects(
    () => q.editQdDetails(client, { id: 1, fields: { manufacturing_defect: 'Maybe' }, actor: 'x' }),
    /Invalid Manufacturing defect/
  );
});

test('editQdDetails ignores identity/derived columns it must never write', async () => {
  const { client, calls } = editMock('Draft');
  await q.editQdDetails(client, { id: 1, actor: 'x', fields: { qd_no: 'HACK', die_no: 'ZZ', press: 'P2' } });
  const upd = calls.find((c) => /UPDATE quality_discrepancies SET/.test(c.sql));
  assert.match(upd.sql, /press = /);
  assert.doesNotMatch(upd.sql, /qd_no = /);
  assert.doesNotMatch(upd.sql, /die_no = /);
});

test('editQdDetails returns false when the QD does not exist', async () => {
  const { client } = editMock(null);
  assert.equal(await q.editQdDetails(client, { id: 999, fields: { press: 'P2' }, actor: 'x' }), false);
});

test('APPROVAL_STATES and the editable subset are the agreed values', () => {
  assert.deepEqual(q.APPROVAL_STATES, ['Draft', 'Pending', 'Approved', 'SentBack']);
  assert.deepEqual(q.EDITABLE_APPROVAL_STATES, ['Draft', 'SentBack']);
});

// ── The fact-card path honours the same approval lock ───────────────────────
// The QD form is printed and mailed to Purchase on approval, so the Part-A
// fields it prints must stop moving at that point — exactly as editQdDetails
// already enforces. The Part-B/progress fields are the opposite case: they are
// only ever filled in after the QD has gone out, so the lock must not reach them.

test('updateFields refuses a Part-A field once the QD is past editing', async () => {
  for (const state of ['Pending', 'Approved']) {
    const { client } = editMock(state);
    await assert.rejects(
      () => q.updateFields(client, { id: 1, fields: { press: 'P2' }, actor: 'x' }),
      /Cannot edit a QD/,
      `state ${state} must be rejected`
    );
  }
});

test('updateFields still records the supplier response on an approved QD', async () => {
  const { client, calls } = editMock('Approved');
  const ok = await q.updateFields(client, {
    id: 1, actor: 'Veera',
    fields: { supplier_acceptance: 'Yes', action_taken: 'Die reworked', eta_date: '2026-09-01' },
  });
  assert.equal(ok, true);
  const upd = calls.find((c) => /UPDATE quality_discrepancies SET/.test(c.sql));
  assert.match(upd.sql, /supplier_acceptance = /);
  assert.match(upd.sql, /action_taken = /);
  assert.match(upd.sql, /eta_date = /);
});

test('updateFields allows Part-A fields while the QD is still editable', async () => {
  const { client, calls } = editMock('Draft');
  assert.equal(await q.updateFields(client, { id: 1, fields: { press: 'P2' }, actor: 'x' }), true);
  assert.match(calls.find((c) => /UPDATE quality_discrepancies SET/.test(c.sql)).sql, /press = /);
});

test('a mixed payload is refused whole, so no Part-A field slips through', async () => {
  const { client, calls } = editMock('Approved');
  await assert.rejects(
    () => q.updateFields(client, { id: 1, fields: { supplier_acceptance: 'Yes', press: 'P2' }, actor: 'x' }),
    /Cannot edit a QD/
  );
  assert.equal(calls.some((c) => /UPDATE quality_discrepancies SET/.test(c.sql)), false,
    'nothing may be written when part of the payload is locked');
});

test('a progress-only payload needs no approval lookup', async () => {
  const { client, calls } = editMock('Approved');
  await q.updateFields(client, { id: 1, fields: { supplier_comments: 'Awaiting reply' }, actor: 'x' });
  assert.equal(calls.some((c) => /SELECT id, qd_no, approval_state/.test(c.sql)), false);
});

test('every editable field is classified, and new ones lock by default', () => {
  for (const [col, spec] of Object.entries(q.EDITABLE_FIELDS)) {
    assert.equal(typeof spec.progress, 'boolean', `${col} must declare whether it is a progress field`);
  }
});

test('nextApprovalState allows only legal transitions', () => {
  assert.equal(q.nextApprovalState('Draft', 'submit'), 'Pending');
  assert.equal(q.nextApprovalState('SentBack', 'submit'), 'Pending');
  assert.equal(q.nextApprovalState('Pending', 'approve'), 'Approved');
  assert.equal(q.nextApprovalState('Pending', 'sendBack'), 'SentBack');
  assert.throws(() => q.nextApprovalState('Approved', 'approve'), /Cannot approve/);
  assert.throws(() => q.nextApprovalState('Draft', 'approve'), /Cannot approve/);
  assert.throws(() => q.nextApprovalState('Pending', 'submit'), /Cannot submit/);
});

test('submitForApproval assigns a number to an unnumbered draft and moves it to Pending', async () => {
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (/SELECT id, qd_no, approval_state/.test(sql)) return { rows: [{ id: 5, qd_no: null, approval_state: 'Draft', supplier: 'Phoenix' }] };
    return { rowCount: 1, rows: [] };
  } };
  const out = await q.submitForApproval(client, { id: 5, newQdNo: '2026PH-04', actor: 'Veera', userId: 2 });
  assert.deepEqual(out, { ok: true, qdNo: '2026PH-04', state: 'Pending' });
  const upd = calls.find(c => /SET qd_no = \$1, approval_state = \$2/.test(c.sql));
  assert.equal(upd.params[0], '2026PH-04');
  assert.equal(upd.params[1], 'Pending');
});

test('submitForApproval keeps an existing number when resubmitting a SentBack QD', async () => {
  const calls = [];
  const client = { query: async (sql) => {
    calls.push(sql);
    if (/SELECT id, qd_no, approval_state/.test(sql)) return { rows: [{ id: 5, qd_no: '2026PH-04', approval_state: 'SentBack', supplier: 'Phoenix' }] };
    return { rowCount: 1, rows: [] };
  } };
  const out = await q.submitForApproval(client, { id: 5, newQdNo: '2026PH-99', actor: 'Veera', userId: 2 });
  assert.equal(out.qdNo, '2026PH-04'); // not the freshly-computed candidate
});

test('submitForApproval records the approver the raiser sent it to, and names them in the timeline', async () => {
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (/SELECT id, qd_no, approval_state/.test(sql)) return { rows: [{ id: 5, qd_no: null, approval_state: 'Draft', supplier: 'Phoenix' }] };
    return { rowCount: 1, rows: [] };
  } };
  await q.submitForApproval(client, {
    id: 5, newQdNo: '2026PH-04', actor: 'Veera', userId: 2, approverUserId: 9, approverName: 'Imran',
  });
  const upd = calls.find(c => /assigned_approver = \$4/.test(c.sql));
  assert.equal(upd.params[3], 9);
  const activity = calls.find(c => /INSERT INTO quality_discrepancy_activity/i.test(c.sql));
  assert.ok(activity.params.some(p => typeof p === 'string' && p.includes('to Imran')), 'the timeline does not say who it went to');
});

// Resubmitting a sent-back QD may go to a different approver, so the new choice
// has to replace the old one rather than being coalesced away.
test('resubmitting can redirect the QD to a different approver', async () => {
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (/SELECT id, qd_no, approval_state/.test(sql)) {
      return { rows: [{ id: 5, qd_no: '2026PH-04', approval_state: 'SentBack', supplier: 'Phoenix', assigned_approver: 9 }] };
    }
    return { rowCount: 1, rows: [] };
  } };
  await q.submitForApproval(client, { id: 5, actor: 'Veera', userId: 2, approverUserId: 12, approverName: 'Sara' });
  assert.equal(calls.find(c => /assigned_approver = \$4/.test(c.sql)).params[3], 12);
});

test('only the named approver — or an admin — can act on an assigned QD', () => {
  const assigned = { assigned_approver: 9 };
  assert.equal(q.canActOnApproval({ id: 9, role: 'user' }, assigned), true);
  assert.equal(q.canActOnApproval({ id: 4, role: 'user' }, assigned), false);
  // An admin has to be able to unblock a QD whose approver is away.
  assert.equal(q.canActOnApproval({ id: 4, role: 'admin' }, assigned), true);
  assert.equal(q.canActOnApproval(null, assigned), false);
});

// QDs submitted before per-QD assignment existed name nobody; they must stay
// approvable by any approver rather than becoming permanently stuck.
test('a QD that names no approver stays open to any approver', () => {
  assert.equal(q.canActOnApproval({ id: 4, role: 'user' }, { assigned_approver: null }), true);
  assert.equal(q.canActOnApproval({ id: 4, role: 'user' }, {}), true);
});

test('the send-back email names the QD and quotes the reason verbatim', () => {
  const qdRow = { qd_no: '2026PH-04', die_no: '30601-201', supplier: 'Phoenix' };
  assert.equal(q.sendBackEmailSubject(qdRow), 'QD 2026PH-04 sent back — changes needed');
  const html = q.buildSendBackEmailHtml(qdRow, { reason: 'billet temps missing', by: 'Imran' });
  assert.ok(html.includes('2026PH-04'));
  assert.ok(html.includes('billet temps missing'), 'the raiser cannot act without the reason');
  assert.ok(html.includes('Imran'));
  // It must not read as an approval — this QD did not go to Purchase.
  assert.ok(/has not gone to Purchase/.test(html));
});

test('a reason containing HTML is escaped, not rendered', () => {
  const html = q.buildSendBackEmailHtml(
    { qd_no: '2026PH-04' },
    { reason: '<script>alert(1)</script> & "quotes"', by: '<b>Imran</b>' },
  );
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<b>Imran</b>'));
});

test('approveQD stamps approver + purchase date and requires Pending', async () => {
  const calls = [];
  const client = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (/SELECT id, qd_no, approval_state/.test(sql)) return { rows: [{ id: 5, qd_no: '2026PH-04', approval_state: 'Pending' }] };
    return { rowCount: 1, rows: [] };
  } };
  const out = await q.approveQD(client, { id: 5, actor: 'Imran', userId: 3 });
  assert.deepEqual(out, { ok: true, qdNo: '2026PH-04' });
  const upd = calls.find(c => /approval_state = 'Approved'/.test(c.sql));
  assert.match(upd.sql, /sent_to_purchase_date = COALESCE\(sent_to_purchase_date, CURRENT_DATE\)/);
});

test('approveQD refuses a QD that is not Pending', async () => {
  const client = { query: async (sql) => (/SELECT id, qd_no, approval_state/.test(sql)
    ? { rows: [{ id: 5, qd_no: null, approval_state: 'Draft' }] } : { rowCount: 1 }) };
  await assert.rejects(() => q.approveQD(client, { id: 5, actor: 'X' }), /Cannot approve/);
});

test('sendBack requires a reason and only works from Pending', async () => {
  const okRow = { query: async (sql) => (/SELECT id, qd_no, approval_state/.test(sql)
    ? { rows: [{ id: 5, qd_no: '2026PH-04', approval_state: 'Pending' }] } : { rowCount: 1 }) };
  await assert.rejects(() => q.sendBack(okRow, { id: 5, reason: '  ', actor: 'X' }), /Reason is required/);
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params });
    return /SELECT id, qd_no, approval_state/.test(sql) ? { rows: [{ id: 5, qd_no: '2026PH-04', approval_state: 'Pending' }] } : { rowCount: 1 }; } };
  const out = await q.sendBack(client, { id: 5, reason: 'billet temps missing', actor: 'Imran', userId: 3 });
  assert.equal(out.ok, true);
  const upd = calls.find(c => /approval_state = 'SentBack'/.test(c.sql));
  assert.equal(upd.params[0], 'billet temps missing');
});

test('excludeDrafts / onlyDrafts split rows by approval_state', () => {
  const rows = [
    { id: 1, approval_state: 'Draft', created_by: 2 },
    { id: 2, approval_state: 'Approved', created_by: 2 },
    { id: 3, approval_state: 'Draft', created_by: 9 },
  ];
  assert.deepEqual(q.excludeDrafts(rows).map(r => r.id), [2]);
  assert.deepEqual(q.onlyDrafts(rows, 2).map(r => r.id), [1]);
  assert.deepEqual(q.onlyDrafts(rows, null).map(r => r.id), [1, 3]);
});

test('purchaseEmailSubject names the QD', () => {
  assert.equal(q.purchaseEmailSubject({ qd_no: '2026PH-04' }),
    'QD 2026PH-04 approved — action required');
});

test('buildPurchaseEmailHtml includes key fields and escapes the issue text', () => {
  const html = q.buildPurchaseEmailHtml({
    qd_no: '2026PH-04', die_no: '30601-201', profile_number: '30601',
    supplier: 'Phoenix', raised_date: '2026-06-04',
    recommended_action: 'Provide FOC replacement die',
    issue_detail: 'Heavy blend <observed> on profile',
  });
  assert.match(html, /2026PH-04/);
  assert.match(html, /Phoenix/);
  assert.match(html, /Provide FOC replacement die/);
  assert.match(html, /&lt;observed&gt;/);      // escaped, not raw HTML
  assert.doesNotMatch(html, /<observed>/);
});

test('EDITABLE_FIELDS now covers the Part-A/Part-B format fields', () => {
  for (const f of ['recommended_action','manufacturing_defect','die_performance',
                   'supplier_acceptance','action_taken','supplier_comments','received_by_supplier',
                   'press','die_type','die_size','no_of_cavity','tooling','no_of_trials',
                   'no_of_corrections','die_received_date','production_date']) {
    assert.ok(q.EDITABLE_FIELDS[f], `expected ${f} to be editable`);
  }
});

test('manufacturing_defect only accepts Yes/No', async () => {
  const { client } = editMock('Draft');
  await assert.rejects(
    () => q.updateFields(client, { id: 1, fields: { manufacturing_defect: 'maybe' }, actor: 'x' }),
    /Invalid Manufacturing defect/);
});

test('saveBilletParameters upserts given billets and deletes empty ones', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [], rowCount: 1 }; } };
  await q.saveBilletParameters(client, 5, {
    first: { billet_temp: '502', running_pressure: '167' },
    last: {},   // empty → should be deleted, not inserted
  });
  const del = calls.find(c => /DELETE FROM qd_billet_parameters/.test(c.sql) && c.params.includes('last'));
  const up = calls.find(c => /INSERT INTO qd_billet_parameters/.test(c.sql) && c.params.includes('first'));
  assert.ok(del, 'empty last billet should be deleted');
  assert.ok(up, 'first billet should be upserted');
});

test('the QD requested date is an editable, validated date field', async () => {
  assert.equal(q.EDITABLE_FIELDS.qd_requested_date.label, 'QD requested date');
  const { client, calls } = editMock('Draft');
  await q.updateFields(client, { id: 1, fields: { qd_requested_date: '2026-07-20' }, actor: 'x' });
  const upd = calls.find((c) => /UPDATE quality_discrepancies SET/.test(c.sql));
  assert.match(upd.sql, /qd_requested_date = /);
  assert.equal(upd.params[0], '2026-07-20');
  await assert.rejects(
    () => q.updateFields(client, { id: 1, fields: { qd_requested_date: '20-07-2026' }, actor: 'x' }),
    /Invalid QD requested date/
  );
});

test('a required field cannot be cleared, while other fields still clear', async () => {
  const { client } = editMock('Draft');
  await assert.rejects(
    () => q.updateFields(client, { id: 1, fields: { qd_requested_date: '' }, actor: 'x' }),
    /Invalid QD requested date: a value is required/
  );
  // the `required` flag must not leak into the other editable fields
  const calls = [];
  const ok = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; } };
  await q.updateFields(ok, { id: 4, fields: { eta_date: '' }, actor: 'x' });
  assert.equal(calls[0].params[0], null);
});

test('createQD writes the QD requested date, and tolerates its absence', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: 7 }] }; } };
  const base = {
    dieNo: '029780-2502', raisedDate: '2026-07-26', plant: 'GEX 2',
    supplier: 'PDTMC', issueSummary: 'Profile out of tolerance',
  };
  const id = await q.createQD(client, { ...base, qdRequestedDate: '2026-07-20' });
  assert.equal(id, 7);
  assert.match(calls[0].sql, /qd_requested_date/);
  assert.equal(calls[0].params.at(-1), '2026-07-20');
  // the sheet importer calls createQD without one — that must not throw
  calls.length = 0;
  await q.createQD(client, base);
  assert.equal(calls[0].params.at(-1), null);
});

test('saveBilletParameters persists the delay details alongside the Yes/No answer', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [], rowCount: 1 }; } };
  await q.saveBilletParameters(client, 7, {
    first: { any_delay_observed: 'Yes', any_delay_details: 'press held 20 min for billet change' },
    last: {},
  });
  const up = calls.find(c => /INSERT INTO qd_billet_parameters/.test(c.sql) && c.params.includes('first'));
  assert.ok(up, 'first billet should be upserted');
  assert.match(up.sql, /any_delay_details/);
  assert.match(up.sql, /any_delay_details = EXCLUDED\.any_delay_details/);
  assert.ok(up.params.includes('press held 20 min for billet change'));
});

test('a billet carrying only delay details is kept, not deleted as empty', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [], rowCount: 1 }; } };
  await q.saveBilletParameters(client, 8, { first: { any_delay_details: 'waiting on the press log' }, last: {} });
  const del = calls.find(c => /DELETE FROM qd_billet_parameters/.test(c.sql) && c.params.includes('first'));
  const up = calls.find(c => /INSERT INTO qd_billet_parameters/.test(c.sql) && c.params.includes('first'));
  assert.equal(del, undefined, 'a details-only billet must not be deleted as empty');
  assert.ok(up, 'a details-only billet should be upserted so it can be corrected');
});

// The approval queue is a personal work list, not a permission check. These
// tests exist because the obvious "simplification" — reusing canActOnApproval —
// silently fills every admin's bell with other approvers' work.
test('a Pending QD assigned to me is in my queue', () => {
  assert.equal(q.isInApprovalQueue({ approval_state: 'Pending', assigned_approver: 7 }, 7), true);
});

test('a Pending QD assigned to nobody is in any approver\'s queue', () => {
  // Submitted before assignment existed, so it is open to whoever picks it up.
  assert.equal(q.isInApprovalQueue({ approval_state: 'Pending', assigned_approver: null }, 7), true);
});

test('a QD assigned to someone else is NOT in my queue, admin or not', () => {
  // canActOnApproval() would say true for an admin here. The queue must not.
  const row = { approval_state: 'Pending', assigned_approver: 9 };
  assert.equal(q.isInApprovalQueue(row, 7), false);
  const admin = { id: 7, role: 'admin' };
  assert.equal(q.canActOnApproval(admin, row), true); // permission: yes
  assert.equal(q.isInApprovalQueue(row, admin.id), false); // queue: no
});

test('only Pending QDs are queued', () => {
  for (const state of ['Draft', 'Approved', 'SentBack']) {
    assert.equal(q.isInApprovalQueue({ approval_state: state, assigned_approver: null }, 7), false, state);
  }
});

test('listPendingApprovals asks only for Pending rows and filters the rest in JS', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [
        { id: 1, qd_no: '2026AD-01', approval_state: 'Pending', assigned_approver: 7 },
        { id: 2, qd_no: '2026AD-02', approval_state: 'Pending', assigned_approver: null },
        { id: 3, qd_no: '2026AD-03', approval_state: 'Pending', assigned_approver: 9 },
      ] };
    },
  };
  const rows = await q.listPendingApprovals(client, 7);
  assert.match(calls[0].sql, /approval_state = 'Pending'/);
  assert.deepEqual(rows.map((r) => r.id), [1, 2]);
});
