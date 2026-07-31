'use strict';

// One row per FOC replacement round.
//
// A QD can loop: the replacement arrives, fails its trial, and the supplier
// promises another. So receipts cannot live as columns on quality_discrepancies
// — round 2 would overwrite round 1 and the history of a repeatedly-bad die,
// which is exactly the evidence a claim rests on, would be lost.
//
// This module knows about rounds only. Status vocabulary stays in
// qualityDiscrepancies.cjs, which requires this one (never the other way round).

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TRIAL_RESULTS = ['Pass', 'Fail'];

const DAY_MS = 24 * 60 * 60 * 1000;
const toDate = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`) : null);

// Signed, unlike the identically-named helper in qualityDiscrepancies.cjs: a
// FOC due next week must read as -7, not clamp to 0, or nothing could ever be
// distinguished from "due today".
const daysBetween = (a, b) => Math.round((b - a) / DAY_MS);

const day = (v) => (v ? String(v).slice(0, 10) : null);

const ROUND_COLS = [
  'id', 'qd_id', 'round_no', 'promised_eta', 'accepted_at',
  'received_date', 'received_by', 'trial_date', 'trial_result', 'trial_notes',
].join(', ');

const byRoundNo = (rounds) => [...(rounds || [])].sort((a, b) => Number(a.round_no) - Number(b.round_no));

function latestRound(rounds) {
  const list = byRoundNo(rounds);
  return list.length ? list[list.length - 1] : null;
}

// The round still in play: the latest one with no trial verdict yet. A round
// that has been trialled is finished, pass or fail — a failed one is answered
// by opening the next round, never by reopening it.
function openRound(rounds) {
  const latest = latestRound(rounds);
  return latest && !latest.trial_result ? latest : null;
}

function nextRoundNo(rounds) {
  return (rounds || []).reduce((max, r) => Math.max(max, Number(r.round_no) || 0), 0) + 1;
}

function roundState(round) {
  if (!round) return 'none';
  if (!round.received_date) return 'awaiting-receipt';
  if (!round.trial_result) return 'awaiting-trial';
  return round.trial_result === 'Pass' ? 'trial-passed' : 'trial-failed';
}

// Everything the UI and the chasers need about one QD's FOC position, derived
// from its rounds alone. `daysOverdue` is signed: negative means still in time.
function focSummary(rounds, now = new Date()) {
  const list = byRoundNo(rounds);
  const latest = list.length ? list[list.length - 1] : null;
  const state = roundState(latest);
  const summary = {
    rounds: list,
    roundCount: list.length,
    state,
    promisedEta: day(latest?.promised_eta),
    receivedDate: day(latest?.received_date),
    trialDate: day(latest?.trial_date),
    trialResult: latest?.trial_result || null,
    daysOverdue: null,
    daysIdle: null,
  };
  if (state === 'awaiting-receipt') {
    const eta = toDate(latest.promised_eta);
    summary.daysOverdue = eta ? daysBetween(eta, now) : null;
  }
  if (state === 'awaiting-trial') {
    const received = toDate(latest.received_date);
    summary.daysIdle = received ? Math.max(0, daysBetween(received, now)) : null;
  }
  return summary;
}

// ── Database operations ────────────────────────────────────────────────────

async function listRounds(client, qdIds) {
  const map = new Map();
  if (!qdIds || !qdIds.length) return map;
  const { rows } = await client.query(
    `SELECT ${ROUND_COLS} FROM qd_foc_rounds WHERE qd_id = ANY($1) ORDER BY qd_id, round_no`,
    [qdIds]
  );
  for (const r of rows) {
    if (!map.has(r.qd_id)) map.set(r.qd_id, []);
    map.get(r.qd_id).push(r);
  }
  return map;
}

async function roundsFor(client, qdId) {
  const { rows } = await client.query(
    `SELECT ${ROUND_COLS} FROM qd_foc_rounds WHERE qd_id = $1 ORDER BY round_no`, [qdId]);
  return rows;
}

// Called when a QD moves to 'FOC Accepted'. The supplier has committed to a
// replacement with an ETA, so a new round starts counting from here.
async function openFocRound(client, { qdId, promisedEta, acceptedAt = null }) {
  if (!promisedEta || !ISO_DATE.test(promisedEta)) {
    throw new Error(`Invalid ETA date: ${promisedEta} (expected YYYY-MM-DD)`);
  }
  const existing = await roundsFor(client, qdId);
  // Re-accepting while a round is still open (e.g. the supplier revises the
  // date) moves that round's ETA rather than starting a phantom second one.
  const open = openRound(existing);
  if (open && !open.received_date) {
    await client.query('UPDATE qd_foc_rounds SET promised_eta = $1 WHERE id = $2', [promisedEta, open.id]);
    return { roundNo: Number(open.round_no), revised: true };
  }
  const roundNo = nextRoundNo(existing);
  await client.query(
    `INSERT INTO qd_foc_rounds (qd_id, round_no, promised_eta, accepted_at)
     VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE))`,
    [qdId, roundNo, promisedEta, acceptedAt]
  );
  return { roundNo, revised: false };
}

// Called when a QD moves to 'FOC Received'. Refuses unless a round is actually
// waiting on a delivery, so 'FOC Received' can never mean "a die arrived
// against nothing".
async function recordReceipt(client, { qdId, receivedDate, receivedBy = null }) {
  if (!receivedDate || !ISO_DATE.test(receivedDate)) {
    throw new Error(`Invalid received date: ${receivedDate} (expected YYYY-MM-DD)`);
  }
  const open = openRound(await roundsFor(client, qdId));
  if (!open) throw new Error('No FOC round is awaiting receipt — accept a FOC first');
  if (open.received_date) throw new Error('This FOC round has already been received');
  await client.query(
    'UPDATE qd_foc_rounds SET received_date = $1, received_by = $2 WHERE id = $3',
    [receivedDate, receivedBy, open.id]
  );
  return { roundNo: Number(open.round_no) };
}

// The trial verdict closes the round. What the QD's status becomes afterwards
// is the user's call (and is recorded with its own reason) — a failed trial
// might mean going back to the supplier, reworking in-house, or giving up.
async function recordTrial(client, { qdId, trialDate, result, notes = null }) {
  if (!TRIAL_RESULTS.includes(result)) {
    throw new Error(`Invalid trial result: ${result} (expected Pass or Fail)`);
  }
  if (!trialDate || !ISO_DATE.test(trialDate)) {
    throw new Error(`Invalid trial date: ${trialDate} (expected YYYY-MM-DD)`);
  }
  const open = openRound(await roundsFor(client, qdId));
  if (!open) throw new Error('No FOC round is awaiting a trial');
  if (!open.received_date) throw new Error('Record the receipt before the trial');
  if (toDate(trialDate) < toDate(open.received_date)) {
    throw new Error(`Trial date ${trialDate} is before the die was received (${day(open.received_date)})`);
  }
  await client.query(
    'UPDATE qd_foc_rounds SET trial_date = $1, trial_result = $2, trial_notes = $3 WHERE id = $4',
    [trialDate, result, notes || null, open.id]
  );
  return { roundNo: Number(open.round_no), result };
}

module.exports = {
  ISO_DATE, TRIAL_RESULTS,
  latestRound, openRound, nextRoundNo, roundState, focSummary,
  listRounds, roundsFor, openFocRound, recordReceipt, recordTrial,
};
