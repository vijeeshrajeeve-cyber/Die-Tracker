'use strict';
process.env.JWT_SECRET = 'enhancement-test-secret-that-is-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

let order;        // the die_orders row the next request finds; null = none
let enhancement;  // the design_enhancements row; null = none
let hasTrial;
let trials = [];
let log = [];
installFakeDb(async (sql, params = []) => {
  const q = sql.trim().replace(/\s+/g, ' ');
  log.push({ q, params });
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
  if (/^SELECT id, status, design_enhancement, simulation_enabled, sample_status, sample_approval_date FROM die_orders WHERE id = \$1( FOR UPDATE)?$/.test(q)) {
    return { rows: order ? [order] : [] };
  }
  if (/^SELECT \* FROM design_enhancements WHERE die_order_id/.test(q)) return { rows: enhancement ? [enhancement] : [] };
  if (/^SELECT \* FROM design_enhancements ORDER BY/.test(q)) return { rows: enhancement ? [enhancement] : [] };
  if (/^SELECT .* FROM sample_trials WHERE die_order_id = \$1 ORDER BY trial_no/.test(q)) return { rows: trials };
  if (/^SELECT 1 FROM sample_trials/.test(q)) return { rows: hasTrial ? [{ '?column?': 1 }] : [] };
  if (/^INSERT INTO design_enhancements/.test(q)) return { rows: [{ id: 1, die_order_id: params[0], current_issue: params[1] }] };
  if (/^UPDATE design_enhancements/.test(q)) return { rows: [{ id: 1, die_order_id: params[params.length - 1] }] };
  if (/^DELETE FROM design_enhancements/.test(q)) return { rows: [] };
  if (/^UPDATE die_orders SET/.test(q)) return { rows: [], rowCount: 1 };
  if (/^INSERT INTO order_changes/.test(q)) return { rows: [] };
  throw new Error(`enhancement test: unexpected query ${q}`);
});

const router = require('./design-enhancements.cjs');
const { todayLocal } = require('../services/dates.cjs');
const { createRevision } = require('../services/orderRevisions.cjs');

const EDITOR = { id: 5, username: 'planner', role: 'user', canEditOrderDetails: true };
const ADMIN = { id: 1, username: 'boss', role: 'admin' };
const VIEWER = { id: 9, username: 'viewer', role: 'user', canEditOrderDetails: false };
let currentUser;
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = currentUser; next(); });
app.use('/api/design-enhancements', router);

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(() => close());
test.beforeEach(() => {
  log = [];
  currentUser = EDITOR;
  hasTrial = false;
  trials = [];
  enhancement = null;
  order = { id: 7, status: 'AWAITING FOR DESIGN', design_enhancement: 0, simulation_enabled: 0,
    sample_status: 'Approved', sample_approval_date: '2026-08-31' };
});

const BASELINE = {
  current_issue: 'Die breaks early at the bearing', reference_dies: '30533_101',
  baseline_failure_pct: 12, baseline_productivity_kgh: 800, baseline_recovery_pct: 70,
  target_productivity_kgh: 900, target_recovery_pct: 75,
};
const put = (body) => request(base, '/api/design-enhancements/order/7', { method: 'PUT', body });
const del = (body) => request(base, '/api/design-enhancements/order/7', { method: 'DELETE', body: body || {} });
const queries = (prefix) => log.filter(({ q }) => q.startsWith(prefix));
const orderUpdate = () => queries('UPDATE die_orders')[0];
const changes = () => queries('INSERT INTO order_changes').map(({ params }) => ({
  field: params[4], old: params[5], new: params[6], reason: params[7], stage: params[8], by: params[2],
}));

test('an editor marks an AWAITING FOR DESIGN order: both flags set, change logged', async () => {
  const { status, body } = await put(BASELINE);
  assert.equal(status, 200);
  assert.equal(body.enhancement.die_order_id, 7);
  assert.match(orderUpdate().q, /design_enhancement = 1, simulation_enabled = 1/);
  assert.equal(queries('INSERT INTO design_enhancements')[0].params.at(-1), 'planner');
  assert.deepEqual(changes()[0], { field: 'Design enhancement', old: 'No', new: 'Yes', reason: null, stage: 'AWAITING FOR DESIGN', by: 'planner' });
  assert.ok(log.some(({ q }) => q === 'COMMIT'));
});

