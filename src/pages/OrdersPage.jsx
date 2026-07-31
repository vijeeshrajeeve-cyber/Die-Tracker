import React from 'react';
import { ChevronUp, ChevronDown, Plane, Truck, Eye, Trash2, ChevronLeft, ChevronRight, History, Download } from 'lucide-react';
import { STATUS_CONFIG } from '../utils/constants';
import { ordersAPI } from '../api';
import { dialogs } from '../components/ui/DialogProvider';
import DieAttentionLabels from '../components/DieAttentionLabels';
import DatePickerField from '../components/DatePickerField';
import { parseDateDMY, formatDate } from '../utils/helpers';
import { exportToExcel } from '../utils/exportExcel';

const StatusBadge = ({ status }) => {
  const config = STATUS_CONFIG[status] || { color: '#6B7280', bgColor: '#F3F4F6', label: status };
  return <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 600, backgroundColor: config.bgColor, color: config.color }}>{config.label}</span>;
};

const parseDieSize = (dieSize) => {
  if (!dieSize) return { diameter: null, thickness: null };
  const cleaned = String(dieSize).toUpperCase().replace(/^DIA\s+/i, '');
  const match = cleaned.match(/^(\d+(?:\.\d+)?)[Xx×](\d+(?:\.\d+)?)/);
  if (match) return { diameter: match[1], thickness: match[2] };
  const single = cleaned.match(/^(\d+(?:\.\d+)?)/);
  return single ? { diameter: single[1], thickness: null } : { diameter: null, thickness: null };
};

const calcLeadDays = (startDate, endDate) => {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate), end = new Date(endDate);
  if (isNaN(start) || isNaN(end)) return null;
  const days = Math.round((end - start) / (1000 * 60 * 60 * 24));
  return days >= 0 ? days : null;
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

