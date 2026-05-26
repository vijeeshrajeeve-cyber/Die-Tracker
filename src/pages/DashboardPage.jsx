import React, { useState, useMemo } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { Package, Clock, CheckCircle, AlertTriangle, XCircle, Truck, Layers, ArrowRight } from 'lucide-react';
import { STATUS_CONFIG, BACKUP_REQUEST_STATUS_CONFIG } from '../utils/constants';
import DieAttentionLabels from '../components/DieAttentionLabels';

const isSimulationEnabled = (value) => {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') return /^(true|1|yes|ok|required)$/i.test(value.trim());
  return false;
};

const hasDieReceivedDate = (order) => {
  const d = order?.['Die Received Date'];
  return d != null && String(d).trim() !== '';
};

const hasDesignApprovedDate = (order) => {
  const raw = order?.['Design Approved Date'] ?? order?.design_approved_date;
  if (raw == null) return false;
  const s = String(raw).trim();
  return s !== '' && /^\d{4}-\d{2}-\d{2}/.test(s);
};

export default function DashboardPage({ data, plantBudgets, backupRequests, theme, isDarkMode, hasPageAccess, setActiveTab, setSelectedOrder, setFilters }) {
  const [trendYear, setTrendYear] = useState(new Date().getFullYear().toString());

  const styles = {
    kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '2.5rem' },
    kpiCard: { background: theme.cardBg, borderRadius: '8px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}`, boxShadow: '0 1px 2px rgba(0,0,0,0.02)' },
    chartsGrid: { display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '2.5rem' },
    chartCard: { background: theme.cardBg, borderRadius: '8px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}`, boxShadow: '0 1px 2px rgba(0,0,0,0.02)' },
    pipelineSection: { background: theme.cardBg, borderRadius: '8px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}`, boxShadow: '0 1px 2px rgba(0,0,0,0.02)' },
    pipelineColumns: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' },
    pipelineColumn: (color) => ({ borderRadius: '8px', padding: '1rem', background: isDarkMode ? `${color}10` : `${color}1A`, border: `1px solid ${color}33` }),
    pipelineItem: { background: theme.cardBg, borderRadius: '6px', padding: '12px', marginBottom: '8px', cursor: 'pointer', border: `1px solid ${theme.cardBorder}`, boxShadow: '0 1px 2px rgba(0,0,0,0.03)', width: 'calc(100% - 2px)', overflow: 'hidden', transition: 'all 0.15s ease' },
  };

  const stats = useMemo(() => {
    const total = data.length;
    const pending = data.filter(o => o.STATUS !== 'CANCELLED' && !hasDesignApprovedDate(o)).length;
    const cancelled = data.filter(o => o.STATUS === 'CANCELLED').length;
    const inManufacturing = data.filter(o => o.STATUS !== 'CANCELLED' && hasDesignApprovedDate(o) && !hasDieReceivedDate(o)).length;
    const dieReceivedCount = data.filter(o => hasDieReceivedDate(o)).length;
    const durationsNoSimulation = [];
    const durationsSimulation = [];
    data.forEach(o => {
      if (o.STATUS === 'CANCELLED' || o.STATUS === 'HOLD') return;
      if (!o['Design Received Date'] || !o['Design Approved Date']) return;
      const received = new Date(o['Design Received Date']);
      const approved = new Date(o['Design Approved Date']);
      if (isNaN(received) || isNaN(approved)) return;
      const days = Math.round((approved - received) / (1000 * 60 * 60 * 24));
      if (days < 0) return;
      if (isSimulationEnabled(o.simulationEnabled)) durationsSimulation.push(days);
      else durationsNoSimulation.push(days);
    });
    const avgOf = (arr) => arr.length > 0 ? (arr.reduce((s, d) => s + d, 0) / arr.length).toFixed(1) : '0';
    return {
      total,
      pending,
      cancelled,
      inManufacturing,
      dieReceivedCount,
      avgDelay: avgOf(durationsNoSimulation),
      avgDelayDesignApprovalSimulation: avgOf(durationsSimulation),
    };
  }, [data]);

  const availableYears = useMemo(() => {
    const years = new Set();
    data.forEach(o => { const d = o['Die Requested Date']; if (d) years.add(d.split('-')[0]); });
    return [...years].sort().reverse();
  }, [data]);

  const trendPlants = useMemo(() => [...new Set(data.map(o => o.Plant))].filter(Boolean).sort(), [data]);

  const monthlyTrendDataByPlant = useMemo(() => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const plants = [...new Set(data.map(o => o.Plant))].filter(Boolean).sort();
    const yearBudgets = trendYear !== 'all' ? (plantBudgets[trendYear] || {}) : {};
    const result = {};
    plants.forEach(plant => {
      const budget = yearBudgets[plant];
      result[plant] = months.map((month, mi) => {
        const monthOrders = data.filter(o => {
          if (o.month !== month || o.Plant !== plant) return false;
          if (trendYear !== 'all') {
            const d = o['Die Requested Date'];
            if (!d || d.split('-')[0] !== trendYear) return false;
          }
          return true;
        });
        const entry = { month, backup: monthOrders.filter(o => o.TYPE === 'B').length, new: monthOrders.filter(o => o.TYPE === 'N').length };
        if (budget) { entry.backup_target = budget.backup[mi]; entry.new_target = budget.new[mi]; }
        return entry;
      });
    });
    return result;
  }, [data, trendYear, plantBudgets]);

  return (
    <>
      <div style={styles.kpiGrid}>
        {[
          { title: 'Total Orders', value: stats.total, color: '#3B82F6', icon: Package, sub: 'Year to date', filter: 'all' },
          { title: 'Dies Received', value: stats.dieReceivedCount, color: '#0891B2', icon: Truck, sub: 'Orders with die received date' },
          { title: 'In Manufacturing', value: stats.inManufacturing, color: '#10B981', icon: CheckCircle, sub: 'Approved · awaiting delivery', filter: 'active' },
          { title: 'In Progress', value: stats.pending, color: '#F59E0B', icon: Clock, sub: 'Not cancelled · no design approval date', filter: 'pre-approval' },
          { title: 'Cancelled', value: stats.cancelled, color: '#EF4444', icon: XCircle, sub: `${stats.total > 0 ? ((stats.cancelled / stats.total) * 100).toFixed(1) : 0}%`, filter: 'CANCELLED' },
          { title: 'Avg Delay', value: `${stats.avgDelay}d`, color: '#8B5CF6', icon: AlertTriangle, sub: 'Design received → approved · no simulation' },
          { title: 'Avg Delay (Simulation)', value: `${stats.avgDelayDesignApprovalSimulation}d`, color: '#7C3AED', icon: Layers, sub: 'Design received → approved' },
        ].map((kpi, index) => {
          const flowFallback = { 'DONE': 'flow-completed' }[kpi.filter];
          const canUseOrders = !!kpi.filter && hasPageAccess('orders');
          const canUseFlow = !canUseOrders && flowFallback && hasPageAccess(flowFallback);
          const clickable = canUseOrders || canUseFlow;
          return (
            <div
              key={`${kpi.title}-${kpi.sub || index}`}
              style={{ ...styles.kpiCard, cursor: clickable ? 'pointer' : 'default', transition: 'transform 0.2s, box-shadow 0.2s' }}
              onClick={() => {
                if (canUseOrders) { setFilters(prev => ({ ...prev, status: kpi.filter })); setActiveTab('orders'); }
                else if (canUseFlow) { setActiveTab(flowFallback); }
              }}
              onMouseEnter={(e) => { if (clickable) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.3)'; } }}
              onMouseLeave={(e) => { if (clickable) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = styles.kpiCard.boxShadow; } }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: '#64748B' }}>{kpi.title}</p>
                  <h3 style={{ fontSize: '2rem', fontWeight: 700, color: kpi.color, marginTop: '8px', fontFamily: 'monospace' }}>{kpi.value}</h3>
                  <p style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '4px' }}>{kpi.sub}</p>
                </div>
                <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: `${kpi.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><kpi.icon size={24} color={kpi.color} /></div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={styles.chartsGrid}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text, margin: 0 }}>Monthly Orders Trend</h3>
            <select value={trendYear} onChange={(e) => setTrendYear(e.target.value)} style={{ padding: '6px 12px', borderRadius: '8px', border: `1px solid ${theme.cardBorder}`, background: theme.inputBg, color: theme.text, fontSize: '0.8rem', cursor: 'pointer', outline: 'none' }}>
              <option value="all">All Years</option>
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
            {trendPlants.map((plant) => {
              const plantData = monthlyTrendDataByPlant[plant] || [];
              const hasBudget = trendYear !== 'all' && !!(plantBudgets[trendYear]?.[plant]);
              const allValues = plantData.flatMap(d => { const vals = [d.new || 0, d.backup || 0]; if (hasBudget) { vals.push(d.backup_target || 0, d.new_target || 0); } return vals; });
              const yMax = Math.max(...allValues, 0) + 15;
              return (
                <div key={plant} style={styles.chartCard}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 700, color: theme.text }}>{plant}</span>
                    {hasBudget && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.68rem', color: '#94A3B8' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <svg width="18" height="4" viewBox="0 0 18 4"><line x1="0" y1="2" x2="18" y2="2" stroke="#EF4444" strokeWidth="2" strokeDasharray="4 2"/></svg>
                          Backup Target
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <svg width="18" height="4" viewBox="0 0 18 4"><line x1="0" y1="2" x2="18" y2="2" stroke="#22C55E" strokeWidth="2" strokeDasharray="4 2"/></svg>
                          New Target
                        </span>
                      </span>
                    )}
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <ComposedChart data={plantData} barCategoryGap="10%" barGap={2} margin={{ top: 16, right: 10, left: 0, bottom: 0 }}>
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11 }} domain={[0, yMax]} />
                      <Tooltip
                        contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', padding: '10px 14px' }}
                        itemStyle={{ color: '#FFFFFF', fontWeight: 500 }}
                        labelStyle={{ color: '#94A3B8', marginBottom: '4px' }}
                        formatter={(value, name) => (value === 0 || value == null ? null : [value, name])}
                      />
                      <Bar dataKey="new" name="New Dies" fill="#3B82F6" radius={[4, 4, 0, 0]}>
                        <LabelList dataKey="new" position="top" fill="#94A3B8" fontSize={10} fontWeight={700} formatter={(v) => v > 0 ? v : ''} />
                      </Bar>
                      <Bar dataKey="backup" name="Backup Dies" fill="#F59E0B" radius={[4, 4, 0, 0]}>
                        <LabelList dataKey="backup" position="top" fill="#94A3B8" fontSize={10} fontWeight={700} formatter={(v) => v > 0 ? v : ''} />
                      </Bar>
                      {hasBudget && <Line dataKey="backup_target" name="Backup Target" type="monotone" stroke="#EF4444" strokeWidth={2} dot={false} strokeDasharray="5 3" />}
                      {hasBudget && <Line dataKey="new_target" name="New Target" type="monotone" stroke="#22C55E" strokeWidth={2} dot={false} strokeDasharray="5 3" />}
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', marginTop: '6px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.75rem', color: '#94A3B8' }}>
                      <span style={{ width: 10, height: 10, borderRadius: '2px', background: '#3B82F6', display: 'inline-block' }} /> New Dies
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.75rem', color: '#94A3B8' }}>
                      <span style={{ width: 10, height: 10, borderRadius: '2px', background: '#F59E0B', display: 'inline-block' }} /> Backup Dies
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.25rem' }}>
          <div style={styles.chartCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text }}>Status Distribution</h3>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: '320px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase' }}>Status</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase' }}>Count</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase' }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const statusCounts = {};
                    data.forEach(o => { if (o.STATUS) statusCounts[o.STATUS] = (statusCounts[o.STATUS] || 0) + 1; });
                    const doneAwaitingDie = data.filter(o => o.STATUS === 'DONE' && !hasDieReceivedDate(o)).length;
                    const doneWithDieReceived = data.filter(o => o.STATUS === 'DONE' && hasDieReceivedDate(o)).length;
                    statusCounts['DONE'] = doneAwaitingDie;
                    statusCounts['DIE RECEIVED'] = (statusCounts['DIE RECEIVED'] || 0) + doneWithDieReceived;
                    const statusColors = {
                      'DONE': '#10B981', 'DIE RECEIVED': '#0891B2', 'CANCELLED': '#6B7280', 'AWAITING DESIGN': '#EF4444',
                      'DESIGN APPROVAL': '#F59E0B', 'PENDING ORDER': '#8B5CF6', 'ORACLE ENTRY': '#3B82F6',
                      'ON HOLD': '#64748B', 'DESIGN TO EMS': '#14B8A6', 'SIMULATION': '#EC4899'
                    };
                    const statusLabels = { 'DONE': 'In Manufacturing', 'DIE RECEIVED': 'Sample Followup' };
                    const statusHiddenFromDistribution = new Set(['DIE RECEIVED']);
                    const visibleEntries = Object.entries(statusCounts).filter(([status]) => !statusHiddenFromDistribution.has(status));
                    const displayedTotal = visibleEntries.reduce((acc, [, c]) => acc + c, 0);
                    return visibleEntries
                      .sort((a, b) => b[1] - a[1])
                      .map(([status, count]) => (
                        <tr key={status} style={{ borderBottom: `1px solid ${theme.border}` }}>
                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: statusColors[status] || '#94A3B8' }} />
                              <span style={{ fontSize: '0.85rem', color: theme.text, fontWeight: 500 }}>{statusLabels[status] || status}</span>
                            </div>
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '0.9rem', fontWeight: 600, color: theme.text }}>{count}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                            <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: `${statusColors[status] || '#94A3B8'}20`, color: statusColors[status] || '#94A3B8' }}>
                              {displayedTotal > 0 ? ((count / displayedTotal) * 100).toFixed(1) : 0}%
                            </span>
                          </td>
                        </tr>
                      ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
          <div style={styles.chartCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text }}>Backup Request Status</h3>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: '320px', overflowY: 'auto' }}>
              {(() => {
                const statuses = Object.keys(BACKUP_REQUEST_STATUS_CONFIG);
                const plantSet = new Set();
                (backupRequests || []).forEach(r => { if (r['Plant']) plantSet.add(r['Plant']); });
                const plantList = Array.from(plantSet).sort();
                const matrix = {};
                statuses.forEach(s => { matrix[s] = { total: 0 }; plantList.forEach(p => { matrix[s][p] = 0; }); });
                (backupRequests || []).forEach(r => {
                  const s = r['Status'] || 'Pending';
                  const p = r['Plant'];
                  if (!matrix[s]) matrix[s] = { total: 0, ...Object.fromEntries(plantList.map(pl => [pl, 0])) };
                  if (p && matrix[s][p] === undefined) matrix[s][p] = 0;
                  matrix[s].total += 1;
                  if (p) matrix[s][p] += 1;
                });
                const plantTotals = Object.fromEntries(plantList.map(p => [p, 0]));
                let grandTotal = 0;
                Object.keys(matrix).forEach(s => { plantList.forEach(p => { plantTotals[p] += matrix[s][p] || 0; }); grandTotal += matrix[s].total; });
                const thStyle = { padding: '10px 12px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase' };
                const tdStyle = { padding: '10px 12px', textAlign: 'center', fontSize: '0.9rem', fontWeight: 600, color: theme.text };
                if (plantList.length === 0 && grandTotal === 0) {
                  return <div style={{ padding: '1.5rem', textAlign: 'center', color: theme.textMuted, fontSize: '0.875rem' }}>No backup requests yet</div>;
                }
                return (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                        <th style={{ ...thStyle, textAlign: 'left' }}>Status</th>
                        {plantList.map(p => <th key={p} style={thStyle}>{p}</th>)}
                        <th style={thStyle}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.keys(matrix).map(s => {
                        const cfg = BACKUP_REQUEST_STATUS_CONFIG[s] || { color: '#94A3B8', label: s };
                        return (
                          <tr key={s} style={{ borderBottom: `1px solid ${theme.border}` }}>
                            <td style={{ padding: '10px 12px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: cfg.color }} />
                                <span style={{ fontSize: '0.85rem', color: theme.text, fontWeight: 500 }}>{cfg.label}</span>
                              </div>
                            </td>
                            {plantList.map(p => <td key={p} style={tdStyle}>{matrix[s][p] || 0}</td>)}
                            <td style={tdStyle}>
                              <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: `${cfg.color}20`, color: cfg.color }}>{matrix[s].total}</span>
                            </td>
                          </tr>
                        );
                      })}
                      <tr>
                        <td style={{ padding: '10px 12px', fontSize: '0.8rem', fontWeight: 700, color: theme.textMuted, textTransform: 'uppercase' }}>Total</td>
                        {plantList.map(p => <td key={p} style={{ ...tdStyle, fontWeight: 700 }}>{plantTotals[p]}</td>)}
                        <td style={{ ...tdStyle, fontWeight: 700 }}>{grandTotal}</td>
                      </tr>
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
      <div style={styles.pipelineSection}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text }}>Active Pipeline</h3>
          <button onClick={() => setActiveTab('flow-pending-order')} style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#3B82F6', fontSize: '0.875rem', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer' }}>View all <ArrowRight size={16} /></button>
        </div>
        <div style={styles.pipelineColumns}>
          {['AWAITING FOR DESIGN', 'PENDING FOR DESIGN APPROVAL', 'PENDING FOR ORACLE ENTRY', 'PENDING FOR ORDERING'].map(status => {
            const config = STATUS_CONFIG[status];
            const orders = data.filter(o => o.STATUS === status).slice(0, 3);
            const count = data.filter(o => o.STATUS === status).length;
            return (
              <div key={status} style={styles.pipelineColumn(config.bgColor)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <config.icon size={16} color={config.color} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: config.color }}>{config.label}</span>
                  <span style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 700, color: config.color }}>{count}</span>
                </div>
                {orders.map(order => (
                  <div key={order['DIE NO']} style={styles.pipelineItem} onClick={() => setSelectedOrder(order)}>
                    <DieAttentionLabels order={order} dense />
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', color: theme.text, fontFamily: 'monospace' }}>{order['DIE NO']}</div>
                    <div style={{ fontSize: '0.75rem', color: theme.textDim, marginTop: '4px' }}>{order.Supplier}</div>
                  </div>
                ))}
                {count === 0 && <div style={{ textAlign: 'center', padding: '1rem', color: '#64748B', fontSize: '0.8rem' }}>No orders</div>}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
