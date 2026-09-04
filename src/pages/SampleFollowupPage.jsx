import React, { useState } from 'react';
import { Search, X, Eye, Trash2, ClipboardList, Download } from 'lucide-react';
import { ordersAPI, sampleFollowupsAPI } from '../api';
import { dialogs } from '../components/ui/DialogProvider';
import { formatDate } from '../utils/helpers';
import { exportToExcel } from '../utils/exportExcel';
import CorrectorSelect from '../components/ui/CorrectorSelect';
import TrialsSection from '../components/sample/TrialsSection';
import { trialCountFor } from '../utils/trials';

const SF_STATUSES = ['Pending', 'Sample Submitted', 'Approved', 'Rejected', 'On hold'];

const sfStatusColors = {
  'Pending': { color: '#F59E0B', bg: '#FFFBEB' },
  'Sample Submitted': { color: '#3B82F6', bg: '#EFF6FF' },
  'Approved': { color: '#16A34A', bg: '#F0FDF4' },
  'Rejected': { color: '#EF4444', bg: '#FEF2F2' },
  'On hold': { color: '#6B7280', bg: '#F3F4F6' },
};

const SF_DISPLAY_TO_SNAKE = {
  'Ascona Reference': 'ascona_reference',
  'Submission Date': 'submission_date',
  'Sample Approval Date': 'sample_approval_date',
  'Remark': 'remark',
  'Sample Status': 'status',
  'Corrector': 'corrector',
};

const sfColor = '#0891B2';

