import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area
} from 'recharts';
import { CHART_COLORS, MONTHS, QUARTER_MONTHS, STATUS_CONFIG, TYPE_LABELS } from '../../utils/constants';

function AnalyticsDashboard({ data, theme }) {
  const [filters, setFilters] = useState({ period: 'all', quarter: 'all' });

  const filteredData = useMemo(() => {
    let filtered = data;
    if (filters.period !== 'all') {
      filtered = filtered.filter(o => o.month === filters.period);
    }
    if (filters.quarter !== 'all' && QUARTER_MONTHS[filters.quarter]) {
      filtered = filtered.filter(o => QUARTER_MONTHS[filters.quarter].includes(o.month));
    }
    return filtered;
  }, [data, filters]);

  // Supplier distribution
  const supplierData = useMemo(() => {
    const counts = {};
    filteredData.forEach(o => {
      if (o.Supplier) counts[o.Supplier] = (counts[o.Supplier] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filteredData]);

  // Type distribution
  const typeData = useMemo(() => {
    const counts = {};
    filteredData.forEach(o => {
      if (o.TYPE) counts[o.TYPE] = (counts[o.TYPE] || 0) + 1;
    });
    return Object.entries(counts).map(([type, value]) => ({
      name: TYPE_LABELS[type] || type,
      value,
      type
    }));
  }, [filteredData]);

  // Monthly trend
  const monthlyData = useMemo(() => {
    return MONTHS.map(month => {
      const monthOrders = filteredData.filter(o => o.month === month);
      return {
        month,
        total: monthOrders.length,
        new: monthOrders.filter(o => o.TYPE === 'N').length,
        backup: monthOrders.filter(o => o.TYPE === 'B').length,
        completed: monthOrders.filter(o => o.STATUS === 'DONE').length
      };
    });
  }, [filteredData]);

  // Status distribution
  const statusData = useMemo(() => {
    const counts = {};
    filteredData.forEach(o => {
      if (o.STATUS) counts[o.STATUS] = (counts[o.STATUS] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({
        name: STATUS_CONFIG[name]?.label || name,
        value,
        color: STATUS_CONFIG[name]?.color || '#64748B'
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredData]);

  // Plant distribution
  const plantData = useMemo(() => {
    const counts = {};
    filteredData.forEach(o => {
      if (o.Plant) counts[o.Plant] = (counts[o.Plant] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filteredData]);

  const selectStyle = {
    padding: '8px 16px',
    background: theme.inputBg || theme.bg,
    border: `1px solid ${theme.border}`,
    borderRadius: '8px',
    color: theme.text,
    fontSize: '0.9rem',
    cursor: 'pointer'
  };

  const cardStyle = {
    background: theme.cardBg,
    borderRadius: '16px',
    padding: '1.25rem',
    border: `1px solid ${theme.border}`
  };

  return (
    <div>
      {/* Filters */}
      <div style={{
        display: 'flex',
        gap: '12px',
        marginBottom: '1.5rem',
        alignItems: 'center'
      }}>
        <select
          value={filters.period}
          onChange={(e) => setFilters(f => ({ ...f, period: e.target.value, quarter: 'all' }))}
          style={selectStyle}
        >
          <option value="all">All Months</option>
          {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        <select
          value={filters.quarter}
          onChange={(e) => setFilters(f => ({ ...f, quarter: e.target.value, period: 'all' }))}
          style={selectStyle}
        >
          <option value="all">All Quarters</option>
          <option value="Q1">Q1 (Jan-Mar)</option>
          <option value="Q2">Q2 (Apr-Jun)</option>
          <option value="Q3">Q3 (Jul-Sep)</option>
          <option value="Q4">Q4 (Oct-Dec)</option>
        </select>

        <span style={{ fontSize: '0.9rem', color: theme.textMuted, marginLeft: 'auto' }}>
          Showing {filteredData.length} orders
        </span>
      </div>

      {/* Stats Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '1rem',
        marginBottom: '1.5rem'
      }}>
        {[
          { label: 'Total Orders', value: filteredData.length, color: '#3B82F6' },
          { label: 'Completed', value: filteredData.filter(o => o.STATUS === 'DONE').length, color: '#10B981' },
          { label: 'In Progress', value: filteredData.filter(o => !['DONE', 'CANCELLED'].includes(o.STATUS)).length, color: '#F59E0B' },
          { label: 'Avg Delay', value: `${(filteredData.filter(o => o.Delay > 0).reduce((s, o) => s + (o.Delay || 0), 0) / (filteredData.filter(o => o.Delay > 0).length || 1)).toFixed(1)}d`, color: '#8B5CF6' }
        ].map(stat => (
          <div key={stat.label} style={cardStyle}>
            <p style={{ fontSize: '0.75rem', color: theme.textMuted, textTransform: 'uppercase', fontWeight: 600 }}>
              {stat.label}
            </p>
            <p style={{ fontSize: '2rem', fontWeight: 700, color: stat.color, marginTop: '8px' }}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Charts Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr',
        gap: '1.5rem',
        marginBottom: '1.5rem'
      }}>
        {/* Monthly Trend */}
        <div style={cardStyle}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text, marginBottom: '1rem' }}>
            Monthly Trend
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={monthlyData}>
              <defs>
                <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="completedGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: theme.textMuted, fontSize: 12 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: theme.textMuted, fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  background: theme.cardBg,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '8px',
                  color: theme.text
                }}
              />
              <Area type="monotone" dataKey="total" name="Total" stroke="#3B82F6" fill="url(#totalGradient)" strokeWidth={2} />
              <Area type="monotone" dataKey="completed" name="Completed" stroke="#10B981" fill="url(#completedGradient)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Type Distribution */}
        <div style={cardStyle}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text, marginBottom: '1rem' }}>
            Order Types
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={typeData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
              >
                {typeData.map((entry, index) => (
                  <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: theme.cardBg,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '8px',
                  color: theme.text
                }}
              />
              <Legend
                formatter={(value) => <span style={{ color: theme.text, fontSize: '0.85rem' }}>{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom Charts */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '1.5rem'
      }}>
        {/* Supplier Distribution */}
        <div style={cardStyle}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text, marginBottom: '1rem' }}>
            Top Suppliers
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={supplierData} layout="vertical">
              <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: theme.textMuted, fontSize: 12 }} />
              <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: theme.textMuted, fontSize: 11 }} width={80} />
              <Tooltip
                contentStyle={{
                  background: theme.cardBg,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '8px',
                  color: theme.text
                }}
              />
              <Bar dataKey="value" name="Orders" fill="#3B82F6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Status Distribution */}
        <div style={cardStyle}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text, marginBottom: '1rem' }}>
            Status Distribution
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={statusData}>
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: theme.textMuted, fontSize: 10 }} angle={-45} textAnchor="end" height={80} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: theme.textMuted, fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  background: theme.cardBg,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '8px',
                  color: theme.text
                }}
              />
              <Bar dataKey="value" name="Orders">
                {statusData.map((entry, index) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export default AnalyticsDashboard;
