import React, { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LabelList } from 'recharts';
import { CHART_COLORS } from '../../utils/constants';

const isSimulationEnabled = (value) => {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') return /^(true|1|yes|ok|required)$/i.test(value.trim());
  return false;
};

const hasDieReceivedDate = (order) => {
  const d = order?.['Die Received Date'];
  return d != null && String(d).trim() !== '';
};

const parseOrderCalendarDate = (raw) => {
  if (raw == null) return null;
  const s0 = String(raw).trim();
  if (!s0) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s0)) {
    const head = s0.slice(0, 10);
    if (!Number.isNaN(Date.parse(head))) return head;
  }
  const t = Date.parse(s0);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const y = d.getFullYear();
    if (y >= 1990 && y <= 2100) return d.toISOString().slice(0, 10);
  }
  return null;
};

const QUARTER_MONTHS = { 'Q1': ['Jan', 'Feb', 'Mar'], 'Q2': ['Apr', 'May', 'Jun'], 'Q3': ['Jul', 'Aug', 'Sep'], 'Q4': ['Oct', 'Nov', 'Dec'] };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function OverviewTab({ data, suppliers, theme }) {
  const [analyticsFilter, setAnalyticsFilter] = useState({ period: 'all', quarter: 'all' });

  const styles = {
    chartCard: { background: theme.cardBg, borderRadius: '8px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}`, boxShadow: theme.shadowSm },
    filterSelect: { padding: '10px 16px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem', cursor: 'pointer', minWidth: '130px', transition: 'all 0.15s', outline: 'none' },
    table: { width: '100%', borderCollapse: 'collapse' },
    th: { padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 500, color: theme.textMuted, background: theme.tableBg, cursor: 'pointer', borderBottom: `1px solid ${theme.cardBorder}` },
    td: { padding: '1rem', borderBottom: `1px solid ${theme.cardBorder}`, fontSize: '0.875rem', color: theme.text },
  };

  const analyticsData = useMemo(() => {
    return data.filter(o => {
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
    const labels = { 'N': 'New', 'B': 'Backup', 'T': 'Tooling', 'C': 'Canceled', 'H': 'Hold' };
    const counts = {};
    analyticsData.forEach(o => { counts[labels[o.TYPE] || o.TYPE] = (counts[labels[o.TYPE] || o.TYPE] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [analyticsData]);

  const tooltipStyle = { background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', padding: '10px 14px' };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
      <div style={{ ...styles.chartCard, gridColumn: 'span 2', padding: '1rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: theme.textMuted }}>Filter Analytics:</span>
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
            Showing <strong style={{ color: theme.text }}>{analyticsData.length}</strong> orders
          </span>
          {(analyticsFilter.period !== 'all' || analyticsFilter.quarter !== 'all') && (
            <button onClick={() => setAnalyticsFilter({ period: 'all', quarter: 'all' })} style={{ fontSize: '0.8rem', color: '#3B82F6', background: 'none', border: 'none', cursor: 'pointer' }}>Clear filter</button>
          )}
        </div>
      </div>
      <div style={{ ...styles.chartCard, gridColumn: 'span 2' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem', color: theme.text }}>Supplier Performance</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead><tr><th scope="col" style={styles.th}>Supplier</th><th scope="col" style={{ ...styles.th, textAlign: 'center' }}>Total</th><th scope="col" style={{ ...styles.th, textAlign: 'center' }} title="Die received date recorded">Completed</th><th scope="col" style={{ ...styles.th, textAlign: 'center' }} title="Awaiting die receivance (no die received date)">In Progress</th><th scope="col" style={styles.th}>Completion Rate</th></tr></thead>
            <tbody>
              {[...new Set(analyticsData.map(o => o.Supplier))].filter(Boolean).sort().map(supplier => {
                const supplierOrders = analyticsData.filter(o => o.Supplier === supplier && o.STATUS !== 'CANCELLED');
                const completed = supplierOrders.filter(o => hasDieReceivedDate(o)).length;
                const inProgress = supplierOrders.filter(o => !hasDieReceivedDate(o)).length;
                const total = supplierOrders.length;
                const rate = total > 0 ? ((completed / total) * 100).toFixed(0) : 0;
                return (
                  <tr key={supplier}>
                    <td style={styles.td}><span style={{ fontWeight: 600, color: theme.text }}>{supplier}</span></td>
                    <td style={{ ...styles.td, textAlign: 'center' }}>{total}</td>
                    <td style={{ ...styles.td, textAlign: 'center' }}><span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600, background: '#F0FDF4', color: '#16A34A' }}>{completed}</span></td>
                    <td style={{ ...styles.td, textAlign: 'center' }}><span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600, background: '#FFFBEB', color: '#D97706' }}>{inProgress}</span></td>
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
          <BarChart data={supplierData} layout="vertical" margin={{ right: 60 }}>
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
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem', color: theme.text }}>Avg Design Lead Time by Supplier</h3>
        <p style={{ fontSize: '0.75rem', color: theme.textDim, marginBottom: '1rem' }}>Days from Ordered Date to Design Received Date</p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={(() => {
            const supplierLeadTimes = {};
            analyticsData.forEach(o => {
              if (o.Supplier && o['Ordered date'] && o['Design Received Date']) {
                const orderedDate = new Date(o['Ordered date']);
                const designDate = new Date(o['Design Received Date']);
                if (!isNaN(orderedDate) && !isNaN(designDate)) {
                  const days = Math.round((designDate - orderedDate) / (1000 * 60 * 60 * 24));
                  if (days >= 0) {
                    if (!supplierLeadTimes[o.Supplier]) supplierLeadTimes[o.Supplier] = [];
                    supplierLeadTimes[o.Supplier].push(days);
                  }
                }
              }
            });
            return Object.entries(supplierLeadTimes)
              .map(([name, times]) => ({ name, avgDays: Math.round(times.reduce((a, b) => a + b, 0) / times.length), count: times.length }))
              .sort((a, b) => a.avgDays - b.avgDays);
          })()} layout="vertical" margin={{ right: 60 }}>
            <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit=" days" domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
            <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={90} />
            <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#FFFFFF', fontWeight: 500 }} labelStyle={{ color: '#94A3B8', marginBottom: '4px' }} formatter={(value, name, props) => [`${value} days (${props.payload.count} orders)`, 'Avg Lead Time']} />
            <Bar dataKey="avgDays" fill="#10B981" radius={[0, 6, 6, 0]} name="Avg Days">
              <LabelList dataKey="avgDays" position="right" fill="#64748B" fontSize={11} fontWeight={600} formatter={(v) => `${v}d`} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
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
      <div style={styles.chartCard}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem', color: theme.text }}>Avg Design Approval Lead Time by Supplier</h3>
        <p style={{ fontSize: '0.75rem', color: theme.textDim, marginBottom: '1rem' }}>Days from Design Received to Design Approved · excludes simulation orders</p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={(() => {
            const supplierTimes = {};
            analyticsData.forEach(o => {
              if (isSimulationEnabled(o.simulationEnabled)) return;
              if (o.Supplier && o['Design Received Date'] && o['Design Approved Date']) {
                const receivedDate = new Date(o['Design Received Date']);
                const approvedDate = new Date(o['Design Approved Date']);
                if (!isNaN(receivedDate) && !isNaN(approvedDate)) {
                  const days = Math.round((approvedDate - receivedDate) / (1000 * 60 * 60 * 24));
                  if (days >= 0) {
                    if (!supplierTimes[o.Supplier]) supplierTimes[o.Supplier] = [];
                    supplierTimes[o.Supplier].push(days);
                  }
                }
              }
            });
            return Object.entries(supplierTimes)
              .map(([name, times]) => ({ name, avgDays: Math.round(times.reduce((a, b) => a + b, 0) / times.length), count: times.length }))
              .sort((a, b) => a.avgDays - b.avgDays);
          })()} layout="vertical" margin={{ right: 60 }}>
            <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit=" days" domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
            <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={90} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name, props) => [`${value} days (${props.payload.count} orders)`, 'Avg Approval Time']} />
            <Bar dataKey="avgDays" fill="#8B5CF6" radius={[0, 6, 6, 0]} name="Avg Days">
              <LabelList dataKey="avgDays" position="right" fill="#64748B" fontSize={11} fontWeight={600} formatter={(v) => `${v}d`} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={styles.chartCard}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem', color: theme.text }}>Avg Design Approval Time by Month</h3>
        <p style={{ fontSize: '0.75rem', color: theme.textDim, marginBottom: '1rem' }}>Days from Design Received to Approved · excludes simulation orders</p>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={(() => {
            const monthOrder = MONTHS;
            const monthTimes = {};
            analyticsData.forEach(o => {
              if (isSimulationEnabled(o.simulationEnabled)) return;
              if (o.month && o['Design Received Date'] && o['Design Approved Date']) {
                const receivedDate = new Date(o['Design Received Date']);
                const approvedDate = new Date(o['Design Approved Date']);
                if (!isNaN(receivedDate) && !isNaN(approvedDate)) {
                  const days = Math.round((approvedDate - receivedDate) / (1000 * 60 * 60 * 24));
                  if (days >= 0) {
                    if (!monthTimes[o.month]) monthTimes[o.month] = [];
                    monthTimes[o.month].push(days);
                  }
                }
              }
            });
            return monthOrder
              .filter(m => monthTimes[m])
              .map(month => ({ month, avgDays: Math.round(monthTimes[month].reduce((a, b) => a + b, 0) / monthTimes[month].length), count: monthTimes[month].length }));
          })()} margin={{ top: 20 }}>
            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit="d" domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name, props) => [`${value} days (${props.payload.count} orders)`, 'Avg Days']} />
            <Bar dataKey="avgDays" fill="#F59E0B" radius={[6, 6, 0, 0]}>
              <LabelList dataKey="avgDays" position="top" fill="#64748B" fontSize={11} fontWeight={600} formatter={(v) => `${v}d`} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={styles.chartCard}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem', color: theme.text }}>Avg Design Approval Time by Plant</h3>
        <p style={{ fontSize: '0.75rem', color: theme.textDim, marginBottom: '1rem' }}>Days from Design Received to Approved · excludes simulation orders</p>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={(() => {
            const plantTimes = {};
            analyticsData.forEach(o => {
              if (isSimulationEnabled(o.simulationEnabled)) return;
              if (o.Plant && o['Design Received Date'] && o['Design Approved Date']) {
                const receivedDate = new Date(o['Design Received Date']);
                const approvedDate = new Date(o['Design Approved Date']);
                if (!isNaN(receivedDate) && !isNaN(approvedDate)) {
                  const days = Math.round((approvedDate - receivedDate) / (1000 * 60 * 60 * 24));
                  if (days >= 0) {
                    if (!plantTimes[o.Plant]) plantTimes[o.Plant] = [];
                    plantTimes[o.Plant].push(days);
                  }
                }
              }
            });
            return Object.entries(plantTimes)
              .map(([plant, times]) => ({ plant, avgDays: Math.round(times.reduce((a, b) => a + b, 0) / times.length), count: times.length }))
              .sort((a, b) => a.avgDays - b.avgDays);
          })()} margin={{ top: 20 }}>
            <XAxis dataKey="plant" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit="d" domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name, props) => [`${value} days (${props.payload.count} orders)`, 'Avg Days']} />
            <Bar dataKey="avgDays" fill="#EC4899" radius={[6, 6, 0, 0]}>
              <LabelList dataKey="avgDays" position="top" fill="#64748B" fontSize={11} fontWeight={600} formatter={(v) => `${v}d`} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {(() => {
        const supplierDelivery = {};
        const supplierMfg = {};
        analyticsData.forEach(o => {
          if (!o.Supplier?.trim()) return;
          const receivedIso = parseOrderCalendarDate(o['Die Received Date']);
          if (!receivedIso) return;
          const receivedDate = new Date(receivedIso);
          if (Number.isNaN(receivedDate.getTime())) return;
          const orderedIso = parseOrderCalendarDate(o['Ordered date']);
          if (orderedIso) {
            const orderedDate = new Date(orderedIso);
            if (!Number.isNaN(orderedDate.getTime())) {
              const days = Math.round((receivedDate - orderedDate) / (1000 * 60 * 60 * 24));
              if (days >= 0) {
                if (!supplierDelivery[o.Supplier]) supplierDelivery[o.Supplier] = [];
                supplierDelivery[o.Supplier].push(days);
              }
            }
          }
          const approvedIso = parseOrderCalendarDate(o['Design Approved Date'] ?? o.design_approved_date);
          if (approvedIso) {
            const approvedDate = new Date(approvedIso);
            if (!Number.isNaN(approvedDate.getTime())) {
              const days = Math.round((receivedDate - approvedDate) / (1000 * 60 * 60 * 24));
              if (days >= 0) {
                if (!supplierMfg[o.Supplier]) supplierMfg[o.Supplier] = [];
                supplierMfg[o.Supplier].push(days);
              }
            }
          }
        });
        const deliveryData = Object.entries(supplierDelivery)
          .map(([name, times]) => ({ name, avgDays: Math.round(times.reduce((a, b) => a + b, 0) / times.length), count: times.length }))
          .sort((a, b) => a.avgDays - b.avgDays);
        const mfgData = Object.entries(supplierMfg)
          .map(([name, times]) => ({ name, avgDays: Math.round(times.reduce((a, b) => a + b, 0) / times.length), count: times.length }))
          .sort((a, b) => a.avgDays - b.avgDays);
        return (
          <>
            {deliveryData.length > 0 && (
              <div style={styles.chartCard}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem', color: theme.text }}>Avg Delivery Lead Time by Supplier</h3>
                <p style={{ fontSize: '0.75rem', color: theme.textDim, marginBottom: '1rem' }}>Days from Die Order Date to Die Received Date · orders with a recorded die received date</p>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={deliveryData} layout="vertical" margin={{ right: 60 }}>
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit=" days" domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
                    <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={90} />
                    <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#FFFFFF', fontWeight: 500 }} labelStyle={{ color: '#94A3B8', marginBottom: '4px' }} formatter={(value, _, props) => [`${value} days (${props.payload.count} orders)`, 'Avg Delivery Lead Time']} />
                    <Bar dataKey="avgDays" fill="#0EA5E9" radius={[0, 6, 6, 0]}>
                      <LabelList dataKey="avgDays" position="right" fill="#64748B" fontSize={11} fontWeight={600} formatter={(v) => `${v}d`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {mfgData.length > 0 && (
              <div style={styles.chartCard}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem', color: theme.text }}>Avg Manufacturing Lead Time by Supplier</h3>
                <p style={{ fontSize: '0.75rem', color: theme.textDim, marginBottom: '1rem' }}>Days from Design Approval Date to Die Received Date · orders with both dates recorded</p>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={mfgData} layout="vertical" margin={{ right: 60 }}>
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit=" days" domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
                    <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={90} />
                    <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: '#FFFFFF', fontWeight: 500 }} labelStyle={{ color: '#94A3B8', marginBottom: '4px' }} formatter={(value, _, props) => [`${value} days (${props.payload.count} orders)`, 'Avg Manufacturing Lead Time']} />
                    <Bar dataKey="avgDays" fill="#F59E0B" radius={[0, 6, 6, 0]}>
                      <LabelList dataKey="avgDays" position="right" fill="#64748B" fontSize={11} fontWeight={600} formatter={(v) => `${v}d`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
