import React, { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, LabelList } from 'recharts';
import { RefreshCw } from 'lucide-react';
import { simulationAPI } from '../../api';

// Simulation process summary: the Simulation Engineer's workload and
// performance. Every number is counted on the server from the simulation
// rounds recorded on the Simulation page (counting rules in
// server/services/simulationSummary.cjs). A figure with nothing behind it is
// "—", never 0, and nothing before tracking started is estimated.

const DASH = '—';
const fmtDays = (v) => (v === null || v === undefined ? DASH : `${v.toFixed(1)} d`);
const fmtRatio = (v) => (v === null || v === undefined ? DASH : v.toFixed(1));
const fmtPct = (v) => (v === null || v === undefined ? DASH : `${Math.round(v * 100)}%`);
const fmtLongDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const tooltipStyle = { background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', padding: '10px 14px' };

function Kpi({ theme, label, ytd, mtd, note }) {
  return (
    <div style={{ background: theme.cardBg, borderRadius: 8, padding: '1.1rem 1.25rem', border: `1px solid ${theme.cardBorder}`, boxShadow: theme.shadowSm }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: 10 }}>{label}</div>
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'baseline' }}>
        <div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: theme.text, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{ytd}</div>
          <div style={{ fontSize: '0.7rem', color: theme.textDim, marginTop: 2 }}>YTD</div>
        </div>
        <div>
          <div style={{ fontSize: '1.15rem', fontWeight: 600, color: theme.text, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{mtd}</div>
          <div style={{ fontSize: '0.7rem', color: theme.textDim, marginTop: 2 }}>MTD</div>
        </div>
      </div>
      {note && <div style={{ fontSize: '0.75rem', color: theme.textDim, marginTop: 10 }}>{note}</div>}
    </div>
  );
}

