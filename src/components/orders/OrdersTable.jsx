import React, { useState, useMemo } from 'react';
import { Search, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Trash2, Eye, History } from 'lucide-react';
import StatusBadge from '../common/StatusBadge';
import ProgressPipeline from '../common/ProgressPipeline';

function OrdersTable({
  data,
  suppliers,
  plants,
  onOrderClick,
  onDeleteOrder,
  onViewChangeLog,
  isAdmin,
  theme
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    plant: 'all',
    status: 'all',
    supplier: 'all',
    type: 'all'
  });
  const [sortConfig, setSortConfig] = useState({ key: 'Die Requested Date', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const statusOptions = [
    'AWAITING FOR DESIGN', 'PENDING FOR DESIGN APPROVAL', 'UNDER SIMULATION',
    'PENDING FOR DESIGN TO EMS', 'PENDING FOR PR', 'PENDING FOR ORACLE ENTRY',
    'PENDING FOR ORDERING', 'DONE', 'CANCELLED', 'HOLD'
  ];

  const filteredData = useMemo(() => {
    return data.filter(order => {
      const matchesSearch = !searchTerm ||
        order['DIE NO']?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order['Order No']?.toString().toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.Supplier?.toLowerCase().includes(searchTerm.toLowerCase());

      return matchesSearch &&
        (filters.plant === 'all' || order.Plant === filters.plant) &&
        (filters.status === 'all' || order.STATUS === filters.status) &&
        (filters.supplier === 'all' || order.Supplier === filters.supplier) &&
        (filters.type === 'all' || order.TYPE === filters.type);
    }).sort((a, b) => {
      const aVal = a[sortConfig.key] || '';
      const bVal = b[sortConfig.key] || '';
      return (aVal > bVal ? 1 : -1) * (sortConfig.direction === 'asc' ? 1 : -1);
    });
  }, [data, searchTerm, filters, sortConfig]);

  const paginatedData = useMemo(() => {
    return filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  }, [filteredData, currentPage]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const selectStyle = {
    padding: '8px 12px',
    background: theme.inputBg || theme.bg,
    border: `1px solid ${theme.border}`,
    borderRadius: '8px',
    color: theme.text,
    fontSize: '0.85rem',
    cursor: 'pointer'
  };

  const SortHeader = ({ label, sortKey }) => (
    <th
      onClick={() => handleSort(sortKey)}
      style={{
        padding: '12px', textAlign: 'left', fontSize: '0.75rem',
        fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase',
        cursor: 'pointer', whiteSpace: 'nowrap'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {label}
        {sortConfig.key === sortKey && (
          sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
        )}
      </div>
    </th>
  );

  return (
    <div style={{
      background: theme.cardBg,
      borderRadius: '16px',
      border: `1px solid ${theme.border}`,
      overflow: 'hidden'
    }}>
      {/* Filters */}
      <div style={{
        padding: '1rem 1.25rem',
        borderBottom: `1px solid ${theme.border}`,
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        alignItems: 'center'
      }}>
        <div style={{ position: 'relative', flex: '1', minWidth: '200px' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: theme.textMuted }} />
          <input
            type="text"
            placeholder="Search orders..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            style={{
              width: '100%',
              padding: '10px 12px 10px 40px',
              background: theme.inputBg || theme.bg,
              border: `1px solid ${theme.border}`,
              borderRadius: '10px',
              color: theme.text,
              fontSize: '0.9rem'
            }}
          />
        </div>

        <select
          value={filters.plant}
          onChange={(e) => { setFilters(f => ({ ...f, plant: e.target.value })); setCurrentPage(1); }}
          style={selectStyle}
        >
          <option value="all">All Plants</option>
          {plants.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
        </select>

        <select
          value={filters.status}
          onChange={(e) => { setFilters(f => ({ ...f, status: e.target.value })); setCurrentPage(1); }}
          style={selectStyle}
        >
          <option value="all">All Status</option>
          {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          value={filters.supplier}
          onChange={(e) => { setFilters(f => ({ ...f, supplier: e.target.value })); setCurrentPage(1); }}
          style={selectStyle}
        >
          <option value="all">All Suppliers</option>
          {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>

        <select
          value={filters.type}
          onChange={(e) => { setFilters(f => ({ ...f, type: e.target.value })); setCurrentPage(1); }}
          style={selectStyle}
        >
          <option value="all">All Types</option>
          <option value="N">New (N)</option>
          <option value="B">Backup (B)</option>
          <option value="T">Tooling (T)</option>
          <option value="C">Cancelled (C)</option>
          <option value="H">Hold (H)</option>
        </select>

        <span style={{ fontSize: '0.85rem', color: theme.textMuted }}>
          {filteredData.length} orders
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
              <SortHeader label="Die No" sortKey="DIE NO" />
              <SortHeader label="Order No" sortKey="Order No" />
              <SortHeader label="Plant" sortKey="Plant" />
              <SortHeader label="Type" sortKey="TYPE" />
              <SortHeader label="Supplier" sortKey="Supplier" />
              <SortHeader label="Requested" sortKey="Die Requested Date" />
              <th style={{ padding: '12px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase' }}>Progress</th>
              <SortHeader label="Status" sortKey="STATUS" />
              <th style={{ padding: '12px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase' }}>Log</th>
              <th style={{ padding: '12px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase' }}>Rev</th>
              <th style={{ padding: '12px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedData.map((order) => (
              <tr
                key={order.id}
                style={{
                  borderBottom: `1px solid ${theme.border}`,
                  cursor: 'pointer',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = theme.hoverBg}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <td style={{ padding: '12px', fontWeight: 600, color: theme.text }} onClick={() => onOrderClick(order)}>
                  {order['DIE NO']}
                </td>
                <td style={{ padding: '12px', color: theme.textDim }} onClick={() => onOrderClick(order)}>
                  {order['Order No']}
                </td>
                <td style={{ padding: '12px', color: theme.textDim }} onClick={() => onOrderClick(order)}>
                  {order.Plant}
                </td>
                <td style={{ padding: '12px' }} onClick={() => onOrderClick(order)}>
                  <span style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    background: order.TYPE === 'N' ? '#3B82F620' : order.TYPE === 'B' ? '#8B5CF620' : '#64748B20',
                    color: order.TYPE === 'N' ? '#3B82F6' : order.TYPE === 'B' ? '#8B5CF6' : '#64748B'
                  }}>
                    {order.TYPE}
                  </span>
                </td>
                <td style={{ padding: '12px', color: theme.textDim }} onClick={() => onOrderClick(order)}>
                  {order.Supplier}
                </td>
                <td style={{ padding: '12px', color: theme.textDim, fontSize: '0.85rem' }} onClick={() => onOrderClick(order)}>
                  {order['Die Requested Date']}
                </td>
                <td style={{ padding: '12px' }} onClick={() => onOrderClick(order)}>
                  <ProgressPipeline order={order} />
                </td>
                <td style={{ padding: '12px' }} onClick={() => onOrderClick(order)}>
                  <StatusBadge status={order.STATUS} />
                </td>
                <td style={{ padding: '12px', textAlign: 'center' }}>
                  {order['Change Log'] && order['Change Log'].length > 0 ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); onViewChangeLog && onViewChangeLog(order); }}
                      style={{
                        padding: '6px',
                        background: 'rgba(59,130,246,0.2)',
                        border: '1px solid rgba(59,130,246,0.4)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        color: '#3B82F6',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                      title={`${order['Change Log'].length} change(s) logged - Click to view`}
                    >
                      <History size={14} />
                      <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>{order['Change Log'].length}</span>
                    </button>
                  ) : (
                    <span style={{ color: theme.textMuted }}>—</span>
                  )}
                </td>
                <td style={{ padding: '12px', textAlign: 'center' }} onClick={() => onOrderClick(order)}>
                  {order['Design Revision Count'] > 0 ? (
                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: '12px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        background: 'rgba(245,158,11,0.2)',
                        color: '#F59E0B'
                      }}
                      title={order['Last Revision Date'] ? `Last: ${order['Last Revision Date']}` : ''}
                    >
                      {order['Design Revision Count']}
                    </span>
                  ) : (
                    <span style={{ color: theme.textMuted }}>—</span>
                  )}
                </td>
                <td style={{ padding: '12px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                    <button
                      onClick={() => onOrderClick(order)}
                      style={{
                        padding: '6px',
                        background: 'transparent',
                        border: `1px solid ${theme.border}`,
                        borderRadius: '6px',
                        color: theme.textDim,
                        cursor: 'pointer'
                      }}
                      title="View details"
                    >
                      <Eye size={16} />
                    </button>
                    {isAdmin && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm('Delete this order?')) onDeleteOrder(order.id);
                        }}
                        style={{
                          padding: '6px',
                          background: 'transparent',
                          border: '1px solid rgba(239,68,68,0.3)',
                          borderRadius: '6px',
                          color: '#EF4444',
                          cursor: 'pointer'
                        }}
                        title="Delete order"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{
          padding: '1rem 1.25rem',
          borderTop: `1px solid ${theme.border}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span style={{ fontSize: '0.85rem', color: theme.textMuted }}>
            Page {currentPage} of {totalPages}
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              style={{
                padding: '8px 12px',
                background: theme.cardBg,
                border: `1px solid ${theme.border}`,
                borderRadius: '8px',
                color: currentPage === 1 ? theme.textMuted : theme.text,
                cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <ChevronLeft size={16} /> Prev
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              style={{
                padding: '8px 12px',
                background: theme.cardBg,
                border: `1px solid ${theme.border}`,
                borderRadius: '8px',
                color: currentPage === totalPages ? theme.textMuted : theme.text,
                cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default OrdersTable;