test('marking a PENDING FOR PR order leaves simulation_enabled and the status alone', async () => {
  order.status = 'PENDING FOR PR';
  const { status } = await put(BASELINE);
  assert.equal(status, 200);
  assert.match(orderUpdate().q, /design_enhancement = 1/);
  assert.doesNotMatch(orderUpdate().q, /simulation_enabled|status/);
});

test('marking an UNDER SIMULATION or PENDING FOR ORDERING order switches simulation on', async () => {
  for (const s of ['UNDER SIMULATION', 'PENDING FOR ORDERING']) {
    log = [];
    order.status = s;
    assert.equal((await put(BASELINE)).status, 200);
    assert.match(orderUpdate().q, /simulation_enabled = 1/);
  }
});

test('someone without the edit switch gets 403 and nothing is written', async () => {
  currentUser = VIEWER;
  const { status } = await put(BASELINE);
  assert.equal(status, 403);
  assert.equal(orderUpdate(), undefined);
  assert.equal(queries('INSERT').length, 0);
});

test('an editor marking a DIE RECEIVED order gets 403; an admin with a reason succeeds', async () => {
  order.status = 'DIE RECEIVED';
  assert.equal((await put(BASELINE)).status, 403);
  currentUser = ADMIN;
  assert.equal((await put({ ...BASELINE, reason: 'Found at first trial' })).status, 200);
  assert.deepEqual(changes()[0].reason, 'Found at first trial');
  assert.doesNotMatch(orderUpdate().q, /simulation_enabled/);
});

test('an admin marking after receipt without a reason gets 400', async () => {
  order.status = 'DIE RECEIVED';
  currentUser = ADMIN;
  const { status } = await put(BASELINE);
  assert.equal(status, 400);
  assert.equal(queries('INSERT INTO design_enhancements').length, 0);
  assert.ok(log.some(({ q }) => q === 'ROLLBACK'));
});

test('a cancelled order cannot be marked, even by an admin', async () => {
  order.status = 'CANCELLED';
  currentUser = ADMIN;
  assert.equal((await put({ ...BASELINE, reason: 'x' })).status, 400);
});

test('an invalid baseline is 400 with the rule message', async () => {
  const { status, body } = await put({ ...BASELINE, baseline_recovery_pct: 120 });
  assert.equal(status, 400);
  assert.equal(body.error, 'baseline_recovery_pct cannot be more than 100');
  const none = await put({ ...BASELINE, current_issue: ' ' });
  assert.equal(none.body.error, 'current_issue is required');
  assert.equal(log.length, 0, 'nothing touched the database');
});

test('an unknown order is 404', async () => {
  order = null;
  assert.equal((await put(BASELINE)).status, 404);
});

test('an editor edits the baseline before receipt; only the changed values are logged', async () => {
  order.design_enhancement = 1;
  enhancement = { die_order_id: 7, ...BASELINE, failure_assessment_required: false, target_failure_pct: null };
  const { status } = await put({ ...BASELINE, baseline_productivity_kgh: 850 });
  assert.equal(status, 200);
  assert.equal(queries('INSERT INTO design_enhancements').length, 0);
  assert.equal(orderUpdate(), undefined, 'the order row is not touched by a baseline edit');
  assert.deepEqual(changes().map((c) => [c.field, c.old, c.new]),
    [['Design enhancement: baseline_productivity_kgh', '800', '850']]);
});

test('an admin baseline edit after receipt without a reason is 400, with one it is logged', async () => {
  order.status = 'DIE RECEIVED';
  order.design_enhancement = 1;
  enhancement = { die_order_id: 7, ...BASELINE };
  currentUser = ADMIN;
  assert.equal((await put({ ...BASELINE, target_recovery_pct: 80 })).status, 400);
  assert.equal(queries('UPDATE design_enhancements').length, 0);
  assert.equal((await put({ ...BASELINE, target_recovery_pct: 80, reason: 'Customer changed the target' })).status, 200);
  assert.equal(changes()[0].reason, 'Customer changed the target');
});

test('an editor removes the flag while no trial exists; the order row and a log row follow', async () => {
  order.design_enhancement = 1;
  enhancement = { die_order_id: 7, ...BASELINE };
  const { status } = await del({ reason: 'Marked the wrong die' });
  assert.equal(status, 200);
  assert.equal(queries('DELETE FROM design_enhancements').length, 1);
  assert.equal(changes()[0].reason, 'Marked the wrong die');
  assert.match(orderUpdate().q, /design_enhancement = 0/);
  assert.doesNotMatch(orderUpdate().q, /simulation_enabled/);
  assert.equal(changes()[0].new, 'No');
});

