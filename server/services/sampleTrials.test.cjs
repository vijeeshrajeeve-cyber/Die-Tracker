'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const trials = require('./sampleTrials.cjs');

const TODAY = '2026-09-04';
const ok = (over = {}) => ({ trial_date: '2026-09-01', result: 'OK', fail_reason: null, comments: '', ...over });

test('a Not OK trial without a reason is rejected', () => {
  const r = trials.validateTrial(ok({ result: 'Not OK', fail_reason: null }), TODAY);
  assert.equal(r.ok, false);
  assert.match(r.error, /reason/i);
});

test('an OK trial carrying a reason has it dropped, not stored', () => {
  const r = trials.validateTrial(ok({ result: 'OK', fail_reason: 'Shape' }), TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.value.fail_reason, null);
});

test('a reason outside the fixed list is rejected', () => {
  const r = trials.validateTrial(ok({ result: 'Not OK', fail_reason: 'Gremlins' }), TODAY);
  assert.equal(r.ok, false);
  assert.match(r.error, /reason/i);
});

test('every listed reason is accepted on a Not OK trial', () => {
  for (const reason of trials.FAIL_REASONS) {
    const r = trials.validateTrial(ok({ result: 'Not OK', fail_reason: reason }), TODAY);
    assert.equal(r.ok, true, `${reason} should be accepted`);
    assert.equal(r.value.fail_reason, reason);
  }
});

test('the reason list is exactly the agreed vocabulary, in order', () => {
  assert.deepEqual(trials.FAIL_REASONS, [
    'Shape', 'Dimension Out of Spec', 'Aesthetic Out of Spec',
    'Die Choked', 'Manufacturing issue', 'Other',
  ]);
});

test('a result outside OK / Not OK is rejected', () => {
  const r = trials.validateTrial(ok({ result: 'Maybe' }), TODAY);
  assert.equal(r.ok, false);
  assert.match(r.error, /result/i);
});

test('a future trial date is rejected but today is accepted', () => {
  assert.equal(trials.validateTrial(ok({ trial_date: '2026-09-05' }), TODAY).ok, false);
  assert.equal(trials.validateTrial(ok({ trial_date: TODAY }), TODAY).ok, true);
});

test('a missing or unparseable trial date is rejected', () => {
  assert.equal(trials.validateTrial(ok({ trial_date: '' }), TODAY).ok, false);
  assert.equal(trials.validateTrial(ok({ trial_date: 'last tuesday' }), TODAY).ok, false);
});

test('DD/MM/YYYY dates are normalised to ISO', () => {
  assert.equal(trials.normaliseDate('01/09/2026'), '2026-09-01');
  assert.equal(trials.normaliseDate('2026-09-01T10:30:00Z'), '2026-09-01');
  assert.equal(trials.normaliseDate(''), null);
});

test('blank comments are stored as null, real ones are trimmed', () => {
  assert.equal(trials.validateTrial(ok({ comments: '   ' }), TODAY).value.comments, null);
  assert.equal(trials.validateTrial(ok({ comments: '  ran short  ' }), TODAY).value.comments, 'ran short');
});

test('next trial number is max + 1, and 1 for a die with no trials', () => {
  assert.equal(trials.nextTrialNo([]), 1);
  assert.equal(trials.nextTrialNo([{ trial_no: 1 }, { trial_no: 3 }]), 4);
});

