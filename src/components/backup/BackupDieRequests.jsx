import React, { useState, useMemo } from 'react';
import { Search, Plus, Edit2, Trash2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { BACKUP_REQUEST_STATUS_CONFIG } from '../../utils/constants';
import { backupRequestsAPI } from '../../api';

const StatusBadge = ({ status }) => {
  const config = BACKUP_REQUEST_STATUS_CONFIG[status] || { color: '#6B7280', bgColor: '#F3F4F6', label: status };
  return (
    <span style={{
      padding: '4px 12px',
      borderRadius: '20px',
      fontSize: '0.75rem',
      fontWeight: 600,
      color: config.color,
      background: config.bgColor,
      whiteSpace: 'nowrap',
    }}>
      {config.label}
    </span>
  );
};

const COLUMNS = [
  { key: 'slNo', label: 'SL NO', sortable: false },
  { key: 'Plant', label: 'PLANT' },
  { key: 'DIE NO', label: 'DIE NO' },
  { key: 'Customer', label: 'CUSTOMER' },
  { key: 'Requested Date', label: 'REQUESTED DATE' },
  { key: 'Die Available', label: 'DIE AVAILABLE' },
  { key: 'Drawing Requested', label: 'DRAWING REQUESTED' },
  { key: 'Ordered Date', label: 'ORDERED DATE' },
  { key: 'Status', label: 'STATUS' },
  { key: 'Reason', label: 'REASON' },
  { key: 'Order Received Last Year', label: 'ORDER RECEIVED' },
  { key: 'Remarks', label: 'REMARKS' },
];

const EMPTY_FORM = {
  'Plant': '',
  'DIE NO': '',
  'Customer': '',
  'Requested Date': '',
  'Die Available': '',
  'Drawing Requested': '',
  'Ordered Date': '',
  'Status': 'Pending',
  'Reason': '',
  'Order Received Last Year': '',
  'Remarks': '',
};

const MANUAL_STATUSES = ['HOLD', 'Not required'];

const BackupDieRequests = ({ theme, backupRequests, onRefresh, plants = [], user }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPlant, setFilterPlant] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const itemsPerPage = 10;

  const filteredData = useMemo(() => {
    let result = [...(backupRequests || [])];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(r =>
        (r['DIE NO'] || '').toLowerCase().includes(term) ||
        (r['Customer'] || '').toLowerCase().includes(term)
      );
    }

    if (filterPlant !== 'all') {
      result = result.filter(r => r['Plant'] === filterPlant);
    }

    if (filterStatus !== 'all') {
      result = result.filter(r => r['Status'] === filterStatus);
    }

    if (sortConfig.key) {
      result.sort((a, b) => {
        const aVal = (a[sortConfig.key] || '').toString().toLowerCase();
        const bVal = (b[sortConfig.key] || '').toString().toLowerCase();
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [backupRequests, searchTerm, filterPlant, filterStatus, sortConfig]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const paginatedData = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSort = (key) => {
    if (key === 'slNo') return;
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const openCreateModal = () => {
    setEditingRequest(null);
    setFormData(EMPTY_FORM);
    setShowModal(true);
  };

  const openEditModal = (request) => {
    setEditingRequest(request);
    setFormData({
      'Plant': request['Plant'] || '',
      'DIE NO': request['DIE NO'] || '',
      'Customer': request['Customer'] || '',
      'Requested Date': request['Requested Date'] || '',
      'Die Available': request['Die Available'] || '',
      'Drawing Requested': request['Drawing Requested'] || '',
      'Ordered Date': request['Ordered Date'] || '',
      'Status': request['Status'] || 'Pending',
      'Reason': request['Reason'] || '',
      'Order Received Last Year': request['Order Received Last Year'] || '',
      'Remarks': request['Remarks'] || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingRequest) {
        await backupRequestsAPI.update(editingRequest.id, formData);
      } else {
        await backupRequestsAPI.create(formData);
      }
      setShowModal(false);
      onRefresh();
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (request) => {
    if (!window.confirm(`Delete backup request for "${request['DIE NO']}"? This cannot be undone.`)) return;
    try {
      await backupRequestsAPI.delete(request.id);
      onRefresh();
    } catch (error) {
      alert('Error: ' + error.message);
    }
  };

  const uniquePlants = useMemo(() => {
    const set = new Set((backupRequests || []).map(r => r['Plant']).filter(Boolean));
    return [...set].sort();
  }, [backupRequests]);

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    background: theme.inputBg,
    border: `1px solid ${theme.cardBorder}`,
    borderRadius: '10px',
    color: theme.text,
    fontSize: '0.875rem',
  };

  const labelStyle = {
    display: 'block',
    fontSize: '0.8rem',
    fontWeight: 600,
    color: theme.textMuted,
    marginBottom: '6px',
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: theme.text }}>Backup Die Requests</h2>
          <p style={{ fontSize: '0.875rem', color: theme.textMuted, marginTop: '4px' }}>Track backup die requirements before formal ordering</p>
        </div>
        <button
          onClick={openCreateModal}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 20px', borderRadius: '12px',
            background: theme.primary, color: theme.primaryText,
            border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
          }}
        >
          <Plus size={18} /> New Request
        </button>
      </div>

      {/* Filters */}
      <div style={{
        background: theme.cardBg, borderRadius: '20px', padding: '1.25rem',
        border: `1px solid ${theme.cardBorder}`, marginBottom: '1.5rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: '250px', position: 'relative' }}>
            <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: theme.textDim }} />
            <input
              type="text"
              placeholder="Search by DIE NO or CUSTOMER..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              style={{
                width: '100%', padding: '12px 16px 12px 44px',
                background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
                borderRadius: '12px', color: theme.text, fontSize: '0.875rem',
              }}
            />
          </div>
          <select
            value={filterPlant}
            onChange={(e) => { setFilterPlant(e.target.value); setCurrentPage(1); }}
            style={{
              padding: '12px 16px', background: theme.inputBg,
              border: `1px solid ${theme.cardBorder}`, borderRadius: '12px',
              color: theme.text, fontSize: '0.875rem', cursor: 'pointer', minWidth: '130px',
            }}
          >
            <option value="all">All Plants</option>
            {uniquePlants.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setCurrentPage(1); }}
            style={{
              padding: '12px 16px', background: theme.inputBg,
              border: `1px solid ${theme.cardBorder}`, borderRadius: '12px',
              color: theme.text, fontSize: '0.875rem', cursor: 'pointer', minWidth: '150px',
            }}
          >
            <option value="all">All Statuses</option>
            {Object.keys(BACKUP_REQUEST_STATUS_CONFIG).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${theme.cardBorder}`,
        }}>
          <span style={{ fontSize: '0.875rem', color: theme.textMuted }}>
            Showing <strong style={{ color: theme.text }}>{filteredData.length}</strong> requests
          </span>
          <button
            onClick={() => { setSearchTerm(''); setFilterPlant('all'); setFilterStatus('all'); setCurrentPage(1); }}
            style={{ fontSize: '0.875rem', color: theme.primary, background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Clear filters
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{
        background: theme.cardBg, borderRadius: '20px',
        border: `1px solid ${theme.cardBorder}`, overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {COLUMNS.map(col => (
                  <th
                    key={col.key}
                    onClick={() => col.sortable !== false && handleSort(col.key)}
                    style={{
                      padding: '1rem', textAlign: 'left', fontSize: '0.7rem',
                      fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
                      color: theme.textDim, background: theme.tableBg,
                      cursor: col.sortable !== false ? 'pointer' : 'default',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {col.label}
                      {col.sortable !== false && (
                        sortConfig.key === col.key
                          ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} color="#3B82F6" /> : <ChevronDown size={14} color="#3B82F6" />)
                          : <ChevronDown size={14} color="#64748B" />
                      )}
                    </div>
                  </th>
                ))}
                {user?.role === 'admin' && (
                  <th style={{
                    padding: '1rem', textAlign: 'center', fontSize: '0.7rem',
                    fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
                    color: theme.textDim, background: theme.tableBg,
                  }}>
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {paginatedData.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + (user?.role === 'admin' ? 1 : 0)} style={{
                    padding: '3rem', textAlign: 'center', color: theme.textMuted, fontSize: '0.95rem',
                  }}>
                    No backup requests found
                  </td>
                </tr>
              ) : (
                paginatedData.map((request, idx) => (
                  <tr
                    key={request.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => openEditModal(request)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = theme.primaryLight; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <td style={{ padding: '1rem', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.875rem', color: theme.textMuted }}>
                      {(currentPage - 1) * itemsPerPage + idx + 1}
                    </td>
                    <td style={{ padding: '1rem', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.875rem', color: theme.textMuted, whiteSpace: 'nowrap' }}>
                      {request['Plant'] && (
                        <span style={{
                          padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600,
                          background: request['Plant'] === 'EXT 1' ? 'rgba(59,130,246,0.2)' : 'rgba(139,92,246,0.2)',
                          color: request['Plant'] === 'EXT 1' ? '#60A5FA' : '#A78BFA',
                        }}>
                          {request['Plant']}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '1rem', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.875rem', color: theme.text, fontWeight: 600, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      {request['DIE NO'] || '—'}
                    </td>
                    <td style={{ padding: '1rem', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.875rem', color: theme.textMuted }}>
                      {request['Customer'] || '—'}
                    </td>
                    <td style={{ padding: '1rem', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.875rem', color: theme.textMuted, whiteSpace: 'nowrap' }}>
                      {request['Requested Date'] || '—'}
                    </td>
                    <td style={{ padding: '1rem', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.875rem', color: theme.textMuted, whiteSpace: 'nowrap' }}>
                      {request['Die Available'] || '—'}
                    </td>
                    <td style={{ padding: '1rem', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.875rem', color: theme.textMuted, whiteSpace: 'nowrap' }}>
                      {request['Drawing Requested'] || '—'}
                    </td>
                    <td style={{ padding: '1rem', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.875rem', color: theme.textMuted, whiteSpace: 'nowrap' }}>
                      {request['Ordered Date'] || '—'}
                    </td>
                    <td style={{ padding: '1rem', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.875rem' }}>
                      <StatusBadge status={request['Status']} />
                    </td>
                    <td style={{ padding: '1rem', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.875rem', color: theme.textMuted }}>
                      {request['Reason'] || '—'}
                    </td>
                    <td style={{ padding: '1rem', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.875rem', color: theme.textMuted }}>
                      {request['Order Received Last Year'] || '—'}
                    </td>
                    <td style={{ padding: '1rem', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.875rem', color: theme.textMuted, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {request['Remarks'] || '—'}
                    </td>
                    {user?.role === 'admin' && (
                      <td style={{ padding: '1rem', borderTop: `1px solid ${theme.cardBorder}`, textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); openEditModal(request); }}
                            style={{ padding: '6px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '6px', cursor: 'pointer', color: '#3B82F6' }}
                            title="Edit"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(request); }}
                            style={{ padding: '6px', background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '6px', cursor: 'pointer', color: '#EF4444' }}
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '1rem 1.5rem', borderTop: `1px solid ${theme.cardBorder}`,
          }}>
            <span style={{ fontSize: '0.85rem', color: theme.textMuted }}>
              Page {currentPage} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                style={{
                  padding: '8px 12px', borderRadius: '8px',
                  background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
                  color: currentPage === 1 ? theme.textDim : theme.text,
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center',
                }}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                style={{
                  padding: '8px 12px', borderRadius: '8px',
                  background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
                  color: currentPage === totalPages ? theme.textDim : theme.text,
                  cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center',
                }}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: theme.cardBg, borderRadius: '20px', padding: '2rem',
            width: '100%', maxWidth: '700px', maxHeight: '90vh', overflowY: 'auto',
            border: `1px solid ${theme.cardBorder}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: theme.text }}>
                {editingRequest ? 'Edit Backup Request' : 'New Backup Request'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                style={{ padding: '8px', background: 'transparent', border: 'none', cursor: 'pointer', color: theme.textMuted, borderRadius: '8px' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {/* Plant */}
              <div>
                <label style={labelStyle}>Plant</label>
                <select
                  value={formData['Plant']}
                  onChange={(e) => setFormData({ ...formData, 'Plant': e.target.value })}
                  style={inputStyle}
                >
                  <option value="">Select Plant</option>
                  {plants.map(p => (
                    <option key={p.id || p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* DIE NO */}
              <div>
                <label style={labelStyle}>DIE NO</label>
                <input
                  type="text"
                  value={formData['DIE NO']}
                  onChange={(e) => setFormData({ ...formData, 'DIE NO': e.target.value })}
                  style={inputStyle}
                  placeholder="Enter die number"
                />
              </div>

              {/* Customer */}
              <div>
                <label style={labelStyle}>Customer</label>
                <input
                  type="text"
                  value={formData['Customer']}
                  onChange={(e) => setFormData({ ...formData, 'Customer': e.target.value })}
                  style={inputStyle}
                  placeholder="Enter customer name"
                />
              </div>

              {/* Requested Date */}
              <div>
                <label style={labelStyle}>Requested Date</label>
                <input
                  type="date"
                  value={formData['Requested Date']}
                  onChange={(e) => setFormData({ ...formData, 'Requested Date': e.target.value })}
                  style={inputStyle}
                />
              </div>

              {/* Die Available */}
              <div>
                <label style={labelStyle}>Die Available</label>
                <input
                  type="text"
                  value={formData['Die Available']}
                  onChange={(e) => setFormData({ ...formData, 'Die Available': e.target.value })}
                  style={inputStyle}
                  placeholder="e.g. Yes / No"
                />
              </div>

              {/* Drawing Requested */}
              <div>
                <label style={labelStyle}>Drawing Requested</label>
                <input
                  type="date"
                  value={formData['Drawing Requested']}
                  onChange={(e) => setFormData({ ...formData, 'Drawing Requested': e.target.value })}
                  style={inputStyle}
                />
              </div>

              {/* Ordered Date */}
              <div>
                <label style={labelStyle}>Ordered Date</label>
                <input
                  type="date"
                  value={formData['Ordered Date']}
                  onChange={(e) => setFormData({ ...formData, 'Ordered Date': e.target.value })}
                  style={inputStyle}
                  disabled={!editingRequest}
                  title={!editingRequest ? 'Auto-populated when a matching die order is created' : ''}
                />
              </div>

              {/* Status */}
              {editingRequest && (
                <div>
                  <label style={labelStyle}>Status</label>
                  <select
                    value={formData['Status']}
                    onChange={(e) => setFormData({ ...formData, 'Status': e.target.value })}
                    style={inputStyle}
                  >
                    <option value="Pending">Pending</option>
                    {MANUAL_STATUSES.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                    {formData['Status'] === 'Completed' && (
                      <option value="Completed">Completed</option>
                    )}
                  </select>
                </div>
              )}

              {/* Reason */}
              <div>
                <label style={labelStyle}>Reason</label>
                <input
                  type="text"
                  value={formData['Reason']}
                  onChange={(e) => setFormData({ ...formData, 'Reason': e.target.value })}
                  style={inputStyle}
                  placeholder="Enter reason"
                />
              </div>

              {/* Order Received Last Year */}
              <div>
                <label style={labelStyle}>Order Received Last Year</label>
                <input
                  type="text"
                  value={formData['Order Received Last Year']}
                  onChange={(e) => setFormData({ ...formData, 'Order Received Last Year': e.target.value })}
                  style={inputStyle}
                  placeholder="e.g. Yes / No / quantity"
                />
              </div>

              {/* Remarks */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Remarks</label>
                <input
                  type="text"
                  value={formData['Remarks']}
                  onChange={(e) => setFormData({ ...formData, 'Remarks': e.target.value })}
                  style={inputStyle}
                  placeholder="Enter remarks"
                />
              </div>
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: `1px solid ${theme.cardBorder}` }}>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  padding: '10px 20px', borderRadius: '10px',
                  background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
                  color: theme.text, cursor: 'pointer', fontWeight: 500, fontSize: '0.875rem',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: '10px 24px', borderRadius: '10px',
                  background: saving ? '#475569' : theme.primary, border: 'none',
                  color: theme.primaryText, cursor: saving ? 'not-allowed' : 'pointer',
                  fontWeight: 600, fontSize: '0.875rem',
                }}
              >
                {saving ? 'Saving...' : (editingRequest ? 'Update' : 'Create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BackupDieRequests;
