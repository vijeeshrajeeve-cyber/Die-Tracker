import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CalendarClock, History, Pause, Play, Send, X } from 'lucide-react';
import useDialog from '../../hooks/useDialog';
import DatePickerField from '../DatePickerField';
import { workQueueAPI } from '../../workQueueAPI';
import { BUCKETS, dateLabel, deadlineBasis, deadlineState, ownerLabel, sourceLabel } from './view';

export default function WorkItemDetail({ id, theme, user, onClose, onChanged, onOpenSource }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState('');
  const [users, setUsers] = useState(null);
  const [owner, setOwner] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [snoozeHours, setSnoozeHours] = useState('24');
  const [preview, setPreview] = useState(null);
  const current = useRef(true);
  const dialogRef = useDialog({ open: true, onClose, closeOnEscape: !busy });

  const reload = useCallback(async () => {
    try {
      const result = await workQueueAPI.detail(id);
      if (current.current) setDetail(result);
      return result;
    } catch (failure) {
      if (current.current && [401, 403, 404].includes(failure.status)) setDetail(null);
      throw failure;
    }
  }, [id]);

  useEffect(() => {
    current.current = true;
    const timer = setTimeout(() => reload().catch(failure => {
      if (current.current) setError(failure.message);
    }).finally(() => { if (current.current) setLoading(false); }), 0);
    return () => { current.current = false; clearTimeout(timer); };
  }, [reload]);

  const item = detail?.item;
  const canManage = detail?.can_manage ?? item?.can_manage ?? false;
  const canNote = detail?.can_note ?? item?.can_note ?? false;
  const derivedOwner = ['source', 'source_derived', 'eligible_approver'].includes(item?.owner_mode);
  const canAssign = (item?.can_assign ?? canManage) && !derivedOwner;
  const isEta = ['eta', 'explicit_eta'].includes(item?.deadline_basis);
  const canOverride = (item?.can_override_deadline ?? canManage) && !isEta;
  const canSnooze = item?.can_snooze ?? (item?.owner_id && String(item.owner_id) === String(user?.id));
  const state = item ? deadlineState(item) : '';

  async function chooseAction(next) {
    setAction(next);
    setError('');
    setNotice('');
    setReason('');
    setPreview(null);
    setOwner(item.owner_id ? String(item.owner_id) : '');
    setDueDate(item.due_date || '');
    if (next === 'assignment') {
      setUsers(null);
      try {
        const result = await workQueueAPI.assignees(id);
        if (current.current) setUsers(result.users || []);
      } catch (failure) { if (current.current) setError(failure.message); }
    }
    if (next === 'resume') {
      setBusy(true);
      try {
        const result = await workQueueAPI.mutate(id, 'resume-preview', { version: item.version });
        if (current.current) setPreview(result);
      } catch (failure) { if (current.current) setError(failure.message); }
      finally { if (current.current) setBusy(false); }
    }
  }

  async function mutate(kind, payload) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await workQueueAPI.mutate(id, kind, { ...payload, version: item.version });
      if (!current.current) return;
      setAction('');
      if (kind === 'notes') setNote('');
      setReason('');
      onChanged();
      setNotice('Saved. The queue has been refreshed.');
      try { await reload(); }
      catch (failure) { if (current.current) setError(`Saved, but the updated detail could not be loaded. ${failure.message}`); }
    } catch (failure) {
      if (!current.current) return;
      if (failure.status === 409) {
        setPreview(null);
        try {
          await reload();
          if (current.current) setError('This item changed while you were editing. Current values are shown above. Your draft is retained; review it before saving again.');
        } catch (refreshFailure) { if (current.current) setError(refreshFailure.message); }
        onChanged();
      } else {
        if ([401, 403, 404].includes(failure.status)) { setDetail(null); onChanged(); }
        setError(failure.message);
      }
    } finally { if (current.current) setBusy(false); }
  }

  function submitAction(event) {
    event.preventDefault();
    if (['deadline', 'pause', 'resume'].includes(action) && !reason.trim()) { setError('Add a reason before saving this change.'); return; }
    if (action === 'assignment') mutate(action, { ownerId: owner ? Number(owner) : null });
    if (action === 'deadline') {
      if (!dueDate) { setError('Choose a due date.'); return; }
      mutate(action, { dueDate, reason: reason.trim() });
    }
    if (action === 'pause') mutate(action, { reason: reason.trim() });
    if (action === 'resume' && preview) mutate(action, { reason: reason.trim(), token: preview.token });
    if (action === 'snooze') mutate(action, { untilAt: new Date(Date.now() + Number(snoozeHours) * 3600000).toISOString() });
  }

  async function openSource() {
    setBusy(true);
    setError('');
    try {
      await onOpenSource(item.source_action || { kind: item.source_kind, id: item.source_id }, item);
      onClose();
    } catch (failure) { if (current.current) setError(failure.message || 'This source record could not be opened.'); }
    finally { if (current.current) setBusy(false); }
  }

  return <div className="wq-overlay" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <aside ref={dialogRef} className="wq-drawer" role="dialog" aria-modal="true" aria-labelledby="wq-detail-title" tabIndex={-1}>
      <header className="wq-drawer-header"><div><span className="wq-eyebrow">Work item</span><h2 id="wq-detail-title">{item?.die_no || item?.profile || 'Item details'}</h2></div>
        <button type="button" className="wq-icon-button" onClick={onClose} disabled={busy} aria-label="Close work item"><X size={20} /></button></header>
      {error && <div role="alert" className="wq-message wq-message-error">{error}</div>}
      {notice && <div role="status" className="wq-message">{notice}</div>}
      {loading && <p className="wq-muted">Loading current details…</p>}
      {!loading && !item && <p className="wq-muted">This item is unavailable. Close this panel and refresh the queue.</p>}
      {item && <>
        <div className="wq-detail-intro"><span className={`wq-status wq-tone-${state}`}>{BUCKETS.find(b => b.key === state)?.label || item.state}</span>
          <h3>{item.stage_label || item.stage_key}</h3><p>{item.plant || 'Plant not set'} · {sourceLabel(item.source_kind)}{item.occurrence ? ` · occurrence ${item.occurrence}` : ''}</p>
        </div>
        <button type="button" className="wq-button wq-primary wq-source-button" disabled={busy || !onOpenSource} onClick={openSource}>Open source workflow<ArrowUpRight size={16} /></button>
        <p className="wq-help">Complete the next action in its existing workflow. Assignment does not change approval permissions.</p>
        <dl className="wq-facts">
          <div><dt>Owner</dt><dd>{ownerLabel(item)}{derivedOwner && <small>Managed by the source workflow</small>}</dd></div>
          <div><dt>Stage entered</dt><dd>{dateLabel(item.entered_date, item.timezone)}</dd></div>
          <div><dt>Current deadline</dt><dd>{dateLabel(item.due_date || item.due_at, item.timezone)}{item.due_at && <small>{item.cutoff || '17:00'} · {item.timezone || 'Asia/Dubai'}</small>}</dd></div>
          <div><dt>Original deadline</dt><dd>{dateLabel(item.baseline_due_at, item.timezone)}</dd></div>
        </dl>
        <div className="wq-policy-note"><CalendarClock size={17} /><div><strong>Deadline basis</strong><p>{deadlineBasis(item)}</p><p>Reassignment and notes do not restart the deadline.</p></div></div>
        {item.setup_reason && <div className="wq-message wq-message-warning">{item.setup_reason}</div>}
        {item.first_breached_at && <p className="wq-breach">First breach recorded {dateLabel(item.first_breached_at, item.timezone, true)}. Later changes retain this history.</p>}
        <section className="wq-detail-section"><h3>Coordination</h3>
          <div className="wq-actions">
            {canAssign && <button type="button" className="wq-button" disabled={busy} onClick={() => chooseAction('assignment')}>Assign owner</button>}
            {canOverride && <button type="button" className="wq-button" disabled={busy} onClick={() => chooseAction('deadline')}>Change deadline</button>}
            {canManage && item.state === 'active' && <button type="button" className="wq-button" disabled={busy} onClick={() => chooseAction('pause')}><Pause size={14} />Pause</button>}
            {canManage && item.state === 'paused' && !item.source_held && <button type="button" className="wq-button" disabled={busy} onClick={() => chooseAction('resume')}><Play size={14} />Resume</button>}
            {canSnooze && <button type="button" className="wq-button" disabled={busy} onClick={() => chooseAction('snooze')}>Snooze my reminder</button>}
          </div>
          {!canManage && !canSnooze && <p className="wq-help">A queue coordinator manages assignments and deadlines.</p>}
          {isEta && canManage && <p className="wq-help">Change the promised ETA in the source record.</p>}
          {item.source_held && <p className="wq-help">The source workflow is on hold. Release that hold there before resuming.</p>}
          {action && <form className="wq-action-form" onSubmit={submitAction}>
            {action === 'assignment' && <label>Owner<select value={owner} onChange={e => setOwner(e.target.value)} disabled={busy || !users}>
              <option value="">Unassigned</option>{users?.map(entry => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}
            </select><span className="wq-help">{users ? 'Only eligible application users are listed.' : 'Loading eligible owners…'}</span></label>}
            {action === 'deadline' && <div><label htmlFor="wq-due-date">Revised due date</label><DatePickerField id="wq-due-date" theme={theme} value={dueDate} onChange={setDueDate} disabled={busy} /><p className="wq-help">Due at {item.cutoff || '17:00'} in {item.timezone || 'the plant timezone'}. The original deadline is retained.</p></div>}
            {action === 'pause' && <p className="wq-help">Complete eligible days between pause and resume may extend a calculated deadline. A supplier ETA stays unchanged.</p>}
            {action === 'resume' && <div className="wq-message">{preview ? <><strong>{preview.creditedDays} eligible day{preview.creditedDays === 1 ? '' : 's'} credited</strong><p>Resulting due date: {dateLabel(preview.dueDate, item.timezone)}</p></> : <><p>Review the pause credit before resuming.</p><button type="button" className="wq-button" disabled={busy} onClick={() => chooseAction('resume')}>Refresh preview</button></>}</div>}
            {['deadline', 'pause', 'resume'].includes(action) && <label>Reason<textarea value={reason} onChange={e => setReason(e.target.value)} required maxLength={2000} rows={3} disabled={busy} placeholder="Explain this change for the activity history" /></label>}
            {action === 'snooze' && <label>Remind me after<select value={snoozeHours} onChange={e => setSnoozeHours(e.target.value)} disabled={busy}><option value="4">4 hours</option><option value="24">24 hours</option><option value="48">48 hours</option></select><span className="wq-help">The deadline, queue visibility and coordinator escalations stay unchanged.</span></label>}
            <div className="wq-actions"><button className="wq-button wq-primary" type="submit" disabled={busy || (action === 'assignment' && !users) || (action === 'resume' && !preview)}>{busy ? 'Saving…' : action === 'resume' ? 'Confirm resume' : 'Save change'}</button><button type="button" className="wq-button" disabled={busy} onClick={() => setAction('')}>Cancel</button></div>
          </form>}
        </section>
        <section className="wq-detail-section"><h3><History size={16} />Activity</h3>
          {canNote && <form className="wq-note-form" onSubmit={event => { event.preventDefault(); if (note.trim()) mutate('notes', { note: note.trim() }); }}>
            <label htmlFor="wq-note" className="wq-sr-only">Add a follow-up note</label><textarea id="wq-note" value={note} onChange={e => setNote(e.target.value)} maxLength={2000} rows={3} placeholder="Add a dependency or next follow-up…" required disabled={busy} />
            <button type="submit" className="wq-button" disabled={busy || !note.trim()}><Send size={14} />Add note</button>
          </form>}
          <ol className="wq-activity">{(detail.events || []).map(event => <li key={event.id}>
            <div><strong>{String(event.kind || event.event_type || 'Update').replaceAll('_', ' ')}</strong><time dateTime={event.created_at}>{dateLabel(event.created_at, item.timezone, true)}</time></div>
            {event.note && <p>{event.note}</p>}<small>{event.actor_name || 'System'}</small>
          </li>)}</ol>{!detail.events?.length && <p className="wq-help">No recorded activity yet.</p>}
        </section>
      </>}
    </aside>
  </div>;
}
