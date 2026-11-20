'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { belongsInSampleFollowup, buildSampleStatus, loadSampleStatus } = require('./sampleStatusReportData.cjs');

const TODAY = '2026-11-20';
const row = (over = {}) => ({
  source: 'order', id: 1, die: '10001-1', plant: 'GEX 1', press: 'Press 1', customer: 'ACME', dieType: 'SF',
  supplier: 'S', receivedDate: '2026-11-18', submissionDate: null, status: 'Pending', orderStatus: 'Active',
  corrector: 'Singh', legacyTrials: 0, remark: '', ...over,
});
const trial = (over = {}) => ({
  source: 'order', parentId: 1, trialNo: 1, trialDate: '2026-11-10', result: 'Not OK', failReason: 'Shape', comments: '', ...over,
});
const build = (rows, trials = [], extra = {}) => buildSampleStatus({ rows, trials, reportDate: TODAY, plant: 'All', ...extra });
const allRows = (report) => report.plants.flatMap(p => p.presses.flatMap(pr => pr.rows));

test('listing follows the rule', () => {
  const report = build([
    row({ id: 1, die: 'pending' }),
    row({ id: 2, die: 'approved', status: 'Approved', submissionDate: TODAY }),
    row({ id: 3, die: 'subToday', status: 'Sample Submitted', submissionDate: TODAY }),
    row({ id: 4, die: 'subOld', status: 'Sample Submitted', submissionDate: '2026-11-10' }),
    row({ id: 5, die: 'blank', status: '' }),
    row({ id: 6, die: 'cancelled', orderStatus: 'cancelled' }),
    row({ id: 7, die: 'hold', orderStatus: ' Hold ' }),
    row({ id: 8, die: 'norecv', receivedDate: '  ' }),
    row({ id: 9, die: 'onhold', status: 'On hold' }),
  ]);
  assert.deepEqual(allRows(report).map(r => r.die).sort(), ['blank', 'onhold', 'pending', 'subToday']);
});

test('a plant with only an approved die and no trial today is not shown', () => {
  const report = build([row({ plant: 'GEX 2', status: 'Approved' }), row({ id: 2, plant: 'GEX 1' })]);
  assert.deepEqual(report.plants.map(p => p.plant), ['GEX 1']);
});

test('days and late', () => {
  const report = build([
    row({ id: 1, die: 'a', receivedDate: '2026-11-10' }),
    row({ id: 2, die: 'b', receivedDate: '2026-11-15' }),
    row({ id: 3, die: 'c', receivedDate: 'received' }),
  ]);
  const by = Object.fromEntries(allRows(report).map(r => [r.die, r]));
  assert.equal(by.a.days, 10); assert.equal(by.a.late, true);
  assert.equal(by.b.days, 5); assert.equal(by.b.late, false);
  assert.equal(by.c.days, null); assert.equal(by.c.late, false);
  assert.equal(report.totals.late, 1);
});

test('rejected rows count their wait since submission and are never late', () => {
  const report = build([row({ status: 'Rejected', receivedDate: '2026-09-01', submissionDate: '2026-11-08' })]);
  const [r] = allRows(report);
  assert.equal(r.rejectedWait, 12);
  assert.equal(r.late, false);
  assert.equal(report.totals.inTrial, 1);
});

test('a die submitted today is never late', () => {
  const report = build([row({ status: 'Sample Submitted', receivedDate: '2026-11-01', submissionDate: TODAY })]);
  assert.equal(allRows(report)[0].late, false);
  assert.equal(report.totals.late, 0);
  assert.equal(report.totals.submittedToday, 1);
});

test('a Rejected die submitted today stays a Rejected row in trial', () => {
  const report = build([row({ status: 'Rejected', receivedDate: '2026-11-01', submissionDate: TODAY })]);
  const [r] = allRows(report);
  assert.equal(r.submittedToday, false);
  assert.equal(r.rejectedWait, 0);
  assert.equal(r.late, false);
  assert.notEqual(r.latest, 'Submitted today');
  assert.equal(report.totals.inTrial, 1);
  assert.equal(report.totals.submittedToday, 0);
});

