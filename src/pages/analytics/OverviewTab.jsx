import React, { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LabelList } from 'recharts';
import { CHART_COLORS } from '../../utils/constants';
import { isCancelled, orderYear, leadTimesBy, supplierProgress } from '../../utils/analyticsOverview.js';

const isSimulationEnabled = (value) => {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') return /^(true|1|yes|ok|required)$/i.test(value.trim());
  return false;
};

const approvedDateOf = (o) => o['Design Approved Date'] ?? o.design_approved_date;

const QUARTER_MONTHS = { 'Q1': ['Jan', 'Feb', 'Mar'], 'Q2': ['Apr', 'May', 'Jun'], 'Q3': ['Jul', 'Aug', 'Sep'], 'Q4': ['Oct', 'Nov', 'Dec'] };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Declared outside the page component so it is not recreated on every render.
// The grid itself is a CSS class because the column cap needs media queries,
// which inline styles cannot express — same reason .dt-table exists.
function Section({ title, theme, children }) {
  return (
    <section style={{ marginBottom: '2rem' }}>
      <h2 style={{
        fontSize: '0.75rem', fontWeight: 700, color: theme.textDim,
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem',
      }}>
        {title}
      </h2>
      <div className="dt-analytics-grid">{children}</div>
    </section>
  );
}