test('removing the flag without a reason is 400 for an editor, and nothing is deleted', async () => {
  order.design_enhancement = 1;
  enhancement = { die_order_id: 7, ...BASELINE };
  for (const body of [{}, { reason: '   ' }]) {
    const { status } = await del(body);
    assert.equal(status, 400);
  }
  assert.equal(queries('DELETE FROM design_enhancements').length, 0);
  assert.ok(log.some(({ q }) => q === 'ROLLBACK'));
});

test('removing with an existing trial is 403 for an editor and needs a reason from an admin', async () => {
  order.design_enhancement = 1;
  enhancement = { die_order_id: 7, ...BASELINE };
  hasTrial = true;
  assert.equal((await del()).status, 403);
  assert.equal(queries('DELETE FROM design_enhancements').length, 0);
  currentUser = ADMIN;
  assert.equal((await del()).status, 400);
  assert.equal((await del({ reason: 'Marked by mistake' })).status, 200);
  assert.equal(changes()[0].reason, 'Marked by mistake');
});

test('removing from an order that is not an enhancement is 404', async () => {
  assert.equal((await del()).status, 404);
});

test('GET lists every enhancement row', async () => {
  enhancement = { die_order_id: 7, ...BASELINE };
  const { status, body } = await request(base, '/api/design-enhancements');
  assert.equal(status, 200);
  assert.equal(body.enhancements[0].die_order_id, 7);
});

test('a design revision leaves design_enhancement and the enhancement row untouched', async () => {
  const seen = [];
  const client = {
    query: async (sql) => {
      seen.push(sql);
      if (/FROM die_orders WHERE id/.test(sql)) return { rowCount: 1, rows: [{ status: 'PENDING FOR PR', design_revision_count: 0 }] };
      if (/INSERT INTO order_revisions/.test(sql)) return { rows: [{ id: 1, created_at: new Date() }] };
      return { rows: [] };
    },
  };
  await createRevision(client, { orderId: 7, targetStatus: 'AWAITING FOR DESIGN', notes: 'rework', user: EDITOR });
  assert.ok(seen.length > 0);
  assert.ok(!seen.some((sql) => /design_enhancement/i.test(sql)));
});

// ---- verdicts and the life review -------------------------------------------
const TARGETS = { target_failure_pct: null, target_productivity_kgh: '900', target_recovery_pct: '75', failure_assessment_required: false };
const okTrial = (over = {}) => ({ id: 31, die_order_id: 7, trial_no: 2, result: 'OK', productivity_kgh: '950', recovery_pct: '80', ...over });
const verdictBody = (over = {}) => ({ verdict: 'Achieved', ...over });
const trialVerdict = (body) => request(base, '/api/design-enhancements/order/7/trial-verdict', { method: 'POST', body });
const lifeReview = (body) => request(base, '/api/design-enhancements/order/7/life-review', { method: 'POST', body });
const suggestion = (qs = '') => request(base, `/api/design-enhancements/order/7/suggestion${qs}`);
const written = () => {
  const update = queries('UPDATE design_enhancements')[0];
  if (!update) return null;
  const out = {};
  for (const m of update.q.matchAll(/(\w+) = \$(\d+)/g)) out[m[1]] = update.params[Number(m[2]) - 1];
  return out;
};
const future = () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return todayLocal(d); };
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return todayLocal(d); };

