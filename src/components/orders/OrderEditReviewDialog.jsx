import React, { useId, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import useDialog from '../../hooks/useDialog';
import { CAUSES, needsCause, normalizeEta } from '../../utils/deliveryFollowup';
import { changeNeedsReason, displayValue, fieldLabel, fieldType, REASON_MAX } from '../../utils/orderDetailEdits';
import { fileChangeNeedsReason } from '../../utils/orderFiles';
import { formatDate } from '../../utils/helpers';

// A value as the drawer shows it: dates formatted, blanks as a dash.
function shown(field, value) {
  const text = displayValue(field, value);
  if (text === null) return '—';
  const type = fieldType(field);
  if ((type === 'date' || type === 'datetext') && normalizeEta(text)) return formatDate(text);
  return text;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Opened by Save in the Order Details drawer. Lists every change, requires a
// reason when an existing value is changed or cleared or a file is replaced,
// and asks for the delivery cause when a set ETA moves. The server checks all
// of it again.
export default function OrderEditReviewDialog({ theme, dieNo, changes, fileChanges = [], fromEta, toEta, saving, error, onCancel, onConfirm }) {
  const titleId = useId();
  const dialogRef = useDialog({ open: true, onClose: onCancel, closeOnEscape: !saving });
  const [reason, setReason] = useState('');
  const [cause, setCause] = useState('');
  const [causeNote, setCauseNote] = useState('');

  const rows = [
    ...changes.map((c) => ({
      key: c.field, label: fieldLabel(c.field), before: shown(c.field, c.before), after: shown(c.field, c.after),
      needsReason: changeNeedsReason(c),
    })),
    ...fileChanges.map((c) => ({
      key: c.slot, label: c.label, before: c.before || '—', after: c.after, needsReason: fileChangeNeedsReason(c),
    })),
  ];
  const withReason = rows.filter((r) => r.needsReason);
  const withoutReason = rows.filter((r) => !r.needsReason);
  const reasonRequired = withReason.length > 0;
  const etaMoved = changes.some((c) => c.field === 'ETA') && needsCause(fromEta, toEta);
  const causeReady = !etaMoved || (!!cause && (cause !== 'other' || !!causeNote.trim()));
  const ready = !saving && causeReady && (!reasonRequired || !!reason.trim());

  const border = theme?.cardBorder || '#334155';
  const input = { width: '100%', padding: '9px 11px', background: theme?.inputBg || '#0F172A', border: `1px solid ${border}`, borderRadius: '8px', color: theme?.text || '#F1F5F9', fontSize: '0.875rem', boxSizing: 'border-box' };
  const heading = { margin: '0 0 4px', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: theme?.textDim || '#64748B' };

  const group = (title, list) => list.length > 0 && (
    <section>
      <h4 style={heading}>{title}</h4>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {list.map((r) => (
          <li key={r.key} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '6px 0', borderBottom: `1px solid ${border}`, fontSize: '0.84rem' }}>
            <span style={{ color: theme?.textDim || '#64748B', flexShrink: 0 }}>{r.label}</span>
            <span style={{ color: theme?.text || '#F1F5F9', textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>
              {r.before} <span aria-hidden="true">→</span> <strong>{r.after}</strong>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '1rem' }} onClick={(e) => e.stopPropagation()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        style={{ background: theme?.cardBg || '#1E293B', borderRadius: '16px', width: '100%', maxWidth: '480px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', border: `1px solid ${border}`, overflow: 'hidden' }}>
        <div style={{ padding: '1.1rem 1.5rem', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#10B981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ClipboardCheck size={18} color="white" />
          </div>
          <div>
            <h3 id={titleId} style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: theme?.text || '#F1F5F9' }}>Save changes to {dieNo}</h3>
            <p style={{ margin: 0, fontSize: '0.78rem', color: theme?.textDim || '#64748B' }}>
              {[
                changes.length > 0 && `${plural(changes.length, 'field')} changed`,
                fileChanges.length > 0 && `${plural(fileChanges.length, 'file')} to upload`,
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>

        <div style={{ padding: '1.1rem 1.5rem', overflowY: 'auto', display: 'grid', gap: '14px' }}>
          {group('Changed · needs a reason', withReason)}
          {group('No reason needed', withoutReason)}

          {etaMoved && (
            <section style={{ display: 'grid', gap: '8px' }}>
              <h4 style={heading}>Why did the ETA move? *</h4>
              <select aria-label="ETA change cause" value={cause} onChange={(e) => setCause(e.target.value)} style={input}>
                <option value="">Pick a cause…</option>
                {CAUSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <textarea aria-label="ETA cause note" rows={2} value={causeNote} onChange={(e) => setCauseNote(e.target.value)}
                placeholder={cause === 'other' ? 'Say what the cause is (required)' : 'Note (optional)'} style={{ ...input, resize: 'vertical' }} />
            </section>
          )}

          <section style={{ display: 'grid', gap: '6px' }}>
            <label htmlFor={`${titleId}-reason`} style={heading}>
              {reasonRequired ? 'Reason for changing existing values *' : 'Reason (optional)'}
            </label>
            <textarea id={`${titleId}-reason`} rows={3} maxLength={REASON_MAX} value={reason}
              onChange={(e) => setReason(e.target.value)} placeholder="Why are these values changing?"
              style={{ ...input, resize: 'vertical' }} />
          </section>

          {error && <p role="alert" style={{ margin: 0, fontSize: '0.82rem', color: '#F87171' }}>{error}</p>}
        </div>

        <div style={{ padding: '0 1.5rem 1.1rem', display: 'flex', justifyContent: 'flex-end', gap: '8px', flexShrink: 0 }}>
          <button type="button" onClick={onCancel} disabled={saving}
            style={{ padding: '8px 18px', background: 'transparent', border: `1px solid ${border}`, borderRadius: '8px', color: theme?.textDim || '#64748B', fontSize: '0.875rem', cursor: saving ? 'not-allowed' : 'pointer' }}>
            Cancel
          </button>
          <button type="button" disabled={!ready}
            onClick={() => onConfirm({ reason: reason.trim(), ...(etaMoved && { etaChange: { cause, note: causeNote.trim() } }) })}
            style={{ padding: '8px 18px', background: ready ? '#10B981' : '#334155', border: 'none', borderRadius: '8px', color: 'white', fontSize: '0.875rem', fontWeight: 600, cursor: ready ? 'pointer' : 'not-allowed' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
