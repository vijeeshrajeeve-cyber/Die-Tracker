import React, { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import useDialog from '../../hooks/useDialog';
import { usePalette } from '../../utils/palette';
import { designEnhancementsAPI, sampleTrialsAPI } from '../../api';
import {
  isEnhancement, formFromRow, validateBaselineForm, canMarkEnhancement, canEditBaseline,
  canRemoveEnhancement, markNeedsReason,
} from '../../utils/designEnhancement';
import EnhancementForm from './EnhancementForm';

const NOT_RECORDED = 'not recorded';
const show = (v, unit) => (v === null || v === undefined || v === '' ? NOT_RECORDED : `${Number(v)} ${unit}`);

// A centred dialog over the drawer. Portalled to <body>: the drawer panel is
// animated, and a transformed ancestor would pin a fixed child to the panel.
function Modal({ title, theme, busy, onClose, children, footer }) {
  const p = usePalette(theme);
  const titleId = useId();
  const dialogRef = useDialog({ open: true, onClose, closeOnEscape: !busy });
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '1rem' }}
      onClick={(e) => e.stopPropagation()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        style={{ background: p.bg, borderRadius: '16px', width: '100%', maxWidth: '560px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', border: `1px solid ${p.border}`, overflow: 'hidden' }}>
        <h3 id={titleId} style={{ margin: 0, padding: '1.1rem 1.5rem', borderBottom: `1px solid ${p.border}`, fontSize: '1rem', fontWeight: 700, color: p.text }}>{title}</h3>
        <div style={{ padding: '1.1rem 1.5rem', overflowY: 'auto' }}>{children}</div>
        <div style={{ padding: '0 1.5rem 1.1rem', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>{footer}</div>
      </div>
    </div>,
    document.body,
  );
}

const button = (p, primary, disabled) => ({
  padding: '8px 18px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
  background: primary ? p.primary : 'transparent', color: primary ? p.primaryText : p.muted,
  border: primary ? 'none' : `1px solid ${p.border}`,
});

// Mark the order (no enhancement yet) or edit its baseline.
function BaselineDialog({ order, enhancement, theme, onClose, onSaved }) {
  const p = usePalette(theme);
  const [form, setForm] = useState(() => formFromRow(enhancement));
  const [errors, setErrors] = useState({});
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const reasonRequired = markNeedsReason(order);

  const save = async () => {
    const checked = validateBaselineForm(form);
    setErrors(checked.errors);
    const noReason = reasonRequired && !reason.trim();
    setReasonError(noReason ? 'Give a reason for this change' : '');
    if (!checked.ok || noReason) return;
    setSaving(true);
    setFailure('');
    try {
      await designEnhancementsAPI.save(order.id, checked.value, reasonRequired ? reason.trim() : undefined);
      onSaved();
    } catch (error) {
      setFailure(error.message || 'Could not save the Design enhancement');
      setSaving(false);
    }
  };

  return (
    <Modal title={enhancement ? `Design enhancement: ${order['DIE NO']}` : `Mark ${order['DIE NO']} as a Design enhancement`}
      theme={theme} busy={saving} onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={saving} style={button(p, false, saving)}>Cancel</button>
          <button type="button" onClick={save} disabled={saving} style={button(p, true, saving)}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      )}>
      <EnhancementForm value={form} onChange={setForm} errors={errors} theme={theme} disabled={saving}
        reason={reason} onReasonChange={setReason} reasonRequired={reasonRequired} reasonError={reasonError} />
      {!enhancement && (
        <p style={{ margin: '12px 0 0', fontSize: '0.78rem', color: p.dim }}>
          Saving switches Simulation on for this order and keeps it on while the flag is set.
        </p>
      )}
      {failure && <p role="alert" style={{ margin: '12px 0 0', fontSize: '0.82rem', color: p.danger }}>{failure}</p>}
    </Modal>
  );
}

// Removing the flag always needs a reason; the change log keeps the baseline.
function RemoveDialog({ order, theme, onClose, onRemoved }) {
  const p = usePalette(theme);
  const fieldId = useId();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const ready = !saving && reason.trim() !== '';

  const remove = async () => {
    setSaving(true);
    setFailure('');
    try {
      await designEnhancementsAPI.remove(order.id, reason.trim());
      onRemoved();
    } catch (error) {
      setFailure(error.message || 'Could not remove the Design enhancement');
      setSaving(false);
    }
  };

  return (
    <Modal title={`Remove the Design enhancement from ${order['DIE NO']}`} theme={theme} busy={saving} onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={saving} style={button(p, false, saving)}>Cancel</button>
          <button type="button" onClick={remove} disabled={!ready}
            style={{ ...button(p, true, !ready), background: p.danger, color: '#fff' }}>{saving ? 'Removing…' : 'Remove'}</button>
        </>
      )}>
      <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: p.muted }}>
        The baseline and targets are deleted; the change log keeps a copy. Simulation stays as it is.
      </p>
      <label htmlFor={fieldId} style={{ display: 'block', marginBottom: '4px', fontSize: '0.72rem', fontWeight: 600, color: p.muted }}>
        Reason for removing it <span style={{ color: p.danger }}>*</span>
      </label>
      <textarea id={fieldId} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '8px', background: p.inset, color: p.text, border: `1px solid ${p.border}`, fontFamily: 'inherit', fontSize: '0.875rem', resize: 'vertical' }} />
      {failure && <p role="alert" style={{ margin: '12px 0 0', fontSize: '0.82rem', color: p.danger }}>{failure}</p>}
    </Modal>
  );
}

