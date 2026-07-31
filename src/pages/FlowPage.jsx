import React, { useState, useEffect } from 'react';
import { Search, ChevronDown, ChevronUp, CheckCircle, RotateCcw, Eye, Plane, Truck, Copy, History, Package, Plus, X, Snowflake } from 'lucide-react';
import { STATUS_CONFIG, WORKFLOW_STEPS } from '../utils/constants';
import { ordersAPI, frozenDesignsAPI, extractProfileFromDie } from '../api';
import { formatDate } from '../utils/helpers';
import DieAttentionLabels from '../components/DieAttentionLabels';
import { BRAND, BRAND_ALPHA } from '../utils/brand';

// Received-date fields are write-once on the order; re-receipts after a revision
// are recorded on the revision row via the complete-stage endpoint.
const RECEIVED_DATE_FIELDS = ['Design Received Date', '3D Model Received Date'];

const FLOW_TABS = [
  { id: 'flow-pending-order', status: 'PENDING FOR ORDERING' },
  { id: 'flow-awaiting-design', status: 'AWAITING FOR DESIGN' },
  { id: 'flow-simulation', status: 'UNDER SIMULATION' },
  { id: 'flow-design-approval', status: 'PENDING FOR DESIGN APPROVAL' },
  { id: 'flow-pending-pr', status: 'PENDING FOR PR' },
  { id: 'flow-oracle-entry', status: 'PENDING FOR ORACLE ENTRY' },
  { id: 'flow-design-ems', status: 'PENDING FOR DESIGN TO EMS' },
  { id: 'flow-completed', status: 'DONE' },
];

const isSimulationEnabled = (value) => {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') return /^(true|1|yes|ok|required)$/i.test(value.trim());
  return false;
};

const hasDieReceivedDate = (order) => {
  const d = order?.['Die Received Date'];
  return d != null && String(d).trim() !== '';
};

const parseDieSize = (dieSize) => {
  if (!dieSize) return { diameter: null, thickness: null };
  const cleaned = String(dieSize).toUpperCase().replace(/^DIA\s+/i, '');
  const parts = cleaned.split('X');
  return {
    diameter: parts[0] ? parseInt(parts[0], 10) || null : null,
    thickness: parts[1] ? parseInt(parts[1], 10) || null : null,
  };
};

const getStageEntryDate = (order) => {
  switch (order.STATUS) {
    case 'PENDING FOR ORDERING': return order['Die Requested Date'] || order.created_at;
    case 'AWAITING FOR DESIGN': return order['Ordered date'];
    case 'UNDER SIMULATION': return order['Design Received Date'];
    case 'PENDING FOR DESIGN APPROVAL':
      return order.simulationEnabled ? order['3D Model Received Date'] : order['Design Received Date'];
    case 'PENDING FOR PR': return order['Design Approved Date'];
    case 'PENDING FOR ORACLE ENTRY': return order['PR Entry'];
    case 'PENDING FOR DESIGN TO EMS': return order['Oracle Entry'];
    case 'DONE': return order['Design to EMS Date'];
    default: return null;
  }
};

