'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const foc = require('./qdFocRounds.cjs');

const NOW = new Date('2026-07-17T00:00:00Z');

// Minimal stand-in for a pg client: enough of qd_foc_rounds to exercise the
// round lifecycle without a database. Dispatches on the SQL the service writes.
function fakeClient(seed = []) {
  let nextId = seed.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
  const rows = seed.map((r) => ({
    received_date: null, received_by: null, trial_date: null,
    trial_result: null, trial_notes: null, accepted_at: null, ...r,
  }));
  return {
    rows,
    async query(sql, params = []) {
      const s = String(sql);
      if (s.includes('FROM qd_foc_rounds') && s.includes('ANY($1)')) {
        return { rows: rows.filter((r) => params[0].includes(r.qd_id)) };
      }
      if (s.includes('FROM qd_foc_rounds')) {
        return {
          rows: rows.filter((r) => r.qd_id === params[0])
            .sort((a, b) => a.round_no - b.round_no),
        };
      }
      if (s.includes('INSERT INTO qd_foc_rounds')) {
        const row = {
          id: nextId++, qd_id: params[0], round_no: params[1],
          promised_eta: params[2], accepted_at: params[3] || '2026-07-17',
          received_date: null, received_by: null,
          trial_date: null, trial_result: null, trial_notes: null,
        };
        rows.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (s.includes('SET promised_eta')) {
        const row = rows.find((r) => r.id === params[1]);
        row.promised_eta = params[0];
        return { rowCount: 1 };
      }
      if (s.includes('SET received_date')) {
        const row = rows.find((r) => r.id === params[2]);
        row.received_date = params[0];
        row.received_by = params[1];
        return { rowCount: 1 };
      }
      if (s.includes('SET trial_date')) {
        const row = rows.find((r) => r.id === params[3]);
        row.trial_date = params[0];
        row.trial_result = params[1];
        row.trial_notes = params[2];
        return { rowCount: 1 };
      }
      throw new Error(`fakeClient got unexpected SQL: ${s}`);
    },
  };
}

// ── Pure helpers ───────────────────────────────────────────────────────────

test('openRound is the latest round with no verdict, and nothing once it is trialled', () => {
  const promised = [{ round_no: 1, promised_eta: '2026-08-01' }];
  assert.equal(foc.openRound(promised).round_no, 1);

  const received = [{ round_no: 1, received_date: '2026-08-03' }];
  assert.equal(foc.openRound(received).round_no, 1);

  const trialled = [{ round_no: 1, received_date: '2026-08-03', trial_result: 'Fail' }];
  assert.equal(foc.openRound(trialled), null, 'a trialled round is finished, pass or fail');
  assert.equal(foc.openRound([]), null);
});

test('openRound tracks the newest round when a QD has looped', () => {
  const rounds = [
    { round_no: 1, received_date: '2026-05-02', trial_result: 'Fail' },
    { round_no: 2, promised_eta: '2026-09-01' },
  ];
  assert.equal(foc.openRound(rounds).round_no, 2);
  assert.equal(foc.nextRoundNo(rounds), 3);
});

test('nextRoundNo starts at 1 and never reuses a number', () => {
  assert.equal(foc.nextRoundNo([]), 1);
  assert.equal(foc.nextRoundNo(null), 1);
  assert.equal(foc.nextRoundNo([{ round_no: 1 }, { round_no: 2 }]), 3);
  // a deleted middle round must not cause round 2 to be issued twice
  assert.equal(foc.nextRoundNo([{ round_no: 1 }, { round_no: 3 }]), 4);
});

test('roundState names each step of one round', () => {
  assert.equal(foc.roundState(null), 'none');
  assert.equal(foc.roundState({ promised_eta: '2026-08-01' }), 'awaiting-receipt');
  assert.equal(foc.roundState({ received_date: '2026-08-01' }), 'awaiting-trial');
  assert.equal(foc.roundState({ received_date: '2026-08-01', trial_result: 'Pass' }), 'trial-passed');
  assert.equal(foc.roundState({ received_date: '2026-08-01', trial_result: 'Fail' }), 'trial-failed');
});

test('focSummary reports days overdue as a signed number', () => {
  const late = foc.focSummary([{ round_no: 1, promised_eta: '2026-07-10' }], NOW);
  assert.equal(late.state, 'awaiting-receipt');
  assert.equal(late.daysOverdue, 7);

  const early = foc.focSummary([{ round_no: 1, promised_eta: '2026-07-24' }], NOW);
  assert.equal(early.daysOverdue, -7, 'still in time must not clamp to 0');

  const dueToday = foc.focSummary([{ round_no: 1, promised_eta: '2026-07-17' }], NOW);
  assert.equal(dueToday.daysOverdue, 0);
});

test('focSummary counts idle days for a die sitting untrialled in the plant', () => {
  const s = foc.focSummary([{ round_no: 1, promised_eta: '2026-07-01', received_date: '2026-07-05' }], NOW);
  assert.equal(s.state, 'awaiting-trial');
  assert.equal(s.daysIdle, 12);
  assert.equal(s.daysOverdue, null, 'it has arrived — overdue no longer applies');
});

test('focSummary reports the latest round but keeps the whole history', () => {
  const s = foc.focSummary([
    { round_no: 2, promised_eta: '2026-09-01' },
    { round_no: 1, promised_eta: '2026-05-01', received_date: '2026-05-02', trial_result: 'Fail' },
  ], NOW);
  assert.equal(s.roundCount, 2);
  assert.equal(s.state, 'awaiting-receipt');
  assert.equal(s.promisedEta, '2026-09-01');
  assert.deepEqual(s.rounds.map((r) => r.round_no), [1, 2], 'sorted oldest first for display');
});

test('focSummary on a QD that never had a FOC is inert', () => {
  const s = foc.focSummary([], NOW);
  assert.equal(s.state, 'none');
  assert.equal(s.roundCount, 0);
  assert.equal(s.daysOverdue, null);
  assert.equal(s.daysIdle, null);
});

test('focSummary trims a timestamp-shaped date down to the day', () => {
  const s = foc.focSummary([{ round_no: 1, promised_eta: '2026-08-01T00:00:00.000Z' }], NOW);
  assert.equal(s.promisedEta, '2026-08-01');
});

// ── Lifecycle ──────────────────────────────────────────────────────────────

test('accepting a FOC opens round 1', async () => {
  const client = fakeClient();
  const { roundNo, revised } = await foc.openFocRound(client, { qdId: 7, promisedEta: '2026-08-01' });
  assert.equal(roundNo, 1);
  assert.equal(revised, false);
  assert.equal(client.rows.length, 1);
  assert.equal(client.rows[0].promised_eta, '2026-08-01');
});

test('re-accepting with a new ETA revises the open round instead of duplicating it', async () => {
  const client = fakeClient([{ id: 1, qd_id: 7, round_no: 1, promised_eta: '2026-08-01' }]);
  const { roundNo, revised } = await foc.openFocRound(client, { qdId: 7, promisedEta: '2026-09-15' });
  assert.equal(roundNo, 1);
  assert.equal(revised, true);
  assert.equal(client.rows.length, 1, 'a slipped date is the same promise, not a second one');
  assert.equal(client.rows[0].promised_eta, '2026-09-15');
});

test('accepting a FOC after a failed trial opens the next round', async () => {
  const client = fakeClient([
    { id: 1, qd_id: 7, round_no: 1, promised_eta: '2026-05-01', received_date: '2026-05-02', trial_result: 'Fail' },
  ]);
  const { roundNo } = await foc.openFocRound(client, { qdId: 7, promisedEta: '2026-09-01' });
  assert.equal(roundNo, 2);
  assert.equal(client.rows.length, 2);
  assert.equal(client.rows[0].trial_result, 'Fail', 'round 1 history is untouched');
});

test('accepting a FOC without a valid ETA is refused', async () => {
  const client = fakeClient();
  await assert.rejects(
    () => foc.openFocRound(client, { qdId: 7, promisedEta: '' }),
    /Invalid ETA date/);
  await assert.rejects(
    () => foc.openFocRound(client, { qdId: 7, promisedEta: '01/08/2026' }),
    /expected YYYY-MM-DD/);
  assert.equal(client.rows.length, 0);
});

test('receipt lands on the open round', async () => {
  const client = fakeClient([{ id: 1, qd_id: 7, round_no: 1, promised_eta: '2026-08-01' }]);
  const { roundNo } = await foc.recordReceipt(client, { qdId: 7, receivedDate: '2026-08-05', receivedBy: 3 });
  assert.equal(roundNo, 1);
  assert.equal(client.rows[0].received_date, '2026-08-05');
  assert.equal(client.rows[0].received_by, 3);
});

test('a receipt against no promised FOC is refused', async () => {
  const client = fakeClient();
  await assert.rejects(
    () => foc.recordReceipt(client, { qdId: 7, receivedDate: '2026-08-05' }),
    /No FOC round is awaiting receipt/);
});

test('the same round cannot be received twice', async () => {
  const client = fakeClient([{ id: 1, qd_id: 7, round_no: 1, received_date: '2026-08-05' }]);
  await assert.rejects(
    () => foc.recordReceipt(client, { qdId: 7, receivedDate: '2026-08-09' }),
    /already been received/);
  assert.equal(client.rows[0].received_date, '2026-08-05', 'the first date stands');
});

test('a trial verdict closes the round', async () => {
  const client = fakeClient([{ id: 1, qd_id: 7, round_no: 1, received_date: '2026-08-05' }]);
  const out = await foc.recordTrial(client, {
    qdId: 7, trialDate: '2026-08-08', result: 'Fail', notes: 'same weld line',
  });
  assert.deepEqual(out, { roundNo: 1, result: 'Fail' });
  assert.equal(client.rows[0].trial_result, 'Fail');
  assert.equal(client.rows[0].trial_notes, 'same weld line');
  assert.equal(foc.openRound(client.rows), null);
});

test('a trial cannot be recorded before the die has arrived', async () => {
  const client = fakeClient([{ id: 1, qd_id: 7, round_no: 1, promised_eta: '2026-08-01' }]);
  await assert.rejects(
    () => foc.recordTrial(client, { qdId: 7, trialDate: '2026-08-08', result: 'Pass' }),
    /Record the receipt before the trial/);
});

test('a trial dated before the receipt is refused', async () => {
  const client = fakeClient([{ id: 1, qd_id: 7, round_no: 1, received_date: '2026-08-05' }]);
  await assert.rejects(
    () => foc.recordTrial(client, { qdId: 7, trialDate: '2026-08-01', result: 'Pass' }),
    /before the die was received/);
});

test('a trial result outside Pass/Fail is refused', async () => {
  const client = fakeClient([{ id: 1, qd_id: 7, round_no: 1, received_date: '2026-08-05' }]);
  await assert.rejects(
    () => foc.recordTrial(client, { qdId: 7, trialDate: '2026-08-08', result: 'Partial' }),
    /expected Pass or Fail/);
});

test('a second trial on a closed round is refused', async () => {
  const client = fakeClient([
    { id: 1, qd_id: 7, round_no: 1, received_date: '2026-08-05', trial_result: 'Fail' },
  ]);
  await assert.rejects(
    () => foc.recordTrial(client, { qdId: 7, trialDate: '2026-08-09', result: 'Pass' }),
    /No FOC round is awaiting a trial/);
});

test('a full accept → receive → fail → accept → receive → pass loop', async () => {
  const client = fakeClient();
  await foc.openFocRound(client, { qdId: 7, promisedEta: '2026-05-01', acceptedAt: '2026-04-01' });
  await foc.recordReceipt(client, { qdId: 7, receivedDate: '2026-05-02' });
  await foc.recordTrial(client, { qdId: 7, trialDate: '2026-05-04', result: 'Fail', notes: 'weld line' });

  await foc.openFocRound(client, { qdId: 7, promisedEta: '2026-07-01', acceptedAt: '2026-05-05' });
  await foc.recordReceipt(client, { qdId: 7, receivedDate: '2026-07-03' });
  await foc.recordTrial(client, { qdId: 7, trialDate: '2026-07-06', result: 'Pass' });

  const s = foc.focSummary(client.rows, NOW);
  assert.equal(s.roundCount, 2);
  assert.equal(s.state, 'trial-passed');
  assert.equal(s.receivedDate, '2026-07-03');
  assert.equal(s.rounds[0].trial_result, 'Fail', 'the failed first attempt is still on record');
});

test('listRounds groups by QD', async () => {
  const client = fakeClient([
    { id: 1, qd_id: 7, round_no: 1, promised_eta: '2026-08-01' },
    { id: 2, qd_id: 7, round_no: 2, promised_eta: '2026-09-01' },
    { id: 3, qd_id: 9, round_no: 1, promised_eta: '2026-08-15' },
  ]);
  const map = await foc.listRounds(client, [7, 9]);
  assert.equal(map.get(7).length, 2);
  assert.equal(map.get(9).length, 1);
  assert.equal((await foc.listRounds(client, [])).size, 0);
});
