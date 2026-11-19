import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarCheck, ChevronLeft, ChevronRight, Download, FileText, Lock, Plus, Search, Send, Trash2, X,
} from 'lucide-react';
import { trialPlansAPI, toolingsAPI } from '../../api';
import { dialogs } from '../ui/DialogProvider';
import CorrectorSelect from '../ui/CorrectorSelect';
import { isEnhancementOrder } from '../DieAttentionLabels';
import { exportToExcel } from '../../utils/exportExcel';
import { validateTrialNumbers } from '../../utils/enhancementVerdict';
import {
  addDays, formatPlanDate, formatShortDate, relativeDayLabel, dieKey, availableToPlan, searchSamples,
  isWaitingForTrial, needsOutOfQueueReason, entryFromSample, editableFields, groupByPress, pressNote,
  toolingClashNotes, checkSentence, resultOf, showPct, plural, planExportRows, TRIAL_PLANTS, carryNote, carryTarget, ordinalDate,
} from '../../utils/trialPlanView';

// Shown until /meta answers, and if it never does.
const FALLBACK_META = {
  entryTypes: ['Trial', 'Supervised'],
  failReasons: [],
  outOfQueueReasons: ['Re-trial after correction', 'Customer feedback', 'Design enhancement', 'Other'],
  resultGraceDays: 1,
  plants: TRIAL_PLANTS,
  notRunReasons: ['Alloy shortage', 'Press breakdown', 'Die not ready', 'Production priority / no time', 'Other'],
};

const toast = (setToast, message, type = 'success') => {
  setToast({ message, type });
  setTimeout(() => setToast(null), type === 'error' ? 5000 : 3000);
};

// The tooling numbers and last alloy for a die, for pre-filling a new entry.
// Either lookup failing just leaves that field blank to type in.
async function prefillFor(die, plant) {
  const [toolings, alloy] = await Promise.all([
    toolingsAPI.forDie(die, plant).then(r => (r.links || []).map(l => l.tooling_number)).catch(() => []),
    trialPlansAPI.lastAlloy(die).then(r => r.alloy).catch(() => null),
  ]);
  return { toolings: [...new Set(toolings.filter(Boolean))], alloy };
}

function DateBar({ date, today, defaultDate, onChange, viewSwitch, plants, plant, onPlant }) {
  return (
    <div className="tp-toolbar">
      {viewSwitch}
      <div className="sf-segmented" role="group" aria-label="Plant">
        {plants.map(p => (
          <button key={p} type="button" aria-pressed={plant === p} onClick={() => onPlant(p)}>{p}</button>
        ))}
      </div>
      <div className="tp-datebar">
        <button type="button" className="tp-day-step" aria-label="Previous day" onClick={() => onChange(addDays(date, -1))}><ChevronLeft size={16} /></button>
        <label className="tp-date-input">
          <span className="sf-visually-hidden">Plan date</span>
          <CalendarCheck size={15} aria-hidden="true" />
          <span className="tp-date-text" aria-hidden="true">{formatPlanDate(date)}</span>
          <input type="date" aria-label="Plan date" value={date} onChange={e => e.target.value && onChange(e.target.value)} />
        </label>
        <button type="button" className="tp-day-step" aria-label="Next day" onClick={() => onChange(addDays(date, 1))}><ChevronRight size={16} /></button>
      </div>
      <span className={`tp-day-chip${date === defaultDate ? ' is-default' : ''}`}>{relativeDayLabel(date, today)}</span>
      {date !== defaultDate && (
        <button type="button" className="sf-button sf-button-tint" onClick={() => onChange(defaultDate)}>Back to tomorrow's plan</button>
      )}
    </div>
  );
}

function Stat({ label, value, note, tone }) {
  return (
    <div className={`tp-stat tp-tone-${tone}`}>
      <p className="tp-stat-label">{label}</p>
      <p className="sf-big-num tp-stat-num">{value}</p>
      {note && <p className="tp-stat-note">{note}</p>}
    </div>
  );
}

export function TrialSummaryStrip({ summary, title = 'Summary of trial' }) {
  const t = summary.trials;
  const s = summary.supervised;
  return (
    <section className="sf-card tp-summary-strip" aria-label={title}>
      <h2 className="sf-card-label">{title}</h2>
      <div className="tp-stats">
        <Stat label="Planned" value={t.planned} note={plural(t.planned, 'trial')} tone="accent" />
        <Stat label="Done" value={t.done} note={`of ${t.planned} run`} tone="blue" />
        <Stat label="OK" value={t.ok} note="passed" tone="ok" />
        <Stat label="Not OK" value={t.notOk} note={summary.failReasons.map(f => f.reason).join(', ').toLowerCase() || 'none'} tone="bad" />
        <Stat label="Not run" value={t.notRun} note={t.awaiting ? `${t.awaiting} awaiting a result` : 'carried over'} tone="muted" />
        <Stat label="Run ratio" value={showPct(t.runRatio)} note="done / planned" tone="muted" />
        <Stat label="Fail ratio" value={showPct(t.failRatio)} note="not OK / done" tone="muted" />
        <Stat label="Supervised" value={s.done} note={`of ${s.planned} run`} tone="warn" />
      </div>
    </section>
  );
}

