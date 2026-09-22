import React, { useState } from 'react';
import { X, CheckCircle } from 'lucide-react';
import { ordersAPI } from '../../api';
import DieAttentionLabels from '../DieAttentionLabels';
import CorrectorSelect from '../ui/CorrectorSelect';
import { todayLocal } from '../../utils/today.js';
import { skipTrialAllowed, skipTrialDefault, buildReceivancePatch } from '../../utils/dieReceivance';

// Confirm Die Receivance, moved out of FlowPage unchanged when In Manufacturing
// got its own page. The parent decides what happens after a confirmed receipt.
export default function DieReceivanceModal({ order, theme, correctors, correctorsError, setToast, onClose, onConfirmed }) {
  const [form, setForm] = useState({ die_received_date: todayLocal(), corrector: '', skip_trial: skipTrialDefault(order.TYPE) });

  const confirm = async () => {
    if (!form.die_received_date) { setToast({ message: 'Please enter the die received date', type: 'error' }); setTimeout(() => setToast(null), 3000); return; }
    if (!form.corrector.trim()) { setToast({ message: 'Please assign a corrector', type: 'error' }); setTimeout(() => setToast(null), 3000); return; }
    try {
      const { patch } = buildReceivancePatch({ order, form, skipTrial: form.skip_trial });
      await ordersAPI.patch(order.id, patch);
      onConfirmed(patch);
    } catch (error) {
      setToast({ message: 'Failed to confirm: ' + error.message, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '2rem', width: '90%', maxWidth: '480px', border: `1px solid ${theme.cardBorder}`, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: theme.text, margin: 0 }}>Confirm Die Receivance</h2>
            <DieAttentionLabels order={order} dense />
            <p style={{ fontSize: '0.85rem', color: theme.textMuted, margin: '4px 0 0' }}>Die No: <strong style={{ color: theme.text, fontFamily: 'monospace' }}>{order['DIE NO']}</strong></p>
          </div>
          <button onClick={onClose} style={{ padding: '8px', background: 'transparent', border: 'none', borderRadius: '8px', cursor: 'pointer', color: theme.textMuted }}><X size={20} /></button>
        </div>
        <div style={{ background: `rgba(8,145,178,0.08)`, borderRadius: '12px', padding: '12px 16px', marginBottom: '1.5rem', border: '1px solid rgba(8,145,178,0.2)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.8rem' }}>
            <div><span style={{ color: theme.textDim }}>Supplier:</span> <strong style={{ color: theme.text }}>{order.Supplier}</strong></div>
            <div><span style={{ color: theme.textDim }}>Plant:</span> <strong style={{ color: theme.text }}>{order.Plant}</strong></div>
            <div><span style={{ color: theme.textDim }}>Type:</span> <strong style={{ color: theme.text }}>{order.TYPE === 'N' ? 'New' : order.TYPE === 'B' ? 'Backup' : order.TYPE}</strong></div>
            <div><span style={{ color: theme.textDim }}>Size:</span> <strong style={{ color: theme.text }}>{order['Die Size'] || '—'}</strong></div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }} htmlFor="flowpage-die-received-date">Die Received Date *</label>
            <input id="flowpage-die-received-date" type="date" value={form.die_received_date} onChange={(e) => setForm({ ...form, die_received_date: e.target.value })} style={{ width: '100%', padding: '10px 12px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.text, fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }} htmlFor="flowpage-assign-corrector">Assign Corrector *</label>
            <CorrectorSelect
              id="flowpage-assign-corrector"
              value={form.corrector}
              onChange={(v) => setForm({ ...form, corrector: v })}
              correctors={correctors}
              loadError={correctorsError}
              plant={order?.Plant}
              style={{ width: '100%', padding: '10px 12px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.text, fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          {skipTrialAllowed(order.TYPE) && (
            <label htmlFor="flowpage-skip-trial" style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: '8px', cursor: 'pointer' }}>
              <input
                id="flowpage-skip-trial"
                type="checkbox"
                checked={!!form.skip_trial}
                onChange={(e) => setForm({ ...form, skip_trial: e.target.checked })}
                style={{ marginTop: '2px', accentColor: '#22C55E' }}
              />
              <span>
                <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: theme.text }}>Skip trial</span>
                <span style={{ display: 'block', fontSize: '0.75rem', color: theme.textMuted, marginTop: '2px' }}>Sample marked submitted and approved on the received date, with no trials.</span>
              </span>
            </label>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '1.5rem', paddingTop: '1rem', borderTop: `1px solid ${theme.border || '#334155'}` }}>
          <button onClick={onClose} style={{ padding: '10px 20px', background: 'transparent', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '10px', color: theme.textMuted, fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' }}>Cancel</button>
          <button
            onClick={confirm}
            style={{ padding: '10px 24px', background: '#0891B2', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', boxShadow: '0 4px 12px rgba(8,145,178,0.4)', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <CheckCircle size={18} /> Confirm Receivance
          </button>
        </div>
      </div>
    </div>
  );
}
