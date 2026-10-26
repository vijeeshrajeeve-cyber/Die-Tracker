'use strict';

// Simulation step tracking: one row per simulation round of a die.
//
// Each round runs Awaiting 3D model -> 3D model received -> Preparation done
// -> Simulation completed, and ends OK (on to Design Approval) or Not OK with
// one fixed reason and an In-house or Supplier modification. An in-house fix
// opens the next round straight at preparation; a supplier fix goes back to
// Awaiting Design through a normal revision and returns for a new round.
//
// This module owns the vocabulary and the rules and never touches the
// database. A die's stage is derived from its rounds, never stored. A die with
// no row yet gets a *virtual* round, so shipping this writes nothing and no
// date is ever stamped that somebody did not enter.

const { workingDaysBetween, strictDate } = require('./workQueueCalendar.cjs');
const { normaliseDate } = require('./sampleTrials.cjs');

const STAGES = ['awaiting_model', 'model_received', 'prep_done', 'in_house_mod'];
const STAGE_LABELS = {
  awaiting_model: 'Awaiting 3D model',
  model_received: '3D model received',
  prep_done: 'Preparation done',
  in_house_mod: 'In-house modification',
};

// Fixed, and stored verbatim in fail_reason. Changing a string here is a data
// migration, not an edit. `Other` keeps a novel failure from being misfiled.
const FAIL_REASONS = [
  'Uneven exit velocity / flow imbalance',
  'Extrusion pressure too high (exceeds press capacity)',
  'Die deflection / stress too high',
  'Weld seam quality',
  'Exit temperature out of range',
  'Profile dimension / shape deviation',
  'Other',
];
const MODIFICATIONS = ['In-house', 'Supplier'];
const RESULTS = ['OK', 'Not OK'];

// The user's target: simulation completed within one working day of the 3D
// model arriving. Only the two stages the engineer controls can be late.
const TARGET_WORKING_DAYS = 1;
const LATE_STAGES = ['model_received', 'prep_done'];

const NEXT_STEP = {
  awaiting_model: 'model_received',
  model_received: 'prep_done',
  prep_done: 'sim_completed',
  in_house_mod: 'modification_done',
};
const STEP_LABELS = {
  model_received: '3D model received',
  prep_done: 'Preparation done',
  sim_completed: 'Simulation completed',
  modification_done: 'Modification done',
};
// The date a step may not precede: steps within a round never go backwards.
const PREVIOUS_DATE = {
  prep_done: 'model_received_date',
  sim_completed: 'prep_done_date',
  modification_done: 'sim_completed_date',
};

const day = (v) => (v ? String(v).slice(0, 10) : null);
const trim = (v) => (v === null || v === undefined ? '' : String(v).trim());

function stageOfRound(round) {
  if (round.result === 'OK' || round.modification === 'Supplier') return 'closed';
  if (round.result === 'Not OK' && round.modification === 'In-house') {
    return round.modification_done_date ? 'closed' : 'in_house_mod';
  }
  if (round.prep_done_date) return 'prep_done';
  if (round.model_received_date) return 'model_received';
  return 'awaiting_model';
}

const blankRound = (round_no, started_from) => ({
  id: null, round_no, started_from, revision_id: null,
  model_received_date: null, model_date_target: null, prep_done_date: null,
  sim_completed_date: null, result: null, fail_reason: null, modification: null,
  supplier_revision_id: null, modification_done_date: null, comments: null,
});

const instant = (v) => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};

// A revision recorded after a round was opened means the design went back
// (the drawer's Revision button, say) while that round was still open. When
// the die returns it waits for a new model, not for the stale round's step.
const supersededBy = (round, latestRevision) => {
  const rev = instant(latestRevision?.created_at);
  const opened = instant(round.created_at);
  return rev !== null && opened !== null && rev > opened;
};

// Rounds as the page shows them. An open round that is not the live one has
// left Simulation some other way (a status change outside this page); it keeps
// its dates but is greyed and counted nowhere.
function deriveRounds({ order, rows, latestRevision = null }) {
  const sorted = [...(rows || [])].sort((a, b) => a.round_no - b.round_no);
  const inSimulation = order.status === 'UNDER SIMULATION';
  const rounds = sorted.map((r) => ({
    ...r,
    model_received_date: day(r.model_received_date),
    prep_done_date: day(r.prep_done_date),
    sim_completed_date: day(r.sim_completed_date),
    modification_done_date: day(r.modification_done_date),
    stage: stageOfRound(r),
  }));
  const last = rounds[rounds.length - 1];

  rounds.forEach((r, i) => {
    if (r.stage === 'closed') return;
    const isLive = i === rounds.length - 1 && inSimulation && !supersededBy(r, latestRevision);
    if (!isLive) {
      r.left_simulation = i === rounds.length - 1 && !inSimulation ? order.status : '';
      r.stage = 'left';
    }
  });

  if (inSimulation && (!last || ['closed', 'left'].includes(last.stage))) {
    const started = !last ? 'initial' : last.modification === 'Supplier' ? 'supplier' : 'reentry';
    const virtual = blankRound((last ? last.round_no : 0) + 1, started);
    // A first-pass die still in Simulation with a 3D date had it typed in by
    // hand -- the old button would have moved it on -- so it is a real receipt.
    // After a revision that column holds an earlier pass's finish date instead.
    if (!last && Number(order.design_revision_count || 0) === 0 && order.three_d_model_received_date) {
      virtual.model_received_date = day(order.three_d_model_received_date);
      virtual.legacy = true;
    }
    virtual.stage = stageOfRound(virtual);
    rounds.push(virtual);
  }
  return rounds;
}