const DaysBadge = ({ order }) => {
  const entry = getStageEntryDate(order);
  if (!entry) return <span style={{ color: '#64748B' }}>—</span>;
  const start = new Date(entry);
  if (isNaN(start)) return <span style={{ color: '#64748B' }}>—</span>;
  const today = new Date();
  const days = Math.floor((today.setHours(0, 0, 0, 0) - start.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24));
  if (days < 0) return <span style={{ color: '#64748B' }}>—</span>;
  const red = days > 1;
  return (
    <span style={{ fontFamily: 'monospace', fontWeight: 700, padding: '3px 8px', borderRadius: '6px', fontSize: '0.75rem', background: red ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)', color: red ? '#EF4444' : '#10B981' }}>
      {days}d
    </span>
  );
};

export default function FlowPage({
  data, activeTab, searchTerm, setSearchTerm, sortConfig, handleSort, suppliers, theme,
  setSelectedOrder, setShowAddOrderModal, setRevisionOrder, setChangelogOrder,
  setRevisionHistoryOrder,
  setData, setToast, setActiveTab,
  handleInlineFieldSave, handleSizeChange, handleMandrelsChange, handlePRNumberChange, copyForERP,
  handleCavityChange,
}) {
  const [dieReceivanceOrder, setDieReceivanceOrder] = useState(null);
  const [dieReceivanceForm, setDieReceivanceForm] = useState({ die_received_date: '', corrector: '' });
  const [cavityEdit, setCavityEdit] = useState(null);
  const [cavityReason, setCavityReason] = useState('');
  const [frozenMap, setFrozenMap] = useState({}); // orderId -> { id, frozen_at, files_count }

  const currentFlow = FLOW_TABS.find(f => f.id === activeTab);

  // Flag orders that have an active frozen design — only at the early planning stages
  // so planners can fast-track them. One bulk request for all visible orders.
  useEffect(() => {
    let cancelled = false;
    const stage = currentFlow?.status;
    const eligible = stage === 'PENDING FOR ORDERING' || stage === 'AWAITING FOR DESIGN';
    const keys = eligible
      ? data
          .filter(o => o.STATUS === stage && o.id != null)
          .map(o => ({ id: o.id, profile: extractProfileFromDie(o['DIE NO']), plant: o.Plant, press: o.Press, cavity: o.Cavity }))
      : [];
    const p = keys.length ? frozenDesignsAPI.matchBulk(keys) : Promise.resolve({});
    p.then(r => { if (!cancelled) setFrozenMap(r || {}); }).catch(() => { if (!cancelled) setFrozenMap({}); });
    return () => { cancelled = true; };
  }, [activeTab, data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!currentFlow) return null;

  const config = STATUS_CONFIG[currentFlow.status] || { color: '#6B7280', label: currentFlow.status };
  const StatusIcon = config.icon || Package;

  const flowOrders = data.filter(o => {
    if (currentFlow.status === 'DONE') return o.STATUS === 'DONE' && !hasDieReceivedDate(o);
    return o.STATUS === currentFlow.status;
  });

  const workflow = WORKFLOW_STEPS[currentFlow.status];

  const styles = {
    tableContainer: { background: theme.cardBg, borderRadius: '8px', border: `1px solid ${theme.cardBorder}`, overflow: 'hidden', boxShadow: theme.shadowSm },
    table: { width: '100%', borderCollapse: 'collapse' },
    th: { padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 500, color: theme.textMuted, background: theme.tableBg, cursor: 'pointer', borderBottom: `1px solid ${theme.cardBorder}` },
    td: { padding: '1rem', borderBottom: `1px solid ${theme.cardBorder}`, fontSize: '0.875rem', color: theme.text },
  };

  const handleCompleteStep = async (order, e) => {
    e.stopPropagation();
    if (!workflow || !workflow.nextStatus) return;
    const today = new Date().toISOString().split('T')[0];
    const nextStatus = currentFlow.status === 'AWAITING FOR DESIGN' && isSimulationEnabled(order.simulationEnabled)
      ? 'UNDER SIMULATION'
      : workflow.nextStatus;
    const changeLogEntry = {
      date: today,
      field: 'STATUS',
      oldValue: order.STATUS,
      newValue: nextStatus,
      stage: order.STATUS,
    };
    try {
      if (RECEIVED_DATE_FIELDS.includes(workflow.dateField)) {
        // Write-once received date: first receipt sets the top-level field; a
        // re-receipt after a revision is logged on the revision row server-side.
        const alreadyReceived = !!order[workflow.dateField];
        await ordersAPI.completeStage(order.id, { field: workflow.dateField, date: today, nextStatus });
        setData(prev => prev.map(o => o.id === order.id ? {
          ...o,
          STATUS: nextStatus,
          ...(alreadyReceived ? {} : { [workflow.dateField]: today }),
          changeCount: (o.changeCount || 0) + 1,
        } : o));
      } else {
        const patch = {
          STATUS: nextStatus,
          [workflow.dateField]: today,
          'Change Log': [changeLogEntry],
        };
        await ordersAPI.patch(order.id, patch);
        setData(prev => prev.map(o => o.id === order.id ? {
          ...o,
          STATUS: nextStatus,
          [workflow.dateField]: today,
          changeCount: (o.changeCount || 0) + 1,
        } : o));
      }
      setToast({ message: `Order ${order['DIE NO']} moved to ${STATUS_CONFIG[nextStatus]?.label || nextStatus}`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      setToast({ message: 'Failed to update: ' + error.message, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  };

  const filteredOrders = flowOrders
    .filter(o => !searchTerm || (o['DIE NO'] && o['DIE NO'].toLowerCase().includes(searchTerm.toLowerCase())) || (o['Order No'] && o['Order No'].toLowerCase().includes(searchTerm.toLowerCase())) || (o.Supplier && o.Supplier.toLowerCase().includes(searchTerm.toLowerCase())))
    .sort((a, b) => {
      if (!sortConfig.key) return 0;
      const aVal = a[sortConfig.key] || '';
      const bVal = b[sortConfig.key] || '';
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

  const isPendingOrder = currentFlow.status === 'PENDING FOR ORDERING';
  const isSimOrApproval = currentFlow.status === 'UNDER SIMULATION' || currentFlow.status === 'PENDING FOR DESIGN APPROVAL';
  const isPR = currentFlow.status === 'PENDING FOR PR';
  const isDone = currentFlow.status === 'DONE';
  const isDesignApproval = currentFlow.status === 'PENDING FOR DESIGN APPROVAL';
  const isOracleEntry = currentFlow.status === 'PENDING FOR ORACLE ENTRY';

  const columns = [
    { key: 'DIE NO', label: 'Die No' },
    ...(isOracleEntry ? [] : [{ key: 'Order No', label: 'Order' }]),
    { key: 'Plant', label: 'Plant' },
    { key: 'TYPE', label: 'Type' },
    { key: 'Diameter', label: 'Diameter' },
    { key: 'Thickness', label: 'Thickness' },
    { key: 'Cavity', label: 'Cav' },
    { key: 'Supplier', label: 'Supplier' },
    ...(isOracleEntry ? [{ key: 'Ordered date', label: 'Order Date' }] : []),
    ...(isPendingOrder ? [{ key: 'Customer Name', label: 'Customer' }, { key: 'Mandrels per Cavity', label: 'Mandrels/Cav' }, { key: 'Total Mandrels', label: 'Total Mandrels' }, { key: 'Die Requested Date', label: 'Requested' }, { key: 'Type of shipment', label: 'Shipment' }] : []),
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: `${config.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <StatusIcon size={24} color={config.color} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: theme.text, margin: 0 }}>{config.label}</h1>
            <p style={{ fontSize: '0.85rem', color: theme.textMuted, margin: '4px 0 0' }}>Orders in {config.label.toLowerCase()} stage</p>
          </div>
          <span style={{ background: config.color, color: 'white', padding: '4px 12px', borderRadius: '20px', fontSize: '0.875rem', fontWeight: 600 }}>{flowOrders.length}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isPendingOrder && (
            <button onClick={() => setShowAddOrderModal(true)} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '10px 18px', background: BRAND.navy, color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <Plus size={16} /> New Order
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: theme.inputBg || '#0F172A', borderRadius: '10px', padding: '10px 14px', border: `1px solid ${theme.border || '#334155'}`, minWidth: '280px' }}>
            <Search size={18} color={theme.textMuted} />
            <input type="text" placeholder="Search orders..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ border: 'none', background: 'transparent', color: theme.text, fontSize: '0.9rem', outline: 'none', width: '100%' }} />
          </div>
        </div>
      </div>

      <div style={styles.tableContainer}>
        {flowOrders.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {columns.map(col => (
                    <th key={col.key} style={styles.th} onClick={() => handleSort(col.key)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {col.label}
                        {sortConfig.key === col.key ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} color={config.color} /> : <ChevronDown size={14} color={config.color} />) : <ChevronDown size={14} color="#64748B" style={{ opacity: 0.3 }} />}
                      </div>
                    </th>
                  ))}
                  <th style={{ ...styles.th, textAlign: 'center' }}>Days</th>
                  <th style={{ ...styles.th, textAlign: 'center' }}>View</th>
                  {!isOracleEntry && <th style={{ ...styles.th, textAlign: 'center' }}>Rev</th>}
                  {isPR && (
                    <>
                      <th style={{ ...styles.th, textAlign: 'center' }}>Copy ERP</th>
                      <th style={{ ...styles.th, textAlign: 'center' }}>PR Number</th>
                      <th style={{ ...styles.th, textAlign: 'center' }}>Change Log</th>
                    </>
                  )}
                  {workflow && workflow.nextStatus && <th style={{ ...styles.th, textAlign: 'center' }}>Complete</th>}
                  {isDone && <th style={{ ...styles.th, textAlign: 'center' }}>Confirm Receivance</th>}
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order, idx) => (
                  <tr key={`${order['DIE NO']}-${idx}`} style={{ cursor: 'pointer' }} onClick={() => setSelectedOrder(order)}>
                    <td style={{ ...styles.td, whiteSpace: 'nowrap', minWidth: '120px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}>
                        <DieAttentionLabels order={order} dense />
                        <span style={{ fontWeight: 600, color: theme.text, fontFamily: 'monospace' }}>{order['DIE NO']}</span>
                        {frozenMap[order.id] && (
                          <span
                            title={`Frozen design available — ${frozenMap[order.id].files_count} file(s). Release together with the die order to skip the design stages.`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 3, padding: '2px 7px', borderRadius: 6, background: 'rgba(56,189,248,0.14)', color: '#0EA5E9', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.02em' }}
                          >
                            <Snowflake size={11} /> FROZEN DESIGN
                          </span>
                        )}
                      </div>
                    </td>
                    {!isOracleEntry && (
                      <td style={styles.td}>
                        {isPendingOrder ? (
                          <input type="text" defaultValue={order['Order No'] || ''} onBlur={(e) => handleInlineFieldSave(order, 'Order No', e.target.value.trim())} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} style={{ width: '90px', padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem' }} placeholder="Order No" />
                        ) : order['Order No']}
                      </td>
                    )}
                    <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                      <span style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, background: order.Plant === 'EXT 1' ? 'rgba(59,130,246,0.2)' : 'rgba(139,92,246,0.2)', color: order.Plant === 'EXT 1' ? '#60A5FA' : '#A78BFA' }}>{order.Plant}</span>
                    </td>
                    <td style={styles.td}>
                      <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, background: order.TYPE === 'N' ? '#3B82F620' : order.TYPE === 'B' ? '#F59E0B20' : '#64748B20', color: order.TYPE === 'N' ? '#3B82F6' : order.TYPE === 'B' ? '#F59E0B' : '#64748B' }}>
                        {order.TYPE === 'N' ? 'New' : order.TYPE === 'B' ? 'Backup' : order.TYPE}
                      </span>
                    </td>
                    <td style={styles.td}>
                      {isSimOrApproval ? (
                        <input type="number" defaultValue={parseDieSize(order['Die Size']).diameter || ''} onBlur={(e) => handleSizeChange(order, 'Diameter', parseInt(e.target.value, 10))} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} style={{ width: '65px', padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', textAlign: 'center' }} placeholder="Ø" />
                      ) : <span style={{ fontFamily: 'monospace' }}>{parseDieSize(order['Die Size']).diameter || '—'}</span>}
                    </td>
                    <td style={styles.td}>
                      {isSimOrApproval ? (
                        <input type="number" defaultValue={parseDieSize(order['Die Size']).thickness || ''} onBlur={(e) => handleSizeChange(order, 'Thickness', parseInt(e.target.value, 10))} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} style={{ width: '65px', padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', textAlign: 'center' }} placeholder="T" />
                      ) : <span style={{ fontFamily: 'monospace' }}>{parseDieSize(order['Die Size']).thickness || '—'}</span>}
                    </td>
                    <td style={styles.td}>
                      {isDesignApproval ? (
                        <input
                          type="number"
                          min="1"
                          defaultValue={order['Cavity'] || ''}
                          onBlur={(e) => {
                            const newVal = parseInt(e.target.value, 10);
                            if (!isNaN(newVal) && newVal !== (order['Cavity'] || 0)) {
                              setCavityEdit({ order, newValue: newVal, rect: e.target.getBoundingClientRect() });
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                          style={{ width: '55px', padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', textAlign: 'center' }}
                          placeholder="Cav"
                        />
                      ) : (
                        <span style={{ fontFamily: 'monospace' }}>{order['Cavity'] || '—'}</span>
                      )}
                    </td>
                    <td style={styles.td}>
                      {isPendingOrder ? (
                        <select defaultValue={order.Supplier || ''} onChange={(e) => handleInlineFieldSave(order, 'Supplier', e.target.value)} onClick={(e) => e.stopPropagation()} style={{ padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', cursor: 'pointer', maxWidth: '120px' }}>
                          <option value="">—</option>
                          {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                        </select>
                      ) : order.Supplier}
                    </td>
                    {isPendingOrder && (
                      <>
                        <td style={styles.td}>
                          <input type="text" defaultValue={order['Customer Name'] || ''} onBlur={(e) => handleInlineFieldSave(order, 'Customer Name', e.target.value.trim())} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} style={{ width: '130px', padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem' }} placeholder="Customer" />
                        </td>
                        <td style={styles.td}>
                          <input type="number" min="0" defaultValue={order['Mandrels per Cavity'] || 0} onBlur={(e) => handleMandrelsChange(order, e.target.value)} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} style={{ width: '55px', padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', textAlign: 'center' }} />
                        </td>
                        <td style={styles.td}><span style={{ fontFamily: 'monospace' }}>{order['Total Mandrels'] || 0}</span></td>
                        <td style={styles.td}>{formatDate(order['Die Requested Date'])}</td>
                        <td style={styles.td}><div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>{order['Type of shipment'] === 'AIR' ? <Plane size={14} color="#0EA5E9" /> : <Truck size={14} color="#10B981" />}{order['Type of shipment']}</div></td>
                      </>
                    )}
                    {isOracleEntry && (
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{formatDate(order['Ordered date'])}</td>
                    )}
                    <td style={{ ...styles.td, textAlign: 'center' }}><DaysBadge order={order} /></td>
                    <td style={{ ...styles.td, textAlign: 'center' }}>
                      <button onClick={(e) => { e.stopPropagation(); setSelectedOrder(order); }} style={{ padding: '8px', background: 'transparent', border: 'none', borderRadius: '8px', cursor: 'pointer', color: '#64748B' }}><Eye size={18} /></button>
                    </td>
                    {!isOracleEntry && (
                      <td style={{ ...styles.td, textAlign: 'center' }}>
                        {order['Design Revision Count'] > 0 ? (
                          <button onClick={(e) => { e.stopPropagation(); setRevisionHistoryOrder && setRevisionHistoryOrder(order); }} style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: 'rgba(245,158,11,0.2)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.4)', cursor: 'pointer' }} title={`${order['Design Revision Count']} revision(s)${order['Last Revision Date'] ? ` - Last: ${order['Last Revision Date']}` : ''} - Click to view history`}>{order['Design Revision Count']}</button>
                        ) : <span style={{ color: '#64748B' }}>—</span>}
                      </td>
                    )}
                    {isPR && (
                      <>
                        <td style={{ ...styles.td, textAlign: 'center' }}>
                          <button onClick={(e) => { e.stopPropagation(); copyForERP(order); }} style={{ padding: '6px 12px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '8px', cursor: 'pointer', color: '#3B82F6', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 600 }} title="Copy for ERP" onMouseEnter={(e) => { e.currentTarget.style.background = '#3B82F6'; e.currentTarget.style.color = 'white'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(59,130,246,0.2)'; e.currentTarget.style.color = '#3B82F6'; }}>
                            <Copy size={14} /> Copy
                          </button>
                        </td>
                        <td style={styles.td}>
                          <input type="text" defaultValue={order['PR Number'] || ''} onBlur={(e) => handlePRNumberChange(order, e.target.value)} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} style={{ width: '100px', padding: '6px 8px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', textAlign: 'center' }} placeholder="PR-XXXX" />
                        </td>
                        <td style={{ ...styles.td, textAlign: 'center' }}>
                          {order.changeCount > 0 ? (
                            <button onClick={(e) => { e.stopPropagation(); setChangelogOrder(order); }} style={{ padding: '6px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '6px', cursor: 'pointer', color: '#3B82F6', display: 'inline-flex', alignItems: 'center', gap: '4px' }} title={`${order.changeCount} change(s) logged`}>
                              <History size={14} />
                              <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>{order.changeCount}</span>
                            </button>
                          ) : <span style={{ color: '#64748B', fontSize: '0.8rem' }}>—</span>}
                        </td>
                      </>
                    )}
                    {workflow && workflow.nextStatus && (
                      <td style={{ ...styles.td, textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          {(currentFlow.status === 'PENDING FOR DESIGN APPROVAL' || currentFlow.status === 'UNDER SIMULATION') && (
                            <button onClick={(e) => { e.stopPropagation(); setRevisionOrder(order); }} style={{ padding: '6px 12px', background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '8px', cursor: 'pointer', color: '#F59E0B', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600 }} title="Request Revision" onMouseEnter={(e) => { e.currentTarget.style.background = '#F59E0B'; e.currentTarget.style.color = 'white'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(245,158,11,0.2)'; e.currentTarget.style.color = '#F59E0B'; }}>
                              <RotateCcw size={16} />
                            </button>
                          )}
                          <button onClick={(e) => handleCompleteStep(order, e)} style={{ padding: '6px 12px', background: `${config.color}20`, border: `1px solid ${config.color}40`, borderRadius: '8px', cursor: 'pointer', color: config.color, display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600 }} title={workflow.completionLabel} onMouseEnter={(e) => { e.currentTarget.style.background = config.color; e.currentTarget.style.color = 'white'; }} onMouseLeave={(e) => { e.currentTarget.style.background = `${config.color}20`; e.currentTarget.style.color = config.color; }}>
                            <CheckCircle size={16} />
                          </button>
                        </div>
                      </td>
                    )}
                    {isDone && (
                      <td style={{ ...styles.td, textAlign: 'center' }}>
                        <button onClick={(e) => { e.stopPropagation(); setDieReceivanceOrder(order); setDieReceivanceForm({ die_received_date: new Date().toISOString().split('T')[0], corrector: '' }); }} style={{ padding: '6px 14px', background: 'rgba(8,145,178,0.15)', border: '1px solid rgba(8,145,178,0.4)', borderRadius: '8px', cursor: 'pointer', color: '#0891B2', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap' }} title="Confirm Die Receivance" onMouseEnter={(e) => { e.currentTarget.style.background = '#0891B2'; e.currentTarget.style.color = 'white'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(8,145,178,0.15)'; e.currentTarget.style.color = '#0891B2'; }}>
                          <Package size={16} /> Confirm
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '4rem 2rem', color: theme.textMuted }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: `${config.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
              <StatusIcon size={28} color={config.color} />
            </div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: theme.text, marginBottom: '0.5rem' }}>No Orders in {config.label}</h3>
            <p style={{ fontSize: '0.9rem', color: theme.textMuted }}>There are currently no orders at this stage</p>
          </div>
        )}
      </div>

      {dieReceivanceOrder && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '2rem', width: '90%', maxWidth: '480px', border: `1px solid ${theme.cardBorder}`, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: theme.text, margin: 0 }}>Confirm Die Receivance</h2>
                <DieAttentionLabels order={dieReceivanceOrder} dense />
                <p style={{ fontSize: '0.85rem', color: theme.textMuted, margin: '4px 0 0' }}>Die No: <strong style={{ color: theme.text, fontFamily: 'monospace' }}>{dieReceivanceOrder['DIE NO']}</strong></p>
              </div>
              <button onClick={() => setDieReceivanceOrder(null)} style={{ padding: '8px', background: 'transparent', border: 'none', borderRadius: '8px', cursor: 'pointer', color: theme.textMuted }}><X size={20} /></button>
            </div>
            <div style={{ background: `rgba(8,145,178,0.08)`, borderRadius: '12px', padding: '12px 16px', marginBottom: '1.5rem', border: '1px solid rgba(8,145,178,0.2)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.8rem' }}>
                <div><span style={{ color: theme.textDim }}>Supplier:</span> <strong style={{ color: theme.text }}>{dieReceivanceOrder.Supplier}</strong></div>
                <div><span style={{ color: theme.textDim }}>Plant:</span> <strong style={{ color: theme.text }}>{dieReceivanceOrder.Plant}</strong></div>
                <div><span style={{ color: theme.textDim }}>Type:</span> <strong style={{ color: theme.text }}>{dieReceivanceOrder.TYPE === 'N' ? 'New' : dieReceivanceOrder.TYPE === 'B' ? 'Backup' : dieReceivanceOrder.TYPE}</strong></div>
                <div><span style={{ color: theme.textDim }}>Size:</span> <strong style={{ color: theme.text }}>{dieReceivanceOrder['Die Size'] || '—'}</strong></div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Die Received Date *</label>
                <input type="date" value={dieReceivanceForm.die_received_date} onChange={(e) => setDieReceivanceForm({ ...dieReceivanceForm, die_received_date: e.target.value })} style={{ width: '100%', padding: '10px 12px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.text, fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Assign Corrector *</label>
                <input type="text" value={dieReceivanceForm.corrector} onChange={(e) => setDieReceivanceForm({ ...dieReceivanceForm, corrector: e.target.value })} placeholder="Enter corrector name" style={{ width: '100%', padding: '10px 12px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.text, fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '1.5rem', paddingTop: '1rem', borderTop: `1px solid ${theme.border || '#334155'}` }}>
              <button onClick={() => setDieReceivanceOrder(null)} style={{ padding: '10px 20px', background: 'transparent', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '10px', color: theme.textMuted, fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' }}>Cancel</button>
              <button
                onClick={async () => {
                  if (!dieReceivanceForm.die_received_date) { setToast({ message: 'Please enter the die received date', type: 'error' }); setTimeout(() => setToast(null), 3000); return; }
                  if (!dieReceivanceForm.corrector.trim()) { setToast({ message: 'Please assign a corrector', type: 'error' }); setTimeout(() => setToast(null), 3000); return; }
                  try {
                    const dieReceivanceLog = {
                      date: dieReceivanceForm.die_received_date,
                      field: 'STATUS',
                      oldValue: dieReceivanceOrder.STATUS,
                      newValue: 'DIE RECEIVED',
                      stage: dieReceivanceOrder.STATUS,
                      reason: `Corrector: ${dieReceivanceForm.corrector.trim()}`,
                    };
                    const patch = {
                      STATUS: 'DIE RECEIVED',
                      'Die Received Date': dieReceivanceForm.die_received_date,
                      'Corrector': dieReceivanceForm.corrector.trim(),
                      'Press': dieReceivanceOrder['Press'] || dieReceivanceOrder.Plant || '',
                      'Ascona Reference': dieReceivanceOrder['Ascona Reference'] || 'No',
                      'Sample Status': dieReceivanceOrder['Sample Status'] || 'Pending',
                      'Change Log': [dieReceivanceLog],
                    };
                    await ordersAPI.patch(dieReceivanceOrder.id, patch);
                    setData(prev => prev.map(o => o.id === dieReceivanceOrder.id ? {
                      ...o, ...patch, changeCount: (o.changeCount || 0) + 1,
                    } : o));
                    setDieReceivanceOrder(null);
                    setToast({ message: `Die ${dieReceivanceOrder['DIE NO']} confirmed & moved to Sample Followup`, type: 'success' });
                    setActiveTab('flow-sample-followup');
                    setTimeout(() => setToast(null), 3000);
                  } catch (error) {
                    setToast({ message: 'Failed to confirm: ' + error.message, type: 'error' });
                    setTimeout(() => setToast(null), 5000);
                  }
                }}
                style={{ padding: '10px 24px', background: '#0891B2', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', boxShadow: '0 4px 12px rgba(8,145,178,0.4)', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <CheckCircle size={18} /> Confirm Receivance
              </button>
            </div>
          </div>
        </div>
      )}

      {cavityEdit && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1999 }}
          onClick={() => { setCavityEdit(null); setCavityReason(''); }}
        >
          <div
            style={{
              position: 'fixed',
              top: cavityEdit.rect.bottom + 8,
              left: cavityEdit.rect.left,
              zIndex: 2000,
              background: theme.cardBg || '#1E293B',
              border: `1px solid ${theme.border || '#334155'}`,
              borderRadius: '10px',
              padding: '12px 14px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              minWidth: '260px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '0.8rem', color: theme.textMuted || '#94A3B8', marginBottom: '8px' }}>
              Cavity change:{' '}
              <span style={{ fontFamily: 'monospace', color: '#EF4444', textDecoration: 'line-through' }}>
                {cavityEdit.order['Cavity'] || 0}
              </span>
              {' → '}
              <span style={{ fontFamily: 'monospace', color: '#10B981', fontWeight: 700 }}>
                {cavityEdit.newValue}
              </span>
            </div>
            <textarea
              autoFocus
              placeholder="Reason for change…"
              value={cavityReason}
              onChange={(e) => setCavityReason(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                background: theme.inputBg || '#0F172A',
                border: `1px solid ${theme.border || '#334155'}`,
                borderRadius: '6px',
                color: theme.text,
                fontSize: '0.8rem',
                resize: 'none',
                height: '60px',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button
                onClick={() => { setCavityEdit(null); setCavityReason(''); }}
                style={{ padding: '5px 12px', background: 'transparent', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.textMuted || '#94A3B8', fontSize: '0.8rem', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                disabled={!cavityReason.trim()}
                onClick={async () => {
                  await handleCavityChange(cavityEdit.order, cavityEdit.newValue, cavityReason.trim());
                  setCavityEdit(null);
                  setCavityReason('');
                }}
                style={{ padding: '5px 12px', background: cavityReason.trim() ? '#3B82F6' : '#334155', border: 'none', borderRadius: '6px', color: cavityReason.trim() ? 'white' : '#64748B', fontSize: '0.8rem', fontWeight: 600, cursor: cavityReason.trim() ? 'pointer' : 'not-allowed' }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