test.describe('trial verdict', () => {
  test.beforeEach(() => {
    enhancement = { die_order_id: 7, ...TARGETS };
    trials = [okTrial({ id: 30, trial_no: 1, productivity_kgh: '700', recovery_pct: '60' }), okTrial(),
      okTrial({ id: 32, trial_no: 3, result: 'Not OK', productivity_kgh: null, recovery_pct: null })];
  });

  test('is refused until the sample is Approved or Rejected', async () => {
    order.sample_status = 'Pending';
    const { status, body } = await trialVerdict(verdictBody());
    assert.equal(status, 400);
    assert.match(body.error, /Approved or Rejected/);
    assert.equal(written(), null);
  });

  test('404 when the order is not an enhancement', async () => {
    enhancement = null;
    assert.equal((await trialVerdict(verdictBody())).status, 404);
  });

  test('snapshots the latest OK trial and, with no life review owed, writes the final verdict too', async () => {
    const { status } = await trialVerdict(verdictBody());
    assert.equal(status, 200);
    const w = written();
    assert.equal(w.trial_productivity_kgh, 950);
    assert.equal(w.trial_recovery_pct, 80);
    assert.equal(w.source_trial_id, 31);
    assert.equal(w.trial_verdict, 'Achieved');
    assert.equal(w.trial_verdict_by, 'planner');
    assert.equal(w.trial_verdict_date, todayLocal());
    assert.equal(w.final_verdict, 'Achieved');
    assert.equal(w.final_verdict_by, 'planner');
    assert.equal(w.final_verdict_date, todayLocal());
    assert.deepEqual(changes().map((c) => c.field), ['Design enhancement: trial verdict', 'Design enhancement: final verdict']);
    assert.ok(log.some(({ q }) => q === 'COMMIT'));
  });

  test('a verdict outside the vocabulary is refused', async () => {
    assert.equal((await trialVerdict({ verdict: 'Great' })).status, 400);
    assert.equal((await trialVerdict({})).status, 400);
  });

  test('a remark is required when the verdict differs from the suggestion', async () => {
    const miss = await trialVerdict(verdictBody({ verdict: 'Not achieved' }));
    assert.equal(miss.status, 400);
    assert.match(miss.body.error, /remark/i);
    const ok = await trialVerdict(verdictBody({ verdict: 'Not achieved', remark: '  Die was damaged  ' }));
    assert.equal(ok.status, 200);
    assert.equal(written().trial_verdict_remark, 'Die was damaged');
  });

  test('with nothing to compare every verdict is an override, and the snapshot is null', async () => {
    trials = [okTrial({ result: 'Not OK' })];
    assert.equal((await trialVerdict(verdictBody())).status, 400);
    assert.equal((await trialVerdict(verdictBody({ remark: 'Judged by eye' }))).status, 200);
    const w = written();
    assert.equal(w.trial_productivity_kgh, null);
    assert.equal(w.trial_recovery_pct, null);
    assert.equal(w.source_trial_id, null);
  });

  test('a life review owed: due date required, valid and not in the past, and no final verdict is written', async () => {
    enhancement.failure_assessment_required = true;
    enhancement.target_failure_pct = '10';
    for (const bad of [undefined, '', '2026-02-30', 'soon', yesterday()]) {
      const r = await trialVerdict(verdictBody({ life_review_due_date: bad }));
      assert.equal(r.status, 400, String(bad));
      assert.match(r.body.error, /life_review_due_date/);
    }
    assert.equal(written(), null);
    const ok = await trialVerdict(verdictBody({ life_review_due_date: future() }));
    assert.equal(ok.status, 200);
    const w = written();
    assert.equal(w.life_review_due_date, future());
    assert.equal(w.final_verdict, null);
    assert.deepEqual(changes().map((c) => c.field), ['Design enhancement: trial verdict']);
  });

  test('a Rejected sample with the assessment required writes the final verdict immediately', async () => {
    order.sample_status = 'Rejected';
    enhancement.failure_assessment_required = true;
    enhancement.target_failure_pct = '10';
    const { status } = await trialVerdict(verdictBody());
    assert.equal(status, 200);
    assert.equal(written().final_verdict, 'Achieved');
    assert.equal(written().life_review_due_date, null);
  });

  test('repeating it: an editor is refused, an admin needs a reason, the reason is logged, the snapshot is fresh', async () => {
    enhancement.trial_verdict = 'Achieved';
    enhancement.final_verdict = 'Achieved';
    assert.equal((await trialVerdict(verdictBody())).status, 403);
    currentUser = ADMIN;
    const bare = await trialVerdict(verdictBody());
    assert.equal(bare.status, 400);
    assert.equal(bare.body.code, 'REASON_REQUIRED');
    trials = [okTrial({ id: 40, trial_no: 4, productivity_kgh: '1000', recovery_pct: '85' })];
    const { status } = await trialVerdict(verdictBody({ reason: 'Trial numbers were corrected' }));
    assert.equal(status, 200);
    assert.equal(written().trial_productivity_kgh, 1000);
    assert.equal(written().source_trial_id, 40);
    const entry = changes().find((c) => c.field === 'Design enhancement: trial verdict');
    assert.equal(entry.reason, 'Trial numbers were corrected');
    assert.equal(entry.old, 'Achieved');
    assert.equal(entry.by, 'boss');
  });

  test('a redo that owes a life review again clears the life-review and final fields', async () => {
    enhancement = { ...enhancement, failure_assessment_required: true, target_failure_pct: '10', trial_verdict: 'Achieved',
      actual_failure_pct: '8', life_review_date: '2027-03-01', final_verdict: 'Achieved' };
    currentUser = ADMIN;
    const { status } = await trialVerdict(verdictBody({ reason: 'Re-judged', life_review_due_date: future() }));
    assert.equal(status, 200);
    const w = written();
    for (const k of ['actual_failure_pct', 'life_review_remark', 'life_review_by', 'life_review_date',
      'final_verdict', 'final_verdict_remark', 'final_verdict_by', 'final_verdict_date']) {
      assert.equal(w[k], null, k);
    }
    assert.ok(changes().some((c) => c.field === 'Design enhancement: final verdict' && c.old === 'Achieved' && c.new === null));
  });

  test('a redo that owes no life review rewrites the final verdict to match', async () => {
    order.sample_status = 'Rejected';
    enhancement = { ...enhancement, failure_assessment_required: true, target_failure_pct: '10', trial_verdict: 'Achieved',
      actual_failure_pct: '8', life_review_date: '2027-03-01', final_verdict: 'Achieved' };
    currentUser = ADMIN;
    const { status } = await trialVerdict({ verdict: 'Not achieved', remark: 'Rejected after all', reason: 'Sample rejected later' });
    assert.equal(status, 200);
    const w = written();
    assert.equal(w.final_verdict, 'Not achieved');
    assert.equal(w.final_verdict_remark, 'Rejected after all');
    assert.ok(!('actual_failure_pct' in w));
  });

  test('is behind the Sample Followup page access', async () => {
    currentUser = { ...EDITOR, pageAccess: ['flow-completed'] };
    assert.equal((await trialVerdict(verdictBody())).status, 403);
    assert.equal((await lifeReview({})).status, 403);
    currentUser = { ...EDITOR, pageAccess: ['flow-sample-followup'] };
    assert.equal((await trialVerdict(verdictBody())).status, 200);
  });

  test('later edits to the source trial leave the snapshot alone', async () => {
    await trialVerdict(verdictBody());
    const snapshot = written();
    const { updateTrial } = require('../services/sampleTrials.cjs');
    const trialQueries = [];
    const client = { query: async (sql) => {
      trialQueries.push(sql);
      if (/^SELECT die_order_id FROM sample_trials/.test(sql)) return { rows: [{ die_order_id: 7 }] };
      if (/^SELECT design_enhancement FROM die_orders/.test(sql)) return { rows: [{ design_enhancement: 1 }] };
      return { rows: [{ id: 31 }], rowCount: 1 };
    } };
    const out = await updateTrial(client, 31, { trial_date: '2026-09-01', result: 'OK', productivity_kgh: 1, recovery_pct: 2 }, todayLocal());
    assert.equal(out.ok, true);
    assert.ok(!trialQueries.some((sql) => /design_enhancements/.test(sql)));
    assert.equal(snapshot.trial_productivity_kgh, 950);
  });
});

