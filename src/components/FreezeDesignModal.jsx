import React, { useState } from 'react';
import { Snowflake, X, Upload } from 'lucide-react';
import { frozenDesignsAPI, extractProfileFromDie } from '../api';

// "Freeze / Final Design" action. Works two ways:
//  - From an order (Order Detail modal): profile/plant/press/cavity prefilled from the order.
//  - Standalone (Frozen Designs page): all fields entered manually.
// Files upload in the same step.
export default function FreezeDesignModal({ order = null, theme = {}, onClose, onDone }) {
  const [profile, setProfile] = useState(order ? (extractProfileFromDie(order['DIE NO']) || '') : '');
  const [plant, setPlant] = useState(order ? (order.Plant || order.plant || '') : '');
  const [press, setPress] = useState(order ? (order['Press'] || order.press || '') : '');
  const [cavity, setCavity] = useState(order ? (order['Cavity'] ?? order.cavity ?? '') : '');
  const [supplier, setSupplier] = useState(order ? (order['Supplier'] || order.supplier || '') : '');
  const [dieSize, setDieSize] = useState(order ? (order['Die Size'] || order.die_size || '') : '');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const bg = theme.cardBg || '#09090b';
  const border = theme.cardBorder || '#27272a';
  const text = theme.text || '#fafafa';
  const muted = theme.textDim || '#71717a';
  const inputBg = theme.inputBg || '#09090b';
  const inputStyle = { width: '100%', padding: '9px 12px', background: inputBg, border: `1px solid ${border}`, borderRadius: '8px', color: text, fontSize: '0.875rem', boxSizing: 'border-box', outline: 'none' };
  const labelStyle = { display: 'block', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', color: muted, marginBottom: '6px', letterSpacing: '0.04em' };

  const cavityNum = Math.round(Number(cavity));
  const canSubmit = String(profile).trim() && String(plant).trim() && String(press).trim() && cavityNum > 0 && !saving;

  const handleSubmit = async () => {
    setError('');
    if (!String(profile).trim()) { setError('Profile is required.'); return; }
    if (!String(plant).trim()) { setError('Plant is required.'); return; }
    if (!String(press).trim()) { setError('Press is required.'); return; }
    if (!(cavityNum > 0)) { setError('Cavity must be greater than 0.'); return; }
    setSaving(true);
    try {
      const { id } = await frozenDesignsAPI.create({
        profile: String(profile).trim(), plant: String(plant).trim(), press: String(press).trim(), cavity: cavityNum,
        sourceOrderId: order ? order.id : null, notes: notes.trim() || null,
        supplier: String(supplier).trim() || null, dieSize: String(dieSize).trim() || null,
      });
      if (files && files.length) {
        await frozenDesignsAPI.uploadFiles(id, files);
      }
      onDone && onDone({ id, filesUploaded: files ? files.length : 0 });
      onClose();
    } catch (e) {
      setError(e.message || 'Failed to freeze design');
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1rem' }} onClick={onClose}>
      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: '14px', width: '440px', maxWidth: '100%', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: `1px solid ${border}` }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: text, fontSize: '1rem' }}>
            <Snowflake size={18} color="#38BDF8" /> Freeze / Final Design
          </h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: muted, cursor: 'pointer' }}><X size={20} /></button>
        </div>

        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {order && (
            <div style={{ fontSize: '0.8rem', color: muted }}>
              Die <span style={{ color: text, fontWeight: 600 }}>{order['DIE NO']}</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Profile *</label>
              <input style={inputStyle} value={profile} onChange={(e) => setProfile(e.target.value)} placeholder="e.g. 29663" />
            </div>
            <div>
              <label style={labelStyle}>Plant *</label>
              <input style={inputStyle} value={plant} onChange={(e) => setPlant(e.target.value)} placeholder="e.g. GEX 1" />
            </div>
            <div>
              <label style={labelStyle}>Press *</label>
              <input style={inputStyle} value={press} onChange={(e) => setPress(e.target.value)} placeholder="e.g. PRESS 4 / P5" />
            </div>
            <div>
              <label style={labelStyle}>Cavity *</label>
              <input style={inputStyle} type="number" min="1" value={cavity} onChange={(e) => setCavity(e.target.value)} placeholder="e.g. 2" />
            </div>
            <div>
              <label style={labelStyle}>Supplier</label>
              <input style={inputStyle} value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. PDTMC" />
            </div>
            <div>
              <label style={labelStyle}>Die Size</label>
              <input style={inputStyle} value={dieSize} onChange={(e) => setDieSize(e.target.value)} placeholder="e.g. DIA 250 X 60" />
            </div>
          </div>
          <div style={{ fontSize: '0.72rem', color: muted, marginTop: '-6px' }}>
            Supplier &amp; die size are reused to pre-fill re-order PDFs for this profile.
          </div>

          <div>
            <label style={labelStyle}>Notes</label>
            <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '54px', fontFamily: 'inherit' }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes about this final design" />
          </div>

          <div>
            <label style={labelStyle}>Final Design Files</label>
            <input type="file" multiple onChange={(e) => setFiles(e.target.files)} style={{ color: text, fontSize: '0.82rem' }} />
            <div style={{ fontSize: '0.72rem', color: muted, marginTop: '4px' }}>PDF, images, DWG, DXF, STEP/STP — up to 100 MB each.</div>
          </div>

          {error && <div style={{ color: '#F87171', fontSize: '0.8rem' }}>{error}</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '1rem 1.25rem', borderTop: `1px solid ${border}` }}>
          <button onClick={onClose} style={{ padding: '9px 18px', background: 'transparent', color: muted, border: `1px solid ${border}`, borderRadius: '8px', fontWeight: 500, fontSize: '0.875rem', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={!canSubmit} style={{ padding: '9px 22px', background: canSubmit ? '#0891B2' : '#475569', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '0.875rem', cursor: canSubmit ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Upload size={16} /> {saving ? 'Freezing…' : 'Freeze Design'}
          </button>
        </div>
      </div>
    </div>
  );
}
