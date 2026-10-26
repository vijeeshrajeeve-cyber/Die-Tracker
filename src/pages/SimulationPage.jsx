import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, X, Cpu, Download, RefreshCw } from 'lucide-react';
import { simulationAPI } from '../api';
import { dialogs } from '../components/ui/DialogProvider';
import { exportToExcel } from '../utils/exportExcel';
import { todayLocal } from '../utils/today';
import { SIMULATION_STAGE_LABELS } from '../utils/constants';
import SimulationDetail from '../components/simulation/SimulationDetail';
import {
  SIM_STAGES, LATE_STAGES, TARGET_WORKING_DAYS, scopeDies, sortDies, bandsFor, stageSummary,
  modelToResult, topReason, plural,
} from '../utils/simulationView';
import '../styles/sample-followup.css';
import '../styles/simulation.css';

const SORT_HINT = { overdue: 'Late first, then longest at this stage', newest: 'Most recent stage start first', plant: 'By plant' };

export default function SimulationPage({ theme, user, data, setData, setToast, searchTerm, setSearchTerm, setSelectedOrder }) {
  const [dies, setDies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [stage, setStage] = useState('model_received');
  const [plant, setPlant] = useState('All');
  const [sort, setSort] = useState('overdue');
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const today = todayLocal();

  const notify = useCallback((message, type) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), type === 'error' ? 5000 : 3000);
  }, [setToast]);

  const load = useCallback(async () => {
    try {
      const { dies: rows } = await simulationAPI.list();
      setDies(rows || []);
      setLoadError(null);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const plantScope = useMemo(() => scopeDies(dies, { plant }), [dies, plant]);
  const scoped = useMemo(() => scopeDies(plantScope, { search: searchTerm || '' }), [plantScope, searchTerm]);
  const summary = useMemo(() => stageSummary(plantScope), [plantScope]);
  const tabCounts = useMemo(() => stageSummary(scoped), [scoped]);
  const pace = useMemo(() => modelToResult(plantScope, today), [plantScope, today]);
  const reason = useMemo(() => topReason(plantScope, today), [plantScope, today]);
  const stageRows = useMemo(() => sortDies(scoped.filter(d => d.stage === stage), sort), [scoped, stage, sort]);
  const bands = sort === 'overdue' ? bandsFor(stage, stageRows) : (stageRows.length ? [{ key: 'all', label: SORT_HINT[sort], tone: 'open', rows: stageRows }] : []);
  const plants = useMemo(() => [...new Set(dies.map(d => d.plant).filter(Boolean))].sort(), [dies]);
  const lateTotal = plantScope.filter(d => d.late).length;

  // Keep the selection on the visible list; fall back to its first die.
  const selected = stageRows.find(d => d.order_id === selectedId) || stageRows[0] || null;

  const applyResult = ({ die, order }) => {
    if (order) {
      setData(prev => prev.map(o => (o.id === order.id ? { ...o, ...order, changeCount: (o.changeCount || 0) + 1 } : o)));
    }
    setDies(prev => (die.stage
      ? prev.map(d => (d.order_id === die.order_id ? die : d))
      : prev.filter(d => d.order_id !== die.order_id)));
    if (die.stage) { setStage(die.stage); setSelectedId(die.order_id); }
  };

  const run = async (action, success) => {
    setBusy(true);
    try {
      applyResult(await action());
      notify(success, 'success');
    } catch (error) {
      notify(error.message, 'error');
      // 409: someone else moved this die on, or it left Simulation.
      if (error.status === 409) await load();
    } finally {
      setBusy(false);
    }
  };

  const recordStep = (payload) => {
    const label = { model_received: '3D model received', prep_done: 'Preparation done',
      sim_completed: payload.result === 'OK' ? 'Simulation OK — moved to Design Approval'
        : payload.modification === 'Supplier' ? 'Sent back to the supplier as a new revision' : 'Simulation Not OK — in-house modification',
      modification_done: 'Modification done — next round started' }[payload.step];
    return run(() => simulationAPI.recordStep(selected.order_id, payload), label);
  };

  const undo = async () => {
    const ok = await dialogs.confirm({
      title: `Undo last step on ${selected.die_no || 'this die'}`,
      message: 'This removes the most recent step entry. It cannot be undone.',
      confirmLabel: 'Undo step',
    });
    if (ok) await run(() => simulationAPI.undoLastStep(selected.order_id), 'Last step undone');
  };

  const openOrder = () => {
    const order = data.find(o => o.id === selected.order_id);
    if (order) setSelectedOrder(order);
  };

  const handleExport = async () => {
    const rows = sortDies(scopeDies(dies, { plant, search: searchTerm || '' }), 'plant');
    await exportToExcel({
      filename: 'simulation',
      sheets: [
        {
          name: 'Dies', rows,
          columns: [
            { key: 'die_no', label: 'Die' }, { key: 'order_no', label: 'Order' }, { key: 'plant', label: 'Plant' },
            { key: 'supplier', label: 'Supplier' }, { key: 'stage_label', label: 'Stage' }, { key: 'round_no', label: 'Round' },
            { key: 'stage_since', label: 'At stage since', format: 'date' },
            { key: 'days_on_stage', label: 'Working days at stage', format: v => (v === null ? '' : v) },
            { key: 'late', label: `Past ${TARGET_WORKING_DAYS}-day target`, format: v => (v ? 'Yes' : 'No') },
          ],
        },
        {
          name: 'Rounds',
          rows: rows.flatMap(d => d.rounds.map(r => ({ ...r, die_no: d.die_no, order_no: d.order_no, plant: d.plant, supplier: d.supplier }))),
          columns: [
            { key: 'die_no', label: 'Die' }, { key: 'order_no', label: 'Order' }, { key: 'plant', label: 'Plant' },
            { key: 'supplier', label: 'Supplier' }, { key: 'round_no', label: 'Round' }, { key: 'started_from', label: 'Started from' },
            { key: 'model_received_date', label: '3D Model Received', format: 'date' },
            { key: 'prep_done_date', label: 'Preparation Done', format: 'date' },
            { key: 'sim_completed_date', label: 'Simulation Completed', format: 'date' },
            { key: 'result', label: 'Result' }, { key: 'fail_reason', label: 'Reason' }, { key: 'modification', label: 'Modification' },
            { key: 'modification_done_date', label: 'Modification Done', format: 'date' },
            { key: 'model_to_result_days', label: 'Working days model to result', format: v => (v === null || v === undefined ? '' : v) },
            { key: 'comments', label: 'Comments' },
          ],
        },
      ],
    });
  };

  return (
    <section className="sample-followup simulation" data-theme={theme.isDark ? 'dark' : 'light'} style={{
      '--sf-bg': theme.bg, '--sf-surface': theme.cardBg, '--sf-raised': theme.inputBg,
      '--sf-line': theme.cardBorder, '--sf-text': theme.text, '--sf-muted': theme.textMuted,
      '--sf-dim': theme.textDim || theme.textMuted, '--sf-shadow': theme.shadowSm || '0 1px 2px rgba(0,0,0,.28)',
      '--sf-hover': theme.rowHover || 'rgba(255,255,255,.04)',
    }}>
      <header className="sf-header">
        <div className="sf-heading">
          <div className="sf-icon-tile" aria-hidden="true"><Cpu size={24} /></div>
          <div>
            <h1>Simulation</h1>
            <p>{plantScope.length
              ? `${lateTotal} of ${plural(plantScope.length, 'die')} ${lateTotal === 1 ? 'is' : 'are'} past the ${TARGET_WORKING_DAYS}-day simulation target`
              : 'No dies in simulation'}</p>
          </div>
        </div>
        <div className="sf-header-actions">
          <label className="sf-search">
            <Search size={18} aria-hidden="true" />
            <input aria-label="Search die, order or supplier" placeholder="Die, order, supplier" value={searchTerm || ''} onChange={e => setSearchTerm(e.target.value)} />
            {searchTerm && <button type="button" className="sf-icon-button" aria-label="Clear search" onClick={() => setSearchTerm('')}><X size={14} /></button>}
          </label>
          <button type="button" className="sf-button sf-button-header" aria-label="Refresh" onClick={() => load()}><RefreshCw size={16} /></button>
          <button type="button" className="sf-button sf-button-header" disabled={!dies.length}
            onClick={() => handleExport().catch(error => notify(`Export failed: ${error.message}`, 'error'))}><Download size={16} />Export</button>
        </div>
      </header>

      <div className="sf-summary">
        <section className="sf-card sf-summary-card" aria-labelledby="sim-sum-stages">
          <h2 id="sim-sum-stages" className="sf-card-label">Where the dies sit</h2>
          <div className="sf-stage-cols">
            {SIM_STAGES.map(s => (
              <div key={s} className={`sf-stage-col sim-tone-${s}`}>
                <p className="sf-stage-col-label" title={SIMULATION_STAGE_LABELS[s]}>{SIMULATION_STAGE_LABELS[s]}</p>
                <div className="sf-stage-col-count"><span className="sf-big-num">{summary[s].count}</span><span>{summary[s].count === 1 ? 'die' : 'dies'}</span></div>
                {LATE_STAGES.includes(s) && (
                  <p className={`sf-stage-col-note${summary[s].late ? ' is-late' : ''}`}>{summary[s].late ? `${summary[s].late} late` : 'None late'}</p>
                )}
              </div>
            ))}
          </div>
        </section>
        <section className="sf-card sf-summary-card" aria-labelledby="sim-sum-pace">
          <h2 id="sim-sum-pace" className="sf-card-label">Model to result</h2>
          <div className="sf-pace">
            <span className="sf-big-num sf-pace-num">{pace.current === null ? '—' : pace.current.toFixed(1)}</span>
            <span>{pace.current === null ? 'no results, last 90 days' : 'working days avg, last 90 days'}</span>
          </div>
          <p className="sf-card-foot">Target {TARGET_WORKING_DAYS} · {pace.previous === null
            ? 'no results in the previous 90 days' : `was ${pace.previous.toFixed(1)} in the previous 90 days`}</p>
        </section>
        <section className="sf-card sf-summary-card" aria-labelledby="sim-sum-reason">
          <h2 id="sim-sum-reason" className="sf-card-label">Top Not OK reason</h2>
          {reason ? (
            <>
              <p style={{ fontWeight: 600 }}>{reason.reason}</p>
              <p className="sf-card-foot">{reason.count} of {plural(reason.total, 'Not OK round')}, last 90 days</p>
            </>
          ) : <p className="sf-card-foot">No Not OK rounds in the last 90 days</p>}
        </section>
      </div>

      <div className="sf-filterbar">
        <div className="sf-segmented" role="group" aria-label="Stage">
          {SIM_STAGES.map(s => (
            <button type="button" key={s} aria-pressed={stage === s} onClick={() => { setStage(s); setSelectedId(null); }}>
              <span className={`sf-dot sim-tone-${s}`} aria-hidden="true" />
              <span>{SIMULATION_STAGE_LABELS[s]}</span>
              <span className="sf-chip-count">{tabCounts[s].count}</span>
              {tabCounts[s].late > 0 && <span className="sf-chip-late">{tabCounts[s].late} late</span>}
            </button>
          ))}
        </div>
        <div className="sf-selects">
          <label>
            <span>Plant</span>
            <select value={plant} onChange={e => setPlant(e.target.value)}>
              <option value="All">All Plants ({dies.length})</option>
              {plants.map(p => <option key={p} value={p}>{p} ({dies.filter(d => d.plant === p).length})</option>)}
            </select>
          </label>
          <label>
            <span>Sort</span>
            <select value={sort} onChange={e => setSort(e.target.value)}>
              <option value="overdue">Most overdue first</option>
              <option value="newest">Newest at stage</option>
              <option value="plant">By plant</option>
            </select>
          </label>
        </div>
      </div>

      <div className="sf-work">
        <section className="sf-card sf-list" aria-labelledby="sim-list-title">
          <header className="sf-list-head">
            <h2 id="sim-list-title">{SIMULATION_STAGE_LABELS[stage]} · {plural(stageRows.length, 'die')}</h2>
            <span>{SORT_HINT[sort]}</span>
          </header>
          {bands.map(band => (
            <div key={band.key} role="group" aria-label={band.label}>
              <div className="sf-band-head">
                <span className={`sf-band-label ${band.tone === 'late' ? 'sf-band-late' : 'sf-band-inside'}`}>{band.label}</span>
                <span className="sf-mono">{band.rows.length}</span>
              </div>
              {band.rows.map(row => {
                const isSelected = selected?.order_id === row.order_id;
                return (
                  <button type="button" key={row.order_id} className={`sf-row${isSelected ? ' is-selected' : ''}`}
                    aria-current={isSelected ? 'true' : undefined} onClick={() => setSelectedId(row.order_id)}>
                    <span className={`sf-row-stripe ${row.late ? 'sf-stripe-late' : 'sf-stripe-open'}`} aria-hidden="true" />
                    <span className="sf-row-main">
                      <span className="sf-row-die">{row.die_no || row.order_no || 'Untitled die'}</span>
                      <span className="sf-row-meta">{[row.order_no, row.supplier, `Round ${row.round_no}`].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="sf-row-side">
                      <span className={`sf-day-chip${row.late ? ' is-late' : ''}`}>{row.days_on_stage === null ? 'No start date' : `${row.days_on_stage}d`}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {!bands.length && (
            <div className="sf-empty">
              <Cpu size={26} aria-hidden="true" />
              <p>{loading ? 'Loading…'
                : loadError ? `Could not load simulation: ${loadError}`
                : searchTerm ? `No dies at ${SIMULATION_STAGE_LABELS[stage].toLowerCase()} match “${searchTerm}”.`
                : `No dies at ${SIMULATION_STAGE_LABELS[stage].toLowerCase()}.`}</p>
              {loadError && <button type="button" className="sf-button" onClick={() => load()}>Try again</button>}
            </div>
          )}
        </section>

        {selected ? (
          <SimulationDetail die={selected} user={user} busy={busy} onStep={recordStep} onUndo={undo} onOpenOrder={openOrder} />
        ) : (
          <section className="sf-card sf-pane sf-empty">
            <p>Pick a die from the list to see its rounds.</p>
          </section>
        )}
      </div>
    </section>
  );
}
