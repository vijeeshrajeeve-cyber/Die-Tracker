import React, { useEffect, useId, useMemo, useState } from 'react';
import { usePalette } from '../../utils/palette';
import { designEnhancementsAPI, getUser } from '../../api';
import { VERDICTS, parseNumber, isBlank } from '../../utils/designEnhancement';
import {
  panelStage, resultRows, showNumber, validateVerdictForm, reviewOwedAfter, formNeedsReason, latestOkTrial, trialSuggestion, prefillDueDate,
} from '../../utils/enhancementVerdict';
import { todayLocal } from '../../utils/today.js';

const STAGE_TITLE = {
  waiting: 'Waiting for the sample result',
  trial: 'Trial verdict',
  review: 'Awaiting life review',
  done: 'Completed',
  cancelled: 'Cancelled',
};

const smallLabel = (p) => ({ display: 'block', marginBottom: '4px', fontSize: '0.72rem', fontWeight: 600, color: p.muted, letterSpacing: '0.04em' });
const inputStyle = (p, hasError) => ({
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: '8px', fontSize: '0.875rem',
  background: p.inset, color: p.text, border: `1px solid ${hasError ? p.danger : p.border}`, outline: 'none', fontFamily: 'inherit',
});

// The trial-verdict form and the life-review form. The values live here, in
// local state, so typing never fights a refetch; the parent keys this on the
// order and the form so a different one starts clean.
function VerdictForm({ form, order, row, suggestion, theme, onSaved, onCancel, onPreview }) {
  const p = usePalette(theme);
  const uid = useId();
  const id = (name) => `${uid}-${name}`;
  const [values, setValues] = useState({ verdict: '', remark: '', dueDate: '', failure: '', reason: '' });
  const [touched, setTouched] = useState({ verdict: false, dueDate: false });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const suggested = suggestion?.suggested ?? null;
  const set = (key, v) => setValues((cur) => ({ ...cur, [key]: v }));

  // Offer the suggestion and the default review date until the user picks their own.
  useEffect(() => {
    setValues((cur) => ({
      ...cur,
      verdict: touched.verdict ? cur.verdict : (suggested || cur.verdict),
      dueDate: touched.dueDate ? cur.dueDate : (prefillDueDate(row, suggestion) || cur.dueDate),
    }));
  }, [suggested, suggestion, row, touched.verdict, touched.dueDate]);

  // The life-review suggestion depends on the failure % typed, so tell the
  // panel to ask the server again once the box holds a valid one.
  useEffect(() => {
    if (form !== 'review' || !onPreview) return undefined;
    const n = parseNumber(values.failure);
    const timer = setTimeout(() => onPreview(!isBlank(values.failure) && !Number.isNaN(n) && n <= 100 ? String(n) : undefined), 300);
    return () => clearTimeout(timer);
  }, [form, values.failure, onPreview]);

  // The life-review suggestion is for one failure % at a time. Until the
  // suggestion on screen is for the one typed, saving would check the remark
  // rule against a stale suggestion, so Save waits.
  const typed = parseNumber(values.failure);
  const typedKey = !isBlank(values.failure) && !Number.isNaN(typed) && typed <= 100 ? String(typed) : undefined;
  const pending = form === 'review' && (!suggestion || suggestion.previewFor !== typedKey);

  const needsReason = formNeedsReason(form, row);
  const overriding = VERDICTS.includes(values.verdict) && values.verdict !== suggested;
  const showDue = form === 'trial' && reviewOwedAfter(values.verdict, row, order);

  const save = async () => {
    const checked = validateVerdictForm({ form, row, order, values, suggested, today: todayLocal() });
    setErrors(checked.errors);
    if (!checked.ok) return;
    setSaving(true);
    setFailure('');
    try {
      if (form === 'review') await designEnhancementsAPI.saveLifeReview(order.id, checked.body);
      else await designEnhancementsAPI.saveTrialVerdict(order.id, checked.body);
      await onSaved?.();
    } catch (error) {
      setFailure(error.message || 'Could not save the verdict');
    } finally {
      setSaving(false);
    }
  };

  const err = (msg) => msg && <span role="alert" style={{ display: 'block', marginTop: '3px', fontSize: '0.72rem', color: p.danger }}>{msg}</span>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {form === 'review' && (
        <div>
          <label htmlFor={id('failure')} style={smallLabel(p)}>Actual die failure (%) <span style={{ color: p.danger }}>*</span></label>
          <input id={id('failure')} type="text" inputMode="decimal" autoComplete="off" disabled={saving}
            aria-invalid={!!errors.failure} placeholder="not recorded" value={values.failure}
            onChange={(e) => set('failure', e.target.value)} style={inputStyle(p, !!errors.failure)} />
          {err(errors.failure)}
        </div>
      )}
      <div>
        <label htmlFor={id('verdict')} style={smallLabel(p)}>{form === 'review' ? 'Final verdict' : 'Verdict'} <span style={{ color: p.danger }}>*</span></label>
        <select id={id('verdict')} disabled={saving} aria-invalid={!!errors.verdict} value={values.verdict}
          onChange={(e) => { setTouched((t) => ({ ...t, verdict: true })); set('verdict', e.target.value); }}
          style={inputStyle(p, !!errors.verdict)}>
          <option value="">Choose a verdict…</option>
          {VERDICTS.map((v) => <option key={v} value={v}>{v}{v === suggested ? ' (suggested)' : ''}</option>)}
        </select>
        {err(errors.verdict)}
      </div>
      <div>
        <label htmlFor={id('remark')} style={smallLabel(p)}>Remark {overriding && <span style={{ color: p.danger }}>*</span>}</label>
        <textarea id={id('remark')} rows={2} maxLength={1000} disabled={saving} aria-invalid={!!errors.remark}
          value={values.remark} onChange={(e) => set('remark', e.target.value)}
          style={{ ...inputStyle(p, !!errors.remark), resize: 'vertical' }} />
        {err(errors.remark)}
      </div>
      {showDue && (
        <div>
          <label htmlFor={id('due')} style={smallLabel(p)}>Die failure % review due date <span style={{ color: p.danger }}>*</span></label>
          <input id={id('due')} type="date" min={todayLocal()} disabled={saving} aria-invalid={!!errors.dueDate}
            value={values.dueDate}
            onChange={(e) => { setTouched((t) => ({ ...t, dueDate: true })); set('dueDate', e.target.value); }}
            style={inputStyle(p, !!errors.dueDate)} />
          {err(errors.dueDate)}
        </div>
      )}
      {needsReason && (
        <div>
          <label htmlFor={id('reason')} style={smallLabel(p)}>Reason for this change <span style={{ color: p.danger }}>*</span></label>
          <input id={id('reason')} type="text" maxLength={500} disabled={saving} aria-invalid={!!errors.reason}
            value={values.reason} onChange={(e) => set('reason', e.target.value)} style={inputStyle(p, !!errors.reason)} />
          {err(errors.reason)}
        </div>
      )}
      {failure && <p role="alert" style={{ margin: 0, fontSize: '0.82rem', color: p.danger }}>{failure}</p>}
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={saving}
            style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, background: 'transparent', color: p.muted, border: `1px solid ${p.border}`, cursor: 'pointer' }}>Cancel</button>
        )}
        <button type="button" onClick={save} disabled={saving || pending}
          style={{ padding: '8px 18px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, background: p.primary, color: p.primaryText, border: 'none', cursor: saving || pending ? 'not-allowed' : 'pointer', opacity: saving || pending ? 0.6 : 1 }}>
          {saving ? 'Saving…' : form === 'review' ? 'Save life review' : 'Save trial verdict'}
        </button>
      </div>
    </div>
  );
}