test('latest trial line', () => {
  const t = [
    trial({ trialNo: 1 }),
    trial({ trialNo: 3, trialDate: '2026-11-18', failReason: 'Dimension Out of Spec', comments: 'wall thin' }),
  ];
  const [a] = allRows(build([row()], t));
  assert.equal(a.latest, 'T3 Not OK · Dimension Out of Spec · wall thin');
  assert.equal(a.lastTrialDate, '2026-11-18');
  assert.equal(a.daysSinceTrial, 2);
  assert.equal(a.trialCount, 2);
  assert.equal(a.legacyTrialCount, null);

  const ok = allRows(build([row()], [trial({ result: 'OK', failReason: '', comments: '' })]))[0];
  assert.equal(ok.latest, 'T1 OK');

  const [legacy] = allRows(build([row({ legacyTrials: 4 })]));
  assert.equal(legacy.trialCount, 0);
  assert.equal(legacy.legacyTrialCount, 4);

  const [none] = allRows(build([row()]));
  assert.equal(none.latest, 'No trial yet');
  assert.equal(none.lastTrialDate, null);
  assert.equal(none.daysSinceTrial, null);
  assert.equal(none.legacyTrialCount, null);

  const [remark] = allRows(build([row({ remark: 'waiting for billet' })]));
  assert.equal(remark.latest, 'waiting for billet');

  const [sub] = allRows(build([row({ status: 'Sample Submitted', submissionDate: TODAY })], [trial()]));
  assert.equal(sub.latest, 'Submitted today');
  assert.equal(sub.submittedToday, true);
});

test('trials are matched to their own parent and source', () => {
  const t = [trial({ source: 'standalone', parentId: 1 })];
  const [a] = allRows(build([row({ source: 'order', id: 1 })], t));
  assert.equal(a.trialCount, 0);
});

test('plants and presses group and order', () => {
  const report = build([
    row({ id: 1, die: 'p', plant: '', press: 'Press 1' }),
    row({ id: 2, die: 'g2a', plant: 'GEX_02', press: 'Press 10' }),
    row({ id: 3, die: 'g2b', plant: 'GEX 2', press: 'Press 2' }),
    row({ id: 4, die: 'g1', plant: 'GEX 01', press: '' }),
    row({ id: 5, die: 'g2c', plant: 'GEX 2', press: '' }),
  ]);
  assert.deepEqual(report.plants.map(p => p.plant), ['GEX 1', 'GEX 2', 'No plant']);
  const g2 = report.plants[1];
  assert.deepEqual(g2.presses.map(p => p.press), ['Press 2', 'Press 10', 'No press']);

  const ordered = build([
    row({ id: 1, die: 'sub', status: 'Sample Submitted', submissionDate: TODAY }),
    row({ id: 2, die: 'rej', status: 'Rejected', submissionDate: '2026-11-10' }),
    row({ id: 3, die: 'wait3', receivedDate: '2026-11-17' }),
    row({ id: 4, die: 'late5', receivedDate: '2026-11-05' }),
    row({ id: 5, die: 'late9', receivedDate: '2026-11-01' }),
    row({ id: 6, die: 'wait5', status: 'On hold', receivedDate: '2026-11-15' }),
    row({ id: 7, die: 'unknown', receivedDate: 'received' }),
    row({ id: 8, die: 'rej2', status: 'Rejected', submissionDate: '2026-11-01' }),
  ]);
  assert.deepEqual(allRows(ordered).map(r => r.die),
    ['late9', 'late5', 'wait5', 'wait3', 'unknown', 'rej2', 'rej', 'sub']);
});

