import React, { useId } from 'react';
import { usePalette } from '../../utils/palette';

/**
 * The Design enhancement baseline form: the current issue, the dies referred
 * to, and a current/target pair for each of productivity, recovery and die
 * failure. `value` is the form text from utils/designEnhancement (numbers as
 * strings), `onChange` receives the whole next value, and `errors` is the
 * per-field map validateBaselineForm returns. The failure target only shows
 * once the assessment box is ticked. Pass `reasonRequired` after the die is
 * received, when an admin must say why. `assessmentLocked` freezes the
 * assessment box once a trial verdict exists.
 */
export default function EnhancementForm({
  value, onChange, errors = {}, activeDies = [], theme = {},
  reason = '', onReasonChange, reasonRequired = false, reasonError = '', disabled = false, assessmentLocked = false,
}) {
  const p = usePalette(theme);
  const uid = useId();
  const id = (name) => `${uid}-${name}`;
  const set = (key, v) => onChange({ ...value, [key]: v });
  const assessment = value.failure_assessment_required === true;

  const input = (hasError) => ({
    width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '8px', fontSize: '0.875rem',
    background: p.inset, color: p.text, border: `1px solid ${hasError ? p.danger : p.border}`, outline: 'none',
  });
  const label = { display: 'block', marginBottom: '4px', fontSize: '0.72rem', fontWeight: 600, color: p.muted, letterSpacing: '0.04em' };
  const errorText = (msg) => msg && <span role="alert" style={{ display: 'block', marginTop: '3px', fontSize: '0.72rem', color: p.danger }}>{msg}</span>;

  const number = (key, aria) => (
    <div>
      <input
        id={id(key)} type="text" inputMode="decimal" autoComplete="off" disabled={disabled}
        aria-label={aria} aria-invalid={!!errors[key]} placeholder="not recorded"
        value={value[key] ?? ''} onChange={(e) => set(key, e.target.value)} style={input(!!errors[key])}
      />
      {errorText(errors[key])}
    </div>
  );

  const row = (name, unit, baselineKey, targetKey) => (
    <>
      <span style={{ fontSize: '0.875rem', color: p.text, alignSelf: 'start', paddingTop: '9px' }}>{name} <span style={{ color: p.dim }}>({unit})</span></span>
      {number(baselineKey, `${name} current (${unit})`)}
      {targetKey ? number(targetKey, `${name} target (${unit})`) : <span />}
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', color: p.text }}>
      <div>
        <label htmlFor={id('issue')} style={label}>Current issue <span style={{ color: p.danger }}>*</span></label>
        <textarea
          id={id('issue')} rows={2} disabled={disabled} aria-invalid={!!errors.current_issue}
          value={value.current_issue ?? ''} onChange={(e) => set('current_issue', e.target.value)}
          style={{ ...input(!!errors.current_issue), resize: 'vertical', fontFamily: 'inherit' }}
        />
        {errorText(errors.current_issue)}
      </div>

      <div>
        <label htmlFor={id('refs')} style={label}>Existing dies referred (optional)</label>
        <input
          id={id('refs')} type="text" disabled={disabled} value={value.reference_dies ?? ''}
          onChange={(e) => set('reference_dies', e.target.value)} style={input(false)}
        />
        {activeDies.length > 0 && (
          <span style={{ display: 'block', marginTop: '4px', fontSize: '0.75rem', color: p.dim }}>
            Active dies of this profile: {activeDies.join(', ')}
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, auto) 1fr 1fr', gap: '8px 10px', alignItems: 'center' }}>
        <span />
        <span style={{ ...label, marginBottom: 0 }}>Current</span>
        <span style={{ ...label, marginBottom: 0 }}>Target</span>
        {row('Productivity', 'kg/h', 'baseline_productivity_kgh', 'target_productivity_kgh')}
        {row('Recovery', '%', 'baseline_recovery_pct', 'target_recovery_pct')}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.875rem', cursor: disabled ? 'default' : 'pointer' }}>
        <input
          type="checkbox" disabled={disabled || assessmentLocked} checked={assessment}
          onChange={(e) => set('failure_assessment_required', e.target.checked)}
          style={{ width: '18px', height: '18px', accentColor: p.primary }}
        />
        Die failure % assessment required
        {assessmentLocked && <span style={{ color: p.dim, fontSize: '0.75rem' }}>(fixed once the trial verdict is saved)</span>}
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, auto) 1fr 1fr', gap: '8px 10px', alignItems: 'center' }}>
        {row('Die failure', '%', 'baseline_failure_pct', assessment ? 'target_failure_pct' : null)}
      </div>

      {reasonRequired && (
        <div>
          <label htmlFor={id('reason')} style={label}>Reason for this change <span style={{ color: p.danger }}>*</span></label>
          <input
            id={id('reason')} type="text" maxLength={500} disabled={disabled} aria-invalid={!!reasonError}
            value={reason} onChange={(e) => onReasonChange && onReasonChange(e.target.value)} style={input(!!reasonError)}
          />
          {errorText(reasonError)}
        </div>
      )}
    </div>
  );
}