// Minimal stand-in for a pg client, dispatching on the SQL the service writes.
// Same approach as qdFocRounds.test.cjs: exercises the queries without a database.
function fakeClient(seed = []) {
  let nextId = seed.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
  const rows = seed.map((r) => ({
    die_order_id: null, sample_followup_id: null, fail_reason: null,
    comments: null, created_by: null, ...r,
  }));
  return {
    rows,
    async query(sql, params = []) {
      const s = String(sql);
      if (s.includes('INSERT INTO sample_trials')) {
        const row = {
          id: nextId++, die_order_id: null, sample_followup_id: null,
          trial_no: params[1], trial_date: params[2], result: params[3],
          fail_reason: params[4], comments: params[5], created_by: params[6],
        };
        // Dispatch on the INSERT column list, not the whole statement: the
        // RETURNING clause names both parent columns, so a bare
        // `s.includes('die_order_id')` would always match.
        row[s.includes('(die_order_id,') ? 'die_order_id' : 'sample_followup_id'] = params[0];
        rows.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (s.includes('UPDATE sample_trials')) {
        const row = rows.find((r) => r.id === Number(params[4]));
        if (!row) return { rows: [], rowCount: 0 };
        Object.assign(row, {
          trial_date: params[0], result: params[1], fail_reason: params[2], comments: params[3],
        });
        return { rows: [row], rowCount: 1 };
      }
      if (s.includes('DELETE FROM sample_trials')) {
        const i = rows.findIndex((r) => r.id === Number(params[0]));
        if (i === -1) return { rowCount: 0 };
        rows.splice(i, 1);
        return { rowCount: 1 };
      }
      if (s.includes('FROM sample_trials') && s.includes('WHERE')) {
        const key = s.includes('die_order_id = $1') ? 'die_order_id' : 'sample_followup_id';
        return { rows: rows.filter((r) => r[key] === params[0]).sort((a, b) => a.trial_no - b.trial_no) };
      }
      if (s.includes('FROM sample_trials')) return { rows: [...rows] };
      throw new Error(`unexpected SQL: ${s}`);
    },
  };
}

test('parentRef picks whichever parent is supplied, and rejects none or both', () => {
  assert.deepEqual(trials.parentRef({ die_order_id: 5 }), { column: 'die_order_id', id: 5 });
  assert.deepEqual(trials.parentRef({ sample_followup_id: 9 }), { column: 'sample_followup_id', id: 9 });
  assert.equal(trials.parentRef({}), null);
  assert.equal(trials.parentRef({ die_order_id: 5, sample_followup_id: 9 }), null);
});

test('createTrial numbers trials per parent, starting at 1', async () => {
  const c = fakeClient();
  const a = await trials.createTrial(c, { sample_followup_id: 1, trial_date: '2026-09-01', result: 'OK' }, 3, TODAY);
  const b = await trials.createTrial(c, { sample_followup_id: 1, trial_date: '2026-09-02', result: 'OK' }, 3, TODAY);
  const other = await trials.createTrial(c, { die_order_id: 1, trial_date: '2026-09-02', result: 'OK' }, 3, TODAY);
  assert.equal(a.row.trial_no, 1);
  assert.equal(b.row.trial_no, 2);
  assert.equal(other.row.trial_no, 1, 'a different die starts its own numbering');
});

test('createTrial ignores a client-supplied trial_no', async () => {
  const c = fakeClient();
  const r = await trials.createTrial(c, { sample_followup_id: 1, trial_no: 99, trial_date: '2026-09-01', result: 'OK' }, 3, TODAY);
  assert.equal(r.row.trial_no, 1);
});

test('createTrial rejects a missing parent with a 400', async () => {
  const r = await trials.createTrial(fakeClient(), { trial_date: '2026-09-01', result: 'OK' }, 3, TODAY);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('createTrial rejects a Not OK trial with no reason', async () => {
  const r = await trials.createTrial(fakeClient(), { sample_followup_id: 1, trial_date: '2026-09-01', result: 'Not OK' }, 3, TODAY);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('createTrial stores the reason on a Not OK trial', async () => {
  const c = fakeClient();
  const r = await trials.createTrial(c, { sample_followup_id: 1, trial_date: '2026-09-01', result: 'Not OK', fail_reason: 'Die Choked', comments: 'stopped at 3m' }, 3, TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.row.fail_reason, 'Die Choked');
  assert.equal(r.row.comments, 'stopped at 3m');
  assert.equal(r.row.created_by, 3);
});

test('updateTrial clears the reason when a failed trial is corrected to OK', async () => {
  const c = fakeClient([{ id: 1, sample_followup_id: 1, trial_no: 1, trial_date: '2026-09-01', result: 'Not OK', fail_reason: 'Shape' }]);
  const r = await trials.updateTrial(c, 1, { trial_date: '2026-09-01', result: 'OK' }, TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.row.fail_reason, null);
});

test('updateTrial on a missing id reports 404', async () => {
  const r = await trials.updateTrial(fakeClient(), 42, { trial_date: '2026-09-01', result: 'OK' }, TODAY);
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
});

test('deleteTrial reports whether a row went', async () => {
  const c = fakeClient([{ id: 1, sample_followup_id: 1, trial_no: 1, trial_date: '2026-09-01', result: 'OK' }]);
  assert.equal(await trials.deleteTrial(c, 1), true);
  assert.equal(await trials.deleteTrial(c, 1), false);
});

test('listTrials returns every trial for the page to group', async () => {
  const c = fakeClient([
    { id: 1, sample_followup_id: 1, trial_no: 1, trial_date: '2026-09-01', result: 'OK' },
    { id: 2, die_order_id: 4, trial_no: 1, trial_date: '2026-09-02', result: 'OK' },
  ]);
  assert.equal((await trials.listTrials(c)).length, 2);
});