const computeSfDelay = (received, submission) => {
  if (!received) return 0;
  const start = new Date(received);
  if (isNaN(start)) return 0;
  const end = submission ? new Date(submission) : new Date();
  if (isNaN(end)) return 0;
  const diff = Math.floor((end.setHours(0, 0, 0, 0) - start.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
};

const extractProfile = (dieNo) => {
  if (!dieNo) return '';
  const s = String(dieNo).trim();
  const idx = s.indexOf('-');
  return idx > 0 ? s.slice(0, idx) : s;
};

const formToOrderFields = (form) => ({
  'DIE NO': form.die || '',
  'Plant': form.plant || '',
  'Press': form.press || '',
  'Supplier': form.supplier || '',
  'Customer Name': form.customer || '',
  'Die Received Date': form.die_received_date || '',
  'Ascona Reference': form.ascona_reference || 'No',
  'Submission Date': form.submission_date || '',
  'Sample Approval Date': form.sample_approval_date || '',
  'Sample Status': form.status || 'Pending',
  'Remark': form.remark || '',
  'Corrector': form.corrector || '',
});

const formToSfFields = (form) => ({
  profile: form.die || '',
  plant: form.plant || '',
  press: form.press || '',
  supplier: form.supplier || '',
  customer: form.customer || '',
  die_received_date: form.die_received_date || '',
  ascona_reference: form.ascona_reference || 'No',
  submission_date: form.submission_date || '',
  sample_approval_date: form.sample_approval_date || '',
  delay_days: computeSfDelay(form.die_received_date, form.submission_date),
  status: form.status || 'Pending',
  remark: form.remark || '',
  corrector: form.corrector || '',
});

const EMPTY_FORM = { die: '', plant: '', press: '', supplier: '', customer: '', die_received_date: '', ascona_reference: 'No', submission_date: '', sample_approval_date: '', delay_days: 0, status: 'Pending', remark: '', corrector: '' };

export default function SampleFollowupPage({
  sampleFollowups,
  sfStatusFilter, setSfStatusFilter,
  sfPlantFilter, setSfPlantFilter,
  searchTerm, setSearchTerm,
  showSampleFollowupForm, setShowSampleFollowupForm,
  editingSampleFollowup, setEditingSampleFollowup,
  sampleFollowupForm, setSampleFollowupForm,
  sampleFollowupsStandalone, setSampleFollowupsStandalone,
  correctors, correctorsError,
  user,
  theme,
  setToast,
  handleInlineFieldSave,
  fetchOrders,
  fetchSampleFollowups,
  sampleTrials,
  fetchSampleTrials,
}) {
  const tableContainer = { background: theme.cardBg, borderRadius: '8px', border: `1px solid ${theme.cardBorder}`, overflow: 'hidden', boxShadow: theme.shadowSm };
  const tableStyle = { width: '100%' };
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

  const handleSampleFollowupSubmit = async () => {
    try {
      if (editingSampleFollowup) {
        if (editingSampleFollowup._source === 'order') {
          // Use PATCH so only the SF-specific fields are touched; other dates
          // (Design Received Date, Ordered date, etc.) are never overwritten.
          await ordersAPI.patch(editingSampleFollowup._order.id, formToOrderFields(sampleFollowupForm));
          fetchOrders();
        } else {
          const raw = editingSampleFollowup._raw;
          await sampleFollowupsAPI.update(raw.id, formToSfFields(sampleFollowupForm));
          fetchSampleFollowups();
        }
        setToast({ message: 'Sample followup updated successfully', type: 'success' });
      } else {
        await sampleFollowupsAPI.create(formToSfFields(sampleFollowupForm));
        fetchSampleFollowups();
        setToast({ message: 'Sample followup created successfully', type: 'success' });
      }
      setTimeout(() => setToast(null), 3000);
      setShowSampleFollowupForm(false);
      setEditingSampleFollowup(null);
      setSampleFollowupForm(EMPTY_FORM);
    } catch (error) {
      console.error('Sample followup error:', error);
      setToast({ message: 'Failed: ' + error.message, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  };

  const handleDeleteSampleFollowup = async (sf) => {
    if (sf._source === 'standalone') {
      const ok = await dialogs.confirm({
        title: 'Delete sample followup',
        message: 'This removes the followup record permanently. It cannot be undone.',
        confirmLabel: 'Delete record',
      });
      if (!ok) return;
      try {
        await sampleFollowupsAPI.delete(sf._raw.id);
        setToast({ message: 'Sample followup deleted', type: 'success' });
        setTimeout(() => setToast(null), 3000);
        fetchSampleFollowups();
      } catch (error) {
        setToast({ message: 'Failed to delete: ' + error.message, type: 'error' });
        setTimeout(() => setToast(null), 5000);
      }
      return;
    }
    const ok = await dialogs.confirm({
      title: 'Clear sample followup data',
      // Logged trials survive this: they are a record of what happened, and the
      // same reason they are admin-only to delete applies here. Deleting the die
      // order itself still cascades them away.
      message: 'Only the sample fields are reset. Logged trials and the underlying die order are kept.',
      confirmLabel: 'Clear fields',
      tone: 'warning',
    });
    if (!ok) return;
    try {
      const existing = sf._order;
      await ordersAPI.patch(existing.id, {
        'Die Received Date': null,
        'Submission Date': null,
        'Sample Approval Date': null,
        'Ascona Reference': 'No',
        'Sample Status': '',
        'Remark': '',
        'Press': '',
      });
      setToast({ message: 'Sample followup cleared', type: 'success' });
      setTimeout(() => setToast(null), 3000);
      fetchOrders();
    } catch (error) {
      setToast({ message: 'Failed to clear: ' + error.message, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  };

  const handleSfInlineSave = async (sf, displayField, value) => {
    if (sf._source === 'order') {
      await handleInlineFieldSave(sf._order, displayField, value);
      return;
    }
    const snake = SF_DISPLAY_TO_SNAKE[displayField];
    if (!snake) return;
    const raw = sf._raw;
    if (raw[snake] === value) return;
    try {
      const updated = { ...raw, [snake]: value };
      await sampleFollowupsAPI.update(raw.id, updated);
      setSampleFollowupsStandalone(prev => prev.map(r => r.id === raw.id ? updated : r));
      setToast({ message: `${displayField} saved`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      console.error(`${displayField} update error:`, error);
      setToast({ message: `Failed to save ${displayField}`, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  };

  // A trial hangs off whichever table its followup came from. `null` means the
  // record has not been saved yet, so there is nothing to attach a trial to.
  const trialParentOf = (sf) => {
    if (!sf) return null;
    if (sf._source === 'order') return { die_order_id: sf._order.id };
    if (sf._source === 'standalone') return { sample_followup_id: sf._raw.id };
    return null;
  };

  const trialsOf = (sf) => {
    const parent = trialParentOf(sf);
    if (!parent) return [];
    const key = parent.die_order_id ? 'die_order_id' : 'sample_followup_id';
    const id = parent.die_order_id || parent.sample_followup_id;
    return (sampleTrials || [])
      .filter(t => t[key] === id)
      .sort((a, b) => a.trial_no - b.trial_no);
  };

  const sfPlants = Array.from(new Set(sampleFollowups.map(sf => (sf.plant || '').trim()).filter(Boolean))).sort();

  const filteredFollowups = sampleFollowups.filter(sf => {
    const matchesStatus = sfStatusFilter === 'All' || (sf.status || 'Pending') === sfStatusFilter;
    const matchesPlant = sfPlantFilter === 'All' || (sf.plant || '').trim() === sfPlantFilter;
    const matchesSearch = !searchTerm ||
      (sf.profile && sf.profile.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (sf.supplier && sf.supplier.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (sf.customer && sf.customer.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (sf.corrector && sf.corrector.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesStatus && matchesPlant && matchesSearch;
  });

  const handleExport = async () => {
    const followupColumns = [
      { key: 'die', label: 'Die' },
      { key: 'profile', label: 'Profile' },
      { key: 'plant', label: 'Plant' },
      { key: 'press', label: 'Press' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'customer', label: 'Customer' },
      { key: 'die_received_date', label: 'Die Received Date', format: 'date' },
      { key: 'ascona_reference', label: 'Ascona Ref', format: (v) => v || 'No' },
      { key: 'submission_date', label: 'Submission Date', format: 'date' },
      { key: 'sample_approval_date', label: 'Sample Approval Date', format: 'date' },
      { key: 'delay_days', label: 'Delay Days', format: (_, sf) => computeSfDelay(sf.die_received_date, sf.submission_date) },
      { key: 'status', label: 'Status', format: (v) => v || 'Pending' },
      { key: 'no_of_trial', label: 'No. of Trial', format: (v, sf) => trialCountFor(trialsOf(sf), v).count },
      { key: 'remark', label: 'Remark' },
      { key: 'corrector', label: 'Corrector' },
    ];

    // One row per trial across everything currently filtered on screen, so the
    // export matches what the user is looking at.
    const trialRows = filteredFollowups.flatMap(sf =>
      trialsOf(sf).map(t => ({
        die: sf.die, profile: sf.profile, plant: sf.plant, supplier: sf.supplier,
        trial_no: t.trial_no, trial_date: t.trial_date, result: t.result,
        fail_reason: t.fail_reason, comments: t.comments,
      }))
    );

    await exportToExcel({
      filename: 'sample_followups',
      sheets: [
        { name: 'Sample Followup', rows: filteredFollowups, columns: followupColumns },
        {
          name: 'Trials',
          rows: trialRows,
          columns: [
            { key: 'die', label: 'Die' },
            { key: 'profile', label: 'Profile' },
            { key: 'plant', label: 'Plant' },
            { key: 'supplier', label: 'Supplier' },
            { key: 'trial_no', label: 'Trial No' },
            { key: 'trial_date', label: 'Trial Date', format: 'date' },
            { key: 'result', label: 'Result' },
            { key: 'fail_reason', label: 'Reason' },
            { key: 'comments', label: 'Comments' },
          ],
        },
      ],
    });
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: `${sfColor}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ClipboardList size={24} color={sfColor} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: theme.text, margin: 0 }}>Sample Followup</h1>
            <p style={{ fontSize: '0.85rem', color: theme.textMuted, margin: '4px 0 0' }}>Track sample submissions, approvals and trials</p>
          </div>
          <span style={{ background: sfColor, color: 'white', padding: '4px 12px', borderRadius: '20px', fontSize: '0.875rem', fontWeight: 600 }}>{filteredFollowups.length}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: theme.inputBg || '#0F172A', borderRadius: '10px', padding: '10px 14px', border: `1px solid ${theme.border || '#334155'}`, minWidth: '240px' }}>
            <Search size={18} color={theme.textMuted} />
            <input aria-label="Search sample followups"
              type="text"
              placeholder="Search followups..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ border: 'none', background: 'transparent', color: theme.text, fontSize: '0.9rem', outline: 'none', width: '100%' }}
            />
          </div>
          <button
            onClick={handleExport}
            disabled={filteredFollowups.length === 0}
            style={{ padding: '10px 16px', background: 'linear-gradient(135deg, #10B981, #059669)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, fontSize: '0.9rem', cursor: filteredFollowups.length === 0 ? 'not-allowed' : 'pointer', opacity: filteredFollowups.length === 0 ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: '8px' }}
            title="Export the currently filtered followups to Excel"
          >
            <Download size={16} /> Export
          </button>
          <button
            onClick={() => { setEditingSampleFollowup(null); setSampleFollowupForm(EMPTY_FORM); setShowSampleFollowupForm(true); }}
            style={{ padding: '10px 20px', background: sfColor, color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.2s', boxShadow: `0 4px 12px ${sfColor}40` }}
          >
            + Add Record
          </button>
        </div>
      </div>

      {/* Status Filter Tabs + Plant Filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {['All', ...SF_STATUSES].map(s => {
            const active = sfStatusFilter === s;
            const sc = sfStatusColors[s];
            const count = s === 'All' ? sampleFollowups.length : sampleFollowups.filter(sf => (sf.status || 'Pending') === s).length;
            return (
              <button
                key={s}
                onClick={() => setSfStatusFilter(s)}
                style={{
                  padding: '6px 14px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 600,
                  cursor: 'pointer', border: `1px solid ${active ? (sc?.color || sfColor) : theme.cardBorder}`,
                  background: active ? (sc?.bg || `${sfColor}20`) : 'transparent',
                  color: active ? (sc?.color || sfColor) : theme.textMuted,
                  transition: 'all 0.15s'
                }}
              >
                {s} <span style={{ marginLeft: '4px', opacity: 0.8 }}>({count})</span>
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Plant</span>
          <select
            value={sfPlantFilter}
            onChange={(e) => setSfPlantFilter(e.target.value)}
            style={{
              padding: '6px 10px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600,
              border: `1px solid ${sfPlantFilter === 'All' ? theme.cardBorder : sfColor}`,
              background: sfPlantFilter === 'All' ? 'transparent' : `${sfColor}15`,
              color: sfPlantFilter === 'All' ? theme.textMuted : sfColor,
              cursor: 'pointer', outline: 'none', minWidth: '120px'
            }}
          >
            <option value="All">All Plants ({sampleFollowups.length})</option>
            {sfPlants.map(p => {
              const count = sampleFollowups.filter(sf => (sf.plant || '').trim() === p).length;
              return <option key={p} value={p}>{p} ({count})</option>;
            })}
          </select>
        </div>
      </div>

      {/* Table */}
      <div style={tableContainer}>
        {filteredFollowups.length > 0 ? (
          <div className="dt-scroll" style={scrollVars}>
            <table className="dt-table" style={tableStyle}>
              <thead>
                <tr>
                  <th scope="col" style={th}>Die</th>
                  <th scope="col" style={th}>Profile</th>
                  <th scope="col" style={th}>Plant</th>
                  <th scope="col" style={th}>Press</th>
                  <th scope="col" style={th}>Supplier</th>
                  <th scope="col" style={th}>Customer</th>
                  <th scope="col" style={th}>Die Received Date</th>
                  <th scope="col" style={th}>Ascona Ref</th>
                  <th scope="col" style={th}>Submission Date</th>
                  <th scope="col" style={th}>Sample Approval Date</th>
                  <th scope="col" style={th} className="dt-center">Delay Days</th>
                  <th scope="col" style={th}>Status</th>
                  <th scope="col" style={th} className="dt-center">No. of Trial</th>
                  <th scope="col" style={th}>Remark</th>
                  <th scope="col" style={th}>Corrector</th>
                  <th scope="col" style={th} className="dt-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredFollowups.map((sf) => {
                  const statusStyle = sfStatusColors[sf.status] || { color: '#6B7280', bg: '#F3F4F6' };
                  return (
                    <tr key={sf.id}>
                      <td style={{ ...td, fontWeight: 600, color: theme.text }}>{sf.die || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: theme.textMuted }}>{sf.profile || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{sf.plant || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{sf.press || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{sf.supplier || '—'}</td>
                      <td style={td}>{sf.customer || '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{formatDate(sf.die_received_date)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <select
                          defaultValue={sf.ascona_reference || 'No'}
                          onChange={(e) => handleSfInlineSave(sf, 'Ascona Reference', e.target.value)}
                          style={{ padding: '4px 8px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', cursor: 'pointer' }}
                        >
                          <option value="No">No</option>
                          <option value="Yes">Yes</option>
                        </select>
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <input
                          type="date"
                          defaultValue={sf.submission_date ? String(sf.submission_date).split('T')[0] : ''}
                          onBlur={(e) => handleSfInlineSave(sf, 'Submission Date', e.target.value)}
                          style={{ padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem' }}
                        />
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <input
                          type="date"
                          defaultValue={sf.sample_approval_date ? String(sf.sample_approval_date).split('T')[0] : ''}
                          onBlur={(e) => handleSfInlineSave(sf, 'Sample Approval Date', e.target.value)}
                          style={{ padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem' }}
                        />
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600, color: computeSfDelay(sf.die_received_date, sf.submission_date) > 0 ? '#EF4444' : '#10B981' }}>
                          {computeSfDelay(sf.die_received_date, sf.submission_date)}
                        </span>
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600, background: statusStyle.bg, color: statusStyle.color }}>
                          {sf.status || 'Pending'}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        {(() => {
                          const { count, isLegacy } = trialCountFor(trialsOf(sf), sf.no_of_trial);
                          return (
                            <span
                              title={isLegacy ? 'Recorded before trials were logged individually' : 'Counted from the logged trials'}
                              style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: isLegacy ? theme.textMuted : theme.text, fontStyle: isLegacy ? 'italic' : 'normal' }}
                            >
                              {count}
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ ...td, minWidth: '160px' }}>
                        <input
                          type="text"
                          defaultValue={sf.remark || ''}
                          onBlur={(e) => handleSfInlineSave(sf, 'Remark', e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                          placeholder="—"
                          style={{ width: '100%', padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem' }}
                        />
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{sf.corrector || '—'}</td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button
                            onClick={() => {
                              setEditingSampleFollowup(sf);
                              setSampleFollowupForm({ die: sf.die || '', plant: sf.plant || '', press: sf.press || '', supplier: sf.supplier || '', customer: sf.customer || '', die_received_date: sf.die_received_date || '', ascona_reference: sf.ascona_reference || 'No', submission_date: sf.submission_date || '', sample_approval_date: sf.sample_approval_date || '', delay_days: sf.delay_days || 0, status: sf.status || 'Pending', remark: sf.remark || '', corrector: sf.corrector || '' });
                              setShowSampleFollowupForm(true);
                            }}
                            style={{ padding: '6px', background: 'rgba(59,130,246,0.15)', border: 'none', borderRadius: '6px', cursor: 'pointer', color: '#3B82F6' }}
                            title="Edit"
                          >
                            <Eye size={16} />
                          </button>
                          {user?.role === 'admin' && (
                            <button
                              onClick={() => handleDeleteSampleFollowup(sf)}
                              style={{ padding: '6px', background: 'rgba(239,68,68,0.15)', border: 'none', borderRadius: '6px', cursor: 'pointer', color: '#EF4444' }}
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '4rem 2rem', color: theme.textMuted }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: `${sfColor}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
              <ClipboardList size={28} color={sfColor} />
            </div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: theme.text, marginBottom: '0.5rem' }}>No Sample Followup Records</h3>
            <p style={{ fontSize: '0.9rem', color: theme.textMuted }}>Click "Add Record" to create a new sample followup entry</p>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showSampleFollowupForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '2rem', width: '90%', maxWidth: '700px', maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${theme.cardBorder}`, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: theme.text, margin: 0 }}>
                {editingSampleFollowup ? 'Edit Sample Followup' : 'New Sample Followup'}
              </h2>
              <button onClick={() => { setShowSampleFollowupForm(false); setEditingSampleFollowup(null); }} style={{ padding: '8px', background: 'transparent', border: 'none', borderRadius: '8px', cursor: 'pointer', color: theme.textMuted }}>
                <X size={20} />
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {[
                { key: 'die', label: 'Die', type: 'text' },
                { key: 'profile', label: 'Profile', type: 'readonly' },
                { key: 'plant', label: 'Plant', type: 'text' },
                { key: 'press', label: 'Press', type: 'text' },
                { key: 'supplier', label: 'Supplier', type: 'text' },
                { key: 'customer', label: 'Customer', type: 'text' },
                { key: 'die_received_date', label: 'Die Received Date', type: 'date' },
                { key: 'ascona_reference', label: 'Ascona Reference', type: 'select', options: ['Yes', 'No'] },
                { key: 'submission_date', label: 'Submission Date', type: 'date' },
                { key: 'sample_approval_date', label: 'Sample Approval Date', type: 'date' },
                { key: 'delay_days', label: 'Delay Days', type: 'number' },
                { key: 'status', label: 'Status', type: 'select', options: SF_STATUSES },
                { key: 'corrector', label: 'Corrector', type: 'corrector' },
              ].map(field => (
                <div key={field.key}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{field.label}</label>
                  {field.type === 'corrector' ? (
                    <CorrectorSelect
                      value={sampleFollowupForm[field.key] || ''}
                      onChange={(v) => setSampleFollowupForm({ ...sampleFollowupForm, [field.key]: v })}
                      correctors={correctors}
                      loadError={correctorsError}
                      plant={sampleFollowupForm.plant}
                      style={{ width: '100%', padding: '10px 12px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.text, fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                    />
                  ) : field.type === 'select' ? (
                    <select
                      value={sampleFollowupForm[field.key] || ''}
                      onChange={(e) => setSampleFollowupForm({ ...sampleFollowupForm, [field.key]: e.target.value })}
                      style={{ width: '100%', padding: '10px 12px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.text, fontSize: '0.9rem', outline: 'none' }}
                    >
                      {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : field.key === 'delay_days' ? (
                    <input
                      type="number"
                      value={computeSfDelay(sampleFollowupForm.die_received_date, sampleFollowupForm.submission_date)}
                      readOnly
                      title="Auto-calculated: submission date − die received date (or today − die received date if submission is empty)"
                      style={{ width: '100%', padding: '10px 12px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.textMuted, fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', cursor: 'not-allowed' }}
                    />
                  ) : field.type === 'readonly' ? (
                    <input
                      type="text"
                      value={extractProfile(sampleFollowupForm.die)}
                      readOnly
                      title="Auto-derived from Die (everything before the first '-')"
                      style={{ width: '100%', padding: '10px 12px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.textMuted, fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', cursor: 'not-allowed' }}
                    />
                  ) : (
                    <input
                      type={field.type}
                      value={field.type === 'date' && sampleFollowupForm[field.key] ? String(sampleFollowupForm[field.key]).split('T')[0] : (sampleFollowupForm[field.key] || '')}
                      onChange={(e) => setSampleFollowupForm({ ...sampleFollowupForm, [field.key]: field.type === 'number' ? parseInt(e.target.value, 10) || 0 : e.target.value })}
                      style={{ width: '100%', padding: '10px 12px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.text, fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                    />
                  )}
                </div>
              ))}
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }} htmlFor="samplefollowuppage-remark">Remark</label>
                <textarea id="samplefollowuppage-remark"
                  value={sampleFollowupForm.remark || ''}
                  onChange={(e) => setSampleFollowupForm({ ...sampleFollowupForm, remark: e.target.value })}
                  rows={3}
                  style={{ width: '100%', padding: '10px 12px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.text, fontSize: '0.9rem', outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
                />
              </div>
            </div>
            <TrialsSection
              parent={trialParentOf(editingSampleFollowup)}
              trials={trialsOf(editingSampleFollowup)}
              theme={theme}
              user={user}
              onChanged={fetchSampleTrials}
              setToast={setToast}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '1.5rem', paddingTop: '1rem', borderTop: `1px solid ${theme.border || '#334155'}` }}>
              <button
                onClick={() => { setShowSampleFollowupForm(false); setEditingSampleFollowup(null); }}
                style={{ padding: '10px 20px', background: 'transparent', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '10px', color: theme.textMuted, fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSampleFollowupSubmit}
                style={{ padding: '10px 24px', background: sfColor, color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', boxShadow: `0 4px 12px ${sfColor}40` }}
              >
                {editingSampleFollowup ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