export default function OrdersPage({
  theme,
  user,
  filters, setFilters,
  searchTerm, setSearchTerm,
  sortConfig, handleSort,
  filteredData,
  paginatedData,
  currentPage, setCurrentPage,
  totalPages,
  uniquePlants, uniqueStatuses, uniqueSuppliers, uniqueTypes, uniqueMonths, uniqueYears,
  uniqueCustomers = [],
  dieReceivedDateMap,
  setSelectedOrder,
  setChangelogOrder,
  setToast,
  fetchOrders,
}) {
  const daysInStage = (order) => {
    const entry = getStageEntryDate(order);
    if (!entry) return null;
    const iso = typeof entry === 'string' && /\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}/.test(entry)
      ? parseDateDMY(entry)
      : entry;
    const start = new Date(iso);
    if (isNaN(start)) return null;
    const today = new Date();
    const days = Math.floor((today.setHours(0,0,0,0) - start.setHours(0,0,0,0)) / (1000 * 60 * 60 * 24));
    return days >= 0 ? days : null;
  };

  const DaysBadge = ({ order }) => {
    const days = daysInStage(order);
    if (days === null) return <span style={{ color: '#64748B' }}>—</span>;
    const red = days > 1;
    return (
      <span style={{ fontFamily: 'monospace', fontWeight: 700, padding: '3px 8px', borderRadius: '6px', fontSize: '0.75rem', background: red ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)', color: red ? '#EF4444' : '#10B981' }}>
        {days}d
      </span>
    );
  };

  const handleExport = () => {
    const leadTime = (startKey) => (_, order) => {
      const receivedDate = dieReceivedDateMap[order['DIE NO']?.trim()];
      const days = calcLeadDays(order[startKey], receivedDate);
      return days !== null ? days : '';
    };
    exportToExcel({
      rows: filteredData,
      filename: 'die_orders',
      sheetName: 'Die Orders',
      columns: [
        { key: 'DIE NO', label: 'Die No' },
        { key: 'Order No', label: 'Order No' },
        { key: 'Plant', label: 'Plant' },
        { key: 'TYPE', label: 'Type' },
        { key: 'Die Size', label: 'Diameter', format: (v) => parseDieSize(v).diameter || '' },
        { key: 'Die Size', label: 'Thickness', format: (v) => parseDieSize(v).thickness || '' },
        { key: 'Cavity', label: 'Cavity' },
        { key: 'Supplier', label: 'Supplier' },
        { key: 'Customer Name', label: 'Customer' },
        { key: 'PR Number', label: 'PR Number' },
        { key: 'Mandrels per Cavity', label: 'Mandrels per Cavity' },
        { key: 'Total Mandrels', label: 'Total Mandrels' },
        { key: 'Die Requested Date', label: 'Requested Date', format: 'date' },
        { key: 'Type of shipment', label: 'Shipment' },
        { key: 'STATUS', label: 'Status', format: (v) => STATUS_CONFIG[v]?.label || v || '' },
        { key: 'Ordered date', label: 'Delivery Lead Time (days)', format: leadTime('Ordered date') },
        { key: 'Design Approved Date', label: 'Mfg Lead Time (days)', format: leadTime('Design Approved Date') },
        { key: 'STATUS', label: 'Days in Stage', format: (_, order) => { const d = daysInStage(order); return d === null ? '' : d; } },
      ],
    });
  };

  const filterBar = { background: theme.cardBg, borderRadius: '8px', padding: '1.25rem', border: `1px solid ${theme.cardBorder}`, marginBottom: '1.5rem', boxShadow: theme.shadowSm };
  const filterRow = { display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' };
  const filterSelect = { padding: '10px 16px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem', cursor: 'pointer', minWidth: '130px', transition: 'all 0.15s', outline: 'none' };
  const dateFieldLabel = { display: 'flex', flexDirection: 'column', gap: '4px' };
  const dateLabelText = { fontSize: '0.7rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.03em' };
  const tableContainer = { background: theme.cardBg, borderRadius: '8px', border: `1px solid ${theme.cardBorder}`, overflow: 'hidden', boxShadow: theme.shadowSm };
  const tableStyle = { width: '100%' };
  // Color tokens consumed by the shared .dt-table CSS (see index.css)
  const scrollVars = {
    '--dt-border': theme.cardBorder,
    '--dt-header-bg': theme.tableHeaderBg,
    '--dt-header-text': theme.tableHeaderText,
    '--dt-header-border': theme.tableHeaderBorder,
    '--dt-stripe': theme.stripeBg,
    '--dt-hover': theme.rowHover,
    '--dt-body-text': theme.text,
  };
  const th = { cursor: 'pointer' };
  const td = {};

  return (
    <>
      <div style={filterBar}>
        <div style={filterRow}>
          <select style={filterSelect} value={filters.plant} onChange={(e) => setFilters({ ...filters, plant: e.target.value })}><option value="all">All Plants</option>{uniquePlants.map(p => <option key={p} value={p}>{p}</option>)}</select>
          <select style={filterSelect} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="all">All Status</option><option value="pre-approval">Pre–design approval (not cancelled)</option>{uniqueStatuses.map(s => <option key={s} value={s}>{STATUS_CONFIG[s]?.label || s}</option>)}</select>
          <select style={filterSelect} value={filters.supplier} onChange={(e) => setFilters({ ...filters, supplier: e.target.value })}><option value="all">All Suppliers</option>{uniqueSuppliers.map(s => <option key={s} value={s}>{s}</option>)}</select>
          <select style={filterSelect} value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}><option value="all">All Types</option>{uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}</select>
          <select style={filterSelect} value={filters.month} onChange={(e) => setFilters({ ...filters, month: e.target.value })}><option value="all">All Months</option>{uniqueMonths.map(m => <option key={m} value={m}>{m}</option>)}</select>
          <select style={filterSelect} value={filters.year} onChange={(e) => setFilters({ ...filters, year: e.target.value })}><option value="all">All Years</option>{uniqueYears.map(y => <option key={y} value={y}>{y}</option>)}</select>
          <select style={filterSelect} value={filters.customer} onChange={(e) => setFilters({ ...filters, customer: e.target.value })}><option value="all">All Customers</option>{uniqueCustomers.map(c => <option key={c} value={c}>{c}</option>)}</select>
          <select style={filterSelect} value={filters.urgency || 'all'} onChange={(e) => setFilters({ ...filters, urgency: e.target.value })} title="Filter by urgency level">
            <option value="all">All Urgencies</option>
            <option value="NORMAL">Normal</option>
            <option value="URGENT">Urgent</option>
            <option value="TOP_URGENT">Top urgent</option>
          </select>
          <select style={filterSelect} value={filters.specialFollowUp || 'all'} onChange={(e) => setFilters({ ...filters, specialFollowUp: e.target.value })} title="Filter by special follow-up flag">
            <option value="all">All (Special follow-up)</option>
            <option value="yes">Flagged</option>
            <option value="no">Not flagged</option>
          </select>
        </div>
        <div style={{ ...filterRow, marginTop: '1rem', alignItems: 'flex-end' }}>
          <div style={dateFieldLabel}>
            <span style={dateLabelText}>Requested from</span>
            <div style={{ minWidth: '180px' }}>
              <DatePickerField
                theme={theme}
                value={filters.dateFrom}
                placeholder="Start date"
                title="Show orders requested on or after this date"
                onChange={(val) => setFilters({ ...filters, dateFrom: val })}
              />
            </div>
          </div>
          <div style={dateFieldLabel}>
            <span style={dateLabelText}>Requested to</span>
            <div style={{ minWidth: '180px' }}>
              <DatePickerField
                theme={theme}
                value={filters.dateTo}
                placeholder="End date"
                title="Show orders requested on or before this date"
                onChange={(val) => setFilters({ ...filters, dateTo: val })}
              />
            </div>
          </div>
          {(filters.dateFrom || filters.dateTo) && (
            <button
              onClick={() => setFilters({ ...filters, dateFrom: '', dateTo: '' })}
              style={{ fontSize: '0.8rem', color: '#3B82F6', background: 'none', border: 'none', cursor: 'pointer', paddingBottom: '10px' }}
            >
              Clear dates
            </button>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${theme.cardBorder}` }}>
          <span style={{ fontSize: '0.875rem', color: theme.textMuted }}>Showing <strong style={{ color: theme.text }}>{filteredData.length}</strong> orders</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              onClick={handleExport}
              disabled={filteredData.length === 0}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 14px', fontSize: '0.8rem', fontWeight: 600, color: 'white', background: 'linear-gradient(135deg, #10B981, #059669)', border: 'none', borderRadius: '8px', cursor: filteredData.length === 0 ? 'not-allowed' : 'pointer', opacity: filteredData.length === 0 ? 0.5 : 1 }}
              title="Export the currently filtered orders to Excel"
            >
              <Download size={14} /> Export to Excel
            </button>
            <button onClick={() => { setFilters({ plant: 'all', status: 'all', supplier: 'all', type: 'all', month: 'all', year: 'all', customer: 'all', urgency: 'all', specialFollowUp: 'all', dateFrom: '', dateTo: '' }); setSearchTerm(''); }} style={{ fontSize: '0.875rem', color: '#3B82F6', background: 'none', border: 'none', cursor: 'pointer' }}>Clear filters</button>
          </div>
        </div>
      </div>
      <div style={tableContainer}>
        <div className="dt-scroll" style={scrollVars}>
          <table className="dt-table" style={tableStyle}>
            <thead>
              <tr>
                {[
                  { key: 'DIE NO', label: 'Die No' }, { key: 'Order No', label: 'Order' },
                  { key: 'Plant', label: 'Plant' }, { key: 'TYPE', label: 'Type' },
                  { key: 'Diameter', label: 'Ø', align: 'right' }, { key: 'Thickness', label: 'T', align: 'right' }, { key: 'Cavity', label: 'Cav', align: 'right' },
                  { key: 'Supplier', label: 'Supplier' }, { key: 'Customer Name', label: 'Customer' },
                  { key: 'PR Number', label: 'PR#' }, { key: 'Mandrels per Cavity', label: 'Mandrels/Cav', align: 'right' },
                  { key: 'Total Mandrels', label: 'Total Mandrels', align: 'right' }, { key: 'Die Requested Date', label: 'Requested' },
                  { key: 'Type of shipment', label: 'Ship' }, { key: 'STATUS', label: 'Status' },
                  { key: 'Delivery Lead Time', label: 'Delivery LT', align: 'right' }, { key: 'Mfg Lead Time', label: 'Mfg LT', align: 'right' },
                ].map(col => (
                  <th key={col.key} style={th} className={col.align === 'right' ? 'dt-num' : undefined} onClick={() => handleSort(col.key)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start' }}>
                      {col.label}
                      {sortConfig.key === col.key ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} color="#3B82F6" /> : <ChevronDown size={14} color="#3B82F6" />) : <ChevronDown size={14} color="#64748B" />}
                    </div>
                  </th>
                ))}
                <th style={th} className="dt-center">Log</th>
                <th style={th} className="dt-center">Days</th>
                <th style={th} className="dt-center">View</th>
                {user?.role === 'admin' && <th style={th} className="dt-center">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {paginatedData.map((order, idx) => (
                <tr key={`${order['DIE NO']}-${idx}`} style={{ cursor: 'pointer' }} onClick={() => setSelectedOrder(order)}>
                  <td style={{ ...td, whiteSpace: 'nowrap', minWidth: '120px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}>
                      <DieAttentionLabels order={order} dense />
                      <span style={{ fontWeight: 600, color: theme.text, fontFamily: 'monospace' }}>{order['DIE NO']}</span>
                    </div>
                  </td>
                  <td style={td}>{order['Order No']}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <span style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, background: order.Plant === 'EXT 1' ? 'rgba(59,130,246,0.2)' : 'rgba(139,92,246,0.2)', color: order.Plant === 'EXT 1' ? '#60A5FA' : '#A78BFA' }}>{order.Plant}</span>
                  </td>
                  <td style={td}>{order.TYPE}</td>
                  <td style={td} className="dt-num"><span style={{ fontFamily: 'monospace' }}>{parseDieSize(order['Die Size']).diameter || '—'}</span></td>
                  <td style={td} className="dt-num"><span style={{ fontFamily: 'monospace' }}>{parseDieSize(order['Die Size']).thickness || '—'}</span></td>
                  <td style={td} className="dt-num"><span style={{ fontFamily: 'monospace' }}>{order['Cavity'] || '—'}</span></td>
                  <td style={td}>{order.Supplier}</td>
                  <td style={td}>{order['Customer Name'] || <span style={{ color: theme.textMuted }}>—</span>}</td>
                  <td style={td}><span style={{ fontFamily: 'monospace', color: order['PR Number'] ? theme.text : theme.textMuted }}>{order['PR Number'] || '—'}</span></td>
                  <td style={td} className="dt-num"><span style={{ fontFamily: 'monospace' }}>{order['Mandrels per Cavity'] || 0}</span></td>
                  <td style={td} className="dt-num"><span style={{ fontFamily: 'monospace' }}>{order['Total Mandrels'] || 0}</span></td>
                  <td style={td}>{formatDate(order['Die Requested Date'])}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {order['Type of shipment'] === 'AIR' ? <Plane size={14} color="#0EA5E9" /> : <Truck size={14} color="#10B981" />}
                      {order['Type of shipment']}
                    </div>
                  </td>
                  <td style={td}><StatusBadge status={order.STATUS} /></td>
                  {/* Delivery Lead Time */}
                  <td style={td} className="dt-num">
                    {(() => {
                      const receivedDate = dieReceivedDateMap[order['DIE NO']?.trim()];
                      const days = calcLeadDays(order['Ordered date'], receivedDate);
                      return days !== null
                        ? <span style={{ fontFamily: 'monospace', fontWeight: 600, color: days > 90 ? '#EF4444' : days > 60 ? '#F59E0B' : '#10B981' }}>{days}d</span>
                        : <span style={{ color: theme.textMuted }}>—</span>;
                    })()}
                  </td>
                  {/* Manufacturing Lead Time */}
                  <td style={td} className="dt-num">
                    {(() => {
                      const receivedDate = dieReceivedDateMap[order['DIE NO']?.trim()];
                      const days = calcLeadDays(order['Design Approved Date'], receivedDate);
                      return days !== null
                        ? <span style={{ fontFamily: 'monospace', fontWeight: 600, color: days > 90 ? '#EF4444' : days > 60 ? '#F59E0B' : '#10B981' }}>{days}d</span>
                        : <span style={{ color: theme.textMuted }}>—</span>;
                    })()}
                  </td>
                  {/* Change Log indicator */}
                  <td style={td} className="dt-center">
                    {order.changeCount > 0 ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); setChangelogOrder(order); }}
                        style={{ padding: '6px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '6px', cursor: 'pointer', color: '#3B82F6', display: 'flex', alignItems: 'center', gap: '4px' }}
                        title={`${order.changeCount} change(s) logged - Click to view`}
                      >
                        <History size={14} />
                        <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>{order.changeCount}</span>
                      </button>
                    ) : (
                      <span style={{ color: '#64748B', fontSize: '0.8rem' }}>—</span>
                    )}
                  </td>
                  <td style={td} className="dt-center"><DaysBadge order={order} /></td>
                  <td style={td} className="dt-center">
                    <button onClick={(e) => { e.stopPropagation(); setSelectedOrder(order); }} style={{ padding: '8px', background: 'transparent', border: 'none', borderRadius: '8px', cursor: 'pointer', color: theme.textMuted }}>
                      <Eye size={18} />
                    </button>
                  </td>
                  {user?.role === 'admin' && (
                    <td style={td} className="dt-center">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const confirmed = await dialogs.confirm({
                            title: 'Delete order',
                            message: `Order ${order['DIE NO']} will be permanently removed. This cannot be undone.`,
                            confirmLabel: 'Delete order',
                          });
                          if (confirmed) {
                            try {
                              await ordersAPI.delete(order.id);
                              setToast({ message: `Order ${order['DIE NO']} deleted successfully`, type: 'success' });
                              setTimeout(() => setToast(null), 3000);
                              fetchOrders();
                            } catch (error) {
                              console.error('Delete error:', error);
                              setToast({ message: 'Failed to delete: ' + error.message, type: 'error' });
                              setTimeout(() => setToast(null), 5000);
                            }
                          }
                        }}
                        style={{ padding: '8px', background: 'rgba(239,68,68,0.1)', border: 'none', borderRadius: '8px', cursor: 'pointer', color: '#EF4444' }}
                        title="Delete Order"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.5rem', borderTop: '1px solid #334155' }}>
            <span style={{ fontSize: '0.875rem', color: '#64748B' }}>Page {currentPage} of {totalPages}</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} style={{ minWidth: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0F172A', border: '1px solid #334155', borderRadius: '8px', color: '#94A3B8', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', opacity: currentPage === 1 ? 0.4 : 1 }}>
                <ChevronLeft size={18} />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + 1).map(page => (
                <button key={page} onClick={() => setCurrentPage(page)} style={{ minWidth: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: currentPage === page ? '#3B82F6' : '#0F172A', border: '1px solid', borderColor: currentPage === page ? '#3B82F6' : '#334155', borderRadius: '8px', color: currentPage === page ? 'white' : '#94A3B8', cursor: 'pointer' }}>
                  {page}
                </button>
              ))}
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} style={{ minWidth: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0F172A', border: '1px solid #334155', borderRadius: '8px', color: '#94A3B8', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', opacity: currentPage === totalPages ? 0.4 : 1 }}>
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