// "Add another die": any die, in any stage, or one with no record at all.
function AddDiePanel({ samples, entries, meta, defaultType, busy, onAdd, onClose }) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null); // a sample, or { free: 'DIE-NO' }
  const [entryType, setEntryType] = useState(defaultType);
  const [urgent, setUrgent] = useState(false);
  const [reason, setReason] = useState('');
  const matches = useMemo(() => searchSamples(samples, query, entries), [samples, query, entries]);
  const sample = picked && !picked.free ? picked : null;
  const reasonNeeded = picked ? needsOutOfQueueReason(sample, entryType) : false;
  const typed = query.trim();
  const alreadyPlanned = typed && entries.some(e => dieKey(e.die_no) === dieKey(typed));

  const submit = (event) => {
    event.preventDefault();
    if (!picked || (reasonNeeded && !reason)) return;
    onAdd({ sample, freeDie: picked.free || null, entryType, urgent, reason: reasonNeeded ? reason : (reason || null) });
  };

  return (
    <form className="tp-add-panel" onSubmit={submit} aria-label="Add another die">
      <div className="tp-add-head">
        <h3>{entryType === 'Supervised' ? 'Add a supervised run' : 'Add another die'}</h3>
        <button type="button" className="sf-icon-button" aria-label="Close" onClick={onClose}><X size={16} /></button>
      </div>
      {!picked ? (
        <>
          <label className="tp-search">
            <Search size={15} aria-hidden="true" />
            <span className="sf-visually-hidden">Die number or customer</span>
            <input autoFocus value={query} placeholder="Die number or customer" onChange={e => setQuery(e.target.value)} />
          </label>
          <ul className="tp-search-results">
            {matches.map(s => (
              <li key={s.id}>
                <button type="button" onClick={() => setPicked(s)}>
                  <span className="sf-mono tp-die">{s.die}</span>
                  <span className="tp-meta">{[s.status, s.press, s.customer].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))}
            {typed && !alreadyPlanned && !matches.some(s => dieKey(s.die) === dieKey(typed)) && (
              <li>
                <button type="button" onClick={() => setPicked({ free: typed })}>
                  <span className="sf-mono tp-die">{typed}</span>
                  <span className="tp-meta">Not in Sample Followup · plan it without a die record</span>
                </button>
              </li>
            )}
            {alreadyPlanned && <li className="tp-meta tp-search-note">{typed} is already on this plan.</li>}
          </ul>
        </>
      ) : (
        <>
          <div className="tp-picked">
            <span className="sf-mono tp-die">{sample ? sample.die : picked.free}</span>
            <span className="tp-meta">{sample ? [sample.status, sample.press, sample.customer].filter(Boolean).join(' · ') : 'No die record. Nothing is written to a trial log.'}</span>
            <button type="button" className="sf-text-button" onClick={() => { setPicked(null); setReason(''); }}>Change</button>
          </div>
          <div className="tp-add-fields">
            <label>
              <span>Type</span>
              <select value={entryType} onChange={e => setEntryType(e.target.value)}>
                {meta.entryTypes.map(t => <option key={t} value={t}>{t === 'Supervised' ? 'Supervised · day shift' : t}</option>)}
              </select>
            </label>
            <label>
              <span>Reason{reasonNeeded ? ' *' : ''}</span>
              <select value={reason} required={reasonNeeded} onChange={e => setReason(e.target.value)}>
                <option value="">{reasonNeeded ? '— choose why —' : '— none —'}</option>
                {meta.outOfQueueReasons.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="tp-check">
              <input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} />
              <span>Urgent</span>
            </label>
          </div>
          {reasonNeeded && (
            <p className="tp-hint">This die is not waiting for trial, so the plan prints why it is on it. Planning it does not change its sample status.</p>
          )}
          <div className="tp-add-actions">
            <button type="submit" className="sf-button sf-button-accent" disabled={busy || (reasonNeeded && !reason)}><Plus size={14} />Add to plan</button>
          </div>
        </>
      )}
    </form>
  );
}