test.describe('life review', () => {
  test.beforeEach(() => {
    enhancement = { die_order_id: 7, ...TARGETS, failure_assessment_required: true, target_failure_pct: '10',
      trial_verdict: 'Achieved', trial_productivity_kgh: '950', trial_recovery_pct: '80', source_trial_id: 31 };
  });

  test('is refused before a trial verdict exists', async () => {
    enhancement.trial_verdict = null;
    assert.equal((await lifeReview({ actual_failure_pct: 5, verdict: 'Achieved' })).status, 400);
  });

  test('is refused when none is owed', async () => {
    enhancement.failure_assessment_required = false;
    assert.equal((await lifeReview({ actual_failure_pct: 5, verdict: 'Achieved' })).status, 400);
    enhancement.failure_assessment_required = true;
    enhancement.final_verdict = 'Achieved'; // written by the trial verdict, no review behind it
    assert.equal((await lifeReview({ actual_failure_pct: 5, verdict: 'Achieved' })).status, 400);
    assert.equal(written(), null);
  });

  test('needs a valid failure %', async () => {
    for (const bad of [undefined, '', 'abc', -1, 101]) {
      const r = await lifeReview({ actual_failure_pct: bad, verdict: 'Achieved' });
      assert.equal(r.status, 400, String(bad));
      assert.match(r.body.error, /actual_failure_pct/);
    }
    assert.equal(written(), null);
  });

  test('judges all three targets against the snapshot plus the actual failure % and writes the final verdict', async () => {
    const { status } = await lifeReview({ actual_failure_pct: '8.5', verdict: 'Achieved' });
    assert.equal(status, 200);
    const w = written();
    assert.equal(w.actual_failure_pct, 8.5);
    assert.equal(w.life_review_by, 'planner');
    assert.equal(w.life_review_date, todayLocal());
    assert.equal(w.final_verdict, 'Achieved');
    assert.equal(w.final_verdict_by, 'planner');
    assert.equal(w.final_verdict_date, todayLocal());
    assert.deepEqual(changes().map((c) => c.field), ['Design enhancement: life review', 'Design enhancement: final verdict']);
  });

  test('a verdict that differs from the suggestion needs a remark', async () => {
    // failure 12 misses the 10 target: suggestion is Partly achieved
    const miss = await lifeReview({ actual_failure_pct: 12, verdict: 'Achieved' });
    assert.equal(miss.status, 400);
    assert.match(miss.body.error, /remark/i);
    assert.equal((await lifeReview({ actual_failure_pct: 12, verdict: 'Partly achieved' })).status, 200);
    log = [];
    const over = await lifeReview({ actual_failure_pct: 12, verdict: 'Achieved', remark: 'Wear is on the bearing only' });
    assert.equal(over.status, 200);
    assert.equal(written().life_review_remark, 'Wear is on the bearing only');
    assert.equal(written().final_verdict_remark, 'Wear is on the bearing only');
  });

  test('repeating it is admin-only with a reason, and logged', async () => {
    enhancement = { ...enhancement, actual_failure_pct: '8', life_review_date: '2027-03-01', final_verdict: 'Achieved' };
    assert.equal((await lifeReview({ actual_failure_pct: 9, verdict: 'Achieved' })).status, 403);
    currentUser = ADMIN;
    assert.equal((await lifeReview({ actual_failure_pct: 9, verdict: 'Achieved' })).status, 400);
    const { status } = await lifeReview({ actual_failure_pct: 9, verdict: 'Achieved', reason: 'Counted again' });
    assert.equal(status, 200);
    const entry = changes().find((c) => c.field === 'Design enhancement: life review');
    assert.equal(entry.reason, 'Counted again');
    assert.equal(entry.old, '8');
    assert.equal(entry.new, '9');
  });
});

