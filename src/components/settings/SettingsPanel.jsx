import React, { useState } from 'react';
import { Upload, FileText, Download, Plus, Trash2, Factory, Truck } from 'lucide-react';
import * as XLSX from 'xlsx';

function SettingsPanel({
  suppliers,
  plants,
  orders,
  onAddSupplier,
  onDeleteSupplier,
  onAddPlant,
  onDeletePlant,
  onImportClick,
  onPDFImportClick,
  theme
}) {
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [showAddPlant, setShowAddPlant] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newPlantName, setNewPlantName] = useState('');

  const handleAddSupplier = async (e) => {
    e.preventDefault();
    if (!newSupplierName.trim()) return;
    try {
      await onAddSupplier(newSupplierName.trim());
      setNewSupplierName('');
      setShowAddSupplier(false);
    } catch (error) {
      alert(error.message);
    }
  };

  const handleAddPlant = async (e) => {
    e.preventDefault();
    if (!newPlantName.trim()) return;
    try {
      await onAddPlant(newPlantName.trim());
      setNewPlantName('');
      setShowAddPlant(false);
    } catch (error) {
      alert(error.message);
    }
  };

  const handleExport = () => {
    const exportData = orders.map(order => ({
      'Plant': order.Plant,
      'Order No': order['Order No'],
      'DIE NO': order['DIE NO'],
      'TYPE': order.TYPE,
      'Die Size': order['Die Size'],
      'Die Requested Date': order['Die Requested Date'],
      'Ordered date': order['Ordered date'],
      'Type of shipment': order['Type of shipment'],
      'Mandrels per Cavity': order['Mandrels per Cavity'],
      'Total Mandrels': order['Total Mandrels'],
      'Design Received Date': order['Design Received Date'],
      'Design Approved Date': order['Design Approved Date'],
      'Delay': order.Delay,
      'PR Entry': order['PR Entry'],
      'Oracle Entry': order['Oracle Entry'],
      'Supplier': order.Supplier,
      'STATUS': order.STATUS,
      'OVERALL DELAY': order['OVERALL DELAY'],
      'ETA': order.ETA,
      'Month': order.month
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Die Orders');
    XLSX.writeFile(wb, `die_orders_export_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const cardStyle = {
    background: theme.cardBg,
    borderRadius: '16px',
    padding: '1.5rem',
    border: `1px solid ${theme.border}`
  };

  const inputStyle = {
    padding: '10px 14px',
    background: theme.inputBg || theme.bg,
    border: `1px solid ${theme.border}`,
    borderRadius: '8px',
    color: theme.text,
    fontSize: '0.9rem',
    width: '100%'
  };

  const buttonStyle = {
    padding: '10px 20px',
    background: '#3B82F6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
      {/* Import/Export Section */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: theme.text, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Upload size={20} />
          Data Import / Export
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button onClick={onImportClick} style={buttonStyle}>
            <Upload size={18} />
            Import from Excel/CSV
          </button>

          <button
            onClick={onPDFImportClick}
            style={{ ...buttonStyle, background: 'linear-gradient(135deg, #F59E0B, #EF4444)' }}
          >
            <FileText size={18} />
            Import from PDF
          </button>

          <button
            onClick={handleExport}
            style={{ ...buttonStyle, background: '#10B981' }}
          >
            <Download size={18} />
            Export to Excel
          </button>
        </div>

        <p style={{ fontSize: '0.8rem', color: theme.textMuted, marginTop: '1rem' }}>
          Export includes all {orders.length} orders in the system.
        </p>
      </div>

      {/* Suppliers Section */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: theme.text, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Truck size={20} />
            Suppliers ({suppliers.length})
          </h3>
          <button
            onClick={() => setShowAddSupplier(!showAddSupplier)}
            style={{
              padding: '6px 12px',
              background: showAddSupplier ? theme.border : '#3B82F6',
              color: showAddSupplier ? theme.text : 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.85rem'
            }}
          >
            <Plus size={16} />
            Add
          </button>
        </div>

        {showAddSupplier && (
          <form onSubmit={handleAddSupplier} style={{ marginBottom: '1rem', display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={newSupplierName}
              onChange={(e) => setNewSupplierName(e.target.value)}
              placeholder="Supplier name"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button type="submit" style={{ ...buttonStyle, padding: '10px 16px' }}>
              Add
            </button>
          </form>
        )}

        <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
          {suppliers.map(supplier => (
            <div
              key={supplier.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 12px',
                borderBottom: `1px solid ${theme.border}`
              }}
            >
              <span style={{ color: theme.text, fontSize: '0.9rem' }}>{supplier.name}</span>
              <button
                onClick={() => {
                  if (confirm(`Delete supplier "${supplier.name}"?`)) {
                    onDeleteSupplier(supplier.id);
                  }
                }}
                style={{
                  padding: '4px 8px',
                  background: 'transparent',
                  border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: '4px',
                  color: '#EF4444',
                  cursor: 'pointer'
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Plants Section */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: theme.text, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Factory size={20} />
            Plants ({plants.length})
          </h3>
          <button
            onClick={() => setShowAddPlant(!showAddPlant)}
            style={{
              padding: '6px 12px',
              background: showAddPlant ? theme.border : '#3B82F6',
              color: showAddPlant ? theme.text : 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.85rem'
            }}
          >
            <Plus size={16} />
            Add
          </button>
        </div>

        {showAddPlant && (
          <form onSubmit={handleAddPlant} style={{ marginBottom: '1rem', display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={newPlantName}
              onChange={(e) => setNewPlantName(e.target.value)}
              placeholder="Plant name"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button type="submit" style={{ ...buttonStyle, padding: '10px 16px' }}>
              Add
            </button>
          </form>
        )}

        <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
          {plants.map(plant => (
            <div
              key={plant.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 12px',
                borderBottom: `1px solid ${theme.border}`
              }}
            >
              <span style={{ color: theme.text, fontSize: '0.9rem' }}>{plant.name}</span>
              <button
                onClick={() => {
                  if (confirm(`Delete plant "${plant.name}"?`)) {
                    onDeletePlant(plant.id);
                  }
                }}
                style={{
                  padding: '4px 8px',
                  background: 'transparent',
                  border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: '4px',
                  color: '#EF4444',
                  cursor: 'pointer'
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* System Info */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: theme.text, marginBottom: '1.25rem' }}>
          System Information
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <p style={{ fontSize: '0.75rem', color: theme.textMuted, textTransform: 'uppercase', marginBottom: '4px' }}>Total Orders</p>
            <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#3B82F6' }}>{orders.length}</p>
          </div>
          <div>
            <p style={{ fontSize: '0.75rem', color: theme.textMuted, textTransform: 'uppercase', marginBottom: '4px' }}>Suppliers</p>
            <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#10B981' }}>{suppliers.length}</p>
          </div>
          <div>
            <p style={{ fontSize: '0.75rem', color: theme.textMuted, textTransform: 'uppercase', marginBottom: '4px' }}>Plants</p>
            <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#8B5CF6' }}>{plants.length}</p>
          </div>
          <div>
            <p style={{ fontSize: '0.75rem', color: theme.textMuted, textTransform: 'uppercase', marginBottom: '4px' }}>Completed</p>
            <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F59E0B' }}>
              {orders.filter(o => o.STATUS === 'DONE').length}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsPanel;