// One editable text cell: saved when it is left, if it changed. Uncontrolled
// and keyed on the saved value, so a reload replaces what is shown.
function CellInput({ entry, field, label, disabled, onSave, mono = false }) {
  const saved = entry[field] || '';
  return (
    <input
      key={`${entry.id}:${saved}`}
      className={`tp-cell-input${mono ? ' sf-mono' : ''}`}
      aria-label={`${label} for ${entry.die_no}`}
      defaultValue={saved}
      disabled={disabled}
      onBlur={e => { const next = e.target.value.trim(); if (next !== saved) onSave(entry, { [field]: next }); }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

function PlanTable({ entries, checks, meta, correctors, correctorsError, busy, onSave, onRemove }) {
  const groups = groupByPress(entries);
  const clashes = toolingClashNotes(entries, checks);
  return (
    <div className="tp-table-scroll">
      <table className="tp-table tp-plan-table">
        <thead>
          <tr>
            <th>Die</th><th>Customer</th><th>Type</th><th>Alloy</th><th>Tooling</th><th>Corrector</th><th>Press</th><th><span className="sf-visually-hidden">Remove</span></th>
          </tr>
        </thead>
        {groups.map(group => (
          <tbody key={group.press}>
            <tr className="tp-press-row"><th colSpan={8} scope="rowgroup">{group.press} <span className="sf-mono">{pressNote(group)}</span></th></tr>
            {group.rows.map(entry => (
              <tr key={entry.id}>
                <td>
                  <div className="tp-die-cell">
                    <span className="sf-mono tp-die">{entry.die_no}</span>
                    <button type="button" className={`tp-urgent-toggle${entry.urgent ? ' is-on' : ''}`} aria-pressed={Boolean(entry.urgent)}
                      disabled={busy} onClick={() => onSave(entry, { urgent: !entry.urgent })}>
                      {entry.urgent ? 'Urgent' : 'Mark urgent'}
                    </button>
                  </div>
                  {carryNote(entry) && <span className="tp-carry-tag">{carryNote(entry)}</span>}
                  {entry.out_of_queue_reason && <span className="tp-reason-tag">{entry.out_of_queue_reason}</span>}
                </td>
                <td><CellInput entry={entry} field="customer" label="Customer" disabled={busy} onSave={onSave} /></td>
                <td>
                  <select className={`tp-type-select tp-type-${entry.entry_type === 'Supervised' ? 'sup' : 'trial'}`} aria-label={`Type for ${entry.die_no}`}
                    value={entry.entry_type} disabled={busy} onChange={e => onSave(entry, { entry_type: e.target.value })}>
                    {meta.entryTypes.map(t => <option key={t} value={t}>{t === 'Supervised' ? 'Supervised · day shift' : t}</option>)}
                  </select>
                </td>
                <td><CellInput entry={entry} field="alloy" label="Alloy" mono disabled={busy} onSave={onSave} /></td>
                <td>
                  <CellInput entry={entry} field="tooling" label="Tooling" mono disabled={busy} onSave={onSave} />
                  {clashes.has(entry.die_no) && <span className="tp-clash">{clashes.get(entry.die_no)}</span>}
                </td>
                <td>
                  <CorrectorSelect id={`tp-corrector-${entry.id}`} ariaLabel={`Corrector for ${entry.die_no}`} value={entry.corrector || ''} plant={entry.plant}
                    correctors={correctors} loadError={correctorsError} disabled={busy}
                    onChange={value => onSave(entry, { corrector: value })} style={{ width: '100%' }} />
                </td>
                <td><CellInput entry={entry} field="press" label="Press" disabled={busy} onSave={onSave} /></td>
                <td>
                  <button type="button" className="sf-icon-button" aria-label={`Remove ${entry.die_no} from the plan`} disabled={busy || Boolean(entry.outcome)}
                    title={entry.outcome ? 'This die has a result and stays on the plan' : 'Remove from the plan'} onClick={() => onRemove(entry)}>
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function ReadOnlyTable({ entries }) {
  return (
    <div className="tp-table-scroll">
      <table className="tp-table">
        <thead>
          <tr><th>Press</th><th>Die</th><th>Customer</th><th>Type</th><th>Alloy</th><th>Tooling</th><th>Corrector</th><th>Result</th></tr>
        </thead>
        <tbody>
          {groupByPress(entries).flatMap(group => group.rows.map(entry => {
            const result = resultOf(entry);
            const sup = entry.entry_type === 'Supervised';
            return (
              <tr key={entry.id}>
                <td>{group.press}</td>
                <td>
                  <span className="sf-mono tp-die">{entry.die_no}</span>
                  {entry.urgent && <span className="tp-urgent-chip">Urgent</span>}
                  {carryNote(entry) && <span className="tp-carry-tag">{carryNote(entry)}</span>}
                  {entry.out_of_queue_reason && <span className="tp-reason-tag">{entry.out_of_queue_reason}</span>}
                </td>
                <td>{entry.customer || '—'}</td>
                <td className={sup ? 'tp-type-text-sup' : 'tp-type-text-trial'}>{entry.entry_type}</td>
                <td className="sf-mono">{entry.alloy || '—'}</td>
                <td className="sf-mono">{entry.tooling || '—'}</td>
                <td>{entry.corrector || '—'}</td>
                <td>
                  <span className={`sf-pill tp-result tp-result-${result.tone}`}>{result.tone === 'waiting' ? 'No result recorded' : result.label}</span>
                  {entry.comments && <span className="tp-comment" title={entry.comments}>{entry.comments}</span>}
                </td>
              </tr>
            );
          }))}
        </tbody>
      </table>
    </div>
  );
}

// The supervisor's form for one entry.
function ResultPanel({ entry, sample, meta, trialsForDie, enhanced, busy, onSave, onCancel, plant, planDate, today }) {
  const supervised = entry.entry_type === 'Supervised';
  const [form, setForm] = useState({
    outcome: entry.outcome || entry._preset || 'OK',
    fail_reason: entry.fail_reason || '',
    not_run_reason: entry.not_run_reason || '',
    comments: entry.comments || '',
    productivity_kgh: '',
    recovery_pct: '',
  });
  const [error, setError] = useState('');
  const linked = Boolean(entry.die_order_id || entry.sample_followup_id);
  const writesLog = !supervised && linked && form.outcome !== 'Not run';
  const loggedTrial = entry.sample_trial_id ? trialsForDie.find(t => t.id === entry.sample_trial_id) : null;
  const trialNo = loggedTrial ? loggedTrial.trial_no : trialsForDie.length + 1;
  const approved = sample?.stage === 'Approved';

  const save = (event) => {
    event.preventDefault();
    setError('');
    if (form.outcome === 'Not OK' && !supervised && !form.fail_reason) { setError('Choose why the trial was not OK.'); return; }
    if (form.outcome === 'Not OK' && supervised && !form.comments.trim()) { setError('Describe what went wrong on the supervised run.'); return; }
    if (form.outcome === 'Not run' && !form.not_run_reason) { setError('Choose why the die did not run.'); return; }
    if (form.outcome === 'Not run' && form.not_run_reason === 'Other' && !form.comments.trim()) { setError('Describe why the die did not run.'); return; }
    const body = { outcome: form.outcome, comments: form.comments };
    if (form.outcome === 'Not OK' && !supervised) body.fail_reason = form.fail_reason;
    if (form.outcome === 'Not run') body.not_run_reason = form.not_run_reason;
    if (enhanced && writesLog) {
      const checked = validateTrialNumbers({ productivity: form.productivity_kgh, recovery: form.recovery_pct, required: form.outcome === 'OK', result: form.outcome });
      if (!checked.ok) { setError(Object.values(checked.errors)[0]); return; }
      body.productivity_kgh = checked.value.productivity_kgh;
      body.recovery_pct = checked.value.recovery_pct;
    }
    onSave(entry, body);
  };

  return (
    <form className="sf-card tp-result-panel" onSubmit={save} aria-labelledby="tp-result-title">
      <header className="tp-result-head">
        <div>
          <h2 id="tp-result-title" className="sf-mono">{entry.die_no}</h2>
          <p>{[entry.customer, entry.press, entry.alloy, entry.tooling, entry.corrector, `${entry.urgent ? 'urgent ' : ''}${supervised ? 'supervised run' : 'trial'}`].filter(Boolean).join(' · ')}</p>
        </div>
        <button type="button" className="sf-icon-button" aria-label="Close" onClick={onCancel}><X size={18} /></button>
      </header>
      <div className="tp-result-body">
        <div>
          <p className="tp-field-label" id="tp-outcome-label">Result</p>
          <div className="tp-outcome-group" role="radiogroup" aria-labelledby="tp-outcome-label">
            {['OK', 'Not OK', 'Not run'].map(o => (
              <button type="button" role="radio" key={o} aria-checked={form.outcome === o} className={`tp-outcome tp-outcome-${o.replace(' ', '-').toLowerCase()}`}
                onClick={() => setForm({ ...form, outcome: o })}>{supervised && o === 'OK' ? 'Run OK' : o}</button>
            ))}
          </div>
        </div>
        {form.outcome === 'Not OK' && !supervised && (
          <label className="tp-field">
            <span className="tp-field-label">Reason *</span>
            <select value={form.fail_reason} onChange={e => setForm({ ...form, fail_reason: e.target.value })}>
              <option value="">— choose a reason —</option>
              {meta.failReasons.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
        {form.outcome === 'Not run' && (
          <label className="tp-field">
            <span className="tp-field-label">Why it did not run *</span>
            <select value={form.not_run_reason} onChange={e => setForm({ ...form, not_run_reason: e.target.value })}>
              <option value="">— choose a reason —</option>
              {meta.notRunReasons.map(r => <option key={r} value={r}>{r === 'Other' ? 'Other (describe below)' : r}</option>)}
            </select>
          </label>
        )}
        {enhanced && writesLog && (
          <div className="tp-two-cols">
            <label className="tp-field">
              <span className="tp-field-label">Productivity (kg/h){form.outcome === 'OK' ? ' *' : ''}</span>
              <input inputMode="decimal" value={form.productivity_kgh} placeholder="not recorded" onChange={e => setForm({ ...form, productivity_kgh: e.target.value })} />
            </label>
            <label className="tp-field">
              <span className="tp-field-label">Recovery (%){form.outcome === 'OK' ? ' *' : ''}</span>
              <input inputMode="decimal" value={form.recovery_pct} placeholder="not recorded" onChange={e => setForm({ ...form, recovery_pct: e.target.value })} />
            </label>
          </div>
        )}
        <label className="tp-field">
          <span className="tp-field-label">Comments{(form.outcome === 'Not OK' && supervised) || (form.outcome === 'Not run' && form.not_run_reason === 'Other') ? ' *' : ''}</span>
          <textarea rows={3} value={form.comments}
            placeholder={form.outcome === 'Not run' ? 'Why it did not run' : 'What was seen at the press'}
            onChange={e => setForm({ ...form, comments: e.target.value })} />
        </label>
        <div className="tp-after-save">
          <p className="tp-after-title">After saving</p>
          {form.outcome === 'Not run' && (
            <p className="tp-carry-note">
              Carried over: added to the {plant} plan for {formatPlanDate(carryTarget(planDate, today))} as urgent,
              marked &ldquo;Carry over from {ordinalDate(planDate)}{form.not_run_reason ? ` because of ${form.not_run_reason === 'Other' ? (form.comments.trim() || '…') : form.not_run_reason}` : ''}&rdquo;.
            </p>
          )}
          <p>
            {supervised ? 'A supervised run is a production run, not a trial, so nothing is written to the trial log.'
              : !linked ? 'This die has no record in Sample Followup, so the result stays on the plan only.'
                : form.outcome === 'Not run' ? "The die's trial log is not touched and the sample status does not change."
                  : `${loggedTrial ? 'Updates' : 'Saved as'} trial ${trialNo} in the die's trial log, dated the plan day.${form.outcome === 'Not OK' && isWaitingForTrial(sample) ? ' The die stays waiting for trial and is offered for the next plan after correction.' : ''} The sample status does not change.`}
          </p>
          {approved && form.outcome === 'Not OK' && !supervised && (
            <p className="tp-approved-warn">This die is already Approved. Decide whether to reopen the sample or raise a QD; neither happens automatically.</p>
          )}
        </div>
        {error && <p className="tp-error" role="alert">{error}</p>}
        <div className="tp-result-actions">
          <button type="button" className="sf-button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="sf-button sf-button-accent" disabled={busy}>Save result</button>
        </div>
      </div>
    </form>
  );
}

function ResultsList({ entries, selectedId, canRecord, onPick }) {
  return groupByPress(entries).map(group => (
    <div key={group.press} role="group" aria-label={group.press}>
      <div className="tp-press-band">{group.press}</div>
      {group.rows.map(entry => {
        const result = resultOf(entry);
        const sup = entry.entry_type === 'Supervised';
        const selected = selectedId === entry.id;
        return (
          <div key={entry.id} className={`tp-result-row${selected ? ' is-selected' : ''}`}>
            <div className="tp-result-main">
              <span className="sf-mono tp-die">{entry.die_no}{entry.urgent && <span className="tp-urgent-chip">Urgent</span>}</span>
              <span className="tp-meta">{[entry.customer, entry.alloy, entry.tooling, entry.corrector].filter(Boolean).join(' · ') || 'No details'}</span>
              {carryNote(entry) && <span className="tp-carry-tag">{carryNote(entry)}</span>}
            </div>
            {sup && <span className="sf-pill tp-sup-pill">Supervised</span>}
            <div className="tp-result-side">
              {selected ? <span className="tp-recording">Recording…</span>
                : entry.outcome ? (
                  <>
                    <span className={`sf-pill tp-result tp-result-${result.tone}`}>{result.label}</span>
                    {canRecord && <button type="button" className="sf-text-button" onClick={() => onPick(entry)}>Change</button>}
                  </>
                ) : canRecord ? (
                  <>
                    <button type="button" className="tp-quick tp-quick-ok" onClick={() => onPick(entry, 'OK')}>{sup ? 'Run OK' : 'OK'}</button>
                    <button type="button" className="tp-quick tp-quick-bad" onClick={() => onPick(entry, 'Not OK')}>Not OK</button>
                    <button type="button" className="tp-quick" onClick={() => onPick(entry, 'Not run')}>Not run</button>
                  </>
                ) : <span className={`sf-pill tp-result tp-result-${result.tone}`}>{result.label}</span>}
            </div>
          </div>
        );
      })}
    </div>
  ));
}

export default function TrialPlanTab({
  date, setDate, plant, setPlant, today, viewSwitch, samples, sampleTrials,
  correctors, correctorsError, setToast, onTrialsChanged,
}) {
  const [meta, setMeta] = useState(FALLBACK_META);
  const [defaultDate, setDefaultDate] = useState(addDays(today, 1));
  // Each answer is kept with the day and plant it is for, so a slow answer for
  // another day or plant is never shown under the one now picked.
  const [loaded, setLoaded] = useState({ key: null });
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null); // 'plan' | 'results', when both are possible
  const [adding, setAdding] = useState(null); // 'Trial' | 'Supervised'
  const [picked, setPicked] = useState(null); // entry id being recorded
  const [preset, setPreset] = useState(null);
  const request = useRef(0);

  const planDate = date || defaultDate;
  const planKey = `${planDate}|${plant}`;

  useEffect(() => {
    trialPlansAPI.meta().then(m => {
      setMeta({ ...FALLBACK_META, ...m });
      setDefaultDate(m.defaultPlanDate);
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const mine = ++request.current;
    try {
      const next = await trialPlansAPI.get(planDate, plant);
      if (mine === request.current) setLoaded({ key: `${planDate}|${plant}`, view: next });
    } catch (error) {
      if (mine === request.current) setLoaded({ key: `${planDate}|${plant}`, error: error.message || 'Could not load the plan' });
    }
  }, [planDate, plant]);

  useEffect(() => { load(); }, [load]);

  const view = loaded.key === planKey ? loaded.view || null : null;
  const loadError = loaded.key === planKey ? loaded.error || '' : '';

  const reset = () => {
    setPicked(null);
    setAdding(null);
    setMode(null);
  };
  const changeDate = (next) => { reset(); setDate(next); };
  const changePlant = (next) => { reset(); setPlant(next); };

  const entries = useMemo(() => view?.entries || [], [view]);
  const plan = view?.plan || null;
  const state = view?.state || { planEditable: false, resultsOpen: false, locked: false };
  const published = plan?.status === 'published';
  const canEditPlan = state.planEditable;
  const canRecord = state.resultsOpen && published;
  const activeMode = canEditPlan && canRecord ? (mode || 'results') : canEditPlan ? 'plan' : 'results';

  const sampleByEntry = useMemo(() => {
    const byOrder = new Map();
    const bySf = new Map();
    const byDie = new Map();
    for (const s of samples) {
      if (s._source === 'order' && s._order?.id) byOrder.set(s._order.id, s);
      if (s._source === 'standalone' && s._raw?.id) bySf.set(s._raw.id, s);
      if (s.die) byDie.set(dieKey(s.die), s);
    }
    return (entry) => (entry.die_order_id && byOrder.get(entry.die_order_id))
      || (entry.sample_followup_id && bySf.get(entry.sample_followup_id))
      || byDie.get(dieKey(entry.die_no)) || null;
  }, [samples]);

  const trialsOf = useCallback((entry) => (sampleTrials || [])
    .filter(t => (entry.die_order_id && t.die_order_id === entry.die_order_id)
      || (entry.sample_followup_id && t.sample_followup_id === entry.sample_followup_id))
    .sort((a, b) => a.trial_no - b.trial_no), [sampleTrials]);

  const run = async (work, success) => {
    setBusy(true);
    try {
      const out = await work();
      if (success) toast(setToast, typeof success === 'function' ? success(out) : success);
      await load();
      return out;
    } catch (error) {
      toast(setToast, error.message || 'Something went wrong', 'error');
      await load();
      return null;
    } finally {
      setBusy(false);
    }
  };

  const addFromSample = async (sample, { entryType = 'Trial', urgent = false, reason = null } = {}) => run(async () => {
    const prefill = await prefillFor(sample.die, sample.plant);
    return trialPlansAPI.addEntry(planDate, plant, entryFromSample(sample, { ...prefill, entryType, urgent, reason }));
  }, `${sample.die} added to the plan`);

  const addOther = async ({ sample, freeDie, entryType, urgent, reason }) => {
    if (sample) {
      const out = await addFromSample(sample, { entryType, urgent, reason });
      if (out) setAdding(null);
      return;
    }
    const out = await run(async () => {
      const prefill = await prefillFor(freeDie, plant);
      return trialPlansAPI.addEntry(planDate, plant, {
        die_no: freeDie, plant, entry_type: entryType, urgent, out_of_queue_reason: reason || null,
        tooling: prefill.toolings.join(', ').slice(0, 120) || null, alloy: prefill.alloy,
      });
    }, `${freeDie} added to the plan`);
    if (out) setAdding(null);
  };

  const saveEntry = (entry, change) => run(
    () => trialPlansAPI.updateEntry(entry.id, { ...editableFields(entry), ...change }),
  );

  const removeEntry = async (entry) => {
    const ok = await dialogs.confirm({
      title: `Remove ${entry.die_no}`,
      message: `Take ${entry.die_no} off the plan for ${formatPlanDate(planDate)}?`,
      confirmLabel: 'Remove',
      tone: 'warning',
    });
    if (ok) run(() => trialPlansAPI.removeEntry(entry.id), `${entry.die_no} removed from the plan`);
  };

  const publish = async () => {
    const checks = view?.checks || [];
    const again = published;
    const ok = await dialogs.confirm({
      title: again ? 'Publish the plan again' : 'Publish the plan',
      message: [
        `${plural(entries.length, 'die')} for ${plant} on ${formatPlanDate(planDate)}.`,
        checks.length ? `${plural(checks.length, 'check')} still open: ${checks.map(checkSentence).join(' ')}` : '',
        again ? 'This replaces the copy published earlier.' : 'Once published, results can be recorded on the day.',
        `The PDF schedule downloads now and is emailed to the ${plant} trial plan list.`,
      ].filter(Boolean).join(' '),
      confirmLabel: again ? 'Publish again' : 'Publish',
    });
    if (!ok) return;
    const out = await run(() => trialPlansAPI.publish(planDate, plant));
    if (!out) return;
    // The plan is published either way; the email outcome rides along with it.
    const done = `${plant} plan published${out.plan?.revision > 1 ? ` (revision ${out.plan.revision})` : ''}.`;
    toast(setToast, [done, out.email?.message].filter(Boolean).join(' '), out.email?.status === 'sent' ? 'success' : 'warning');
    downloadPdf();
  };

  const downloadPdf = async () => {
    try {
      const blob = await trialPlansAPI.pdf(planDate, plant);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Trial-schedule-${plant.replace(/\s+/g, '-')}-${planDate}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      toast(setToast, `Could not download the PDF: ${error.message}`, 'error');
    }
  };

  const pickEntry = (entry, outcome = null) => {
    setPreset(outcome);
    setPicked(entry.id);
  };

  const saveResult = async (entry, body) => {
    // One click for a plain OK; the panel for anything that needs more.
    const out = await run(() => trialPlansAPI.recordOutcome(entry.id, body), (res) => {
      const said = `${entry.die_no}: ${body.outcome === 'OK' && entry.entry_type === 'Supervised' ? 'Run OK' : body.outcome} recorded`;
      const carry = res?.carry;
      if (carry?.status === 'added') return `${said}. Carried over to the ${carry.plant} plan for ${formatPlanDate(carry.date)} as urgent.`;
      if (carry?.status === 'tagged') return `${said}. Already on the ${carry.plant} plan for ${formatPlanDate(carry.date)}; now marked urgent and carried over.`;
      if (carry?.status === 'undone' && carry.removed) return `${said}. The carry-over was taken off the next plan.`;
      return said;
    });
    if (out) {
      setPicked(null);
      if (entry.entry_type === 'Trial') onTrialsChanged?.();
    }
  };

  const handlePick = (entry, outcome) => {
    const sample = sampleByEntry(entry);
    const enhanced = Boolean(sample?._order && isEnhancementOrder(sample._order));
    if (outcome === 'OK' && !entry.outcome && !enhanced) {
      saveResult(entry, { outcome: 'OK' });
      return;
    }
    pickEntry(entry, outcome);
  };

  const exportPlan = () => exportToExcel({
    filename: `trial_plan_${plant.replace(/\s+/g, '_')}_${planDate}`,
    sheetName: 'Trial plan',
    rows: planExportRows(entries),
    columns: [
      { key: 'press', label: 'Press' },
      { key: 'die_no', label: 'Die' },
      { key: 'customer', label: 'Customer' },
      { key: 'entry_type', label: 'Type' },
      { key: 'urgent', label: 'Urgent' },
      { key: 'alloy', label: 'Alloy' },
      { key: 'tooling', label: 'Tooling' },
      { key: 'corrector', label: 'Corrector' },
      { key: 'out_of_queue_reason', label: 'Why planned' },
      { key: 'result', label: 'Result' },
      { key: 'comments', label: 'Comments' },
    ],
  }).catch(error => toast(setToast, `Export failed: ${error.message}`, 'error'));

  const queue = availableToPlan(samples, entries, { plant });
  const summary = view?.summary;
  const checks = view?.checks || [];
  const recordingEntry = picked ? entries.find(e => e.id === picked) : null;
  const awaiting = summary ? summary.trials.awaiting + summary.supervised.awaiting : 0;

  const subtitle = !view ? `${plant} trial plan for ${formatPlanDate(planDate)}`
    : [
      `${plant} trial plan for ${planDate === defaultDate ? 'tomorrow, ' : ''}${formatPlanDate(planDate)}`,
      !plan ? 'nothing planned yet' : published ? `published${plan.revision > 1 ? ` · revision ${plan.revision}` : ''}` : 'draft, not published yet',
      canRecord && awaiting ? `${plural(awaiting, 'result')} still to record` : null,
      state.locked ? 'closed' : null,
    ].filter(Boolean).join(' · ');

  return (
    <>
      <header className="sf-header">
        <div className="sf-heading">
          <div className="sf-icon-tile" aria-hidden="true"><CalendarCheck size={24} /></div>
          <div>
            <h1>Sample Followup</h1>
            <p>{subtitle}</p>
          </div>
        </div>
        <div className="sf-header-actions">
          {plan && <span className={`tp-status-chip${published ? ' is-published' : ''}`}>{published ? 'Published' : 'Draft'}</span>}
          <button type="button" className="sf-button sf-button-header" disabled={!entries.length} onClick={exportPlan}><Download size={16} />Export Excel</button>
          {published && entries.length > 0 && (
            <button type="button" className="sf-button sf-button-header" onClick={downloadPdf}><FileText size={16} />PDF schedule</button>
          )}
          {canEditPlan && (
            <button type="button" className="sf-button sf-button-header sf-button-primary" disabled={busy || !entries.length} onClick={publish}>
              <Send size={16} />{published ? 'Publish again' : 'Publish plan'}
            </button>
          )}
        </div>
      </header>

      <DateBar date={planDate} today={today} defaultDate={defaultDate} onChange={changeDate} viewSwitch={viewSwitch}
        plants={meta.plants} plant={plant} onPlant={changePlant} />

      {loadError && <div className="sf-card tp-banner tp-banner-error" role="alert">{loadError} <button type="button" className="sf-text-button" onClick={load}>Try again</button></div>}
      {!view && !loadError && <div className="sf-card tp-banner">Loading the plan…</div>}

      {view && (
        <>
          {state.locked && (
            <div className="tp-banner tp-banner-lock">
              <Lock size={18} aria-hidden="true" />
              <p><strong>Past plan, view only.</strong> <span>The plan and its results are locked and cannot be changed. You can export it or download the PDF schedule.</span></p>
            </div>
          )}
          {!state.locked && !canEditPlan && plan && !published && (
            <div className="tp-banner tp-banner-lock"><Lock size={18} aria-hidden="true" /><p><strong>This plan was never published.</strong> <span>Results can only be recorded against a published plan.</span></p></div>
          )}
          {!state.locked && !canEditPlan && canRecord && (
            <div className="tp-banner"><p>The plan is closed for changes. Results stay open until the end of {formatShortDate(addDays(planDate, meta.resultGraceDays))}.</p></div>
          )}
          {canEditPlan && published && view.carriedAfterPublish > 0 && (
            <div className="tp-banner tp-banner-carry" role="status">
              <p><strong>{plural(view.carriedAfterPublish, 'carry-over')} added after this plan was published.</strong> <span>The schedule people hold is out of date. Publish again to send the updated PDF.</span></p>
              <button type="button" className="sf-button sf-button-tint" disabled={busy} onClick={publish}>Publish again</button>
            </div>
          )}
          {canEditPlan && !published && planDate === today && plan && (
            <div className="tp-banner"><p>Publish today's plan before recording results.</p></div>
          )}

          {canEditPlan && canRecord && (
            <div className="sf-segmented tp-mode" role="group" aria-label="Plan or results">
              <button type="button" aria-pressed={activeMode === 'plan'} onClick={() => setMode('plan')}>Edit plan</button>
              <button type="button" aria-pressed={activeMode === 'results'} onClick={() => setMode('results')}>Record results</button>
            </div>
          )}

          {activeMode === 'plan' ? (
            <>
              <div className="tp-cards">
                <section className="sf-card tp-card">
                  <h2 className="sf-card-label">Planned for the day</h2>
                  <div className="tp-stats tp-stats-two">
                    <Stat label="Trials" value={summary.trials.planned} note={summary.urgent ? `${summary.urgent} urgent` : 'none urgent'} tone="accent" />
                    <Stat label="Supervised runs" value={summary.supervised.planned} note="day shift only" tone="warn" />
                  </div>
                </section>
                <section className="sf-card tp-card">
                  <h2 className="sf-card-label">Trials by press</h2>
                  {summary.byPress.length ? (
                    <ul className="sf-plant-bars tp-press-bars">
                      {(() => {
                        const max = Math.max(1, ...summary.byPress.map(p => p.planned));
                        return summary.byPress.map(p => (
                          <li key={p.press}>
                            <span className="sf-plant-name tp-press-name" title={p.press}>{p.press}</span>
                            <span className="sf-bar" role="img" aria-label={`${p.planned} trials`}><span style={{ width: `${(p.planned / max) * 100}%` }} /></span>
                            <span className="sf-mono sf-plant-ratio">{p.planned}</span>
                          </li>
                        ));
                      })()}
                    </ul>
                  ) : <p className="sf-card-foot">Nothing planned yet</p>}
                </section>
                <section className={`sf-card tp-card${checks.length ? ' tp-card-warn' : ''}`}>
                  <h2 className="sf-card-label">{checks.length ? `${plural(checks.length, 'check')} before publishing` : 'Checks before publishing'}</h2>
                  {checks.length ? (
                    <ul className="tp-checks">{checks.map((c, i) => <li key={i}>{checkSentence(c)}</li>)}</ul>
                  ) : <p className="sf-card-foot">No tooling on two presses, no corrector overloaded.</p>}
                </section>
              </div>

              <div className="tp-work">
                <section className="sf-card tp-queue" aria-labelledby="tp-queue-title">
                  <header className="sf-list-head">
                    <h2 id="tp-queue-title">Available to plan</h2>
                    <span>{plant} dies from Sample Followup</span>
                  </header>
                  {adding && (
                    <AddDiePanel samples={samples} entries={entries} meta={meta} defaultType={adding} busy={busy}
                      onAdd={addOther} onClose={() => setAdding(null)} />
                  )}
                  <div className="sf-band-head">
                    <span className="sf-band-label sf-band-inside">Waiting for trial</span>
                    <span className="sf-mono">{queue.length}</span>
                  </div>
                  {queue.map(s => (
                    <div key={s.id} className="tp-queue-row">
                      <div className="sf-row-main">
                        <span className="sf-row-die">{s.die}</span>
                        <span className="sf-row-meta">{[s.press, s.customer, s.die_received_date ? `received ${formatShortDate(String(s.die_received_date).slice(0, 10))}` : null].filter(Boolean).join(' · ')}</span>
                      </div>
                      <span className={`sf-day-chip${s.late ? ' is-late' : ''}`}>{s.days ?? 0}d waiting</span>
                      <button type="button" className="sf-button sf-button-sm sf-button-tint" disabled={busy} onClick={() => addFromSample(s)}>Add</button>
                    </div>
                  ))}
                  {!queue.length && <p className="tp-empty-note">No {plant} dies are waiting for trial.</p>}
                  <div className="tp-queue-foot">
                    <button type="button" className="tp-dashed" onClick={() => setAdding('Trial')}>+ Add another die (re-trial, approved, or not in Sample Followup)</button>
                    <button type="button" className="tp-dashed" onClick={() => setAdding('Supervised')}>+ Add any die as a supervised run for this day</button>
                  </div>
                </section>

                <section className="sf-card tp-plan" aria-labelledby="tp-plan-title">
                  <header className="sf-list-head">
                    <h2 id="tp-plan-title">Plan · {plural(entries.length, 'die')}</h2>
                    <span>Customer, press, tooling and corrector come from the die record; alloy from its last plan</span>
                  </header>
                  {entries.length ? (
                    <PlanTable entries={entries} checks={checks} meta={meta} correctors={correctors} correctorsError={correctorsError}
                      busy={busy} onSave={saveEntry} onRemove={removeEntry} />
                  ) : <p className="tp-empty-note">Add dies from the list to start the {plant} plan for {formatPlanDate(planDate)}.</p>}
                </section>
              </div>
            </>
          ) : (
            <>
              <TrialSummaryStrip summary={summary} />
              {!entries.length ? (
                <div className="sf-card sf-empty"><p>Nothing was planned at {plant} for {formatPlanDate(planDate)}.</p></div>
              ) : state.locked || !canRecord ? (
                <section className="sf-card tp-plan" aria-labelledby="tp-past-title">
                  <header className="sf-list-head">
                    <h2 id="tp-past-title">Plan as published · {plural(entries.length, 'die')}</h2>
                    {plan?.published_at && <span>Published {formatShortDate(String(plan.published_at).slice(0, 10))}{plan.revision > 1 ? ` · revision ${plan.revision}` : ''}</span>}
                  </header>
                  <ReadOnlyTable entries={entries} />
                </section>
              ) : (
                <div className="tp-work tp-work-results">
                  <section className="sf-card tp-plan" aria-labelledby="tp-res-title">
                    <header className="sf-list-head">
                      <h2 id="tp-res-title">Results · {plural(entries.length, 'die')}</h2>
                      <span>Entered by the shift supervisor · trials are saved to the die's trial log</span>
                    </header>
                    <ResultsList entries={entries} selectedId={picked} canRecord={canRecord} onPick={handlePick} />
                  </section>
                  {recordingEntry ? (
                    <ResultPanel key={`${recordingEntry.id}:${preset}`} entry={{ ...recordingEntry, _preset: preset }} sample={sampleByEntry(recordingEntry)} meta={meta}
                      trialsForDie={trialsOf(recordingEntry)} busy={busy}
                      enhanced={Boolean(sampleByEntry(recordingEntry)?._order && isEnhancementOrder(sampleByEntry(recordingEntry)._order))}
                      plant={plant} planDate={planDate} today={today}
                      onSave={saveResult} onCancel={() => setPicked(null)} />
                  ) : (
                    <section className="sf-card sf-empty tp-result-placeholder">
                      <p>Pick OK, Not OK or Not run on a die. A plain OK saves at once; anything else opens here for the reason and comments.</p>
                    </section>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