test.describe('suggestion', () => {
  test.beforeEach(() => {
    enhancement = { die_order_id: 7, ...TARGETS };
    trials = [okTrial()];
  });

  test('trial stage compares the live latest OK trial with the productivity and recovery targets', async () => {
    const { status, body } = await suggestion();
    assert.equal(status, 200);
    assert.equal(body.stage, 'trial');
    assert.equal(body.suggested, 'Achieved');
    assert.deepEqual(body.actuals, { failure: null, productivity: 950, recovery: 80 });
    assert.deepEqual(body.targets, { failure: null, productivity: 900, recovery: 75 });
    assert.equal(body.defaultReviewDate, '2027-02-28');
  });

  test('no OK trial means no suggestion and null actuals', async () => {
    trials = [];
    const { body } = await suggestion();
    assert.equal(body.suggested, null);
    assert.deepEqual(body.actuals, { failure: null, productivity: null, recovery: null });
  });

  test('final stage uses the snapshot, all three targets and the failure % given', async () => {
    enhancement = { ...enhancement, failure_assessment_required: true, target_failure_pct: '10', trial_verdict: 'Achieved',
      trial_productivity_kgh: '800', trial_recovery_pct: '80' };
    trials = [okTrial({ productivity_kgh: '999' })]; // a later edit must not matter
    const { body } = await suggestion('?actual_failure_pct=12');
    assert.equal(body.stage, 'final');
    assert.deepEqual(body.targets, { failure: 10, productivity: 900, recovery: 75 });
    assert.deepEqual(body.actuals, { failure: 12, productivity: 800, recovery: 80 });
    assert.equal(body.suggested, 'Partly achieved');
  });

  test('404 when the order is not an enhancement; 400 for a bad failure %', async () => {
    enhancement = null;
    assert.equal((await suggestion()).status, 404);
    enhancement = { die_order_id: 7, ...TARGETS };
    assert.equal((await suggestion('?actual_failure_pct=abc')).status, 400);
  });
});
