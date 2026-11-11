import React from 'react';
import { ChevronUp, ChevronDown, Plane, Truck, Eye, Trash2, ChevronLeft, ChevronRight, History, Download } from 'lucide-react';
import { STATUS_CONFIG } from '../utils/constants';
import { ordersAPI } from '../api';
import { dialogs } from '../components/ui/DialogProvider';
import DieAttentionLabels from '../components/DieAttentionLabels';
import DatePickerField from '../components/DatePickerField';
import { formatDate } from '../utils/helpers';
import { typeLabel, dieTypeLabel } from '../utils/dieType';
import { parseDieSize, calcLeadDays, daysInStage } from '../utils/orderExport';
import StatusPill from '../components/ui/StatusPill';

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
  onExport,
}) {
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
          <select aria-label="Filter by plant" style={filterSelect} value={filters.plant} onChange={(e) => setFilters({ ...filters, plant: e.target.value })}><option value="all">All Plants</option>{uniquePlants.map(p => <option key={p} value={p}>{p}</option>)}</select>
          <select aria-label="Filter by status" style={filterSelect} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="all">All Status</option><option value="pre-approval">Pre–design approval (not cancelled)</option>{uniqueStatuses.map(s => <option key={s} value={s}>{STATUS_CONFIG[s]?.label || s}</option>)}</select>
          <select aria-label="Filter by supplier" style={filterSelect} value={filters.supplier} onChange={(e) => setFilters({ ...filters, supplier: e.target.value })}><option value="all">All Suppliers</option>{uniqueSuppliers.map(s => <option key={s} value={s}>{s}</option>)}</select>
          <select aria-label="Filter by item type" style={filterSelect} value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}><option value="all">All Item Types</option>{uniqueTypes.map(t => <option key={t} value={t}>{typeLabel(t)}</option>)}</select>
          <select aria-label="Filter by month" style={filterSelect} value={filters.month} onChange={(e) => setFilters({ ...filters, month: e.target.value })}><option value="all">All Months</option>{uniqueMonths.map(m => <option key={m} value={m}>{m}</option>)}</select>
          <select aria-label="Filter by year" style={filterSelect} value={filters.year} onChange={(e) => setFilters({ ...filters, year: e.target.value })}><option value="all">All Years</option>{uniqueYears.map(y => <option key={y} value={y}>{y}</option>)}</select>
          <select aria-label="Filter by customer" style={filterSelect} value={filters.customer} onChange={(e) => setFilters({ ...filters, customer: e.target.value })}><option value="all">All Customers</option>{uniqueCustomers.map(c => <option key={c} value={c}>{c}</option>)}</select>
          <select aria-label="Filter by urgency" style={filterSelect} value={filters.urgency || 'all'} onChange={(e) => setFilters({ ...filters, urgency: e.target.value })} title="Filter by urgency level">
            <option value="all">All Urgencies</option>
            <option value="NORMAL">Normal</option>
            <option value="URGENT">Urgent</option>
            <option value="TOP_URGENT">Top urgent</option>
          </select>
          <select aria-label="Filter by special follow-up" style={filterSelect} value={filters.specialFollowUp || 'all'} onChange={(e) => setFilters({ ...filters, specialFollowUp: e.target.value })} title="Filter by special follow-up flag">
            <option value="all">All (Special follow-up)</option>
            <option value="yes">Flagged</option>
            <option value="no">Not flagged</option>
          </select>
        </div>
        <div style={{ ...filterRow, marginTop: '1rem', alignItems: 'flex-end' }}>
          <div style={dateFieldLabel}>
            <span style={dateLabelText}>Requested from</span>
            <div style={{ minWidth: '180px' }}>
              <DatePickerField aria-label="Requested from date"
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
              <DatePickerField aria-label="Requested to date"
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
              onClick={onExport}
              disabled={filteredData.length === 0}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 14px', fontSize: '0.8rem', fontWeight: 600, color: 'white', background: 'linear-gradient(135deg, #10B981, #059669)', border: 'none', borderRadius: '8px', cursor: filteredData.length === 0 ? 'not-allowed' : 'pointer', opacity: filteredData.length === 0 ? 0.5 : 1 }}
              title="Export orders to Excel or CSV"
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
                  { key: 'Plant', label: 'Plant' }, { key: 'TYPE', label: 'Item Type' }, { key: 'Die Type', label: 'Die Type' },
                  { key: 'Diameter', label: 'Ø', align: 'right' }, { key: 'Thickness', label: 'T', align: 'right' }, { key: 'Cavity', label: 'Cav', align: 'right' },
                  { key: 'Supplier', label: 'Supplier' }, { key: 'Customer Name', label: 'Customer' },
                  { key: 'PR Number', label: 'PR#' }, { key: 'Mandrels per Cavity', label: 'Mandrels/Cav', align: 'right' },
                  { key: 'Total Mandrels', label: 'Total Mandrels', align: 'right' }, { key: 'Die Requested Date', label: 'Requested' },
                  { key: 'Type of shipment', label: 'Ship' }, { key: 'STATUS', label: 'Status' },
                  { key: 'Delivery Lead Time', label: 'Delivery LT', align: 'right' }, { key: 'Mfg Lead Time', label: 'Mfg LT', align: 'right' },
                ].map(col => (
                  <th scope="col" key={col.key} style={th} className={col.align === 'right' ? 'dt-num' : undefined} onClick={() => handleSort(col.key)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start' }}>
                      {col.label}
                      {sortConfig.key === col.key ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} color="#3B82F6" /> : <ChevronDown size={14} color="#3B82F6" />) : <ChevronDown size={14} color="#64748B" />}
                    </div>
                  </th>
                ))}
                <th scope="col" style={th} className="dt-center">Log</th>
                <th scope="col" style={th} className="dt-center">Days</th>
                <th scope="col" style={th} className="dt-center">View</th>
                {user?.role === 'admin' && <th scope="col" style={th} className="dt-center">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {paginatedData.map((order, idx) => (
                <tr key={`${order['DIE NO']}-${idx}`} style={{ cursor: 'pointer' }} onClick={() => setSelectedOrder(order)}>
                  <td style={{ ...td, whiteSpace: 'nowrap', minWidth: '120px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}>
                      <DieAttentionLabels order={order} dense />
                      <button
                        type="button"
                        className="row-open"
                        onClick={(e) => { e.stopPropagation(); setSelectedOrder(order); }}
                        style={{ fontWeight: 600, color: theme.text, fontFamily: 'monospace' }}
                      >
                        {order['DIE NO']}
                        <span className="sr-only"> — open details</span>
                      </button>
                    </div>
                  </td>
                  <td style={td}>{order['Order No']}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <span style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, background: order.Plant === 'EXT 1' ? 'rgba(59,130,246,0.2)' : 'rgba(139,92,246,0.2)', color: order.Plant === 'EXT 1' ? '#60A5FA' : '#A78BFA' }}>{order.Plant}</span>
                  </td>
                  <td style={td}>{typeLabel(order.TYPE) || '—'}</td>
                  <td style={td}>{dieTypeLabel(order['Die Type']) || '—'}</td>
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
                  <td style={td}><StatusPill status={order.STATUS} theme={theme} /></td>
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
