import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

function MonthlyTrendChart({ data, theme }) {
  return (
    <div style={{
      background: theme.cardBg,
      borderRadius: '16px',
      padding: '1.25rem',
      border: `1px solid ${theme.border}`
    }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', color: theme.text }}>
        Monthly Trend
      </h3>
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="newGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="backupGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="month"
            axisLine={false}
            tickLine={false}
            tick={{ fill: theme.textMuted, fontSize: 12 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: theme.textMuted, fontSize: 12 }}
          />
          <Tooltip
            contentStyle={{
              background: theme.cardBg,
              border: `1px solid ${theme.border}`,
              borderRadius: '8px',
              color: theme.text
            }}
          />
          <Area
            type="monotone"
            dataKey="new"
            name="New Dies"
            stroke="#3B82F6"
            fill="url(#newGradient)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="backup"
            name="Backup Dies"
            stroke="#8B5CF6"
            fill="url(#backupGradient)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default MonthlyTrendChart;