/**
 * The Design enhancement result: Current / Target / Actual for the three
 * numbers, the suggested verdict, and the forms that record the trial verdict
 * and, when owed, the die failure % life review. `order` is the display-shaped
 * order, `enhancement` the stored row, `trials` the order's trials. Without
 * `canRecord` it is read-only; changing a saved verdict is admin-only and asks
 * for a reason. `onSaved` runs after a save so the caller can reload.
 */
export default function EnhancementResultPanel({ order, enhancement, trials = [], canRecord = false, theme = {}, onSaved }) {
  const p = usePalette(theme);
  const isAdmin = getUser()?.role === 'admin';
  const [change, setChange] = useState(null); // an admin redoing a saved verdict: 'trial' | 'review'
  const [fetched, setFetched] = useState(null); // { ...server suggestion, previewFor }
  const [previewFailure, setPreviewFailure] = useState(undefined);

  const stage = enhancement ? panelStage(enhancement, order) : null;
  const form = change || (stage === 'trial' ? 'trial' : stage === 'review' ? 'review' : null);
  const editable = Boolean(form) && canRecord && (!change || isAdmin);
  // Without Sample Followup access the trials are not loaded, so there is no Actual to show.
  const trialsHidden = !canRecord && !enhancement?.trial_verdict;

  // The latest OK trial moves the suggestion, so it is part of the key.
  const latest = latestOkTrial(trials);
  const trialKey = latest ? `${latest.id}:${latest.productivity_kgh}:${latest.recovery_pct}` : '';
  const asked = form === 'review' ? previewFailure : undefined;
  useEffect(() => {
    if (!form || !order?.id) return undefined;
    let cancelled = false;
    designEnhancementsAPI.suggestion(order.id, asked)
      .then((res) => { if (!cancelled) setFetched({ ...res, previewFor: asked }); })
      .catch(() => { if (!cancelled) setFetched({ suggested: null, previewFor: asked }); });
    return () => { cancelled = true; };
  }, [form, order?.id, trialKey, enhancement?.updated_at, asked]);

  // Changing a saved trial verdict while a life review is owed: the server's
  // suggestion is then the final-stage one, so the trial one is worked out here.
  const suggestion = useMemo(() => {
    if (!form || !fetched) return null;
    if (form === 'trial' && fetched.stage === 'final') return { ...fetched, suggested: trialSuggestion(enhancement, order, trials) };
    return fetched;
  }, [form, fetched, enhancement, order, trials]);

  const rows = useMemo(() => resultRows(enhancement, trials), [enhancement, trials]);
  if (!enhancement) return null;

  const cell = { padding: '6px 8px', fontSize: '0.85rem', color: p.text };
  const head = { padding: '4px 8px', fontWeight: 600, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: p.dim, textAlign: 'left' };
  const finish = async () => { setChange(null); setPreviewFailure(undefined); await onSaved?.(); };
  // A trial-stage final verdict repeats the trial verdict, so show it once.
  const showTrialLine = stage === 'review' || stage === 'cancelled' || (stage === 'done' && enhancement.life_review_date != null);

  const saved = (label, verdict, by, date, remark) => verdict && (
    <p style={{ margin: 0, fontSize: '0.85rem', color: p.text }}>
      <strong>{label}: {verdict}</strong>
      <span style={{ color: p.dim }}>{[by && ` by ${by}`, date && ` on ${String(date).slice(0, 10)}`].filter(Boolean).join('')}</span>
      {remark && <span style={{ display: 'block', color: p.muted }}>{remark}</span>}
    </p>
  );

  return (
    <section aria-label="Design enhancement result" style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: p.inset, border: `1px solid ${p.border}`, borderRadius: '12px', padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
        <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: p.text }}>Enhancement result</h4>
        <span style={{ fontSize: '0.75rem', color: p.dim }}>{STAGE_TITLE[stage]}</span>
      </div>

      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th scope="col" style={head}>Measure</th><th scope="col" style={head}>Current</th>
            <th scope="col" style={head}>Target</th><th scope="col" style={head}>Actual</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} style={{ borderTop: `1px solid ${p.border}` }}>
              <th scope="row" style={{ ...cell, fontWeight: 500, textAlign: 'left' }}>{r.name}</th>
              <td style={cell}>{showNumber(r.current, r.unit)}</td>
              <td style={{ ...cell, color: r.target === undefined ? p.dim : p.text }}>{r.target === undefined ? 'assessment not required' : showNumber(r.target, r.unit)}</td>
              <td style={cell}>{r.key === 'failure' && r.target === undefined ? '' : trialsHidden && r.key !== 'failure' ? '—' : showNumber(r.actual, r.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {trialsHidden && (
        <p style={{ margin: 0, fontSize: '0.78rem', color: p.dim }}>Trial numbers are visible to users with Sample Followup access</p>
      )}
      {stage === 'waiting' && (
        <p style={{ margin: 0, fontSize: '0.8rem', color: p.dim }}>The verdict can be recorded once the sample is Approved or Rejected</p>
      )}
      {stage === 'cancelled' && !enhancement.trial_verdict && (
        <p style={{ margin: 0, fontSize: '0.8rem', color: p.dim }}>A cancelled order cannot get a verdict.</p>
      )}

      {(stage === 'trial' || stage === 'review') && suggestion && (
        <p style={{ margin: 0, fontSize: '0.85rem', color: p.text }}>
          Suggested verdict: <strong>{suggestion.suggested || 'none (no numbers to compare)'}</strong>
        </p>
      )}

      {showTrialLine && saved('Trial verdict', enhancement.trial_verdict, enhancement.trial_verdict_by, enhancement.trial_verdict_date, enhancement.trial_verdict_remark)}
      {stage === 'review' && (
        <p style={{ margin: 0, fontSize: '0.8rem', color: p.warn }}>
          Die failure % review due {enhancement.life_review_due_date ? String(enhancement.life_review_due_date).slice(0, 10) : 'on a date not set'}
        </p>
      )}
      {stage === 'done' && enhancement.life_review_date != null && saved('Life review', enhancement.actual_failure_pct == null ? null : `${Number(enhancement.actual_failure_pct)}% failure`, enhancement.life_review_by, enhancement.life_review_date, enhancement.life_review_remark)}
      {stage === 'done' && saved('Final verdict', enhancement.final_verdict, enhancement.final_verdict_by, enhancement.final_verdict_date, enhancement.final_verdict_remark)}

      {editable && (
        <VerdictForm key={`${order.id}:${form}:${enhancement.updated_at || ''}`} form={form} order={order} row={enhancement}
          suggestion={suggestion} theme={theme} onSaved={finish} onPreview={setPreviewFailure} onCancel={change ? () => setChange(null) : undefined} />
      )}
      {(stage === 'trial' || stage === 'review') && !canRecord && (
        <p style={{ margin: 0, fontSize: '0.78rem', color: p.dim }}>You need Sample Followup access to record the verdict.</p>
      )}
      {stage === 'review' && canRecord && isAdmin && !change && (
        <div>
          <button type="button" onClick={() => setChange('trial')}
            style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, background: 'transparent', color: p.muted, border: `1px solid ${p.border}`, cursor: 'pointer' }}>
            Change trial verdict
          </button>
        </div>
      )}
      {stage === 'done' && canRecord && isAdmin && !change && (
        <div>
          <button type="button" onClick={() => setChange(enhancement.life_review_date != null ? 'review' : 'trial')}
            style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, background: 'transparent', color: p.muted, border: `1px solid ${p.border}`, cursor: 'pointer' }}>
            Change verdict
          </button>
        </div>
      )}
    </section>
  );
}
