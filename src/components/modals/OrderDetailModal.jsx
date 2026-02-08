import React, { useState } from 'react';
import { X, Package } from 'lucide-react';
import { STATUS_CONFIG } from '../../utils/constants';
import { ordersAPI } from '../../api';
import ProgressPipeline from '../common/ProgressPipeline';

function OrderDetailModal({ order, onClose, onUpdate, theme, suppliers = [], plants = [] }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedOrder, setEditedOrder] = useState({ ...order });
  const [isSaving, setIsSaving] = useState(false);

  if (!order) return null;

  const currentOrder = isEditing ? editedOrder : order;
  const config = STATUS_CONFIG[currentOrder.STATUS] || { color: '#6B7280', icon: Package };
  const StatusIcon = config.icon || Package;

  const determineStatus = (orderData) => {
    if (orderData.STATUS === 'CANCELLED' || orderData.STATUS === 'HOLD') return orderData.STATUS;

    if (orderData['Oracle Entry'] && orderData['PR Entry'] && orderData['Design Approved Date'] && orderData['Design Received Date'] && orderData['Ordered date']) {
      return 'DONE';
    }
    if (orderData['PR Entry'] && orderData['Design Approved Date'] && orderData['Design Received Date'] && orderData['Ordered date']) {
      return 'PENDING FOR ORACLE ENTRY';
    }
    if (orderData['Design Approved Date'] && orderData['Design Received Date'] && orderData['Ordered date']) {
      return 'PENDING FOR PR';
    }
    if (orderData.simulationEnabled && orderData['3D Model Received Date'] && orderData['Design Received Date'] && orderData['Ordered date']) {
      return 'UNDER SIMULATION';
    }
    if (orderData['Design Received Date'] && orderData['Ordered date']) {
      return 'PENDING FOR DESIGN APPROVAL';
    }
    if (orderData['Ordered date']) {
      return 'AWAITING FOR DESIGN';
    }
    return 'PENDING FOR ORDERING';
  };

  const handleFieldChange = (field, value) => {
    setEditedOrder(prev => {
      const updated = { ...prev, [field]: value };
      if (field !== 'STATUS') {
        updated.STATUS = determineStatus(updated);
      }
      return updated;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await ordersAPI.update(order.id, editedOrder);
      if (onUpdate) onUpdate(editedOrder);
      setIsEditing(false);
    } catch (error) {
      alert('Failed to save: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedOrder({ ...order });
    setIsEditing(false);
  };

  const inputStyle = {
    width: '100%',
    padding: '8px 12px',
    background: theme?.inputBg || '#0F172A',
    border: `1px solid ${theme?.border || '#334155'}`,
    borderRadius: '8px',
    color: theme?.text || '#F1F5F9',
    fontSize: '0.875rem',
    textAlign: 'right',
    outline: 'none',
  };

  const dateInputStyle = {
    ...inputStyle,
    minWidth: '140px',
    cursor: 'pointer',
    colorScheme: theme?.text === '#F1F5F9' ? 'dark' : 'light',
  };

  const selectStyle = { ...inputStyle, cursor: 'pointer' };

  const InfoRow = ({ label, field, value, type = 'text', options = null }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${theme?.border || '#334155'}` }}>
      <span style={{ fontSize: '0.8rem', color: theme?.textDim || '#64748B', minWidth: '80px' }}>{label}</span>
      {isEditing ? (
        type === 'select' && options ? (
          <select style={selectStyle} value={editedOrder[field] || ''} onChange={(e) => handleFieldChange(field, e.target.value)}>
            <option value="">—</option>
            {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        ) : type === 'date' ? (
          <input
            type="date"
            style={dateInputStyle}
            value={editedOrder[field] || ''}
            onChange={(e) => handleFieldChange(field, e.target.value)}
            onClick={(e) => e.target.showPicker && e.target.showPicker()}
          />
        ) : (
          <input type="text" style={inputStyle} value={editedOrder[field] || ''} onChange={(e) => handleFieldChange(field, e.target.value)} />
        )
      ) : (
        <span style={{ fontSize: '0.875rem', fontWeight: 500, color: theme?.text || '#F1F5F9' }}>{value || '—'}</span>
      )}
    </div>
  );

  const statusOptions = Object.keys(STATUS_CONFIG);
  const typeOptions = ['N', 'B', 'T', 'C', 'H'];
  const shipmentOptions = ['AIR', 'LAND'];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }} onClick={onClose}>
      <div style={{ background: theme?.cardBg || '#1E293B', borderRadius: '20px', width: '100%', maxWidth: '680px', maxHeight: '90vh', overflow: 'hidden', border: `1px solid ${theme?.border || '#334155'}` }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem', borderBottom: `1px solid ${theme?.border || '#334155'}`, background: `${config.color}10` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: config.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <StatusIcon size={24} color="white" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: theme?.text || '#F1F5F9' }}>{order['DIE NO']}</h2>
              <p style={{ color: theme?.textDim || '#64748B' }}>Order #{order['Order No']}</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {!isEditing ? (
              <button onClick={() => setIsEditing(true)} style={{ padding: '8px 16px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 500, cursor: 'pointer' }}>Edit</button>
            ) : (
              <>
                <button onClick={handleCancel} style={{ padding: '8px 16px', background: theme?.cardBg || '#334155', color: theme?.text || '#F1F5F9', border: `1px solid ${theme?.border || '#334155'}`, borderRadius: '8px', fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
                <button onClick={handleSave} disabled={isSaving} style={{ padding: '8px 16px', background: isSaving ? '#475569' : '#10B981', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 500, cursor: isSaving ? 'not-allowed' : 'pointer' }}>{isSaving ? 'Saving...' : 'Save'}</button>
              </>
            )}
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: theme?.textDim || '#64748B', cursor: 'pointer', padding: '8px', borderRadius: '8px' }}><X size={24} /></button>
          </div>
        </div>
        <div style={{ padding: '1.5rem', overflowY: 'auto', maxHeight: '65vh' }}>
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme?.textDim || '#64748B', marginBottom: '12px' }}>Progress</h3>
            <ProgressPipeline order={currentOrder} />
            {isEditing && <p style={{ fontSize: '0.7rem', color: theme?.textDim || '#64748B', marginTop: '8px', fontStyle: 'italic' }}>Fill in date fields below to update progress</p>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
            <div style={{ background: theme?.inputBg || '#0F172A', borderRadius: '12px', padding: '1rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme?.textDim || '#64748B', marginBottom: '12px' }}>Order Details</h3>
              <InfoRow label="Plant" field="Plant" value={currentOrder.Plant} type="select" options={plants.map(p => p.name)} />
              <InfoRow label="Type" field="TYPE" value={currentOrder.TYPE} type="select" options={typeOptions} />
              <InfoRow label="Die Size" field="Die Size" value={currentOrder['Die Size']} />
              <InfoRow label="Shipment" field="Type of shipment" value={currentOrder['Type of shipment']} type="select" options={shipmentOptions} />
              <InfoRow label="Supplier" field="Supplier" value={currentOrder.Supplier} type="select" options={suppliers.map(s => s.name)} />
              <InfoRow label="Status" field="STATUS" value={currentOrder.STATUS} type="select" options={statusOptions} />
            </div>
            <div style={{ background: theme?.inputBg || '#0F172A', borderRadius: '12px', padding: '1rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme?.textDim || '#64748B', marginBottom: '12px' }}>Timeline</h3>
              <InfoRow label="Requested" field="Die Requested Date" value={currentOrder['Die Requested Date']} type="date" />
              <InfoRow label="Design Received" field="Design Received Date" value={currentOrder['Design Received Date']} type="date" />
              {currentOrder.simulationEnabled && <InfoRow label="3D Model Received" field="3D Model Received Date" value={currentOrder['3D Model Received Date']} type="date" />}
              <InfoRow label="Design Approved" field="Design Approved Date" value={currentOrder['Design Approved Date']} type="date" />
              <InfoRow label="PR Entry" field="PR Entry" value={currentOrder['PR Entry']} type="date" />
              <InfoRow label="Oracle Entry" field="Oracle Entry" value={currentOrder['Oracle Entry']} type="date" />
              <InfoRow label="Ordered" field="Ordered date" value={currentOrder['Ordered date']} type="date" />
              <InfoRow label="ETA" field="ETA" value={currentOrder.ETA} type="date" />
            </div>
          </div>
          {(currentOrder.Delay > 0 || currentOrder['OVERALL DELAY'] > 0) && (
            <div style={{ background: 'rgba(244,63,94,0.1)', borderRadius: '12px', padding: '1rem', marginTop: '1rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: '#F43F5E', marginBottom: '12px' }}>Delays</h3>
              <div style={{ display: 'flex', gap: '2rem' }}>
                <div>
                  <span style={{ fontSize: '0.8rem', color: '#F43F5E', opacity: 0.8 }}>Design</span>
                  <span style={{ display: 'block', fontSize: '1.5rem', fontWeight: 700, color: '#F43F5E' }}>{currentOrder.Delay || 0}d</span>
                </div>
                <div>
                  <span style={{ fontSize: '0.8rem', color: '#F43F5E', opacity: 0.8 }}>Overall</span>
                  <span style={{ display: 'block', fontSize: '1.5rem', fontWeight: 700, color: '#F43F5E' }}>{currentOrder['OVERALL DELAY'] || 0}d</span>
                </div>
              </div>
            </div>
          )}
          {/* Revision Info Section */}
          {currentOrder['Design Revision Count'] > 0 && (
            <div style={{ background: 'rgba(245,158,11,0.1)', borderRadius: '12px', padding: '1rem', marginTop: '1rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: '#F59E0B', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                Design Revisions
                <span style={{ background: '#F59E0B', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '0.7rem' }}>
                  {currentOrder['Design Revision Count']} {currentOrder['Design Revision Count'] === 1 ? 'revision' : 'revisions'}
                </span>
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: '#F59E0B', opacity: 0.8 }}>Last Revision Date</span>
                  <span style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: theme?.text || '#F1F5F9', marginTop: '4px' }}>
                    {currentOrder['Last Revision Date'] || '—'}
                  </span>
                </div>
                {currentOrder['Revision PDF'] && (
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#F59E0B', opacity: 0.8 }}>Revision Document</span>
                    <span style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: '#F59E0B', marginTop: '4px' }}>
                      📄 {currentOrder['Revision PDF']}
                    </span>
                  </div>
                )}
              </div>
              {currentOrder['Revision Notes'] && (
                <div style={{ marginTop: '12px', padding: '10px', background: 'rgba(245,158,11,0.1)', borderRadius: '8px', borderLeft: '3px solid #F59E0B' }}>
                  <span style={{ fontSize: '0.75rem', color: '#F59E0B', opacity: 0.8, display: 'block', marginBottom: '4px' }}>Revision Notes</span>
                  <p style={{ fontSize: '0.85rem', color: theme?.text || '#F1F5F9', margin: 0, lineHeight: 1.5 }}>
                    {currentOrder['Revision Notes']}
                  </p>
                </div>
              )}
            </div>
          )}
          {/* Change Log Section */}
          {currentOrder['Change Log'] && currentOrder['Change Log'].length > 0 && (
            <div style={{ background: 'rgba(59,130,246,0.1)', borderRadius: '12px', padding: '1rem', marginTop: '1rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: '#3B82F6', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                Size Change Log
                <span style={{ background: '#3B82F6', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '0.7rem' }}>
                  {currentOrder['Change Log'].length} {currentOrder['Change Log'].length === 1 ? 'change' : 'changes'}
                </span>
              </h3>
              <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
                {[...currentOrder['Change Log']].reverse().map((entry, idx) => (
                  <div key={idx} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 10px',
                    background: idx % 2 === 0 ? 'rgba(59,130,246,0.05)' : 'transparent',
                    borderRadius: '6px',
                    marginBottom: '4px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '0.75rem', color: theme?.textMuted || '#94A3B8', minWidth: '80px' }}>{entry.date}</span>
                      <span style={{ fontWeight: 600, color: '#3B82F6', fontSize: '0.8rem' }}>{entry.field}</span>
                      <span style={{ fontSize: '0.8rem', color: theme?.text || '#F1F5F9' }}>
                        <span style={{ color: '#EF4444', textDecoration: 'line-through' }}>{entry.oldValue || 'N/A'}</span>
                        {' → '}
                        <span style={{ color: '#10B981', fontWeight: 600 }}>{entry.newValue}</span>
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.7rem', color: theme?.textMuted || '#94A3B8', padding: '2px 6px', background: 'rgba(100,116,139,0.2)', borderRadius: '4px' }}>{entry.stage}</span>
                      <span style={{ fontSize: '0.7rem', color: theme?.textMuted || '#94A3B8' }}>by {entry.changedBy}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default OrderDetailModal;