export default function OverviewTab({ data, suppliers, theme }) {
  const [analyticsFilter, setAnalyticsFilter] = useState({ year: 'all', period: 'all', quarter: 'all' });

  const styles = {
    chartCard: { background: theme.cardBg, borderRadius: '8px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}`, boxShadow: theme.shadowSm },
    filterSelect: { padding: '10px 16px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem', cursor: 'pointer', minWidth: '130px', transition: 'all 0.15s', outline: 'none' },
    table: { width: '100%', borderCollapse: 'collapse' },
    th: { padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 500, color: theme.textMuted, background: theme.tableBg, cursor: 'pointer', borderBottom: `1px solid ${theme.cardBorder}` },
    td: { padding: '1rem', borderBottom: `1px solid ${theme.cardBorder}`, fontSize: '0.875rem', color: theme.text },
  };

  // Years offered are the ones present in the data, newest first, read from
  // the same date as the month so the two filters cannot disagree.
  const years = useMemo(
    () => [...new Set(data.map(orderYear))].filter(Boolean).sort((a, b) => Number(b) - Number(a)),
    [data],
  );

  // Cancelled orders are left out of every figure on this tab: a cancelled
  // die was never going to be designed, made or delivered, and counting it in
  // some charts and not others made the totals disagree.
  const analyticsData = useMemo(() => {
    return data.filter(o => {
      if (isCancelled(o)) return false;
      if (analyticsFilter.year !== 'all' && orderYear(o) !== analyticsFilter.year) return false;
      if (analyticsFilter.period !== 'all' && o.month !== analyticsFilter.period) return false;
      if (analyticsFilter.quarter !== 'all' && !QUARTER_MONTHS[analyticsFilter.quarter]?.includes(o.month)) return false;
      return true;
    });
  }, [data, analyticsFilter]);

  const supplierData = useMemo(() => {
    const counts = {};
    analyticsData.forEach(o => { if (o.Supplier) counts[o.Supplier] = (counts[o.Supplier] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [analyticsData]);

  const regionData = useMemo(() => {
    const supplierRegionMap = {};
    suppliers.forEach(s => { if (s.name) supplierRegionMap[s.name.toUpperCase()] = s.region || 'Unknown'; });
    const counts = {};
    analyticsData.forEach(o => {
      if (!o.Supplier) return;
      const region = supplierRegionMap[String(o.Supplier).toUpperCase()] || 'Unknown';
      counts[region] = (counts[region] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [analyticsData, suppliers]);

  const typeData = useMemo(() => {
    const labels = { 'N': 'New', 'B': 'Backup', 'T': 'Tooling', 'H': 'Hold' };
    const counts = {};
    analyticsData.forEach(o => { counts[labels[o.TYPE] || o.TYPE] = (counts[labels[o.TYPE] || o.TYPE] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [analyticsData]);

  // Chart data. Every lead time is a median per supplier (or month, or
  // plant), carrying the number of orders behind it; the rules are in
  // utils/analyticsOverview.js.
  const nonSimulation = useMemo(
    () => analyticsData.filter(o => !isSimulationEnabled(o.simulationEnabled)),
    [analyticsData],
  );

  const designLeadData = useMemo(
    () => leadTimesBy(analyticsData, o => o.Supplier, o => o['Ordered date'], o => o['Design Received Date']),
    [analyticsData],
  );

  const approvalLeadData = useMemo(
    () => leadTimesBy(nonSimulation, o => o.Supplier, o => o['Design Received Date'], approvedDateOf),
    [nonSimulation],
  );

  const approvalByMonthData = useMemo(() => {
    const byMonth = Object.fromEntries(
      leadTimesBy(nonSimulation, o => o.month, o => o['Design Received Date'], approvedDateOf).map(r => [r.name, r]),
    );
    return MONTHS.filter(m => byMonth[m]).map(m => ({ ...byMonth[m], month: m }));
  }, [nonSimulation]);

  const approvalByPlantData = useMemo(
    () => leadTimesBy(nonSimulation, o => o.Plant, o => o['Design Received Date'], approvedDateOf)
      .map(r => ({ ...r, plant: r.name })),
    [nonSimulation],
  );

  const deliveryData = useMemo(
    () => leadTimesBy(analyticsData, o => o.Supplier?.trim() && o.Supplier, o => o['Ordered date'], o => o['Die Received Date']),
    [analyticsData],
  );

  const mfgData = useMemo(
    () => leadTimesBy(analyticsData, o => o.Supplier?.trim() && o.Supplier, approvedDateOf, o => o['Die Received Date']),
    [analyticsData],
  );

  const supplierRows = useMemo(
    () => [...new Set(analyticsData.map(o => o.Supplier))].filter(Boolean).sort()
      .map(supplier => ({ supplier, ...supplierProgress(analyticsData.filter(o => o.Supplier === supplier)) })),
    [analyticsData],
  );

  const tooltipStyle = { background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', padding: '10px 14px' };

  return (
    <div>
      <div style={{ ...styles.chartCard, padding: '1rem 1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: theme.textMuted }}>Filter Analytics:</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.8rem', color: theme.textDim }} htmlFor="analyticspage-year">Year:</label>
            <select id="analyticspage-year" value={analyticsFilter.year} onChange={(e) => setAnalyticsFilter({ ...analyticsFilter, year: e.target.value })} style={styles.filterSelect}>
              <option value="all">All Years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.8rem', color: theme.textDim }} htmlFor="analyticspage-quarter">Quarter:</label>
            <select id="analyticspage-quarter" value={analyticsFilter.quarter} onChange={(e) => setAnalyticsFilter({ ...analyticsFilter, quarter: e.target.value, period: 'all' })} style={styles.filterSelect}>
              <option value="all">All Quarters</option>
              <option value="Q1">Q1 (Jan-Mar)</option>
              <option value="Q2">Q2 (Apr-Jun)</option>
              <option value="Q3">Q3 (Jul-Sep)</option>
              <option value="Q4">Q4 (Oct-Dec)</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.8rem', color: theme.textDim }} htmlFor="analyticspage-month">Month:</label>
            <select id="analyticspage-month" value={analyticsFilter.period} onChange={(e) => setAnalyticsFilter({ ...analyticsFilter, period: e.target.value, quarter: 'all' })} style={styles.filterSelect}>
              <option value="all">All Months</option>
              {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <span style={{ fontSize: '0.8rem', color: theme.textDim, marginLeft: 'auto' }}>
            Showing <strong style={{ color: theme.text }}>{analyticsData.length}</strong> orders · cancelled excluded
          </span>
          {(analyticsFilter.year !== 'all' || analyticsFilter.period !== 'all' || analyticsFilter.quarter !== 'all') && (
            <button onClick={() => setAnalyticsFilter({ year: 'all', period: 'all', quarter: 'all' })} style={{ fontSize: '0.8rem', color: '#3B82F6', background: 'none', border: 'none', cursor: 'pointer' }}>Clear filter</button>
          )}
        </div>
      </div>
      <Section title="Volume & Distribution" theme={theme}>
      <div style={styles.chartCard} className="dt-span-all">
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem', color: theme.text }}>Supplier Performance</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead><tr><th scope="col" style={styles.th}>Supplier</th><th scope="col" style={{ ...styles.th, textAlign: 'center' }}>Total</th><th scope="col" style={{ ...styles.th, textAlign: 'center' }} title="Die received date recorded">Completed</th><th scope="col" style={{ ...styles.th, textAlign: 'center' }} title="Design approved, die not received yet: the supplier is making it">With Supplier</th><th scope="col" style={{ ...styles.th, textAlign: 'center' }} title="No design approval date yet: still in ordering, design or approval">Before Approval</th><th scope="col" style={styles.th}>Completion Rate</th></tr></thead>
            <tbody>
              {supplierRows.map(({ supplier, total, received, withSupplier, beforeApproval }) => {
                const rate = total > 0 ? ((received / total) * 100).toFixed(0) : 0;
                return (
                  <tr key={supplier}>
                    <td style={styles.td}><span style={{ fontWeight: 600, color: theme.text }}>{supplier}</span></td>
                    <td style={{ ...styles.td, textAlign: 'center' }}>{total}</td>
                    <td style={{ ...styles.td, textAlign: 'center' }}><span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600, background: '#F0FDF4', color: '#16A34A' }}>{received}</span></td>
                    <td style={{ ...styles.td, textAlign: 'center' }}><span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600, background: '#FFFBEB', color: '#D97706' }}>{withSupplier}</span></td>
                    <td style={{ ...styles.td, textAlign: 'center' }}><span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600, background: '#F1F5F9', color: '#475569' }}>{beforeApproval}</span></td>
                    <td style={styles.td}><div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><div style={{ flex: 1, height: '6px', background: theme.cardBorder, borderRadius: '3px', overflow: 'hidden' }}><div style={{ height: '100%', width: `${rate}%`, background: '#10B981', borderRadius: '3px' }} /></div><span style={{ fontSize: '0.8rem', fontWeight: 600, color: theme.textMuted, minWidth: '40px' }}>{rate}%</span></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div style={styles.chartCard}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem', color: theme.text }}>Orders by Supplier</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={supplierData} layout="vertical" margin={{ right: 80 }}>
            <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
            <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={90} />
            <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#FFFFFF', fontWeight: 500 }} labelStyle={{ color: '#94A3B8', marginBottom: '4px' }} />
            <Bar dataKey="value" fill="#3B82F6" radius={[0, 6, 6, 0]}>
              <LabelList dataKey="value" position="right" fill="#94A3B8" fontSize={11} fontWeight={600} formatter={(v) => { const total = supplierData.reduce((s, d) => s + d.value, 0); return `${v} (${Math.round(v / total * 100)}%)`; }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={styles.chartCard}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem', color: theme.text }}>Die Order Distribution by Region</h3>
        {regionData.length === 0 ? (
          <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.textDim, fontSize: '0.875rem' }}>No data available</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={regionData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {regionData.map((entry, idx) => <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#FFFFFF', fontWeight: 500 }} labelStyle={{ color: '#94A3B8', marginBottom: '4px' }} formatter={(value, name) => { const total = regionData.reduce((s, d) => s + d.value, 0); return [`${value} (${Math.round(value / total * 100)}%)`, name]; }} />
              <Legend wrapperStyle={{ fontSize: '0.8rem', color: theme.textDim }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
      <div style={styles.chartCard}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem', color: theme.text }}>Orders by Die Type</h3>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie data={typeData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
              {typeData.map((entry, idx) => <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#FFFFFF', fontWeight: 500 }} labelStyle={{ color: '#94A3B8', marginBottom: '4px' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      </Section>

      <Section title="Lead Times" theme={theme}>
      <div style={styles.chartCard}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem', color: theme.text }}>Median Design Lead Time by Supplier</h3>
        <p style={{ fontSize: '0.75rem', color: theme.textDim, marginBottom: '1rem' }}>Days from Ordered Date to Design Received Date · bars show median days (orders)</p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={designLeadData} layout="vertical" margin={{ right: 80 }}>
            <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit=" days" domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
            <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={90} />
            <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#FFFFFF', fontWeight: 500 }} labelStyle={{ color: '#94A3B8', marginBottom: '4px' }} formatter={(value, name, props) => [`${value} days (${props.payload.count} orders)`, 'Median Lead Time']} />
            <Bar dataKey="medianDays" fill="#10B981" radius={[0, 6, 6, 0]} name="Median Days">
              <LabelList dataKey="label" position="right" fill="#64748B" fontSize={11} fontWeight={600} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {deliveryData.length > 0 && (
              <div style={styles.chartCard}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem', color: theme.text }}>Median Delivery Lead Time by Supplier</h3>
                <p style={{ fontSize: '0.75rem', color: theme.textDim, marginBottom: '1rem' }}>Days from Die Order Date to Die Received Date · orders with a recorded die received date · bars show median days (orders)</p>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={deliveryData} layout="vertical" margin={{ right: 80 }}>
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit=" days" domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
                    <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={90} />
                    <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#FFFFFF', fontWeight: 500 }} labelStyle={{ color: '#94A3B8', marginBottom: '4px' }} formatter={(value, _, props) => [`${value} days (${props.payload.count} orders)`, 'Median Delivery Lead Time']} />
                    <Bar dataKey="medianDays" fill="#0EA5E9" radius={[0, 6, 6, 0]}>
                      <LabelList dataKey="label" position="right" fill="#64748B" fontSize={11} fontWeight={600} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
      )}
      {mfgData.length > 0 && (
              <div style={styles.chartCard}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem', color: theme.text }}>Median Manufacturing Lead Time by Supplier</h3>
                <p style={{ fontSize: '0.75rem', color: theme.textDim, marginBottom: '1rem' }}>Days from Design Approval Date to Die Received Date · orders with both dates recorded · bars show median days (orders)</p>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={mfgData} layout="vertical" margin={{ right: 80 }}>
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit=" days" domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
                    <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={90} />
                    <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#FFFFFF', fontWeight: 500 }} labelStyle={{ color: '#94A3B8', marginBottom: '4px' }} formatter={(value, _, props) => [`${value} days (${props.payload.count} orders)`, 'Median Manufacturing Lead Time']} />
                    <Bar dataKey="medianDays" fill="#F59E0B" radius={[0, 6, 6, 0]}>
                      <LabelList dataKey="label" position="right" fill="#64748B" fontSize={11} fontWeight={600} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
      )}
      </Section>

      <Section title="Design Approval" theme={theme}>
      <div style={styles.chartCard}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem', color: theme.text }}>Median Design Approval Lead Time by Supplier</h3>
        <p style={{ fontSize: '0.75rem', color: theme.textDim, marginBottom: '1rem' }}>Days from Design Received to Design Approved · excludes simulation orders · bars show median days (orders)</p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={approvalLeadData} layout="vertical" margin={{ right: 80 }}>
            <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit=" days" domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
            <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={90} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name, props) => [`${value} days (${props.payload.count} orders)`, 'Median Approval Time']} />
            <Bar dataKey="medianDays" fill="#8B5CF6" radius={[0, 6, 6, 0]} name="Median Days">
              <LabelList dataKey="label" position="right" fill="#64748B" fontSize={11} fontWeight={600} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={styles.chartCard}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem', color: theme.text }}>Median Design Approval Time by Month</h3>
        <p style={{ fontSize: '0.75rem', color: theme.textDim, marginBottom: '1rem' }}>Days from Design Received to Approved · excludes simulation orders · bars show median days (orders)</p>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={approvalByMonthData} margin={{ top: 20 }}>
            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit="d" domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name, props) => [`${value} days (${props.payload.count} orders)`, 'Median Days']} />
            <Bar dataKey="medianDays" fill="#F59E0B" radius={[6, 6, 0, 0]}>
              <LabelList dataKey="label" position="top" fill="#64748B" fontSize={11} fontWeight={600} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={styles.chartCard}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem', color: theme.text }}>Median Design Approval Time by Plant</h3>
        <p style={{ fontSize: '0.75rem', color: theme.textDim, marginBottom: '1rem' }}>Days from Design Received to Approved · excludes simulation orders · bars show median days (orders)</p>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={approvalByPlantData} margin={{ top: 20 }}>
            <XAxis dataKey="plant" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit="d" domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name, props) => [`${value} days (${props.payload.count} orders)`, 'Median Days']} />
            <Bar dataKey="medianDays" fill="#EC4899" radius={[6, 6, 0, 0]}>
              <LabelList dataKey="label" position="top" fill="#64748B" fontSize={11} fontWeight={600} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      </Section>
    </div>
  );
}
