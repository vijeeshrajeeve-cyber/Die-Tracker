import React, { useState } from 'react';
import { todayLocal } from '../../utils/today';
import { SIMULATION_FAIL_REASONS, SIMULATION_MODIFICATIONS } from '../../utils/constants';

const STEP_FOR_STAGE = {
  awaiting_model: { step: 'model_received', label: '3D model received' },
  model_received: { step: 'prep_done', label: 'Preparation done' },
  prep_done: { step: 'sim_completed', label: 'Simulation completed' },
  in_house_mod: { step: 'modification_done', label: 'Modification done' },
};

// The open round's next step. Controlled inputs throughout, so a saved step
// that changes the die re-renders the form with the right date and fields.
export default function StepForm({ die, busy, onSubmit }) {
  const today = todayLocal();
  const next = STEP_FOR_STAGE[die.stage];
  const [date, setDate] = useState(today);
  const [result, setResult] = useState('');
  const [reason, setReason] = useState('');
  const [modification, setModification] = useState('');
  const [comments, setComments] = useState('');
  const [notes, setNotes] = useState('');
  const [notesTouched, setNotesTouched] = useState(false);
  if (!next) return null;

  const completing = next.step === 'sim_completed';
  const supplier = completing && result === 'Not OK' && modification === 'Supplier';
  // Revision notes start from the reason and comment, editable before saving.
  const suggestedNotes = [reason, comments.trim()].filter(Boolean).join(': ');
  const revisionNotes = notesTouched ? notes : suggestedNotes;

  const ready = Boolean(date) && (!completing || (result === 'OK'
    || (result === 'Not OK' && reason && modification && (!supplier || revisionNotes.trim()))));

  const submit = (event) => {
    event.preventDefault();
    if (!ready) return;
    onSubmit({
      step: next.step, date,
      ...(completing && { result, fail_reason: reason || null, modification: modification || null, comments }),
      ...(supplier && { revision_notes: revisionNotes }),
    });
  };

  const choose = (setter, value) => () => setter(value);

  return (
    <form className="sim-step-form" onSubmit={submit} aria-label={`Record ${next.label}`}>
      <div className="sf-form-grid">
        <div className="sf-field">
          <label htmlFor="sim-step-date">{next.label} on</label>
          <input id="sim-step-date" type="date" value={date} max={today} required onChange={e => setDate(e.target.value)} />
        </div>
        {completing && (
          <div className="sf-field">
            <label id="sim-result-label">Result</label>
            <div className="sim-choice" role="group" aria-labelledby="sim-result-label">
              {['OK', 'Not OK'].map(r => (
                <button key={r} type="button" className="sf-button sf-button-sm" aria-pressed={result === r} onClick={choose(setResult, r)}>{r}</button>
              ))}
            </div>
          </div>
        )}
        {completing && result === 'Not OK' && (
          <>
            <div className="sf-field">
              <label htmlFor="sim-reason">Reason</label>
              <select id="sim-reason" value={reason} onChange={e => setReason(e.target.value)}>
                <option value="">Select a reason…</option>
                {SIMULATION_FAIL_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="sf-field">
              <label id="sim-mod-label">Modification</label>
              <div className="sim-choice" role="group" aria-labelledby="sim-mod-label">
                {SIMULATION_MODIFICATIONS.map(m => (
                  <button key={m} type="button" className="sf-button sf-button-sm" aria-pressed={modification === m} onClick={choose(setModification, m)}>{m}</button>
                ))}
              </div>
            </div>
          </>
        )}
        {completing && (
          <div className="sf-field sf-full-width">
            <label htmlFor="sim-comments">Comments</label>
            <textarea id="sim-comments" rows={2} value={comments} maxLength={2000} onChange={e => setComments(e.target.value)} />
          </div>
        )}
        {supplier && (
          <div className="sf-field sf-full-width">
            <label htmlFor="sim-rev-notes">Revision notes for the supplier</label>
            <textarea id="sim-rev-notes" rows={2} value={revisionNotes} maxLength={2000}
              onChange={e => { setNotesTouched(true); setNotes(e.target.value); }} />
            <p className="sf-form-hint sf-dim">Sends the design back to Awaiting Design as a new revision.</p>
          </div>
        )}
      </div>
      <button type="submit" className="sf-button sf-button-pane sf-button-accent" disabled={busy || !ready}>
        {busy ? 'Saving…' : `Record ${next.label.toLowerCase()}`}
      </button>
    </form>
  );
}