function stageSince(round, order, latestRevision) {
  switch (round.stage) {
    case 'awaiting_model':
      return day(latestRevision?.design_received_date || latestRevision?.revision_date || order.design_received_date);
    case 'model_received': return round.model_received_date;
    case 'prep_done': return round.prep_done_date;
    case 'in_house_mod': return round.sim_completed_date;
    default: return null;
  }
}

// Revision dates are free text, so a malformed one gives no count rather than
// taking the whole page down.
const daysBetween = (from, to, calendar) => {
  if (!strictDate(from) || !strictDate(to)) return null;
  return workingDaysBetween(from, to, calendar);
};

function deriveDie({ order, rows, latestRevision = null, calendar = {}, today }) {
  const rounds = deriveRounds({ order, rows, latestRevision }).map((r) => {
    const model_to_result_days = r.sim_completed_date
      ? daysBetween(r.model_received_date, r.sim_completed_date, calendar) : null;
    let late = false;
    if (r.model_received_date) {
      if (LATE_STAGES.includes(r.stage)) late = daysBetween(r.model_received_date, today, calendar) > TARGET_WORKING_DAYS;
      else if (model_to_result_days !== null && r.stage !== 'left') late = model_to_result_days > TARGET_WORKING_DAYS;
    }
    return { ...r, model_to_result_days, late };
  });
  const current = rounds[rounds.length - 1] || null;
  const stage = current && STAGES.includes(current.stage) ? current.stage : null;
  const since = stage ? stageSince(current, order, latestRevision) : null;
  return {
    order_id: order.id,
    die_no: order.die_no || null,
    order_no: order.order_no || null,
    plant: order.plant || null,
    supplier: order.supplier || null,
    press: order.press || null,
    customer: order.customer_name || null,
    design_revision_count: Number(order.design_revision_count || 0),
    stage,
    stage_label: stage ? STAGE_LABELS[stage] : null,
    round_no: current ? current.round_no : null,
    stage_since: since,
    days_on_stage: since ? daysBetween(since, today, calendar) : null,
    late: Boolean(stage && LATE_STAGES.includes(stage) && current.late),
    rounds,
  };
}

const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

// `today` is an ISO day so the caller decides what today means.
function validateStep(round, input = {}, today) {
  const expected = NEXT_STEP[round.stage];
  const step = trim(input.step);
  if (!expected) return fail('This round has no next step', { stageMismatch: true });
  if (step !== expected) {
    return fail(`This die is at the "${STAGE_LABELS[round.stage]}" stage; the next step is "${STEP_LABELS[expected]}"`, { stageMismatch: true });
  }

  const date = normaliseDate(input.date);
  if (!date) return fail('A valid date is required');
  if (today && date > today) return fail('The date cannot be in the future');
  const previous = PREVIOUS_DATE[step] && round[PREVIOUS_DATE[step]];
  if (previous && date < previous) return fail(`The date cannot be earlier than the previous step (${previous})`);

  const comments = trim(input.comments).slice(0, 2000) || null;
  const value = { step, date, result: null, fail_reason: null, modification: null, comments, revision_notes: null };

  if (step === 'sim_completed') {
    const result = trim(input.result);
    if (!RESULTS.includes(result)) return fail(`Result must be one of: ${RESULTS.join(', ')}`);
    value.result = result;
    if (result === 'Not OK') {
      const reason = trim(input.fail_reason);
      if (!FAIL_REASONS.includes(reason)) return fail('Choose a reason from the list for a Not OK result');
      const modification = trim(input.modification);
      if (!MODIFICATIONS.includes(modification)) return fail('Choose In-house or Supplier modification');
      value.fail_reason = reason;
      value.modification = modification;
      if (modification === 'Supplier') {
        const notes = trim(input.revision_notes).slice(0, 2000);
        if (!notes) return fail('Revision notes are required for a supplier modification');
        value.revision_notes = notes;
      }
    }
  }
  return { ok: true, value };
}

module.exports = {
  STAGES, STAGE_LABELS, FAIL_REASONS, MODIFICATIONS, RESULTS, TARGET_WORKING_DAYS,
  NEXT_STEP, STEP_LABELS, stageOfRound, deriveRounds, deriveDie, validateStep,
};