test('counts per plant and in total', () => {
  const report = build([
    row({ id: 1, plant: 'GEX 1', receivedDate: '2026-11-05' }),
    row({ id: 2, plant: 'GEX 1', status: 'Sample Submitted', submissionDate: TODAY }),
    row({ id: 3, plant: 'GEX 2' }),
  ], [
    trial({ parentId: 1, trialDate: TODAY, result: 'OK', failReason: '' }),
    trial({ parentId: 3, trialDate: TODAY, result: 'Not OK' }),
    trial({ parentId: 3, trialNo: 2, trialDate: TODAY, result: 'Not OK' }),
    trial({ parentId: 3, trialNo: 3, trialDate: '2026-11-19', result: 'OK' }),
  ]);
  const [g1, g2] = report.plants;
  assert.deepEqual(g1.counts, { inTrial: 1, late: 1, submittedToday: 1, trialsToday: 1, trialsOk: 1, trialsNotOk: 0 });
  assert.deepEqual(g2.counts, { inTrial: 1, late: 0, submittedToday: 0, trialsToday: 2, trialsOk: 0, trialsNotOk: 2 });
  assert.deepEqual(report.totals, { inTrial: 2, late: 1, submittedToday: 1, trialsToday: 3, trialsOk: 1, trialsNotOk: 2 });
  assert.equal(report.reportDate, TODAY);
  assert.equal(report.plantFilter, 'All');
});

test('plant filter keeps one plant', () => {
  const rows = [row({ id: 1, plant: 'GEX 1' }), row({ id: 2, plant: 'GEX 2' })];
  const report = build(rows, [], { plant: 'GEX 2' });
  assert.equal(report.plants.length, 1);
  assert.equal(report.plants[0].plant, 'GEX 2');
  assert.equal(report.plantFilter, 'GEX 2');
  assert.equal(report.totals.inTrial, 1);
});

test('mirrors the page rule', () => {
  assert.equal(belongsInSampleFollowup({ receivedDate: '2026-11-10', orderStatus: 'Active' }), true);
  assert.equal(belongsInSampleFollowup({ receivedDate: '2026-11-10', orderStatus: null }), true);
  assert.equal(belongsInSampleFollowup({ receivedDate: '  ', orderStatus: 'Active' }), false);
  assert.equal(belongsInSampleFollowup({ receivedDate: null, orderStatus: 'Active' }), false);
  assert.equal(belongsInSampleFollowup({ receivedDate: '2026-11-10', orderStatus: ' cancelled ' }), false);
  assert.equal(belongsInSampleFollowup({ receivedDate: '2026-11-10', orderStatus: 'Hold' }), false);
});

test('loadSampleStatus maps DB columns and filters', async () => {
  const seen = [];
  const db = {
    async query(sql) {
      seen.push(sql);
      if (/FROM\s+die_orders/i.test(sql)) return { rows: [
        { id: 1, die_no: 'D-1', plant: 'GEX 1', press: 'Press 3', customer_name: 'ACME', die_type: 'SF', supplier: 'Sup',
          die_received_date: '2026-11-10', submission_date: null, sample_status: 'Pending', order_status: 'Active',
          corrector: 'Singh', no_of_trial: 4, sample_remark: 'rem' },
        { id: 2, die_no: 'D-2', plant: 'GEX 1', press: 'Press 3', customer_name: 'X', die_type: 'PH', supplier: 'Sup',
          die_received_date: '2026-11-10', submission_date: null, sample_status: 'Pending', order_status: 'CANCELLED',
          corrector: null, no_of_trial: 0, sample_remark: null },
      ] };
      if (/FROM\s+sample_followups/i.test(sql)) return { rows: [
        { id: 7, profile: 'S-9', plant: 'GEX 2', press: 'Press 1', customer: 'Solo', supplier: 'Sup2',
          die_received_date: '2026-11-19', submission_date: null, sample_status: 'On hold', no_of_trial: 0, remark: 'standalone note', corrector: 'Jo' },
      ] };
      if (/FROM\s+sample_trials/i.test(sql)) return { rows: [
        { die_order_id: 1, sample_followup_id: null, trial_no: 2, trial_date: '2026-11-20', result: 'OK', fail_reason: null, comments: null },
        { die_order_id: null, sample_followup_id: 7, trial_no: 1, trial_date: '2026-11-20', result: 'Not OK', fail_reason: 'Shape', comments: 'x' },
      ] };
      throw new Error('unexpected sql ' + sql);
    },
  };
  const report = await loadSampleStatus(db, { reportDate: TODAY });
  assert.equal(seen.length, 3);
  const rows = allRows(report);
  assert.deepEqual(rows.map(r => r.die).sort(), ['D-1', 'S-9']);
  const d1 = rows.find(r => r.die === 'D-1');
  assert.equal(d1.customer, 'ACME'); assert.equal(d1.dieType, 'SF'); assert.equal(d1.corrector, 'Singh');
  assert.equal(d1.latest, 'T2 OK'); assert.equal(d1.trialCount, 1); assert.equal(d1.legacyTrialCount, null);
  const s9 = rows.find(r => r.die === 'S-9');
  assert.equal(s9.latest, 'T1 Not OK · Shape · x'); assert.equal(s9.customer, 'Solo'); assert.equal(s9.dieType, '');
  assert.equal(report.plantFilter, 'All');
  assert.equal(report.totals.trialsToday, 2);

  const one = await loadSampleStatus(db, { reportDate: TODAY, plant: 'GEX 2' });
  assert.equal(one.plants.length, 1);
});