/**
 * The Design enhancement section of the order drawer: the switch, the saved
 * baseline (read-only), and the edit and remove actions, each gated by the
 * same rules the server enforces. `enhancement` is the stored row or null.
 * `onChanged` runs after a save or removal so the caller can reload.
 */
export default function EnhancementBlock({ order, enhancement, user, theme, onChanged }) {
  const p = usePalette(theme);
  const [dialog, setDialog] = useState(null); // 'mark' | 'edit' | 'remove'
  const on = isEnhancement(order);

  // Non-admins cannot remove the flag once a trial is logged, so count them.
  // An admin may always remove it, which spares the lookup.
  const needsTrialCount = on && user?.role !== 'admin';
  const [trialCount, setTrialCount] = useState(null);
  useEffect(() => {
    if (!needsTrialCount) return undefined;
    let cancelled = false;
    sampleTrialsAPI.getAll()
      .then((res) => {
        if (!cancelled) setTrialCount((res.sampleTrials || []).filter((t) => t.die_order_id === order.id).length);
      })
      .catch(() => { if (!cancelled) setTrialCount(null); });
    return () => { cancelled = true; };
  }, [needsTrialCount, order.id]);

  const canMark = canMarkEnhancement(order, user);
  const canEdit = canEditBaseline(order, user);
  // While the count is unknown, hold the action back; the server decides anyway.
  const canRemove = (!needsTrialCount || trialCount !== null) && canRemoveEnhancement(order, user, trialCount ?? 0);

  const switchDisabled = on ? !canRemove : !canMark;
  let hint = '';
  if (switchDisabled) {
    if (on) hint = 'Only an admin can remove it once a trial is logged.';
    else if (String(order.STATUS).toUpperCase() === 'CANCELLED') hint = 'A cancelled order cannot be a Design enhancement.';
    else hint = 'You cannot mark this order as a Design enhancement.';
  }

  const finish = () => { setDialog(null); onChanged?.(); };
  const cell = { fontSize: '0.875rem', color: p.text };

  return (
    <section aria-label="Design enhancement" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <label style={{
        display: 'flex', alignItems: 'center', gap: '10px', minHeight: '44px', padding: '0 14px', borderRadius: '10px',
        border: `1px solid ${p.border}`, color: p.text, fontSize: '0.875rem', cursor: switchDisabled ? 'not-allowed' : 'pointer', opacity: switchDisabled ? 0.7 : 1,
      }} title={hint || undefined}>
        <input type="checkbox" role="switch" checked={on} disabled={switchDisabled}
          onChange={() => setDialog(on ? 'remove' : 'mark')}
          style={{ width: '18px', height: '18px', accentColor: p.primary, cursor: 'inherit' }} />
        Design enhancement
      </label>
      {hint && <p style={{ margin: 0, fontSize: '0.78rem', color: p.dim }}>{hint}</p>}

      {on && enhancement && (
        <div style={{ background: p.inset, border: `1px solid ${p.border}`, borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '0.68rem', color: p.dim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Current issue</div>
            <div style={{ ...cell, overflowWrap: 'anywhere' }}>{enhancement.current_issue}</div>
          </div>
          {enhancement.reference_dies && (
            <div>
              <div style={{ fontSize: '0.68rem', color: p.dim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Existing dies referred</div>
              <div style={{ ...cell, overflowWrap: 'anywhere' }}>{enhancement.reference_dies}</div>
            </div>
          )}
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ color: p.dim, textAlign: 'left', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <th scope="col" style={{ padding: '4px 0', fontWeight: 600 }}>Measure</th>
                <th scope="col" style={{ padding: '4px 8px', fontWeight: 600 }}>Current</th>
                <th scope="col" style={{ padding: '4px 0', fontWeight: 600 }}>Target</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Productivity', 'kg/h', enhancement.baseline_productivity_kgh, enhancement.target_productivity_kgh],
                ['Recovery', '%', enhancement.baseline_recovery_pct, enhancement.target_recovery_pct],
                ['Die failure', '%', enhancement.baseline_failure_pct, enhancement.failure_assessment_required ? enhancement.target_failure_pct : undefined],
              ].map(([name, unit, current, target]) => (
                <tr key={name} style={{ borderTop: `1px solid ${p.border}`, color: p.text }}>
                  <th scope="row" style={{ padding: '6px 0', fontWeight: 500, textAlign: 'left' }}>{name}</th>
                  <td style={{ padding: '6px 8px' }}>{show(current, unit)}</td>
                  <td style={{ padding: '6px 0', color: target === undefined ? p.dim : p.text }}>
                    {target === undefined ? 'assessment not required' : show(target, unit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit && (
            <div>
              <button type="button" onClick={() => setDialog('edit')} style={button(p, false, false)}>Edit baseline</button>
            </div>
          )}
        </div>
      )}

      {dialog === 'mark' && <BaselineDialog order={order} enhancement={null} theme={theme} onClose={() => setDialog(null)} onSaved={finish} />}
      {dialog === 'edit' && <BaselineDialog order={order} enhancement={enhancement} theme={theme} onClose={() => setDialog(null)} onSaved={finish} />}
      {dialog === 'remove' && <RemoveDialog order={order} theme={theme} onClose={() => setDialog(null)} onRemoved={finish} />}
    </section>
  );
}
