import React, { useState, useMemo, useEffect } from 'react';
import { Search, Plus, Edit2, Trash2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, X, Mail } from 'lucide-react';
import { BACKUP_REQUEST_STATUS_CONFIG } from '../../utils/constants';
import { backupRequestsAPI, profilesAPI, pressesAPI, extractProfileFromDie } from '../../api';
import DatePickerField from '../DatePickerField';

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
  { key: 'Press', label: 'PRESS' },
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
  'Press': '',
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

const getTodayDateString = () => new Date().toISOString().split('T')[0];

const normalizePlantName = (plant) => (plant || '')
  .toString()
  .trim()
  .toUpperCase()
  .replace(/\b0+(\d+)\b/g, '$1');

const escapeHtml = (value) => (value || 'N/A')
  .toString()
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const BackupDieRequests = ({ theme, backupRequests, onRefresh, plants = [], user, onCompose, emailTemplates = [] }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPlant, setFilterPlant] = useState('all');
  const [filterStatus, setFilterStatus] = useState('Pending');
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [presses, setPresses] = useState([]);
  const [selectedRequestIds, setSelectedRequestIds] = useState([]);
  const itemsPerPage = 10;

  useEffect(() => {
    let cancelled = false;
    pressesAPI.getAll()
      .then((rows) => { if (!cancelled) setPresses(rows || []); })
      .catch((err) => console.error('Failed to load presses:', err));
    return () => { cancelled = true; };
  }, []);

  const pressCodeByName = useMemo(() => {
    const map = {};
    presses.forEach((p) => { map[p.press_name] = p.press_code; });
    return map;
  }, [presses]);

  const pressOptions = useMemo(() => {
    const selectedPlant = normalizePlantName(formData['Plant']);
    if (!selectedPlant) return [];
    return presses.filter((p) => normalizePlantName(p.plant) === selectedPlant);
  }, [presses, formData]);

  const handlePlantChange = (plant) => {
    setFormData((prev) => {
      const selectedPlant = normalizePlantName(plant);
      const selectedPress = presses.find((p) => p.press_name === prev['Press']);
      const pressMatchesPlant = selectedPress && normalizePlantName(selectedPress.plant) === selectedPlant;

      return {
        ...prev,
        Plant: plant,
        Press: pressMatchesPlant ? prev['Press'] : '',
      };
    });
  };

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
  const paginatedRequestIds = paginatedData.map(request => request.id);
  const allPageRequestsSelected = paginatedRequestIds.length > 0 && paginatedRequestIds.every(id => selectedRequestIds.includes(id));
  const selectedRequests = useMemo(() => {
    const selectedIds = new Set(selectedRequestIds);
    return (backupRequests || []).filter(request => selectedIds.has(request.id));
  }, [backupRequests, selectedRequestIds]);

  useEffect(() => {
    const validIds = new Set((backupRequests || []).map(request => request.id));
    setSelectedRequestIds(prev => prev.filter(id => validIds.has(id)));
  }, [backupRequests]);

  const handleSort = (key) => {
    if (key === 'slNo') return;
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const openCreateModal = () => {
    setEditingRequest(null);
    setFormData({ ...EMPTY_FORM, 'Requested Date': getTodayDateString() });
    setShowModal(true);
  };

  const toggleRequestSelection = (requestId) => {
    setSelectedRequestIds(prev =>
      prev.includes(requestId)
        ? prev.filter(id => id !== requestId)
        : [...prev, requestId]
    );
  };

  const togglePageSelection = () => {
    setSelectedRequestIds(prev => {
      const pageIds = new Set(paginatedRequestIds);
      if (allPageRequestsSelected) {
        return prev.filter(id => !pageIds.has(id));
      }
      return [...new Set([...prev, ...paginatedRequestIds])];
    });
  };

  const handleRequestPdfDrawings = () => {
    if (selectedRequests.length === 0) {
      alert('Select at least one backup request first.');
      return;
    }
    if (!onCompose) {
      alert('Email compose is not available from this page.');
      return;
    }

    const requestRows = selectedRequests
      .map((request, index) => {
        const press = request['Press']
          ? `${request['Press']}${pressCodeByName[request['Press']] ? ` (${pressCodeByName[request['Press']]})` : ''}`
          : 'N/A';
        return `
          <tr>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;text-align:center;">${index + 1}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;font-weight:600;">${escapeHtml(request['DIE NO'])}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;">${escapeHtml(request['Plant'])}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;">${escapeHtml(press)}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;">${escapeHtml(request['Customer'])}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;">${escapeHtml(request['Requested Date'])}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;">${escapeHtml(request['Reason'])}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;">${escapeHtml(request['Remarks'])}</td>
          </tr>`;
      })
      .join('');

    onCompose({
      to: emailTemplates.find(template => template.name === 'PDF Drawing Request')?.default_to || '',
      cc: emailTemplates.find(template => template.name === 'PDF Drawing Request')?.default_cc || '',
      subject: `URGENT: PDF Drawing Request for ${selectedRequests.length} Backup Die Request(s)`,
      body: `
        <p>Dear Design Team,</p>
        <p>Please provide PDF drawings for the following backup die request(s):</p>
        <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px;color:#0F172A;">
          <thead>
            <tr style="background:#E2E8F0;color:#0F172A;">
              <th style="padding:9px 10px;border:1px solid #CBD5E1;text-align:center;">SL No</th>
              <th style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">Die No</th>
              <th style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">Plant</th>
              <th style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">Press</th>
              <th style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">Customer</th>
              <th style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">Requested Date</th>
              <th style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">Reason</th>
              <th style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">Remarks</th>
            </tr>
          </thead>
          <tbody>${requestRows}</tbody>
        </table>
        <p>Please share the drawings at the earliest so the requests can proceed without delay.</p>
        <p>Best regards,<br/>Die Ordering Team</p>`,
      importance: 'high',
      isHtml: true,
    });
  };

  const openEditModal = (request) => {
    setEditingRequest(request);
    setFormData({
      'Plant': request['Plant'] || '',
      'DIE NO': request['DIE NO'] || '',
      'Customer': request['Customer'] || '',
      'Press': request['Press'] || '',
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

  const handleDieBlur = async () => {
    const die = (formData['DIE NO'] || '').trim();
    const existingCustomer = (formData['Customer'] || '').trim();
    if (!die || existingCustomer) return;
    try {
      const result = await profilesAPI.lookup(die);
      if (result?.customer_name) {
        setFormData(prev => ({ ...prev, 'Customer': result.customer_name }));
      }
    } catch (e) {
      console.error('Profile lookup failed:', e);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const die = (formData['DIE NO'] || '').trim();
      let customer = (formData['Customer'] || '').trim();
      const profile = extractProfileFromDie(die);

      // If die set but no customer, try lookup once
      if (die && !customer && profile) {
        try {
          const result = await profilesAPI.lookup(die);
          if (result?.customer_name) {
            customer = result.customer_name;
            setFormData(prev => ({ ...prev, 'Customer': customer }));
          }
        } catch (e) { console.error('Profile lookup failed:', e); }
      }

      // Still missing → ask the user
      if (die && !customer && profile) {
        const entered = window.prompt(`No customer found for profile ${profile} (die ${die}).\nEnter customer name to save to Profile Master:`);
        if (entered === null) { setSaving(false); return; } // cancelled
        customer = entered.trim();
        if (!customer) { alert('Customer name is required.'); setSaving(false); return; }
        try { await profilesAPI.save(die, customer); } catch (e) { console.error('Save profile failed:', e); }
      }

      const payload = { ...formData, 'Customer': customer };

      if (editingRequest) {
        await backupRequestsAPI.update(editingRequest.id, payload);
      } else {
        await backupRequestsAPI.create(payload);
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            onClick={handleRequestPdfDrawings}
            disabled={selectedRequests.length === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '10px 18px', borderRadius: '12px',
              background: selectedRequests.length > 0 ? 'rgba(59,130,246,0.16)' : theme.inputBg,
              color: selectedRequests.length > 0 ? theme.primary : theme.textDim,
              border: `1px solid ${selectedRequests.length > 0 ? theme.primary : theme.cardBorder}`,
              cursor: selectedRequests.length > 0 ? 'pointer' : 'not-allowed',
              fontWeight: 600, fontSize: '0.875rem',
            }}
          >
            <Mail size={18} /> Request PDF Drawings{selectedRequests.length > 0 ? ` (${selectedRequests.length})` : ''}
          </button>
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
                <th style={{
                  padding: '1rem', textAlign: 'center', fontSize: '0.7rem',
                  fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
                  color: theme.textDim, background: theme.tableBg, width: '48px',
                }}>
                  <input
                    type="checkbox"
                    checked={allPageRequestsSelected}
                    onChange={togglePageSelection}
                    aria-label="Select all visible backup requests"
                    style={{ width: '16px', height: '16px', accentColor: theme.primary, cursor: 'pointer' }}
                  />
                </th>
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
                  <td colSpan={COLUMNS.length + 1 + (user?.role === 'admin' ? 1 : 0)} style={{
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
                    <td style={{ padding: '1rem', borderTop: `1px solid ${theme.cardBorder}`, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedRequestIds.includes(request.id)}
                        onChange={(e) => { e.stopPropagation(); toggleRequestSelection(request.id); }}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select backup request ${request['DIE NO'] || request.id}`}
                        style={{ width: '16px', height: '16px', accentColor: theme.primary, cursor: 'pointer' }}
                      />
                    </td>
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
                      {request['Press']
                        ? `${request['Press']}${pressCodeByName[request['Press']] ? ` (${pressCodeByName[request['Press']]})` : ''}`
                        : '—'}
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
                  onChange={(e) => handlePlantChange(e.target.value)}
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
                  onBlur={handleDieBlur}
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

              {/* Press */}
              <div>
                <label style={labelStyle}>Press</label>
                <select
                  value={formData['Press']}
                  onChange={(e) => setFormData({ ...formData, 'Press': e.target.value })}
                  disabled={!formData['Plant']}
                  style={{
                    ...inputStyle,
                    cursor: formData['Plant'] ? 'pointer' : 'not-allowed',
                    opacity: formData['Plant'] ? 1 : 0.65,
                  }}
                >
                  <option value="">{formData['Plant'] ? 'Select Press' : 'Select Plant first'}</option>
                  {pressOptions.map((p) => (
                    <option key={p.id} value={p.press_name}>
                      {p.press_name} ({p.press_code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Requested Date */}
              <div>
                <label style={labelStyle}>Requested Date</label>
                <DatePickerField
                  value={formData['Requested Date']}
                  onChange={(v) => setFormData({ ...formData, 'Requested Date': v })}
                  theme={theme}
                  placeholder="Select requested date"
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
                <DatePickerField
                  value={formData['Drawing Requested']}
                  onChange={(v) => setFormData({ ...formData, 'Drawing Requested': v })}
                  theme={theme}
                  placeholder="Select drawing requested date"
                />
              </div>

              {/* Ordered Date */}
              <div>
                <label style={labelStyle}>Ordered Date</label>
                <DatePickerField
                  value={formData['Ordered Date']}
                  onChange={(v) => setFormData({ ...formData, 'Ordered Date': v })}
                  theme={theme}
                  disabled={!editingRequest}
                  title={!editingRequest ? 'Auto-populated when a matching die order is created' : ''}
                  placeholder="Select ordered date"
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
