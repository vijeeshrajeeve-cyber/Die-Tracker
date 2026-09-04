import React, { useState } from 'react';
import { X, Check, XCircle } from 'lucide-react';
import { qualityDiscrepanciesAPI } from '../../api';
import { QD_STATUSES } from '../../utils/constants';
import DatePickerField from '../DatePickerField';
import useDialog from '../../hooks/useDialog';
import { BRAND, BRAND_ALPHA } from '../../utils/brand';
import { todayLocal } from '../../utils/today.js';

const today = () => todayLocal();

// Records the verdict on the open FOC round.
//
// A pass leaves the QD where it is — closing it may need paperwork, so that
// stays a deliberate step. A fail must be answered with the QD's next status
// and a reason in the same submission: the round closes either way, and a QD
// left on 'FOC Received' with nothing further to receive belongs to nobody.
export default function FocTrialModal({ qd, theme = {}, onClose, onDone }) {
  const dialogRef = useDialog({ open: true, onClose });
  const round = qd.foc?.rounds?.length ? qd.foc.rounds[qd.foc.rounds.length - 1] : null;
  const receivedOn = round?.received_date ? String(round.received_date).slice(0, 10) : null;

  const [trialDate, setTrialDate] = useState(today());
  const [result, setResult] = useState('');
  const [notes, setNotes] = useState('');
  const [nextStatus, setNextStatus] = useState('Sent to Supplier');
  const [reason, setReason] = useState('');
  const [etaDate, setEtaDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const bg = theme.cardBg || '#09090b';
  const border = theme.cardBorder || '#27272a';
  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';
  const inputBg = theme.inputBg || '#09090b';

  const label = { fontSize: '0.72rem', fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' };
  const field = { padding: '9px 12px', background: inputBg, border: `1px solid ${border}`, borderRadius: 8, color: text, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box', width: '100%' };

  const failed = result === 'Fail';
  const needsEta = failed && nextStatus === 'FOC Accepted';
  const canSubmit = !!result && !!trialDate
    && (!failed || (!!nextStatus && !!reason.trim()))
    && (!needsEta || !!etaDate)
    && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      await qualityDiscrepanciesAPI.recordFocTrial(qd.id, {
        trialDate,
        result,
        notes: notes.trim() || undefined,
        nextStatus: failed ? nextStatus : undefined,
        reason: failed ? reason.trim() : undefined,
        etaDate: needsEta ? etaDate : undefined,
      });
      await onDone();
      onClose();
    } catch (e) {
      setError(e.message || 'Could not record the trial');
      setSubmitting(false);
    }
  };

  const verdict = (value, Icon, colour) => {
    const on = result === value;
    return (
      <button key={value} type="button" onClick={() => setResult(value)}
        style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '11px 14px', borderRadius: 10, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
          background: on ? `${colour}22` : inputBg,
          border: `1px solid ${on ? colour : border}`,
          color: on ? colour : muted,
        }}>
        <Icon size={16} /> {value}
      </button>
    );
  };

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}>
      <style>{`@keyframes qdTrialIn { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } }
        .qd-trial-cta:hover { filter: brightness(1.06); }`}</style>

      <div onClick={(e) => e.stopPropagation()}
        style={{ background: bg, border: `1px solid ${border}`, borderRadius: 16, width: 520, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', animation: 'qdTrialIn 0.2s ease-out', color: text }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '20px 24px', borderBottom: `1px solid ${border}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '1rem', fontWeight: 700 }}>Record FOC trial</div>
            <div style={{ fontSize: '0.8rem', color: dim, marginTop: 6 }}>
              QD {qd.qd_no} · round {round?.round_no ?? '—'}
              {receivedOn ? ` · received ${receivedOn}` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={label} htmlFor="foctrialmodal-trial-date">Trial date <span style={{ color: '#FCA5A5' }}>*</span></label>
            <DatePickerField id="foctrialmodal-trial-date" value={trialDate} theme={theme} onChange={setTrialDate} placeholder="Select trial date" />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={label}>Result <span style={{ color: '#FCA5A5' }}>*</span></label>
            <div style={{ display: 'flex', gap: 10 }}>
              {verdict('Pass', Check, '#34D399')}
              {verdict('Fail', XCircle, '#F87171')}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={label} htmlFor="foctrialmodal-trial-notes">Trial notes</label>
            <textarea id="foctrialmodal-trial-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder="e.g. same weld line at cavity 2 · optional"
              style={{ ...field, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
          </div>

          {failed && (
            <div style={{ border: `1px solid ${border}`, borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: '0.78rem', color: muted, lineHeight: 1.5 }}>
                This replacement failed, so round {round?.round_no ?? ''} is closed. Where does the QD go now?
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={label} htmlFor="foctrialmodal-next-status">Next status <span style={{ color: '#FCA5A5' }}>*</span></label>
                <select id="foctrialmodal-next-status" value={nextStatus} onChange={(e) => setNextStatus(e.target.value)} style={field}>
                  {QD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {needsEta && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={label} htmlFor="foctrialmodal-eta-for-the-next-replacement">ETA for the next replacement <span style={{ color: '#FCA5A5' }}>*</span></label>
                  <DatePickerField id="foctrialmodal-eta-for-the-next-replacement" value={etaDate} theme={theme} onChange={setEtaDate} placeholder="Select ETA" />
                  <span style={{ fontSize: '0.72rem', color: dim }}>Opens the next FOC round against this QD.</span>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={label} htmlFor="foctrialmodal-reason">Reason <span style={{ color: '#FCA5A5' }}>*</span></label>
                <textarea id="foctrialmodal-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                  placeholder="Why this status? e.g. supplier agreed to send a third die"
                  style={{ ...field, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
              </div>
            </div>
          )}

          {result === 'Pass' && (
            <div style={{ fontSize: '0.78rem', color: muted, lineHeight: 1.5 }}>
              The replacement is proven. The QD stays open — close it from the status menu once the paperwork is done.
            </div>
          )}

          {error && <div style={{ fontSize: '0.78rem', color: '#FCA5A5' }}>{error}</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: `1px solid ${border}` }}>
          <button onClick={onClose} style={{ padding: '9px 16px', background: bg, border: `1px solid ${border}`, borderRadius: 10, color: muted, fontWeight: 500, fontSize: '0.85rem', cursor: 'pointer' }}>Cancel</button>
          <button onClick={submit} disabled={!canSubmit} className="qd-trial-cta"
            style={{ padding: '9px 18px', background: BRAND.navy, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: '0.85rem', cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.55, boxShadow: `0 4px 12px ${BRAND_ALPHA.navyGlow}` }}>
            {submitting ? 'Saving…' : 'Record trial'}
          </button>
        </div>
      </div>
    </div>
  );
}