test('plant filter accepts non-canonical plant spellings', () => {
  const rows = [row({ id: 1, plant: 'GEX 1' }), row({ id: 2, plant: 'GEX 2' })];
  for (const spelling of ['GEX 01', 'GEX_1', 'gex 1']) {
    const report = build(rows, [], { plant: spelling });
    assert.equal(report.plantFilter, 'GEX 1', spelling);
    assert.deepEqual(report.plants.map(p => p.plant), ['GEX 1'], spelling);
  }
});

test('loadSampleStatus fills a blank customer: die match beats profile match beats profiles table', async () => {
  let customerQueries = 0;
  const base = { plant: 'GEX 1', press: 'P', die_type: 'SF', supplier: 'S', die_received_date: '2026-11-10', submission_date: null,
    sample_status: 'Pending', order_status: 'Active', corrector: null, no_of_trial: 0, sample_remark: null };
  const db = {
    async query(sql) {
      if (/FROM\s+die_orders/i.test(sql)) return { rows: [
        { ...base, id: 1, die_no: '123-4', customer_name: '' },
        { ...base, id: 2, die_no: '123-9', customer_name: null },
        { ...base, id: 3, die_no: '777-1', customer_name: '' },
        { ...base, id: 4, die_no: '555-1', customer_name: 'Own' },
        { ...base, id: 5, die_no: '999-1', customer_name: '' },
      ] };
      if (/FROM\s+sample_followups/i.test(sql)) return { rows: [
        { id: 7, profile: '123_4', plant: 'GEX 1', press: 'P', customer: '', supplier: 'S', die_received_date: '2026-11-10',
          submission_date: null, sample_status: 'Pending', no_of_trial: 0, remark: '', corrector: null },
      ] };
      if (/FROM\s+sample_trials/i.test(sql)) return { rows: [] };
      if (/existing_die_details/i.test(sql)) {
        customerQueries += 1;
        return { rows: [
          { kind: 'die', key: '123-4', customer: 'DieMatch-old', id: 1 },
          { kind: 'die', key: '123-4', customer: 'DieMatch', id: 2 },
          { kind: 'profile', key: '123', customer: 'ProfileMatch', id: 3 },
          { kind: 'profile', key: '777', customer: 'ProfileMatch777', id: 4 },
          { kind: 'master', key: '123', customer: 'Master123', id: 5 },
          { kind: 'master', key: '999', customer: 'Master999', id: 6 },
        ] };
      }
      throw new Error('unexpected sql ' + sql);
    },
  };
  const report = await loadSampleStatus(db, { reportDate: TODAY });
  assert.equal(customerQueries, 1);
  const byDie = Object.fromEntries(allRows(report).map(r => [r.die, r.customer]));
  assert.equal(byDie['123-4'], 'DieMatch');
  assert.equal(byDie['123-9'], 'ProfileMatch');
  assert.equal(byDie['777-1'], 'ProfileMatch777');
  assert.equal(byDie['555-1'], 'Own');
  assert.equal(byDie['999-1'], 'Master999');
  assert.equal(byDie['123_4'], 'DieMatch');
});
