import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Unlock } from 'lucide-react';
import { frozenDesignsAPI } from '../api';

export default function FrozenDesignsPage({ user }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const isAdmin = user?.role === 'admin';

  const load = useCallback(() => {
    setLoading(true);
    frozenDesignsAPI.list()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const release = async (id) => {
    if (!window.confirm('Release (unfreeze) this design? Future orders will no longer be flagged.')) return;
    await frozenDesignsAPI.release(id);
    load();
  };

  const statusLabel = (r) => r.is_active ? 'Active' : (r.release_reason === 'superseded' ? 'Superseded' : 'Released');

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginBottom: 16 }}>Frozen Designs</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #E5E7EB' }}>
            <th>Profile</th><th>Plant</th><th>Press</th><th>Cavity</th>
            <th>Status</th><th>Frozen At</th><th>Files</th>
            <th>Released ×N</th><th>Bypassed ×N</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
              <td>{r.profile_number}</td><td>{r.plant}</td><td>{r.press}</td><td>{r.cavity}</td>
              <td>{statusLabel(r)}</td>
              <td>{r.frozen_at ? new Date(r.frozen_at).toLocaleDateString() : '—'}</td>
              <td>
                {(r.files || []).map(f => (
                  <button key={f.id} type="button"
                    onClick={() => frozenDesignsAPI.downloadFile(f.id, f.original_name)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginRight: 8, color: '#1D4ED8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    <FileText size={13} /> {f.original_name}
                  </button>
                ))}
              </td>
              <td>Released ×{r.released_count}</td>
              <td>Bypassed ×{r.bypassed_count}</td>
              <td>
                {isAdmin && r.is_active && (
                  <button onClick={() => release(r.id)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fff', border: '1px solid #DC2626', color: '#DC2626', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>
                    <Unlock size={13} /> Release
                  </button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={10} style={{ padding: 16, color: '#6B7280' }}>No frozen designs yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
