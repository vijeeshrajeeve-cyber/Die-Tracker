import React from 'react';
import { CalendarCheck, CheckSquare, Pencil, Trash2 } from 'lucide-react';
import TrialsSection from './TrialsSection';
import { useStampToday } from './useStampToday';
import CorrectorSelect from '../ui/CorrectorSelect';
import { formatDate } from '../../utils/helpers';
import { trialCountFor } from '../../utils/trials';
import { SUBMISSION_TARGET_DAYS, daysSince, plural, sampleStatusClass } from '../../utils/sampleFollowupView';

const orDash = (value) => (value === null || value === undefined || value === '' ? '—' : value);

// Both actions go through the same stamp-today path the rest of the app uses:
// one save for the date and the status it implies, with the overwrite confirm.
function StampAction({ sample, kind, onSave, setToast }) {
  const submission = kind === 'submission';
  const { stamp, busy } = useStampToday({
    sf: sample,
    dateField: submission ? 'Submission Date' : 'Sample Approval Date',
    snakeDateField: submission ? 'submission_date' : 'sample_approval_date',
    targetStatus: submission ? 'Sample Submitted' : 'Approved',
    label: submission ? 'Submission date' : 'Approval date',
    currentDate: submission ? sample.submission_date : sample.sample_approval_date,
    currentStatus: sample.status,
    onSave, setToast,
  });
  return (
    <button type="button" className={`sf-button sf-button-pane ${submission ? 'sf-button-accent' : 'sf-button-tint'}`} disabled={busy} onClick={stamp}>
      {submission ? <CalendarCheck size={14} /> : <CheckSquare size={14} />}
      {busy ? 'Saving…' : submission ? 'Mark submitted today' : 'Mark approved today'}
    </button>
  );
}

export default function SampleFollowupDetail({
  sample, trials, parent, today, theme, user, correctors, correctorsError,
  onEdit, onDelete, onSaveDate, onSaveField, onTrialsChanged, setToast,
}) {
  const count = trialCountFor(trials, sample.no_of_trial);
  const submitted = Boolean(sample.submission_date);
  const approved = Boolean(sample.sample_approval_date);
  const receivedAgo = daysSince(sample.die_received_date, today);

  const stages = [
    {
      label: 'Die received', filled: Boolean(sample.die_received_date), tone: 'accent',
      date: formatDate(sample.die_received_date),
      note: receivedAgo === null ? 'Received date missing' : receivedAgo === 0 ? 'Today' : `${plural(receivedAgo, 'day')} ago`,
    },
    {
      label: 'Sample submitted', filled: submitted, tone: 'accent', late: sample.late,
      date: submitted ? formatDate(sample.submission_date) : approved ? 'Not recorded' : 'Not submitted',
      note: submitted
        ? (sample.days === null ? 'Received date missing' : `${plural(sample.days, 'day')} after receiving`)
        : approved ? 'Approved without a submission date'
        : (sample.days === null ? `Target ${SUBMISSION_TARGET_DAYS}` : `${plural(sample.days, 'day')} waiting · target ${SUBMISSION_TARGET_DAYS}`),
    },
    {
      label: 'Sample approved', filled: approved, tone: 'ok',
      date: approved ? formatDate(sample.sample_approval_date) : sample.status === 'Rejected' ? 'Rejected' : 'Pending',
      note: approved ? 'Closed' : `${plural(count.count, count.isLegacy ? 'legacy trial' : 'trial')} logged`,
    },
  ];

  const facts = [
    ['Profile', sample.profile], ['Plant', sample.plant], ['Press', sample.press], ['Supplier', sample.supplier],
    ['Customer', sample.customer], ['Ascona ref', sample.ascona_reference], ['Corrector', sample.corrector], ['Delay days', sample.days],
  ];

  const subhead = [sample.profile, sample.plant, sample.press && `press ${sample.press}`, sample.customer].filter(Boolean).join(' · ');

  const saveRemark = (event) => {
    const value = event.target.value;
    if (value !== (sample.remark || '')) onSaveField(sample, 'Sample Remark', value);
  };

  return (
    <article className="sf-card sf-pane" aria-labelledby="sf-pane-die">
      <header className="sf-pane-head">
        <div className="sf-pane-title">
          <div className="sf-pane-die">
            <h2 id="sf-pane-die">{sample.die || sample.profile || 'Untitled die'}</h2>
            <span className={`sf-pill sf-status-pill sf-status-${sampleStatusClass(sample.status)}`}>{sample.status}</span>
          </div>
          {subhead && <p>{subhead}</p>}
        </div>
        <div className="sf-pane-actions">
          {!submitted && !approved && <StampAction sample={sample} kind="submission" onSave={onSaveDate} setToast={setToast} />}
          {submitted && !approved && <StampAction sample={sample} kind="approval" onSave={onSaveDate} setToast={setToast} />}
          {approved && <span className="sf-closed-chip">Closed {formatDate(sample.sample_approval_date)}</span>}
          <button type="button" className="sf-icon-button" onClick={onEdit} aria-label="Edit all details" title="Edit all details"><Pencil size={15} /></button>
        </div>
      </header>

      <div className="sf-pane-body">
        <ol className="sf-stages" aria-label="Sample progress">
          {stages.map((stage, index) => {
            const next = stages[index + 1];
            return (
              <li key={stage.label} className={stage.filled ? 'is-filled' : undefined}>
                <div className="sf-stage-track" aria-hidden="true">
                  <span className={`sf-stage-dot sf-tone-${stage.tone}`} />
                  <span className={`sf-stage-line${next ? next.filled ? ' is-reached' : '' : ' is-last'}`} />
                </div>
                <p className={`sf-stage-label${stage.late ? ' is-late' : ''}`}>{stage.label}</p>
                <p className="sf-stage-date">{stage.date}</p>
                <p className="sf-stage-note">{stage.note}</p>
              </li>
            );
          })}
        </ol>

        <dl className="sf-facts">
          {facts.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{orDash(value)}</dd></div>)}
        </dl>

        <TrialsSection pane parent={parent} trials={trials} legacyCount={count.isLegacy ? count.count : 0} theme={theme} user={user} onChanged={onTrialsChanged} setToast={setToast} />

        <div className="sf-notes">
          <div className="sf-field">
            <label htmlFor="sf-pane-remark">Remark</label>
            {/* Uncontrolled so typing never fights a refetch; keyed on the saved
                value so a change from elsewhere replaces what is shown. */}
            <textarea key={`${sample.id}:${sample.remark || ''}`} id="sf-pane-remark" rows={2} defaultValue={sample.remark || ''} onBlur={saveRemark} />
          </div>
          <div className="sf-field">
            <label htmlFor="sf-pane-corrector">Corrector</label>
            <CorrectorSelect id="sf-pane-corrector" value={sample.corrector || ''} plant={sample.plant}
              correctors={correctors} loadError={correctorsError}
              onChange={value => onSaveField(sample, 'Corrector', value)}
              style={{ width: '100%' }} />
          </div>
        </div>

        {user?.role === 'admin' && (
          <details className="sf-record-actions">
            <summary>Record actions</summary>
            <button type="button" className="sf-text-button sf-danger" onClick={() => onDelete(sample)}>
              <Trash2 size={14} />{sample._source === 'order' ? 'Clear sample fields' : 'Delete record'}
            </button>
          </details>
        )}
      </div>
    </article>
  );
}
