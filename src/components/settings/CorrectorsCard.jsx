import React, { useState } from 'react';
import { UserCheck } from 'lucide-react';
import { correctorsAPI } from '../../api';
import { dialogs } from '../ui/DialogProvider';
import { BRAND } from '../../utils/brand';

// Admin-maintained master list behind every Corrector dropdown. This is the
// only place in the app where a corrector name is typed rather than chosen.
//
// Kept in its own file rather than inline in SettingsPage, which is already
// past a thousand lines.
export default function CorrectorsCard({ theme, plants = [], correctors = [], fetchCorrectors, isAdmin }) {
  const [newName, setNewName] = useState('');
  const [newPlant, setNewPlant] = useState('');
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!newName.trim()) { dialogs.notify('Corrector name is required.', 'error'); return; }
    setSaving(true);
    try {
      await correctorsAPI.create(newName.trim(), newPlant || null);
      setNewName(''); setNewPlant('');
      fetchCorrectors();
    } catch (error) {
      dialogs.notify('Failed to add: ' + error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const patch = async (id, data) => {
    try { await correctorsAPI.update(id, data); fetchCorrectors(); }
    catch (error) { dialogs.notify('Failed to update: ' + error.message, 'error'); }
  };

  const deactivate = async (c) => {
    const ok = await dialogs.confirm({
      title: 'Deactivate corrector',
      message: `"${c.name}" will no longer appear in the Corrector dropdowns. Dies already recorded against this name keep it.`,
      confirmLabel: 'Deactivate',
    });
    if (ok) patch(c.id, { is_active: false });
  };

  const cell = { padding: '8px 12px', fontSize: '0.8rem', color: theme.text };

  return (
    // No marginTop here: the parent is a CSS grid whose own gap already spaces
    // the cards, and this one shares a row with Plants and Suppliers. A margin
    // pushes it 24px below their top edge; the default stretch keeps all three
    // the same height.
    <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}` }}>
      <div style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: theme.text, margin: 0 }}>
          <UserCheck size={20} /> Correctors
        </h3>
        <p style={{ fontSize: '0.8rem', color: theme.textDim, marginTop: '4px', marginBottom: 0 }}>
          The list offered on Die Receiving, Sample Followup and QD. Correctors are shown for their own plant first.
        </p>
      </div>

      {isAdmin && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <input
            aria-label="New corrector name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="Corrector name"
            style={{ flex: '1 1 200px', padding: '8px 12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.85rem' }}
          />
          <select
            aria-label="New corrector plant"
            value={newPlant}
            onChange={(e) => setNewPlant(e.target.value)}
            style={{ padding: '8px 12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.85rem' }}
          >
            <option value="">All plants</option>
            {plants.map((p) => <option key={p.id || p.name} value={p.name}>{p.name}</option>)}
          </select>
          <button onClick={add} disabled={saving} style={{ padding: '8px 18px', background: BRAND.navy, color: 'white', border: 'none', borderRadius: '8px', cursor: saving ? 'wait' : 'pointer', fontSize: '0.85rem' }}>
            Add
          </button>
        </div>
      )}

      <div style={{ background: theme.inputBg, borderRadius: '12px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th scope="col" style={{ ...cell, textAlign: 'left', color: theme.textDim }}>Name</th>
              <th scope="col" style={{ ...cell, textAlign: 'left', color: theme.textDim }}>Plant</th>
              <th scope="col" style={{ ...cell, textAlign: 'left', color: theme.textDim }}>Status</th>
              {isAdmin && <th scope="col" style={{ ...cell, textAlign: 'right', color: theme.textDim }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {correctors.map((c) => (
              <tr key={c.id} style={{ borderTop: `1px solid ${theme.cardBorder}`, opacity: c.is_active ? 1 : 0.55 }}>
                <td style={cell}>{c.name}</td>
                <td style={cell}>
                  {isAdmin ? (
                    <select
                      aria-label={`Plant for ${c.name}`}
                      value={c.plant || ''}
                      onChange={(e) => patch(c.id, { plant: e.target.value || null })}
                      style={{ padding: '4px 8px', background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '4px', color: theme.text, fontSize: '0.75rem' }}
                    >
                      <option value="">All plants</option>
                      {plants.map((p) => <option key={p.id || p.name} value={p.name}>{p.name}</option>)}
                    </select>
                  ) : (c.plant || 'All plants')}
                </td>
                <td style={cell}>{c.is_active ? 'Active' : 'Inactive'}</td>
                {isAdmin && (
                  <td style={{ ...cell, textAlign: 'right' }}>
                    {c.is_active ? (
                      <button onClick={() => deactivate(c)} style={{ padding: '4px 10px', background: '#EF4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>Deactivate</button>
                    ) : (
                      <button onClick={() => patch(c.id, { is_active: true })} style={{ padding: '4px 10px', background: '#10B981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>Reactivate</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {correctors.length === 0 && (
              <tr><td colSpan={isAdmin ? 4 : 3} style={{ padding: '24px', textAlign: 'center', color: theme.textDim }}>No correctors configured</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
