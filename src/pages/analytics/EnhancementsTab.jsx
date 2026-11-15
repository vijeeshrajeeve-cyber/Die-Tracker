import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, LabelList } from 'recharts';
import { RefreshCw, FileText, FileSpreadsheet } from 'lucide-react';
import { enhancementSummaryAPI } from '../../api';
import MetricCard from '../../components/analytics/MetricCard';
import { exportToExcel } from '../../utils/exportExcel';
import { downloadBlob } from '../../utils/downloadBlob';
import { buildEnhancementSheets, enhancementReportFilename } from '../../utils/enhancementReport';

// Design enhancement projects: how many were started and finished, how often
// the target was reached, and how the real numbers moved against the baseline.
// Counting rules live in server/services/enhancementSummary.cjs. A number that
// was never recorded is "not recorded", never 0.

const DASH = 'not recorded';
const VERDICT_COLORS = { achieved: '#16A34A', partly: '#D97706', notAchieved: '#DC2626' };
const STARTED_COLOR = '#3B82F6';
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const tooltipStyle = { background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', padding: '10px 14px' };

const NUMBERS = [
  { key: 'productivity', label: 'Productivity', unit: 'kg/h', higherIsBetter: true },
  { key: 'recovery', label: 'Recovery', unit: '%', higherIsBetter: true },
  { key: 'failure', label: 'Failure', unit: '%', higherIsBetter: false },
];

const GROUPS = [
  { id: 'completed', label: 'Completed in period' },
  { id: 'started', label: 'Started in period' },
  { id: 'open', label: 'Open at end of period' },
];

const fmt = (v) => (v === null || v === undefined ? DASH : `${Number(v.toFixed(1))}`);
const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const monthLabel = (key) => `${MONTH_LABELS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;

function ChangeCard({ theme, spec, figures }) {
  const { baseline, actual, change, count } = figures;
  let verdict = null;
  if (change !== null && change !== 0) {
    verdict = (change > 0) === spec.higherIsBetter ? { text: 'better', color: '#16A34A' } : { text: 'worse', color: '#DC2626' };
  } else if (change === 0) {
    verdict = { text: 'no change', color: theme.textDim };
  }
  return (
    <div style={{ padding: 16, borderRadius: 10, border: `1px solid ${theme.cardBorder}`, background: theme.cardBg }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: theme.textMuted }}>{spec.label} ({spec.unit})</div>
      {count === 0 ? (
        <div style={{ marginTop: 12, fontSize: 13, color: theme.textDim }}>Not tracked yet — no completed project has both a baseline and an actual.</div>
      ) : (
        <>
          <div style={{ marginTop: 12, fontSize: 26, fontWeight: 700, color: theme.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
            {change > 0 ? '+' : ''}{fmt(change)} <span style={{ fontSize: 12, fontWeight: 500, color: theme.textDim }}>{spec.unit}</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: verdict.color, fontWeight: 600 }}>{verdict.text}</div>
          <div style={{ marginTop: 6, fontSize: 11, color: theme.textDim }}>
            Average {fmt(baseline)} → {fmt(actual)} {spec.unit} · {count} {count === 1 ? 'project' : 'projects'}
          </div>
        </>
      )}
    </div>
  );
}

// baseline → target → actual for one number
function Triple({ theme, figures }) {
  const part = (v) => (v === null ? <span style={{ color: theme.textDim }}>—</span> : fmt(v));
  const label = `baseline ${fmt(figures.baseline)}, target ${fmt(figures.target)}, actual ${fmt(figures.actual)}`;
  return (
    <span aria-label={label} title={label}>
      {part(figures.baseline)} → {part(figures.target)} → <strong>{part(figures.actual)}</strong>
    </span>
  );
}

export default function EnhancementsTab({ theme, active, onOpenOrder }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [group, setGroup] = useState('completed');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadedPeriod, setLoadedPeriod] = useState(null); // the dates `summary` was built for
  const [exporting, setExporting] = useState('');          // '' | 'pdf' | 'excel'
  const [exportError, setExportError] = useState('');
  const requestId = useRef(0);

  // From / to override the year; either one left blank falls back to the year's edge.
  const effFrom = from || `${year}-01-01`;
  const effTo = to || `${year}-12-31`;
  const badRange = effFrom > effTo;

  const load = useCallback(async () => {
    if (badRange) return;
    // A slower earlier response must not overwrite a newer one (year switched quickly).
    const mine = ++requestId.current;
    setLoading(true); setError('');
    try {
      const data = await enhancementSummaryAPI.get(effFrom, effTo);
      if (mine !== requestId.current) return;
      setSummary(data);
      setLoadedPeriod({ from: effFrom, to: effTo });
    } catch (e) {
      if (mine !== requestId.current) return;
      setError(e.message || 'Could not load the enhancement summary.');
    } finally {
      if (mine === requestId.current) setLoading(false);
    }
  }, [effFrom, effTo, badRange]);

  // Panels stay mounted while hidden: fetch when the tab is opened or the period changes.
  useEffect(() => { if (active) load(); }, [active, load]);

  const card = { background: theme.cardBg, borderRadius: 8, padding: '1.5rem', border: `1px solid ${theme.cardBorder}`, boxShadow: theme.shadowSm };
  const field = { padding: '7px 10px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, color: theme.text, fontSize: '0.8rem' };
  const th = { padding: '0.6rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 500, color: theme.textMuted, background: theme.tableBg, borderBottom: `1px solid ${theme.cardBorder}`, whiteSpace: 'nowrap' };
  const td = { padding: '0.6rem 0.75rem', borderBottom: `1px solid ${theme.cardBorder}`, fontSize: '0.85rem', color: theme.text, verticalAlign: 'top' };

  // The report is exactly what is on screen: the loaded summary, for its own dates.
  const reportReady = Boolean(summary && loadedPeriod && loadedPeriod.from === effFrom && loadedPeriod.to === effTo) && !loading;
  const downloadPdf = async () => {
    setExporting('pdf'); setExportError('');
    try {
      downloadBlob(await enhancementSummaryAPI.exportPdf(effFrom, effTo), enhancementReportFilename(effFrom, effTo, 'pdf'));
    } catch (e) {
      setExportError(e.message || 'Could not create the PDF.');
    } finally { setExporting(''); }
  };
  const downloadExcel = async () => {
    setExporting('excel'); setExportError('');
    try {
      await exportToExcel({ sheets: buildEnhancementSheets(summary), filename: enhancementReportFilename(effFrom, effTo, 'xlsx') });
    } catch (e) {
      setExportError(e.message || 'Could not create the Excel file.');
    } finally { setExporting(''); }
  };

  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);

  const controls = (
    <div className="no-print" style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
      <label style={{ fontSize: '0.75rem', color: theme.textMuted, display: 'grid', gap: 4 }}>Year
        <select value={year} onChange={(e) => { setYear(Number(e.target.value)); setFrom(''); setTo(''); }} style={field}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
      <label style={{ fontSize: '0.75rem', color: theme.textMuted, display: 'grid', gap: 4 }}>From
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={field} />
      </label>
      <label style={{ fontSize: '0.75rem', color: theme.textMuted, display: 'grid', gap: 4 }}>To
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={field} />
      </label>
      {(from || to) && (
        <button onClick={() => { setFrom(''); setTo(''); }} style={{ ...field, cursor: 'pointer' }}>Use the whole year</button>
      )}
      <button onClick={load} disabled={loading || badRange} aria-label="Refresh enhancement summary"
        style={{ ...field, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: loading ? 'default' : 'pointer', marginLeft: 'auto' }}>
        <RefreshCw size={14} /> {loading ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );

  const heading = (
    <div style={{ marginBottom: '1rem' }}>
      <h2 style={{ fontSize: '1.05rem', fontWeight: 600, color: theme.text, margin: 0 }}>Design enhancements · {fmtDate(effFrom)} to {fmtDate(effTo)}</h2>
      <p style={{ fontSize: '0.8rem', color: theme.textDim, margin: '4px 0 0' }}>
        Started by the day the order was marked, completed by the day of the final verdict. Cancelled orders are left out. Success rate is Achieved ÷ completed.
      </p>
    </div>
  );

  if (badRange) {
    return <div>{heading}{controls}<div role="alert" style={{ ...card, color: '#DC2626' }}>The From date is after the To date.</div></div>;
  }
  if (error) {
    return <div>{heading}{controls}<div role="alert" style={{ ...card, color: '#DC2626' }}>{error} <button onClick={load} style={{ marginLeft: 8, color: '#3B82F6', background: 'none', border: 'none', cursor: 'pointer' }}>Try again</button></div></div>;
  }
  if (!summary) {
    return <div>{heading}{controls}<div style={{ ...card, color: theme.textDim }}>{loading ? 'Loading enhancement summary…' : ''}</div></div>;
  }

  const { totals, months, averages } = summary;
  const rows = summary[group] || [];
  const chartData = months.map((m) => ({ ...m, label: monthLabel(m.month) }));
  const segment = (v) => (v || '');
  const metrics = [
    { metric: { key: 'enh-started', label: 'Projects started', decimals: 0, blurb: 'Marked as a design enhancement in the period' }, value: totals.started },
    { metric: { key: 'enh-completed', label: 'Projects completed', decimals: 0, blurb: `${totals.achieved} achieved · ${totals.partly} partly · ${totals.notAchieved} not achieved` }, value: totals.completed },
    { metric: { key: 'enh-success', label: 'Success rate', decimals: 0, unit: '%', blurb: `${totals.achieved} of ${totals.completed} completed were Achieved` }, value: totals.successRate === null ? null : totals.successRate * 100 },
    { metric: { key: 'enh-awaiting', label: 'Awaiting life review', decimals: 0, blurb: 'At the end of the period' }, value: totals.awaitingLifeReview },
    { metric: { key: 'enh-open', label: 'Open', decimals: 0, blurb: 'No final verdict at the end of the period' }, value: totals.open },
  ];

  return (
    <div>
      {heading}
      {controls}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {metrics.map((m) => <MetricCard key={m.metric.key} metric={m.metric} value={m.value} theme={theme} />)}
      </div>

      <div style={{ ...card, marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.25rem', color: theme.text }}>Projects by month</h3>
        <p style={{ fontSize: '0.75rem', color: theme.textDim, margin: '0 0 1rem' }}>
          Left bar: projects started. Right bar: projects completed, split by verdict. The number in each segment is its count.
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} margin={{ top: 20, right: 16, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} />
            <YAxis axisLine={false} tickLine={false} allowDecimals={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={28} />
            <Tooltip cursor={{ fill: 'rgba(148,163,184,0.12)' }} contentStyle={tooltipStyle} itemStyle={{ color: '#FFFFFF', fontWeight: 500 }} labelStyle={{ color: '#94A3B8', marginBottom: 4 }} />
            <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="started" name="Started" stackId="started" fill={STARTED_COLOR} maxBarSize={22}>
              <LabelList dataKey="started" position="top" fill="#94A3B8" fontSize={11} fontWeight={600} formatter={segment} />
            </Bar>
            <Bar dataKey="achieved" name="Achieved" stackId="completed" fill={VERDICT_COLORS.achieved} maxBarSize={22}>
              <LabelList dataKey="achieved" position="center" fill="#FFFFFF" fontSize={10} fontWeight={700} formatter={segment} />
            </Bar>
            <Bar dataKey="partly" name="Partly achieved" stackId="completed" fill={VERDICT_COLORS.partly} maxBarSize={22}>
              <LabelList dataKey="partly" position="center" fill="#FFFFFF" fontSize={10} fontWeight={700} formatter={segment} />
            </Bar>
            <Bar dataKey="notAchieved" name="Not achieved" stackId="completed" fill={VERDICT_COLORS.notAchieved} maxBarSize={22}>
              <LabelList dataKey="notAchieved" position="center" fill="#FFFFFF" fontSize={10} fontWeight={700} formatter={segment} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="no-print" style={{ ...card, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: theme.text }}>Enhancement report</h3>
          <p style={{ fontSize: '0.75rem', color: theme.textDim, margin: '4px 0 0' }}>
            The summary, the monthly chart and the three project lists for {fmtDate(effFrom)} to {fmtDate(effTo)}. Change the dates above to change the period.
          </p>
          {exportError && <div role="alert" style={{ fontSize: '0.8rem', color: '#DC2626', marginTop: 6 }}>{exportError}</div>}
        </div>
        <button onClick={downloadPdf} disabled={!reportReady || Boolean(exporting)}
          style={{ ...field, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: reportReady && !exporting ? 'pointer' : 'default' }}>
          <FileText size={14} /> {exporting === 'pdf' ? 'Creating PDF…' : 'PDF'}
        </button>
        <button onClick={downloadExcel} disabled={!reportReady || Boolean(exporting)}
          style={{ ...field, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: reportReady && !exporting ? 'pointer' : 'default' }}>
          <FileSpreadsheet size={14} /> {exporting === 'excel' ? 'Creating Excel…' : 'Excel'}
        </button>
      </div>

      <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.25rem', color: theme.text }}>Average change on completed projects</h3>
      <p style={{ fontSize: '0.75rem', color: theme.textDim, margin: '0 0 0.75rem' }}>Actual against baseline, over the completed projects that have both numbers.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {NUMBERS.map((n) => <ChangeCard key={n.key} theme={theme} spec={n} figures={averages[n.key]} />)}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: theme.text, flex: 1 }}>Projects</h3>
          <div role="tablist" aria-label="Project group" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {GROUPS.map((g) => (
              <button key={g.id} role="tab" aria-selected={group === g.id} onClick={() => setGroup(g.id)}
                style={{ ...field, cursor: 'pointer', fontWeight: group === g.id ? 700 : 500, borderColor: group === g.id ? '#1F6FB0' : theme.cardBorder }}>
                {g.label} ({summary[g.id].length})
              </button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? (
          <div style={{ color: theme.textDim, fontSize: '0.85rem' }}>No projects in this group for the period.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <p style={{ fontSize: '0.75rem', color: theme.textDim, margin: '0 0 0.5rem' }}>Each number reads baseline → target → actual.</p>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th scope="col" style={th}>Die no</th>
                  <th scope="col" style={th}>Profile</th>
                  <th scope="col" style={th}>Supplier</th>
                  <th scope="col" style={th}>Current issue</th>
                  <th scope="col" style={th}>Productivity (kg/h)</th>
                  <th scope="col" style={th}>Recovery (%)</th>
                  <th scope="col" style={th}>Failure (%)</th>
                  <th scope="col" style={th}>Verdict</th>
                  <th scope="col" style={th}>State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const openOrder = () => onOpenOrder && onOpenOrder(p.die_order_id);
                  return (
                    <tr key={p.die_order_id} onClick={onOpenOrder ? openOrder : undefined}
                      style={{ cursor: onOpenOrder ? 'pointer' : 'default' }}>
                      <th scope="row" style={{ ...td, fontWeight: 600, textAlign: 'left' }}>
                        {onOpenOrder
                          ? <button onClick={(e) => { e.stopPropagation(); openOrder(); }} style={{ background: 'none', border: 'none', padding: 0, color: '#3B82F6', fontWeight: 600, cursor: 'pointer', fontSize: 'inherit' }}>{p.die_no}</button>
                          : p.die_no}
                      </th>
                      <td style={td}>{p.profile || '—'}</td>
                      <td style={td}>{p.supplier || '—'}</td>
                      <td style={{ ...td, maxWidth: 260 }}>{p.current_issue || '—'}</td>
                      <td style={td}><Triple theme={theme} figures={p.productivity} /></td>
                      <td style={td}><Triple theme={theme} figures={p.recovery} /></td>
                      <td style={td}><Triple theme={theme} figures={p.failure} /></td>
                      <td style={td}>
                        {p.final_verdict
                          ? <>{p.final_verdict}<div style={{ fontSize: '0.7rem', color: theme.textDim }}>{fmtDate(p.final_verdict_date)}</div></>
                          : (p.trial_verdict ? <>{p.trial_verdict}<div style={{ fontSize: '0.7rem', color: theme.textDim }}>trial verdict</div></> : '—')}
                      </td>
                      <td style={td}>{p.state}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
