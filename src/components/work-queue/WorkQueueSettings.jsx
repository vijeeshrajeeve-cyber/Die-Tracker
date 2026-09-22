import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Plus, Settings2, ShieldCheck, X } from 'lucide-react';
import DatePickerField from '../DatePickerField';
import { workQueueAPI } from '../../workQueueAPI';
import { dateLabel } from './view';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_CALENDAR = { plant: '', timezone: 'Asia/Dubai', weekdays: [1, 2, 3, 4, 5, 6], holidays: [], cutoff: '17:00' };
const DEFAULT_RULE = { plant: '', stage_key: '', days: 1, day_mode: 'working', default_owner_id: '', escalation_owner_id: '', enabled: true };

function PlantField({ value, plants, onChange }) {
  return <label>Plant<select value={value || ''} onChange={event => onChange(event.target.value)}><option value="">Global fallback</option>{plants.map(entry => {
    const name = typeof entry === 'string' ? entry : entry.name;
    return <option key={name} value={name}>{name}</option>;
  })}</select></label>;
}

function UserField({ label, value, users, onChange, required = false }) {
  return <label>{label}<select value={value || ''} required={required} onChange={event => onChange(event.target.value)}><option value="">{required ? 'Select user' : 'Not assigned'}</option>{users.map(entry => <option key={entry.id} value={entry.id}>{entry.displayName}</option>)}</select></label>;
}

