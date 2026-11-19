import React, { useEffect, useRef, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
import { trialPlansAPI } from '../../api';
import {
  formatPlanDate, periodRange, previousPeriod, nextPeriod, periodLabel, showPct, delta, plural, TRIAL_PLANTS,
} from '../../utils/trialPlanView';

function Kpi({ label, value, note, change, tone }) {
  return (
    <div className={`tp-stat tp-tone-${tone}`}>
      <p className="tp-stat-label">{label}</p>
      <p className="sf-big-num tp-stat-num">{value}</p>
      {note && <p className="tp-stat-note">{note}</p>}
      {change && <p className={`tp-delta tp-delta-${change.tone}`}>{change.text}</p>}
    </div>
  );
}

// Week (Monday to Saturday) or month totals, against the period before. One
// plant, or both added together (plant '').
export default function TrialPlanSummary({ today, viewSwitch, onOpenDay, plant = '', setPlant }) {
  const [kind, setKind] = useState('week');
  const [range, setRange] = useState(() => periodRange('week', today));
  // Kept with the range it answers, so a stale answer is never shown for a new range.
  const [result, setResult] = useState({ key: null });
  const request = useRef(0);
  const key = `${range.from}:${range.to}:${plant}`;

  const switchKind = (next) => {
    setKind(next);
    setRange(periodRange(next, today));
  };

  useEffect(() => {
    const mine = ++request.current;
    const asked = `${range.from}:${range.to}:${plant}`;
    const before = previousPeriod(kind, range.from);
    Promise.all([
      trialPlansAPI.summary(range.from, range.to, plant),
      trialPlansAPI.summary(before.from, before.to, plant).catch(() => null),
    ]).then(([current, prior]) => {
      if (mine === request.current) setResult({ key: asked, data: current, previous: prior });
    }).catch(err => {
      if (mine === request.current) setResult({ key: asked, error: err.message || 'Could not load the summary' });
    });
  }, [kind, range, plant]);

  const fresh = result.key === key;
  const data = fresh ? result.data : null;
  const previous = fresh ? result.previous : null;
  const error = fresh ? result.error : '';
  const isCurrent = range.from <= today && today <= range.to;
  const t = data?.summary.trials;
  const p = previous?.summary.trials;
  const word = kind === 'week' ? 'week' : 'month';
  const where = plant || 'All plants';
  const allPlants = !plant;

  return (
    <>
      <header className="sf-header">
        <div className="sf-heading">
          <div className="sf-icon-tile" aria-hidden="true"><BarChart3 size={24} /></div>
          <div>
            <h1>Sample Followup</h1>
            <p>Trial summary · {where} · {periodLabel(kind, range)}{kind === 'week' ? ' · Monday to Saturday' : ''}</p>
          </div>
        </div>
      </header>

      <div className="tp-toolbar">
        {viewSwitch}
        <div className="sf-segmented" role="group" aria-label="Plant">
          <button type="button" aria-pressed={allPlants} onClick={() => setPlant('')}>All plants</button>
          {TRIAL_PLANTS.map(p => (
            <button key={p} type="button" aria-pressed={plant === p} onClick={() => setPlant(p)}>{p}</button>
          ))}
        </div>
        <div className="sf-segmented" role="group" aria-label="Period">
          <button type="button" aria-pressed={kind === 'week'} onClick={() => switchKind('week')}>Week</button>
          <button type="button" aria-pressed={kind === 'month'} onClick={() => switchKind('month')}>Month</button>
        </div>
        <div className="tp-datebar">
          <button type="button" className="tp-day-step" aria-label={`Previous ${word}`} onClick={() => setRange(previousPeriod(kind, range.from))}><ChevronLeft size={16} /></button>
          <span className="tp-date-text tp-period">{periodLabel(kind, range)}</span>
          <button type="button" className="tp-day-step" aria-label={`Next ${word}`} onClick={() => setRange(nextPeriod(kind, range.to))}><ChevronRight size={16} /></button>
        </div>
        {!isCurrent && <button type="button" className="sf-button sf-button-tint" onClick={() => setRange(periodRange(kind, today))}>This {word}</button>}
      </div>

      {error && <div className="sf-card tp-banner tp-banner-error" role="alert">{error}</div>}
      {!data && !error && <div className="sf-card tp-banner">Loading the summary…</div>}

      {data && (
        <>
          <section className="sf-card tp-summary-strip" aria-label="Totals">
            <h2 className="sf-card-label">Trials this {word} · {where}{previous ? ` · compared with the ${word} before` : ''}</h2>
            <div className="tp-stats">
              <Kpi label="Planned" value={t.planned} tone="accent" change={delta(t.planned, p?.planned)} />
              <Kpi label="Done" value={t.done} note={`of ${t.planned} run`} tone="blue" change={delta(t.done, p?.done)} />
              <Kpi label="OK" value={t.ok} tone="ok" change={delta(t.ok, p?.ok)} />
              <Kpi label="Not OK" value={t.notOk} tone="bad" change={delta(t.notOk, p?.notOk, { better: 'down' })} />
              <Kpi label="Not run" value={t.notRun} note={t.awaiting ? `${t.awaiting} awaiting a result` : null} tone="muted" change={delta(t.notRun, p?.notRun, { better: 'down' })} />
              <Kpi label="Run ratio" value={showPct(t.runRatio)} note="done / planned" tone="muted" change={delta(t.runRatio, p?.runRatio, { unit: ' pts' })} />
              <Kpi label="Fail ratio" value={showPct(t.failRatio)} note="not OK / done" tone="muted" change={delta(t.failRatio, p?.failRatio, { better: 'down', unit: ' pts' })} />
              <Kpi label="Supervised" value={data.summary.supervised.done} note={`of ${data.summary.supervised.planned} run`} tone="warn" />
            </div>
          </section>

          <div className="tp-summary-grid">
            <section className="sf-card tp-plan" aria-labelledby="tp-byday-title">
              <header className="sf-list-head"><h2 id="tp-byday-title">By day</h2><span>{plural(data.byDay.length, allPlants ? 'plan' : 'planned day')}</span></header>
              {data.byDay.length ? (
                <div className="tp-table-scroll">
                  <table className="tp-table tp-num-table">
                    <thead><tr><th>Day</th>{allPlants && <th>Plant</th>}<th>Planned</th><th>Done</th><th>OK</th><th>Not OK</th><th>Not run</th><th>Run</th><th>Fail</th><th>Supervised</th></tr></thead>
                    <tbody>
                      {data.byDay.map(d => (
                        <tr key={`${d.date}|${d.plant}`}>
                          <td><button type="button" className="sf-text-button" onClick={() => onOpenDay(d.date, d.plant)}>{formatPlanDate(d.date)}</button></td>
                          {allPlants && <td>{d.plant}</td>}
                          <td>{d.planned}</td><td>{d.done}</td><td>{d.ok}</td><td>{d.notOk}</td><td>{d.notRun}</td>
                          <td>{showPct(d.runRatio)}</td><td>{showPct(d.failRatio)}</td><td>{d.supervised}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="tp-empty-note">No plans in this {word}.</p>}
            </section>

            <section className="sf-card tp-plan" aria-labelledby="tp-bypress-title">
              <header className="sf-list-head"><h2 id="tp-bypress-title">By press</h2></header>
              {data.summary.byPress.length ? (
                <div className="tp-table-scroll">
                  <table className="tp-table tp-num-table">
                    <thead><tr><th>Press</th><th>Planned</th><th>Done</th><th>OK</th><th>Not OK</th><th>Run</th><th>Fail</th><th>Supervised</th></tr></thead>
                    <tbody>
                      {data.summary.byPress.map(row => (
                        <tr key={row.press}>
                          <td>{row.press}</td><td>{row.planned}</td><td>{row.done}</td><td>{row.ok}</td><td>{row.notOk}</td>
                          <td>{showPct(row.runRatio)}</td><td>{showPct(row.failRatio)}</td><td>{row.supervised}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="tp-empty-note">No presses planned.</p>}
            </section>

            <section className="sf-card tp-card" aria-labelledby="tp-reasons-title">
              <h2 id="tp-reasons-title" className="sf-card-label">Failure reasons</h2>
              {data.summary.failReasons.length ? (
                <ul className="sf-plant-bars tp-reason-bars">
                  {(() => {
                    const max = Math.max(...data.summary.failReasons.map(f => f.count));
                    return data.summary.failReasons.map(f => (
                      <li key={f.reason}>
                        <span className="tp-reason-name" title={f.reason}>{f.reason}</span>
                        <span className="sf-bar" role="img" aria-label={`${f.count} trials`}><span style={{ width: `${(f.count / max) * 100}%` }} /></span>
                        <span className="sf-mono sf-plant-ratio">{f.count}</span>
                      </li>
                    ));
                  })()}
                </ul>
              ) : <p className="sf-card-foot">No failed trials this {word}.</p>}
            </section>

            <section className="sf-card tp-card" aria-labelledby="tp-notrun-title">
              <h2 id="tp-notrun-title" className="sf-card-label">Why trials did not run</h2>
              {data.summary.notRunReasons?.length ? (
                <ul className="sf-plant-bars tp-reason-bars">
                  {(() => {
                    const max = Math.max(...data.summary.notRunReasons.map(f => f.count));
                    return data.summary.notRunReasons.map(f => (
                      <li key={f.reason}>
                        <span className="tp-reason-name" title={f.reason}>{f.reason}</span>
                        <span className="sf-bar" role="img" aria-label={`${f.count} trials`}><span style={{ width: `${(f.count / max) * 100}%` }} /></span>
                        <span className="sf-mono sf-plant-ratio">{f.count}</span>
                      </li>
                    ));
                  })()}
                </ul>
              ) : <p className="sf-card-foot">Every planned trial ran this {word}.</p>}
            </section>
          </div>
        </>
      )}
    </>
  );
}