export default function SimulationSummaryTab({ theme, active }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setSummary(await simulationAPI.summary());
    } catch (e) {
      setError(e.message || 'Could not load the simulation summary.');
    } finally {
      setLoading(false);
    }
  }, []);

  // The Analytics panels stay mounted while hidden, so fetch each time this
  // tab is opened: the engineer records steps all day.
  useEffect(() => { if (active) load(); }, [active, load]);

  const card = { background: theme.cardBg, borderRadius: 8, padding: '1.5rem', border: `1px solid ${theme.cardBorder}`, boxShadow: theme.shadowSm };
  const th = { padding: '0.6rem 0.75rem', textAlign: 'right', fontSize: '0.75rem', fontWeight: 500, color: theme.textMuted, background: theme.tableBg, borderBottom: `1px solid ${theme.cardBorder}` };
  const td = { padding: '0.6rem 0.75rem', textAlign: 'right', borderBottom: `1px solid ${theme.cardBorder}`, fontSize: '0.85rem', color: theme.text, fontVariantNumeric: 'tabular-nums' };

  if (error) {
    return <div role="alert" style={{ ...card, color: '#DC2626' }}>{error} <button onClick={load} style={{ marginLeft: 8, color: '#3B82F6', background: 'none', border: 'none', cursor: 'pointer' }}>Try again</button></div>;
  }
  if (!summary) {
    return <div style={{ ...card, color: theme.textDim }}>{loading ? 'Loading simulation summary…' : ''}</div>;
  }

  const { ytd, mtd, months, reasons, tracking_since: since, target_working_days: target, year } = summary;
  const monthName = months.length ? months[months.length - 1].label : '';
  const targetText = `${plural(target, 'working day')}`;
  // Only months from the start of tracking are shown in the table: earlier
  // months were not recorded, and a row of dashes there reads like a gap.
  const trackedMonths = since ? months.filter((m) => m.month >= since.slice(0, 7)) : [];
  const chartData = months.map((m) => ({ label: m.label, lead: m.avg_lead_days, rounds: m.lead_measured }));
  const maxReason = reasons.length ? reasons[0].count : 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 600, color: theme.text, margin: 0 }}>Simulation summary · {year}</h2>
          <p style={{ fontSize: '0.8rem', color: theme.textDim, margin: '4px 0 0' }}>
            {since
              ? <>Counted from the rounds recorded on the Simulation page since {fmtLongDate(since)}. Simulations before step tracking were not recorded per round and are not counted.</>
              : <>No simulation has been recorded on the Simulation page yet. Figures appear once the first round is completed there.</>}
          </p>
        </div>
        <button onClick={load} disabled={loading} className="no-print" aria-label="Refresh simulation summary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, color: theme.text, fontSize: '0.8rem', cursor: loading ? 'default' : 'pointer' }}>
          <RefreshCw size={14} /> {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <Kpi theme={theme} label="Simulations done" ytd={ytd.simulations} mtd={mtd.simulations}
          note={`${ytd.ok} OK · ${ytd.not_ok} Not OK this year`} />
        <Kpi theme={theme} label="Avg simulations per die" ytd={fmtRatio(ytd.per_die)} mtd={fmtRatio(mtd.per_die)}
          note={`${plural(ytd.dies, 'die order')} simulated this year, revisions included`} />
        <Kpi theme={theme} label="In-house modifications done" ytd={ytd.in_house} mtd={mtd.in_house}
          note={`Supplier modifications: ${ytd.supplier} YTD · ${mtd.supplier} MTD`} />
        <Kpi theme={theme} label="Avg lead time (model → result)" ytd={fmtDays(ytd.avg_lead_days)} mtd={fmtDays(mtd.avg_lead_days)}
          note="Working days, Sundays and holidays skipped" />
        <Kpi theme={theme} label={`On time (within ${targetText})`} ytd={fmtPct(ytd.on_time_rate)} mtd={fmtPct(mtd.on_time_rate)}
          note={`${ytd.on_time} of ${plural(ytd.lead_measured, 'round')} this year`} />
        <Kpi theme={theme} label="First-pass OK" ytd={fmtPct(ytd.first_pass_rate)} mtd={fmtPct(mtd.first_pass_rate)}
          note={`${ytd.first_pass} of ${plural(ytd.passed, 'passed die')} passed in their first simulation`} />
      </div>

      <div style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={card}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.25rem', color: theme.text }}>Average lead time by month</h3>
          <p style={{ fontSize: '0.75rem', color: theme.textDim, margin: '0 0 1rem' }}>
            Working days from 3D model received to simulation completed, by the month the simulation finished. Dashed line: the {targetText} target. No bar means nothing was recorded that month.
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 20, right: 16, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} />
              <YAxis axisLine={false} tickLine={false} allowDecimals tick={{ fill: '#94A3B8', fontSize: 11 }} width={36}
                domain={[0, (dataMax) => Math.max(target + 1, Math.ceil(dataMax || 0))]} />
              <Tooltip cursor={{ fill: 'rgba(148,163,184,0.12)' }} contentStyle={tooltipStyle} itemStyle={{ color: '#FFFFFF', fontWeight: 500 }} labelStyle={{ color: '#94A3B8', marginBottom: 4 }}
                formatter={(value, name, item) => [value === null || value === undefined ? DASH : `${value.toFixed(1)} working days (${plural(item.payload.rounds, 'simulation')})`, 'Avg lead time']} />
              <ReferenceLine y={target} stroke="#94A3B8" strokeDasharray="4 4" />
              <Bar dataKey="lead" fill="#3B82F6" radius={[4, 4, 0, 0]} maxBarSize={36}>
                <LabelList dataKey="lead" position="top" fill="#94A3B8" fontSize={11} fontWeight={600}
                  formatter={(v) => (v === null || v === undefined ? '' : v.toFixed(1))} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={card}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.25rem', color: theme.text }}>Not OK reasons · {year}</h3>
          <p style={{ fontSize: '0.75rem', color: theme.textDim, margin: '0 0 1rem' }}>Why simulations failed this year.</p>
          {reasons.length === 0 ? (
            <div style={{ color: theme.textDim, fontSize: '0.85rem' }}>No Not OK results recorded this year.</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
              {reasons.map((r) => (
                <li key={r.reason}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: theme.text, marginBottom: 4 }}>
                    <span>{r.reason}</span><span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{r.count}</span>
                  </div>
                  <div style={{ height: 6, background: theme.cardBorder, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(r.count / maxReason) * 100}%`, background: '#3B82F6', borderRadius: 3 }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div style={card}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 1rem', color: theme.text }}>Month by month</h3>
        {trackedMonths.length === 0 ? (
          <div style={{ color: theme.textDim, fontSize: '0.85rem' }}>Nothing recorded yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th scope="col" style={{ ...th, textAlign: 'left' }}>Month</th>
                  <th scope="col" style={th}>Simulations</th>
                  <th scope="col" style={th}>Die orders</th>
                  <th scope="col" style={th}>Per die</th>
                  <th scope="col" style={th}>In-house mods</th>
                  <th scope="col" style={th}>Supplier mods</th>
                  <th scope="col" style={th}>Avg lead time</th>
                  <th scope="col" style={th}>On time</th>
                  <th scope="col" style={th}>First-pass OK</th>
                </tr>
              </thead>
              <tbody>
                {trackedMonths.map((m) => (
                  <tr key={m.month}>
                    <th scope="row" style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{m.label} {year}{m.label === monthName ? ' (MTD)' : ''}</th>
                    <td style={td}>{m.simulations}</td>
                    <td style={td}>{m.dies}</td>
                    <td style={td}>{fmtRatio(m.per_die)}</td>
                    <td style={td}>{m.in_house}</td>
                    <td style={td}>{m.supplier}</td>
                    <td style={td}>{fmtDays(m.avg_lead_days)}</td>
                    <td style={td}>{m.lead_measured ? `${fmtPct(m.on_time_rate)} (${m.on_time}/${m.lead_measured})` : DASH}</td>
                    <td style={td}>{m.passed ? `${fmtPct(m.first_pass_rate)} (${m.first_pass}/${m.passed})` : DASH}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
