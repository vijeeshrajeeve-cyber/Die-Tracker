import React, { useMemo, useState } from 'react';
import { Search, X, Plus, ClipboardList, Download } from 'lucide-react';
import { ordersAPI, sampleFollowupsAPI } from '../api';
import { dialogs } from '../components/ui/DialogProvider';
import { exportToExcel } from '../utils/exportExcel';
import { todayLocal } from '../utils/today';
import SampleFollowupForm from '../components/sample/SampleFollowupForm';
import SampleFollowupDetail from '../components/sample/SampleFollowupDetail';
import { trialCountFor } from '../utils/trials';
import {
  STAGES, SUBMISSION_TARGET_DAYS, enrichSample, plantOf, scopeSampleFollowups, sortSampleFollowups,
  bandsFor, stageSummary, daysToSubmission, lateByPlant, plural, sampleStatusClass,
} from '../utils/sampleFollowupView';
import '../styles/sample-followup.css';

const computeSfDelay = (received, submission) => {
  if (!received) return 0;
  const start = new Date(received);
  if (isNaN(start)) return 0;
  const end = submission ? new Date(submission) : new Date();
  if (isNaN(end)) return 0;
  const diff = Math.floor((end.setHours(0, 0, 0, 0) - start.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
};

const formToOrderFields = (form) => ({
  'DIE NO': form.die || '',
  'Plant': form.plant || '',
  'Press': form.press || '',
  'Supplier': form.supplier || '',
  'Customer Name': form.customer || '',
  'Die Received Date': form.die_received_date || '',
  'Ascona Reference': form.ascona_reference || 'No',
  'Submission Date': form.submission_date || '',
  'Sample Approval Date': form.sample_approval_date || '',
  'Sample Status': form.status || 'Pending',
  'Sample Remark': form.remark || '',
  'Corrector': form.corrector || '',
});

const formToSfFields = (form) => ({
  profile: form.die || '',
  plant: form.plant || '',
  press: form.press || '',
  supplier: form.supplier || '',
  customer: form.customer || '',
  die_received_date: form.die_received_date || '',
  ascona_reference: form.ascona_reference || 'No',
  submission_date: form.submission_date || '',
  sample_approval_date: form.sample_approval_date || '',
  delay_days: computeSfDelay(form.die_received_date, form.submission_date),
  status: form.status || 'Pending',
  remark: form.remark || '',
  corrector: form.corrector || '',
});

// Die-order column → standalone sample_followups column, for inline edits.
const SF_DISPLAY_TO_SNAKE = {
  'Sample Remark': 'remark',
  'Corrector': 'corrector',
};

const EMPTY_FORM = { die: '', plant: '', press: '', supplier: '', customer: '', die_received_date: '', ascona_reference: 'No', submission_date: '', sample_approval_date: '', delay_days: 0, status: 'Pending', remark: '', corrector: '' };

const STAGE_TONE = { 'Pending': 'pending', 'Sample Submitted': 'submitted', 'Approved': 'approved' };
const STAGE_NOTE = {
  'Pending': late => `${late} overdue now`,
  'Sample Submitted': late => `${late} missed the line`,
  'Approved': () => 'Closed, no action needed',
};
const STAGE_HINT = {
  'Pending': 'Longest wait first',
  'Sample Submitted': 'Slowest submission first',
  'Approved': 'No action needed',
};
const SORT_HINT = { received: 'Newest received first', plant: 'Grouped by plant' };

export default function SampleFollowupPage({
  focusId = null, onFocusHandled,
  sampleFollowups,
  sfPlantFilter, setSfPlantFilter,
  searchTerm, setSearchTerm,
  showSampleFollowupForm, setShowSampleFollowupForm,
  editingSampleFollowup, setEditingSampleFollowup,
  sampleFollowupForm, setSampleFollowupForm,
  setSampleFollowupsStandalone,
  correctors, correctorsError,
  user,
  theme,
  setToast,
  handleInlineFieldSave,
  handleOrderFieldsSave,
  fetchOrders,
  fetchSampleFollowups,
  sampleTrials,
  fetchSampleTrials,
}) {
  const [stage, setStage] = useState('Pending');
  const [sort, setSort] = useState('overdue');
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const today = todayLocal();

  const enriched = useMemo(() => sampleFollowups.map(sf => enrichSample(sf, today)), [sampleFollowups, today]);

  // The summary strip follows the plant filter only; the tabs and the list
  // also follow the search, so the tab counts show where the matches are.
  const plantScope = scopeSampleFollowups(enriched, { plant: sfPlantFilter });
  const scoped = scopeSampleFollowups(enriched, { plant: sfPlantFilter, search: searchTerm });
  const summary = stageSummary(plantScope);
  const tabCounts = stageSummary(scoped);
  const lateTotal = plantScope.filter(r => r.late).length;
  const pace = daysToSubmission(plantScope, today);
  const plantLate = lateByPlant(plantScope);

  const bandsOf = (s) => bandsFor(s, sortSampleFollowups(scoped.filter(r => r.stage === s), sort));
  const bands = bandsOf(stage);
  const stageRows = bands.flatMap(band => band.rows);

  // The pane keeps showing the die it was showing even after a stamp moves it
  // to another stage; it only falls back when that die has left the scope.
  const selected = enriched.find(r => r.id === focusId) || scoped.find(r => r.id === selectedId) || stageRows[0] || scoped[0] || null;

  const plantCounts = new Map();
  for (const row of enriched) {
    const plant = plantOf(row);
    if (plant) plantCounts.set(plant, (plantCounts.get(plant) || 0) + 1);
  }
  const plants = [...plantCounts.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (sfPlantFilter !== 'All' && !plantCounts.has(sfPlantFilter)) plants.push(sfPlantFilter);

  const selectStage = (next) => {
    onFocusHandled?.();
    setStage(next);
    setSelectedId(bandsOf(next)[0]?.rows[0]?.id ?? null);
  };

  const selectRow = (sf) => {
    onFocusHandled?.();
    setShowSampleFollowupForm(false);
    setEditingSampleFollowup(null);
    setSelectedId(sf.id);
  };

  const closeForm = () => {
    if (saving) return;
    setShowSampleFollowupForm(false);
    setEditingSampleFollowup(null);
  };

  const editSample = () => {
    setEditingSampleFollowup(selected);
    setSampleFollowupForm(Object.fromEntries(Object.keys(EMPTY_FORM).map(key => [key, selected[key] ?? EMPTY_FORM[key]])));
    setShowSampleFollowupForm(true);
  };

  const addSample = () => {
    setEditingSampleFollowup(null);
    setSampleFollowupForm({ ...EMPTY_FORM });
    setShowSampleFollowupForm(true);
  };

  const handleSampleFollowupSubmit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (editingSampleFollowup) {
        if (editingSampleFollowup._source === 'order') {
          // Use PATCH so only the SF-specific fields are touched; other dates
          // (Design Received Date, Ordered date, etc.) are never overwritten.
          await ordersAPI.patch(editingSampleFollowup._order.id, formToOrderFields(sampleFollowupForm));
          await fetchOrders();
        } else {
          const raw = editingSampleFollowup._raw;
          await sampleFollowupsAPI.update(raw.id, formToSfFields(sampleFollowupForm));
          await fetchSampleFollowups();
        }
        setToast({ message: 'Sample followup updated successfully', type: 'success' });
      } else {
        await sampleFollowupsAPI.create(formToSfFields(sampleFollowupForm));
        await fetchSampleFollowups();
        setToast({ message: 'Sample followup created successfully', type: 'success' });
      }
      setTimeout(() => setToast(null), 3000);
      setShowSampleFollowupForm(false);
      setEditingSampleFollowup(null);
      setSampleFollowupForm(EMPTY_FORM);
    } catch (error) {
      console.error('Sample followup error:', error);
      setToast({ message: 'Failed: ' + error.message, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSampleFollowup = async (sf) => {
    if (sf._source === 'standalone') {
      const ok = await dialogs.confirm({
        title: 'Delete sample followup',
        message: 'This removes the followup record permanently. It cannot be undone.',
        confirmLabel: 'Delete record',
      });
      if (!ok) return;
      try {
        await sampleFollowupsAPI.delete(sf._raw.id);
        setSelectedId(null);
        setToast({ message: 'Sample followup deleted', type: 'success' });
        setTimeout(() => setToast(null), 3000);
        await fetchSampleFollowups();
      } catch (error) {
        setToast({ message: 'Failed to delete: ' + error.message, type: 'error' });
        setTimeout(() => setToast(null), 5000);
      }
      return;
    }
    const ok = await dialogs.confirm({
      title: 'Clear sample followup data',
      // Logged trials survive this: they are a record of what happened, and the
      // same reason they are admin-only to delete applies here. Deleting the die
      // order itself still cascades them away.
      message: 'Only the sample fields are reset. Logged trials and the underlying die order are kept.',
      confirmLabel: 'Clear fields',
      tone: 'warning',
    });
    if (!ok) return;
    try {
      const existing = sf._order;
      await ordersAPI.patch(existing.id, {
        'Die Received Date': null,
        'Submission Date': null,
        'Sample Approval Date': null,
        'Ascona Reference': 'No',
        'Sample Status': '',
        'Sample Remark': '',
        'Press': '',
      });
      setSelectedId(null);
      setToast({ message: 'Sample followup cleared', type: 'success' });
      setTimeout(() => setToast(null), 3000);
      fetchOrders();
    } catch (error) {
      setToast({ message: 'Failed to clear: ' + error.message, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  };

  // Writes a date and (optionally) the status it implies, in one request, down
  // whichever path this row came from. `newStatus` of null means the ladder
  // refused to move the record — the date still saves.
  const saveSfFields = async (sf, { dateField, snakeDateField, dateValue, newStatus }) => {
    // Pin the pane to this die: the stamp may move it out of the current stage.
    setSelectedId(sf.id);
    if (sf._source === 'order') {
      const fields = { [dateField]: dateValue };
      if (newStatus) fields['Sample Status'] = newStatus;
      await handleOrderFieldsSave(sf._order, fields);
      return;
    }
    const raw = sf._raw;
    const updated = { ...raw, [snakeDateField]: dateValue };
    if (newStatus) updated.status = newStatus;
    await sampleFollowupsAPI.update(raw.id, updated);
    setSampleFollowupsStandalone(prev => prev.map(r => (r.id === raw.id ? updated : r)));
  };

  // One field saved as soon as it is left, like the inline cells elsewhere.
  const saveSfField = async (sf, displayField, value) => {
    if (sf._source === 'order') {
      await handleInlineFieldSave(sf._order, displayField, value);
      return;
    }
    const snake = SF_DISPLAY_TO_SNAKE[displayField];
    const raw = sf._raw;
    if (!snake || (raw[snake] || '') === value) return;
    try {
      const updated = { ...raw, [snake]: value };
      await sampleFollowupsAPI.update(raw.id, updated);
      setSampleFollowupsStandalone(prev => prev.map(r => (r.id === raw.id ? updated : r)));
      setToast({ message: `${displayField} saved`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      console.error(`${displayField} update error:`, error);
      setToast({ message: `Failed to save ${displayField}`, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  };

  // A trial hangs off whichever table its followup came from. `null` means the
  // record has not been saved yet, so there is nothing to attach a trial to.
  const trialParentOf = (sf) => {
    if (!sf) return null;
    if (sf._source === 'order') return { die_order_id: sf._order.id };
    if (sf._source === 'standalone') return { sample_followup_id: sf._raw.id };
    return null;
  };

  const trialsOf = (sf) => {
    const parent = trialParentOf(sf);
    if (!parent) return [];
    const key = parent.die_order_id ? 'die_order_id' : 'sample_followup_id';
    const id = parent.die_order_id || parent.sample_followup_id;
    return (sampleTrials || [])
      .filter(t => t[key] === id)
      .sort((a, b) => a.trial_no - b.trial_no);
  };

  // Everything in the current plant and search scope, across all three stages.
  const exportRows = sortSampleFollowups(scoped, sort);

  const handleExport = async () => {
    const followupColumns = [
      { key: 'die', label: 'Die' },
      { key: 'profile', label: 'Profile' },
      { key: 'plant', label: 'Plant' },
      { key: 'press', label: 'Press' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'customer', label: 'Customer' },
      { key: 'die_received_date', label: 'Die Received Date', format: 'date' },
      { key: 'ascona_reference', label: 'Ascona Ref', format: (v) => v || 'No' },
      { key: 'submission_date', label: 'Submission Date', format: 'date' },
      { key: 'sample_approval_date', label: 'Sample Approval Date', format: 'date' },
      { key: 'days', label: 'Days to Submit', format: (v) => (v === null ? '' : v) },
      { key: 'late', label: `Past ${SUBMISSION_TARGET_DAYS}-day line`, format: (v) => (v ? 'Yes' : 'No') },
      { key: 'stage', label: 'Stage' },
      { key: 'status', label: 'Status' },
      { key: 'no_of_trial', label: 'No. of Trial', format: (v, sf) => trialCountFor(trialsOf(sf), v).count },
      { key: 'remark', label: 'Remark' },
      { key: 'corrector', label: 'Corrector' },
    ];

    const trialRows = exportRows.flatMap(sf =>
      trialsOf(sf).map(t => ({
        die: sf.die, profile: sf.profile, plant: sf.plant, supplier: sf.supplier,
        trial_no: t.trial_no, trial_date: t.trial_date, result: t.result,
        fail_reason: t.fail_reason, comments: t.comments,
      }))
    );

    await exportToExcel({
      filename: 'sample_followups',
      sheets: [
        { name: 'Sample Followup', rows: exportRows, columns: followupColumns },
        {
          name: 'Trials',
          rows: trialRows,
          columns: [
            { key: 'die', label: 'Die' },
            { key: 'profile', label: 'Profile' },
            { key: 'plant', label: 'Plant' },
            { key: 'supplier', label: 'Supplier' },
            { key: 'trial_no', label: 'Trial No' },
            { key: 'trial_date', label: 'Trial Date', format: 'date' },
            { key: 'result', label: 'Result' },
            { key: 'fail_reason', label: 'Reason' },
            { key: 'comments', label: 'Comments' },
          ],
        },
      ],
    });
  };

  const total = plantScope.length;

  return (
    <section className="sample-followup" data-theme={theme.isDark ? 'dark' : 'light'} style={{
      '--sf-bg': theme.bg, '--sf-surface': theme.cardBg, '--sf-raised': theme.inputBg,
      '--sf-line': theme.cardBorder, '--sf-text': theme.text, '--sf-muted': theme.textMuted,
      '--sf-dim': theme.textDim || theme.textMuted, '--sf-shadow': theme.shadowSm || '0 1px 2px rgba(0,0,0,.28)',
      '--sf-hover': theme.rowHover || 'rgba(255,255,255,.04)',
    }}>
      <header className="sf-header">
        <div className="sf-heading">
          <div className="sf-icon-tile" aria-hidden="true"><ClipboardList size={24} /></div>
          <div>
            <h1>Sample Followup</h1>
            <p>{total
              ? `${lateTotal} of ${plural(total, 'die')} ${lateTotal === 1 ? 'is' : 'are'} past the ${SUBMISSION_TARGET_DAYS}-day submission line`
              : 'No sample followups yet'}</p>
          </div>
        </div>
        <div className="sf-header-actions">
          <label className="sf-search">
            <Search size={18} aria-hidden="true" />
            <input aria-label="Search die, profile, customer or corrector" placeholder="Die, profile, customer, corrector" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} />
            {searchTerm && <button type="button" className="sf-icon-button" aria-label="Clear search" onClick={() => setSearchTerm('')}><X size={14} /></button>}
          </label>
          <button type="button" className="sf-button sf-button-header" disabled={!exportRows.length} onClick={() => handleExport().catch(error => setToast({ type: 'error', message: `Export failed: ${error.message}` }))}><Download size={16} />Export</button>
          <button type="button" className="sf-button sf-button-header sf-button-primary" disabled={saving} onClick={addSample}><Plus size={16} />Add Record</button>
        </div>
      </header>

      <div className="sf-summary">
        <section className="sf-card sf-summary-card" aria-labelledby="sf-sum-stages">
          <h2 id="sf-sum-stages" className="sf-card-label">Where the dies sit</h2>
          <div className="sf-stage-cols">
            {STAGES.map(s => {
              const { count, late } = summary[s];
              const noteLate = s !== 'Approved' && late > 0;
              return (
                <div key={s} className={`sf-stage-col sf-tone-${STAGE_TONE[s]}`}>
                  <p className="sf-stage-col-label">{s}</p>
                  <div className="sf-stage-col-count"><span className="sf-big-num">{count}</span><span>{count === 1 ? 'die' : 'dies'}</span></div>
                  <p className={`sf-stage-col-note${noteLate ? ' is-late' : ''}`}>{STAGE_NOTE[s](late)}</p>
                </div>
              );
            })}
          </div>
        </section>
        <section className="sf-card sf-summary-card" aria-labelledby="sf-sum-pace">
          <h2 id="sf-sum-pace" className="sf-card-label">Days to submission</h2>
          <div className="sf-pace">
            <span className="sf-big-num sf-pace-num">{pace.current === null ? '—' : pace.current.toFixed(1)}</span>
            <span>{pace.current === null ? 'no submissions, last 90 days' : 'avg, last 90 days'}</span>
          </div>
          <p className="sf-card-foot">Target {SUBMISSION_TARGET_DAYS} · {pace.previous === null
            ? 'no submissions in the previous 90 days'
            : `was ${pace.previous.toFixed(1)} in the previous 90 days`}</p>
        </section>
        <section className="sf-card sf-summary-card" aria-labelledby="sf-sum-plant">
          <h2 id="sf-sum-plant" className="sf-card-label">Late by plant</h2>
          {plantLate.length ? (
            <ul className="sf-plant-bars">
              {plantLate.map(({ plant, late, total: plantTotal }) => (
                <li key={plant}>
                  <span className="sf-plant-name" title={plant}>{plant}</span>
                  <span className="sf-bar" role="img" aria-label={`${late} of ${plantTotal} late`}><span style={{ width: `${(late / plantTotal) * 100}%` }} /></span>
                  <span className="sf-mono sf-plant-ratio">{late}/{plantTotal}</span>
                </li>
              ))}
            </ul>
          ) : <p className="sf-card-foot">No open dies</p>}
        </section>
      </div>

      <div className="sf-filterbar">
        <div className="sf-segmented" role="group" aria-label="Stage">
          {STAGES.map(s => (
            <button type="button" key={s} aria-pressed={stage === s} onClick={() => selectStage(s)}>
              <span className={`sf-dot sf-tone-${STAGE_TONE[s]}`} aria-hidden="true" />
              <span>{s}</span>
              <span className="sf-chip-count">{tabCounts[s].count}</span>
              {s !== 'Approved' && tabCounts[s].late > 0 && <span className="sf-chip-late">{tabCounts[s].late} late</span>}
            </button>
          ))}
        </div>
        <div className="sf-selects">
          <label>
            <span>Plant</span>
            <select value={sfPlantFilter} onChange={event => setSfPlantFilter(event.target.value)}>
              <option value="All">All Plants ({enriched.length})</option>
              {plants.map(plant => <option key={plant} value={plant}>{plant} ({plantCounts.get(plant) || 0})</option>)}
            </select>
          </label>
          <label>
            <span>Sort</span>
            <select value={sort} onChange={event => setSort(event.target.value)}>
              <option value="overdue">Most overdue first</option>
              <option value="received">Newest die received</option>
              <option value="plant">By plant</option>
            </select>
          </label>
        </div>
      </div>

      <div className="sf-work">
        <section className="sf-card sf-list" aria-labelledby="sf-list-title">
          <header className="sf-list-head">
            <h2 id="sf-list-title">{stage} · {plural(stageRows.length, 'die')}</h2>
            <span>{sort === 'overdue' ? STAGE_HINT[stage] : SORT_HINT[sort]}</span>
          </header>
          {bands.map(band => (
            <div key={band.key} role="group" aria-label={band.label}>
              <div className="sf-band-head">
                <span className={`sf-band-label sf-band-${band.tone}`}>{band.label}</span>
                <span className="sf-mono">{band.rows.length}</span>
              </div>
              {band.rows.map(row => {
                const isSelected = !showSampleFollowupForm && selected?.id === row.id;
                const stripe = row.late ? 'late' : row.status === 'Approved' ? 'approved' : 'open';
                return (
                  <button type="button" key={row.id} className={`sf-row${isSelected ? ' is-selected' : ''}`} aria-current={isSelected ? 'true' : undefined} onClick={() => selectRow(row)}>
                    <span className={`sf-row-stripe sf-stripe-${stripe}`} aria-hidden="true" />
                    <span className="sf-row-main">
                      <span className="sf-row-die">{row.die || row.profile || 'Untitled die'}</span>
                      <span className="sf-row-meta">{[row.profile, row.press, row.customer].filter(Boolean).join(' · ') || 'No details yet'}</span>
                    </span>
                    <span className="sf-row-side">
                      <span className={`sf-day-chip${row.late ? ' is-late' : ''}`}>
                        {row.days !== null ? `${row.days}d ${row.submission_date ? 'to submit' : 'waiting'}`
                          : row.die_received_date ? 'No submit date' : 'No received date'}
                      </span>
                      <span className={`sf-row-status sf-status-text-${sampleStatusClass(row.status)}`}>{row.status}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {!bands.length && (
            <div className="sf-empty">
              <ClipboardList size={26} aria-hidden="true" />
              <p>{!sampleFollowups.length ? 'No sample followups yet.'
                : searchTerm ? `No ${stage.toLowerCase()} dies match “${searchTerm}”.`
                : `No dies are at ${stage.toLowerCase()}.`}</p>
              {!sampleFollowups.length
                ? <button type="button" className="sf-button" onClick={addSample}><Plus size={14} />Add Record</button>
                : searchTerm && <button type="button" className="sf-button" onClick={() => setSearchTerm('')}>Clear search</button>}
            </div>
          )}
        </section>

        {showSampleFollowupForm ? (
          <section className="sf-card sf-pane" aria-labelledby="sf-form-title">
            <header className="sf-pane-head">
              <div className="sf-pane-title">
                <h2 id="sf-form-title" className="sf-form-title">{editingSampleFollowup ? `Edit ${editingSampleFollowup.die || 'sample'}` : 'New sample followup'}</h2>
              </div>
              <button type="button" className="sf-icon-button" disabled={saving} aria-label="Close form" onClick={closeForm}><X size={18} /></button>
            </header>
            <div className="sf-pane-body">
              <SampleFollowupForm value={sampleFollowupForm} onChange={setSampleFollowupForm} onSubmit={handleSampleFollowupSubmit} onCancel={closeForm} editing={Boolean(editingSampleFollowup)} busy={saving} correctors={correctors} correctorsError={correctorsError} theme={theme} />
            </div>
          </section>
        ) : selected ? (
          <SampleFollowupDetail
            sample={selected} trials={trialsOf(selected)} parent={trialParentOf(selected)} today={today}
            theme={theme} user={user} correctors={correctors} correctorsError={correctorsError}
            onEdit={editSample} onDelete={handleDeleteSampleFollowup} onSaveDate={saveSfFields} onSaveField={saveSfField}
            onTrialsChanged={fetchSampleTrials} setToast={setToast} />
        ) : (
          <section className="sf-card sf-pane sf-empty">
            <p>Pick a die from the list to see its timeline and trials.</p>
          </section>
        )}
      </div>
    </section>
  );
}
