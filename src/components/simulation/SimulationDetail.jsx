import React from 'react';
import { Undo2 } from 'lucide-react';
import StepForm from './StepForm';
import { formatDate } from '../../utils/helpers';
import { STATUS_CONFIG } from '../../utils/constants';
import { TARGET_WORKING_DAYS, plural } from '../../utils/simulationView';

const orDash = (value) => (value === null || value === undefined || value === '' ? '—' : value);
const LIVE = ['awaiting_model', 'model_received', 'prep_done', 'in_house_mod'];

// Four boxes per round. The live round marks the step it is waiting on; an
// in-house round never waited for a supplier model, so its first box is the
// modified model, drawn dashed.
function roundSteps(round) {
  const live = LIVE.includes(round.stage);
  const inHouseModel = round.started_from === 'in_house';
  const resultText = round.result === 'OK' ? 'OK'
    : round.result === 'Not OK' ? `Not OK · ${round.modification}` : 'Result';
  const steps = [
    { label: inHouseModel ? 'In-house model' : '3D model', date: round.model_received_date, skipped: inHouseModel },
    { label: 'Preparation', date: round.prep_done_date },
    { label: 'Simulation', date: round.sim_completed_date },
    {
      label: resultText,
      date: round.modification === 'In-house' ? round.modification_done_date : null,
      done: Boolean(round.result) && (round.modification !== 'In-house' || Boolean(round.modification_done_date)),
    },
  ];
  const currentIndex = live ? steps.findIndex(s => !(s.done ?? Boolean(s.date))) : -1;
  return steps.map((s, i) => ({
    ...s,
    state: s.skipped && s.date ? 'skipped' : (s.done ?? Boolean(s.date)) ? 'done' : i === currentIndex ? 'current' : 'todo',
  }));
}

function Round({ round }) {
  const live = LIVE.includes(round.stage);
  const left = round.stage === 'left';
  const steps = roundSteps(round);
  return (
    <li className={`sim-round${live ? ' is-open' : ''}${left ? ' is-left' : ''}`}>
      <div className="sim-round-head">
        <span className="sim-round-title">Round {round.round_no}{round.started_from === 'supplier' ? ' · after supplier revision' : ''}</span>
        {round.result && (
          <span className={`sim-round-result ${round.result === 'OK' ? 'is-ok' : 'is-bad'}`}>
            {round.result === 'OK' ? 'OK' : `Not OK — ${round.fail_reason}`}
          </span>
        )}
        {live && !round.result && <span className="sim-round-result sf-dim">In progress</span>}
      </div>
      <ol className="sim-steps">
        {steps.map(step => (
          <li key={step.label} className={`sim-step is-${step.state}${step.state === 'current' && round.late ? ' is-late' : ''}`}>
            <span className="sim-step-label">{step.label}</span>
            <span className="sim-step-date">{step.date ? formatDate(step.date) : step.state === 'current' ? 'Waiting' : '—'}</span>
          </li>
        ))}
      </ol>
      {round.model_to_result_days !== null && round.model_to_result_days !== undefined && (
        <p className={`sim-round-note${round.late ? ' sf-danger' : ''}`}>
          {plural(round.model_to_result_days, 'working day')} from model to result · target {TARGET_WORKING_DAYS}
        </p>
      )}
      {round.comments && <p className="sim-round-note">{round.comments}</p>}
      {left && (
        <p className="sim-round-note">
          Left Simulation{round.left_simulation ? ` (status changed to ${STATUS_CONFIG[round.left_simulation]?.label || round.left_simulation})` : ''}
        </p>
      )}
      {round.legacy && <p className="sim-round-note">3D model date taken from the order (recorded before step tracking).</p>}
    </li>
  );
}

export default function SimulationDetail({ die, user, busy, onStep, onUndo, onOpenOrder }) {
  const facts = [
    ['Order', die.order_no], ['Plant', die.plant], ['Supplier', die.supplier],
    ['Press', die.press], ['Customer', die.customer], ['Revisions', die.design_revision_count],
  ];
  const daysNote = die.days_on_stage === null ? 'Start date missing'
    : `${plural(die.days_on_stage, 'working day')} at this stage`;

  return (
    <article className="sf-card sf-pane" aria-labelledby="sim-pane-die">
      <header className="sf-pane-head">
        <div className="sf-pane-title">
          <div className="sf-pane-die">
            <h2 id="sim-pane-die">{die.die_no || die.order_no || 'Untitled die'}</h2>
            <span className={`sf-pill ${die.late ? 'sf-pill-bad' : 'sf-pill-neutral'}`}>{die.stage_label}</span>
          </div>
          <p>Round {die.round_no} · {daysNote}{die.late ? ` · past the ${TARGET_WORKING_DAYS}-day target` : ''}</p>
        </div>
        <div className="sf-pane-actions">
          <button type="button" className="sf-button sf-button-sm" onClick={onOpenOrder}>Open order</button>
        </div>
      </header>

      <div className="sf-pane-body">
        <dl className="sf-facts">
          {facts.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{orDash(value)}</dd></div>)}
        </dl>

        <ol className="sim-rounds" aria-label="Simulation rounds">
          {die.rounds.map(round => <Round key={`${round.round_no}:${round.id ?? 'virtual'}`} round={round} />)}
        </ol>

        <StepForm key={`${die.order_id}:${die.round_no}:${die.stage}`} die={die} busy={busy} onSubmit={onStep} />

        {user?.role === 'admin' && die.rounds.some(r => r.id !== null) && (
          <details className="sf-record-actions">
            <summary>Record actions</summary>
            <button type="button" className="sf-text-button sf-danger" disabled={busy} onClick={onUndo}>
              <Undo2 size={14} />Undo last step
            </button>
          </details>
        )}
      </div>
    </article>
  );
}
