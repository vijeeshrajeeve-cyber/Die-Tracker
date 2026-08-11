import React, { useEffect, useState } from 'react';
import { AlertTriangle, FileText } from 'lucide-react';
import { frozenDesignsAPI } from '../api';
import { BYPASS_REASONS } from '../utils/constants';

// Props: { profile, plant, press, cavity, onRelease(match), onBypass({reason, note, match}), infoOnly }
// Fires a /match lookup when the full key is present; renders nothing when no match.
// infoOnly: render the banner + details for awareness, without the Release/Proceed actions
// (used on the Backup Die Request page, which has no design-approval stages).
export default function FrozenDesignBanner({ profile, plant, press, cavity, onRelease, onBypass, infoOnly = false }) {
  const [match, setMatch] = useState(null);
  const [mode, setMode] = useState(null); // null | 'bypass'
  const [reason, setReason] = useState(BYPASS_REASONS[0]);
  const [note, setNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    const full = profile && plant && press && (cavity !== '' && cavity !== null && cavity !== undefined);
    const lookup = full ? frozenDesignsAPI.match({ profile, plant, press, cavity }) : Promise.resolve(null);
    lookup
      .then(r => { if (!cancelled) setMatch(r); })
      .catch(() => { if (!cancelled) setMatch(null); });
    return () => { cancelled = true; };
  }, [profile, plant, press, cavity]);

  // Require an id, not just a truthy object: Release stamps match.id onto the
  // order and skips the design stages, so a shapeless match must never render.
  if (!match?.id) return null;

  const noteRequired = reason === 'Other';
  const canBypass = !noteRequired || note.trim().length > 0;

  return (
    <div style={{ border: '1px solid #F59E0B', background: '#FFFBEB', borderRadius: 8, padding: 12, margin: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: '#92400E' }}>
        <AlertTriangle size={18} /> Frozen Design Available
      </div>
      <div style={{ fontSize: '0.85rem', color: '#78350F', marginTop: 4 }}>
        A finalized design exists for {profile} / {press} / cavity {cavity}. Frozen on {match.frozen_at ? new Date(match.frozen_at).toLocaleDateString() : '—'}.
      </div>
      {(match.supplier || match.die_size) && (
        <div style={{ fontSize: '0.8rem', color: '#78350F', marginTop: 4 }}>
          {match.supplier && <>Supplier: <strong>{match.supplier}</strong></>}
          {match.supplier && match.die_size && ' · '}
          {match.die_size && <>Die size: <strong>{match.die_size}</strong></>}
        </div>
      )}
      {infoOnly && (
        <div style={{ fontSize: '0.78rem', color: '#92400E', marginTop: 4, fontStyle: 'italic' }}>
          These details will pre-fill the die order PDF, and the design files will be merged into it on release.
        </div>
      )}
      {Array.isArray(match.files) && match.files.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {match.files.map(f => (
            <button key={f.id} type="button"
              onClick={() => frozenDesignsAPI.downloadFile(f.id, f.original_name)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', color: '#1D4ED8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              <FileText size={14} /> {f.original_name}
            </button>
          ))}
        </div>
      )}
      {!infoOnly && (
      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" onClick={() => onRelease && onRelease(match)}
          style={{ background: '#16A34A', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>
          Release Frozen Design
        </button>
        <button type="button" onClick={() => setMode(mode === 'bypass' ? null : 'bypass')}
          style={{ background: '#fff', color: '#92400E', border: '1px solid #F59E0B', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>
          Proceed with normal flow
        </button>
      </div>
      )}
      {!infoOnly && mode === 'bypass' && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: '0.8rem', color: '#78350F' }} htmlFor="frozendesignbanner-reason-required">Reason (required)</label>
          <select id="frozendesignbanner-reason-required" value={reason} onChange={e => setReason(e.target.value)}>
            {BYPASS_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <textarea aria-label="Note explaining the bypass" placeholder={noteRequired ? 'Note required for "Other"' : 'Optional note'}
            value={note} onChange={e => setNote(e.target.value)} rows={2} />
          <button type="button" disabled={!canBypass}
            onClick={() => onBypass && onBypass({ reason, note: note.trim(), match })}
            style={{ alignSelf: 'flex-start', background: canBypass ? '#92400E' : '#D1D5DB', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: canBypass ? 'pointer' : 'not-allowed' }}>
            Confirm normal flow
          </button>
        </div>
      )}
    </div>
  );
}