export default function WorkQueueSettings({ theme, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState('');
  const [calendar, setCalendar] = useState(DEFAULT_CALENDAR);
  const [holidayText, setHolidayText] = useState('');
  const [rule, setRule] = useState(DEFAULT_RULE);
  const [grantUser, setGrantUser] = useState('');
  const [grantPlant, setGrantPlant] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [preview, setPreview] = useState(null);
  const [backfill, setBackfill] = useState(null);
  const [backfillPlant, setBackfillPlant] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [recalculation, setRecalculation] = useState(null);
  const [recalculateReason, setRecalculateReason] = useState('');
  const [recalculatePlant, setRecalculatePlant] = useState('');
  const current = useRef(true);

  useEffect(() => {
    current.current = true;
    const controller = new AbortController();
    workQueueAPI.settings(controller.signal).then(result => { if (current.current) setData(result); }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => { current.current = false; controller.abort(); };
  }, []);

  async function save(section, payload, success = 'Configuration saved. Changes apply to future stage entries.') {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await workQueueAPI.saveSettings(section, payload);
      if (!current.current) return null;
      if (section === 'preview') { setPreview(result); return result; }
      if (section === 'recalculate-preview') { setRecalculation(result); return result; }
      if (section === 'recalculate') { setRecalculation(null); setRecalculateReason(''); }
      if (section === 'backfill') { setBackfill(result); if (payload.dryRun) return result; }
      const next = await workQueueAPI.settings();
      if (!current.current) return result;
      setData(next); setNotice(section === 'recalculate' ? `${result.updated} current work items recalculated. Original deadlines and earlier breaches are retained.` : success); setEditor(''); setReviewed(false); onChanged();
      if (section === 'calendar' || section === 'rule') setRecalculation(null);
      return result;
    } catch (failure) {
      if (!current.current) return null;
      if ([401, 403].includes(failure.status)) setData(null);
      setError(failure.status === 409 ? `${failure.message} Your draft is retained. Refresh the preview or reopen Deadline rules to review current values.` : failure.message);
      if (section === 'recalculate') setRecalculation(null);
      return null;
    } finally { if (current.current) setBusy(false); }
  }

  function editCalendar(value) { setCalendar(value ? { ...value, plant: value.plant || '' } : { ...DEFAULT_CALENDAR }); setHolidayText((value?.holidays || []).join('\n')); setEditor('calendar'); setError(''); setNotice(''); }
  function editRule(value) { setRule(value ? { ...value, plant: value.plant || '' } : { ...DEFAULT_RULE, stage_key: data?.stages?.[0]?.key || '' }); setEditor('rule'); setError(''); setNotice(''); setPreview(null); }
  function changeRule(next) { setRule(next); setPreview(null); }

  function saveCalendar(event) {
    event.preventDefault();
    const holidays = [...new Set(holidayText.split(/[\s,]+/).map(value => value.trim()).filter(Boolean))];
    if (!calendar.weekdays.length) { setError('Choose at least one working weekday.'); return; }
    if (holidays.some(value => !/^\d{4}-\d{2}-\d{2}$/.test(value))) { setError('Enter each excluded date as YYYY-MM-DD.'); return; }
    save('calendar', { ...calendar, plant: calendar.plant || null, holidays });
  }

  function saveRule(event) {
    event.preventDefault();
    save('rule', { ...rule, plant: rule.plant || null, days: Number(rule.days), default_owner_id: rule.default_owner_id ? Number(rule.default_owner_id) : null, escalation_owner_id: rule.escalation_owner_id ? Number(rule.escalation_owner_id) : null });
  }

  if (!data) return <div className="wq-card wq-settings-loading">{error ? <p role="alert" className="wq-breach">{error}</p> : <p>Loading queue configuration…</p>}</div>;
  const users = data.users || [];
  const plants = data.plants || [];
  const nameOf = id => users.find(entry => String(entry.id) === String(id))?.displayName || (id ? 'Unavailable user' : 'Unassigned');
  const selectedStage = data.stages?.find(stage => stage.key === rule.stage_key);
  const ruleUsesEta = selectedStage?.days === null;
  const ruleHasDerivedOwner = ['qd_approval', 'qd_returned'].includes(rule.stage_key);

  return <div className="wq-settings">
    <div className="wq-message">Rules and calendars are versioned. Saving a change applies it to future stage entries; current deadlines keep their recorded policy.</div>
    {error && <div role="alert" className="wq-message wq-message-error">{error}</div>}{notice && <div role="status" className="wq-message">{notice}</div>}
    <section className="wq-card wq-settings-section"><header><div><h2><CalendarDays size={18} />Plant calendars</h2><p className="wq-help">Working weekdays, excluded dates and local deadline cutoff.</p></div><button type="button" className="wq-button" disabled={busy} onClick={() => editCalendar()}><Plus size={15} />Add calendar</button></header>
      <div className="wq-settings-list">{(data.calendars || []).map(value => <div className="wq-setting-row" key={value.id}><div><strong>{value.plant || 'Global fallback'}</strong><small>{value.timezone} · {value.cutoff} · version {value.version}</small><small>{(value.weekdays || []).map(day => DAYS[day]).join(', ')} · {(value.holidays || []).length} excluded dates</small></div><button type="button" className="wq-button wq-button-small" disabled={busy} onClick={() => editCalendar(value)}>Edit</button></div>)}{!data.calendars?.length && <p className="wq-help">Add a calendar before configuring stage targets.</p>}</div>
      {editor === 'calendar' && <form className="wq-settings-form" onSubmit={saveCalendar}><div className="wq-form-heading"><h3>{calendar.id ? 'Revise calendar' : 'New calendar'}</h3><button type="button" className="wq-icon-button" aria-label="Cancel calendar editing" disabled={busy} onClick={() => setEditor('')}><X size={18} /></button></div>
        <fieldset disabled={busy}><div className="wq-form-grid"><PlantField value={calendar.plant} plants={plants} onChange={plant => setCalendar({ ...calendar, plant })} /><label>Timezone<input value={calendar.timezone} onChange={event => setCalendar({ ...calendar, timezone: event.target.value })} required placeholder="Asia/Dubai" /></label><label>Local cutoff<input type="time" value={calendar.cutoff} onChange={event => setCalendar({ ...calendar, cutoff: event.target.value })} required /></label></div>
          <span className="wq-field-label">Working weekdays</span><div className="wq-weekdays">{DAYS.map((label, day) => <label key={label}><input type="checkbox" checked={calendar.weekdays.includes(day)} onChange={event => setCalendar({ ...calendar, weekdays: event.target.checked ? [...calendar.weekdays, day].sort() : calendar.weekdays.filter(value => value !== day) })} />{label}</label>)}</div>
          <label>Excluded dates<textarea value={holidayText} onChange={event => setHolidayText(event.target.value)} rows={3} placeholder={'YYYY-MM-DD\nOne date per line'} /><span className="wq-help">Only the dates listed here are excluded. No public holidays are added automatically.</span></label>
          <button type="submit" className="wq-button wq-primary">{busy ? 'Saving…' : 'Save calendar version'}</button>
        </fieldset>
      </form>}
    </section>
    <section className="wq-card wq-settings-section"><header><div><h2><Settings2 size={18} />Stage rules</h2><p className="wq-help">Exact plant rules take precedence over the global fallback.</p></div><button type="button" className="wq-button" disabled={busy} onClick={() => editRule()}><Plus size={15} />Add rule</button></header>
      <div className="wq-table-scroll"><table className="wq-table wq-rules-table"><thead><tr><th>Stage / plant</th><th>Target</th><th>Default owner</th><th>Escalation contact</th><th /></tr></thead><tbody>{(data.rules || []).map(value => <tr key={value.id}><td><strong>{value.stage_label || value.stage_key}</strong><small>{value.plant || 'Global fallback'} · v{value.version}{!value.enabled ? ' · Disabled' : ''}</small></td><td>{value.days === null ? 'Source ETA' : `${value.days} ${value.day_mode === 'calendar' ? 'calendar' : 'working'} day${value.days === 1 ? '' : 's'}`}</td><td>{['qd_approval','qd_returned'].includes(value.stage_key) ? 'From source workflow' : nameOf(value.default_owner_id)}</td><td>{nameOf(value.escalation_owner_id)}</td><td><button type="button" className="wq-button wq-button-small" disabled={busy} onClick={() => editRule(value)}>Edit</button></td></tr>)}</tbody></table></div>
      {!data.rules?.length && <p className="wq-help">No stage rules are configured. Missing deadlines remain visible as Needs setup.</p>}
      {editor === 'rule' && <form className="wq-settings-form" onSubmit={saveRule}><div className="wq-form-heading"><h3>{rule.id ? 'Revise stage rule' : 'New stage rule'}</h3><button type="button" className="wq-icon-button" aria-label="Cancel rule editing" disabled={busy} onClick={() => setEditor('')}><X size={18} /></button></div><fieldset disabled={busy}>
        <div className="wq-form-grid"><PlantField value={rule.plant} plants={plants} onChange={plant => changeRule({ ...rule, plant })} /><label>Stage<select value={rule.stage_key} onChange={event => changeRule({ ...rule, stage_key: event.target.value, days: rule.days || 1, ...(['qd_approval','qd_returned'].includes(event.target.value) ? { default_owner_id: '' } : {}) })} required><option value="">Select stage</option>{(data.stages || []).map(stage => <option key={stage.key} value={stage.key}>{stage.label}</option>)}</select></label>{!ruleUsesEta && <><label>Target basis<select value={rule.day_mode} onChange={event => changeRule({ ...rule, day_mode: event.target.value })}><option value="working">Working days</option><option value="calendar">Calendar days</option></select></label><label>Target days<input type="number" min={1} step={1} max={3650} required value={rule.days ?? 1} onChange={event => changeRule({ ...rule, days: event.target.value })} /></label></>}
          {!ruleHasDerivedOwner && <UserField label="Default owner" value={rule.default_owner_id} users={users} onChange={default_owner_id => changeRule({ ...rule, default_owner_id })} />}<UserField label="Escalation contact" value={rule.escalation_owner_id} users={users} onChange={escalation_owner_id => changeRule({ ...rule, escalation_owner_id })} />
        </div><label className="wq-checkbox"><input type="checkbox" checked={rule.enabled} onChange={event => changeRule({ ...rule, enabled: event.target.checked })} />Rule enabled for new occurrences</label>
        <p className="wq-help">QD approval and correction owners always come from the source workflow. Owner eligibility is checked when work is created.</p>
        {ruleUsesEta ? <p className="wq-help">This stage uses the explicitly promised supplier ETA. Its due date is updated through the source workflow.</p> : <div className="wq-rule-preview"><label htmlFor="wq-preview-entry">Example stage entry date</label><DatePickerField id="wq-preview-entry" value={entryDate} onChange={value => { setEntryDate(value); setPreview(null); }} theme={theme} /><button type="button" className="wq-button" disabled={!entryDate || !rule.stage_key} onClick={() => save('preview', { ...rule, days: Number(rule.days), plant: rule.plant || null, entryDate })}>Calculate preview</button>{preview && <p role="status">{preview.setupReason || `Due ${dateLabel(preview.dueDate)} at ${preview.cutoff || '17:00'} (${preview.timezone || 'plant timezone'}).`}</p>}</div>}
        <button type="submit" className="wq-button wq-primary">{busy ? 'Saving…' : 'Save rule version'}</button>
      </fieldset></form>}
    </section>
    <section className="wq-card wq-settings-section"><header><div><h2>Apply current rules to open work</h2><p className="wq-help">Preview every proposed deadline before applying. Supplier ETAs and paused items are excluded.</p></div></header>
      <div className="wq-grant-form"><label>Plant to review<select value={recalculatePlant} onChange={event => { setRecalculatePlant(event.target.value); setRecalculation(null); }} disabled={busy}><option value="">All plants</option>{plants.map(entry => { const name = typeof entry === 'string' ? entry : entry.name; return <option key={name} value={name}>{name}</option>; })}</select></label><button type="button" className="wq-button" disabled={busy} onClick={() => save('recalculate-preview', { plant: recalculatePlant || null })}>Preview deadline changes</button></div>
      {recalculation && <div className="wq-recalculation"><p className="wq-help">{recalculation.changes?.length || 0} eligible items. Applying replaces their effective deadlines, including manual overrides. Original deadlines and breach history are retained.</p>
        <div className="wq-table-scroll"><table className="wq-table"><thead><tr><th>Die / profile</th><th>Stage</th><th>Current deadline</th><th>Proposed deadline</th></tr></thead><tbody>{(recalculation.changes || []).map(change => <tr key={change.id}><td>{change.dieNo || `Item ${change.id}`}</td><td>{change.stage}</td><td>{dateLabel(change.oldDueAt, change.calendar?.timezone)}</td><td>{dateLabel(change.dueDate)}</td></tr>)}</tbody></table></div>
        {!!recalculation.changes?.length && <form className="wq-recalculate-form" onSubmit={event => { event.preventDefault(); if (recalculateReason.trim()) save('recalculate', { token: recalculation.token, reason: recalculateReason.trim() }); }}><label>Reason for applying these rules<textarea rows={2} required maxLength={2000} value={recalculateReason} onChange={event => setRecalculateReason(event.target.value)} disabled={busy} placeholder="Explain why these existing deadlines should change" /></label><button type="submit" className="wq-button wq-primary" disabled={busy || !recalculateReason.trim()}>Apply to {recalculation.changes.length} reviewed items</button></form>}
      </div>}
    </section>
    <section className="wq-card wq-settings-section"><header><div><h2><ShieldCheck size={18} />Queue coordinators</h2><p className="wq-help">Grants allow coordination within a plant. Source visibility and approval permissions still apply.</p></div></header>
      <div className="wq-settings-list">{(data.grants || []).map(grant => <div className="wq-setting-row" key={grant.id || `${grant.user_id}:${grant.plant}`}><div><strong>{nameOf(grant.user_id)}</strong><small>{grant.plant || 'All plants'}</small></div><button type="button" className="wq-button wq-button-small" disabled={busy} onClick={() => save('grants', { userId: grant.user_id, plant: grant.plant || null, remove: true }, 'Coordinator grant removed.')}>Remove grant</button></div>)}</div>
      <form className="wq-grant-form" onSubmit={event => { event.preventDefault(); save('grants', { userId: Number(grantUser), plant: grantPlant || null, remove: false }, 'Coordinator grant saved.'); }}><UserField label="Application user" value={grantUser} users={users} onChange={setGrantUser} required /><label>Coordination scope<select value={grantPlant} onChange={event => setGrantPlant(event.target.value)}><option value="">All plants</option>{plants.map(entry => { const name = typeof entry === 'string' ? entry : entry.name; return <option key={name} value={name}>{name}</option>; })}</select></label><button type="submit" className="wq-button" disabled={busy || !grantUser}>Add coordinator</button></form>
    </section>
    <section className="wq-card wq-settings-section"><header><div><h2>Current work and reminders</h2><p className="wq-help">Review existing work before enabling internal notifications.</p></div></header>
      <div className="wq-form-grid"><label>Pilot plant<select value={backfillPlant} onChange={event => { setBackfillPlant(event.target.value); setBackfill(null); }}><option value="">Select plant</option>{plants.map(entry => { const name = typeof entry === 'string' ? entry : entry.name; return <option key={name} value={name}>{name}</option>; })}</select></label></div>
      <div className="wq-actions"><button type="button" className="wq-button" disabled={busy || !backfillPlant} onClick={() => save('backfill', { dryRun: true, plant: backfillPlant })}>Preview current work</button>{backfill && <button type="button" className="wq-button" disabled={busy || !backfillPlant} onClick={() => save('backfill', { dryRun: false, plant: backfillPlant }, 'Current work synchronized. No historical reminders were sent.')}>Synchronize current work</button>}</div>
      {backfill && <div className="wq-message" role="status"><strong>Current-work review</strong><dl className="wq-backfill-counts">{Object.entries(backfill.counts || backfill).filter(([, value]) => ['string', 'number'].includes(typeof value)).map(([key, value]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{value}</dd></div>)}</dl>{backfill.message && <p>{backfill.message}</p>}</div>}
      <div className="wq-notification-config"><strong>Internal reminders: {data.notificationsEnabled ? 'Enabled' : 'Off'}</strong><p className="wq-help">Owner reminders and coordinator escalations use the saved rules. Existing supplier reminders continue in their own workflows.</p>
        {!data.notificationsEnabled && <label className="wq-checkbox"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I have reviewed calendars, owners, escalation contacts and current work.</label>}
        <button type="button" className="wq-button" disabled={busy || (!data.notificationsEnabled && !reviewed)} onClick={() => save('notifications', { enabled: !data.notificationsEnabled, ...(!data.notificationsEnabled ? { goLiveAt: new Date().toISOString(), reviewed: true } : {}) }, data.notificationsEnabled ? 'Internal reminders disabled.' : 'Internal reminders enabled from now.')}>{data.notificationsEnabled ? 'Disable internal reminders' : 'Enable internal reminders from now'}</button>
      </div>
    </section>
  </div>;
}
