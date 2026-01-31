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
        </div>
      </div>
    </div>
  );
}

export default OrderDetailModal;
