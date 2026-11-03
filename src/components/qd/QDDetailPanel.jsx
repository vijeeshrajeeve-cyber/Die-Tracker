import React, { useState, useRef, useEffect } from 'react';
import {
  X, Flag, Send, Bell, Wrench,
  Calendar, Check, MessageSquare, Pencil, XCircle, Mail, ArrowUpCircle, CornerUpLeft, Repeat,
  Download, Eye, Undo2, AlertTriangle, ArrowRight, FlaskConical, ExternalLink, Ban,
} from 'lucide-react';
import { qualityDiscrepanciesAPI, getUser } from '../../api';
import { QD_STATUS_CONFIG, QD_STATUSES, QD_ACTIVITY_TONES, QD_OUTCOMES, QD_PROGRESS_FIELDS, QD_APPROVAL_BADGE, QD_IMPORTED_BADGE, QD_UNNUMBERED } from '../../utils/constants';
import { dialogs } from '../ui/DialogProvider';
import { dieDesignSignature, userSignature } from '../../utils/emailSignature';
import StatusChangeModal from './StatusChangeModal';
import FocTrialModal from './FocTrialModal';
import FocRounds from './FocRounds';
import QdJourneyStrip from './QdJourneyStrip';
import QdPhotoGrid from './QdPhotoGrid';
import QdCancelModal from './QdCancelModal';
import QDFormPreviewModal from './QDFormPreviewModal';
import DatePickerField from '../DatePickerField';
import useDialog from '../../hooks/useDialog';
import { BRAND, BRAND_ALPHA } from '../../utils/brand';


// Part-B's supplier_acceptance column only ever accepts these two values (or
// '' to clear) — the server rejects anything else with a 400.
const QD_YES_NO = ['Yes', 'No'];

// Activity rows store a lucide icon name; map the ones the app actually writes.
const ACTIVITY_ICON = {
  flag: Flag,
  send: Send,
  bell: Bell,
  wrench: Wrench,
  calendar: Calendar,
  check: Check,
  x: XCircle,
  pencil: Pencil,
  'message-square': MessageSquare,
};

// The drawer's tabs, in order. Issue opens first in every state.
const TABS = [
  { key: 'issue', label: 'Issue' },
  { key: 'photos', label: 'Photos' },
  { key: 'supplier', label: 'Supplier & FOC' },
  { key: 'die', label: 'Die' },
  { key: 'activity', label: 'Activity' },
];

const dateVal = (v) => (v ? String(v).slice(0, 10) : '');
const dateOnly = (v) => (v ? String(v).slice(0, 10) : '—');

const esc = (v) => String(v == null || v === '' ? '—' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Shared markup for the QD summary table used by both outbound emails.
// Deliberately omits our internal workflow status: it is our tracking
// vocabulary rather than anything the supplier can act on, and it is stale the
// moment the mail is read.
const detailsTable = (qd) => `
  <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;color:#0F172A;">
    <tbody>
      <tr><td style="padding:6px 12px;border:1px solid #CBD5E1;font-weight:600;">QD No</td><td style="padding:6px 12px;border:1px solid #CBD5E1;">${esc(qd.qd_no)}</td></tr>
      <tr><td style="padding:6px 12px;border:1px solid #CBD5E1;font-weight:600;">Die No</td><td style="padding:6px 12px;border:1px solid #CBD5E1;">${esc(qd.die_no)}</td></tr>
      <tr><td style="padding:6px 12px;border:1px solid #CBD5E1;font-weight:600;">Profile No</td><td style="padding:6px 12px;border:1px solid #CBD5E1;">${esc(qd.profile_number)}</td></tr>
      <tr><td style="padding:6px 12px;border:1px solid #CBD5E1;font-weight:600;">Plant</td><td style="padding:6px 12px;border:1px solid #CBD5E1;">${esc(qd.plant)}</td></tr>
      <tr><td style="padding:6px 12px;border:1px solid #CBD5E1;font-weight:600;">Date raised</td><td style="padding:6px 12px;border:1px solid #CBD5E1;">${esc(qd.raised_date)}</td></tr>
      <tr><td style="padding:6px 12px;border:1px solid #CBD5E1;font-weight:600;">Outcome sought</td><td style="padding:6px 12px;border:1px solid #CBD5E1;">${esc(qd.outcome)}</td></tr>
    </tbody>
  </table>`;

// The evidence images are rendered into the attached QD form itself, so the
// supplier needs no list of our internal filenames. This used to print
// "Supporting evidence on record: Screenshot ....png … Please attach any of
// these that are needed before sending" — an instruction to our own sender,
// mailed out to the supplier.
const fmtWhen = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' });
};

export default function QDDetailPanel({ qd, theme = {}, supplier = null, canApprove = false, nextQd = null, queueLeft = 0, onOpenNext, onOpenOrder, onCompose, onClose, onEdit, onChanged }) {
  const [tab, setTab] = useState('issue');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // column name being edited
  const [draft, setDraft] = useState('');
  const [pendingStatus, setPendingStatus] = useState(null);
  const [trialOpen, setTrialOpen] = useState(false);
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [sendBackReason, setSendBackReason] = useState('');
  // Nothing is fetched until this opens — a QD drawer must not pay for a
  // server-side PDF render that nobody asked for.
  const [previewOpen, setPreviewOpen] = useState(false);

  // Escape closes the drawer, but not while an inline fact edit is open — that
  // key already means "cancel this edit" (see the field's own onKeyDown), and a
  // document-level capture listener would otherwise beat it to the event.
  const dialogRef = useDialog({ open: true, onClose, closeOnEscape: !editing });
  const [approvers, setApprovers] = useState([]);
  const [approverId, setApproverId] = useState('');
  const [checks, setChecks] = useState(null);
  const [checksFailed, setChecksFailed] = useState(false);
  const fileRef = useRef(null);

  const me = getUser();
  const isOwner = !!me && qd.created_by === me.id;
  const isDraftOrSentBack = qd.approval_state === 'Draft' || qd.approval_state === 'SentBack';
  // The server decides per QD: being an approver is not enough once the raiser
  // has sent it to someone specific. Older responses only carried the
  // account-wide flag, so fall back to it.
  const mayApprove = qd.can_approve != null ? qd.can_approve : canApprove;
  const aBadge = QD_APPROVAL_BADGE[qd.approval_state] || null;
  const isPending = qd.approval_state === 'Pending';
  const isApproved = qd.approval_state === 'Approved';
  const isCancelled = qd.approval_state === 'Cancelled';
  const missing = qd.submit_missing || [];
  const canDecide = isPending && mayApprove;

  // Only needed while a QD is waiting to be sent, so it is fetched on demand
  // rather than with every drawer open. Defaults to whoever it went to last,
  // which is the usual answer when resubmitting something sent back.
  const needsApprover = isDraftOrSentBack && (isOwner || me?.role === 'admin');
  useEffect(() => {
    if (!needsApprover) return;
    let cancelled = false;
    qualityDiscrepanciesAPI.listApprovers()
      .then((r) => {
        if (cancelled) return;
        const list = r.approvers || [];
        setApprovers(list);
        setApproverId((prev) => prev || (list.some((a) => a.id === qd.assigned_approver) ? String(qd.assigned_approver) : ''));
      })
      .catch(() => { if (!cancelled) setApprovers([]); });
    return () => { cancelled = true; };
  }, [needsApprover, qd.id, qd.assigned_approver]);

  // Read when someone can actually decide, not on every drawer open: it looks up
  // signatures and settings that nobody else needs.
  useEffect(() => {
    if (!canDecide) return undefined;
    let cancelled = false;
    qualityDiscrepanciesAPI.approvalCheck(qd.id)
      .then((r) => { if (!cancelled) setChecks(r.checks || []); })
      .catch(() => { if (!cancelled) setChecksFailed(true); });
    return () => { cancelled = true; };
  }, [canDecide, qd.id]);

  const bg = theme.cardBg || '#09090b';
  const border = theme.cardBorder || '#27272a';
  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';
  const surfaceHover = theme.rowHover || 'rgba(255,255,255,0.06)';
  const inputBg = theme.inputBg || '#09090b';
  const primary = theme.primary || '#fafafa';
  const primaryFg = theme.primaryText || '#18181b';
  const mono = "'JetBrains Mono', ui-monospace, monospace";

  const sc = QD_STATUS_CONFIG[qd.status] || QD_STATUS_CONFIG.Open;
  const label = { fontSize: 10.5, fontWeight: 700, color: dim, textTransform: 'uppercase', letterSpacing: '0.06em' };
  const sectionLabel = { fontSize: 11, fontWeight: 700, color: dim, textTransform: 'uppercase', letterSpacing: '0.06em' };

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  // Status changes go through a modal so the reason (and the ETA, for a FOC)
  // is captured and recorded rather than the change happening silently.
  const changeStatus = (e) => {
    const value = e.target.value;
    if (value === qd.status) return;
    setPendingStatus(value);
  };

  const postNote = () => {
    const trimmed = note.trim();
    if (!trimmed || busy) return;
    run(async () => {
      await qualityDiscrepanciesAPI.addNote(qd.id, trimmed);
      setNote('');
    });
  };

  const onFilesChosen = (e) => {
    const chosen = e.target.files;
    if (!chosen || !chosen.length) return;
    run(() => qualityDiscrepanciesAPI.uploadFiles(qd.id, chosen));
  };

  // Both mail actions open the compose modal pre-filled — they never send on
  // their own. The timeline entry is written from onSent, so it only records
  // mail that actually went out.
  const composeEmail = () => {
    if (!onCompose) return setError('Email compose is not available from this page.');
    onCompose({
      to: supplier?.contact_email || '',
      subject: `QD ${qd.qd_no} — Die ${qd.die_no} — quality discrepancy raised`,
      isHtml: true,
      // The server renders and attaches this QD's form; the client only names
      // the record, never a file path.
      qdId: qd.id,
      attachmentName: `QD-${qd.qd_no || qd.id}.pdf`,
      body: `
        <p>Dear ${esc(qd.supplier)} Team,</p>
        <p>We have raised a quality discrepancy against the die detailed below, supplied by you.
           The full Quality Discrepancy form, including the production parameters and the
           supporting images, is attached.</p>
        ${detailsTable(qd)}
        <p style="margin-bottom:4px"><strong>Quality issue observed</strong></p>
        <p style="margin-top:0">${esc(qd.issue_detail || qd.issue_summary).replace(/\n/g, '<br/>')}</p>
        <p>Please review the attached form and confirm your acceptance, the corrective action
           you propose, and the expected date of completion.</p>
        ${userSignature(me)}`,
      onSent: async () => {
        await qualityDiscrepanciesAPI.addNote(qd.id, `emailed ${qd.supplier} the QD details`, 'email');
        onChanged();
      },
    });
  };

  const composeReminder = () => {
    if (!onCompose) return setError('Email compose is not available from this page.');
    const days = qd.age_days;
    onCompose({
      to: supplier?.contact_email || '',
      importance: 'high',
      subject: `REMINDER: QD ${qd.qd_no} — Die ${qd.die_no} — awaiting your response`,
      isHtml: true,
      qdId: qd.id,
      attachmentName: `QD-${qd.qd_no || qd.id}.pdf`,
      body: `
        <p>Dear ${esc(qd.supplier)} Team,</p>
        <p>We refer to the quality discrepancy below, raised
           <strong>${days} day${days === 1 ? '' : 's'}</strong> ago and still open.
           The Quality Discrepancy form is attached again for your reference.</p>
        ${detailsTable(qd)}
        <p style="margin-bottom:4px"><strong>Quality issue observed</strong></p>
        <p style="margin-top:0">${esc(qd.issue_detail || qd.issue_summary).replace(/\n/g, '<br/>')}</p>
        <p>We have not yet received your confirmation${qd.eta_date ? '' : ' or an expected completion date'}.
           We would appreciate your response at the earliest so this can be closed out.</p>
        ${dieDesignSignature()}`,
      onSent: async () => {
        await qualityDiscrepanciesAPI.addNote(
          qd.id, `reminder sent to ${qd.supplier} — no response after ${days} day${days === 1 ? '' : 's'}`, 'reminder'
        );
        onChanged();
      },
    });
  };

  // No supplier contact on file is common right now, so say where mail will go
  // rather than opening a draft with a mysteriously empty To field.
  const mailTitle = supplier?.contact_email
    ? `Opens a draft to ${supplier.contact_email}`
    : `No contact email on file for ${qd.supplier} — add one in Settings, or type it into the draft`;

  // Part-A facts live on the Issue tab, Part-B and the hand-off dates on the
  // Supplier & FOC tab. Age is derived from the dates, so it stays read-only;
  // the answers given when raising are changed through Edit QD, not in place.
  const issueFacts = [
    { label: 'Manufacturing defect', value: qd.manufacturing_defect || '—' },
    { label: 'Die performance', value: qd.die_performance || '—' },
    { label: 'Recommended action', value: qd.recommended_action || '—' },
    { label: 'Corrector', value: qd.corrector || '—', field: 'corrector', type: 'text', current: qd.corrector || '', placeholder: 'e.g. Sijith' },
    { label: 'Outcome sought', value: qd.outcome || '—', field: 'outcome', type: 'select', current: qd.outcome || '' },
    { label: 'Input at failure', value: qd.input_at_failure || '—', field: 'input_at_failure', type: 'text', current: qd.input_at_failure || '', placeholder: 'e.g. 3,417 kg' },
    ...(qd.billets || []).map((b) => ({
      label: `${b.billet === 'first' ? 'First' : 'Last'} billet`,
      value: [b.billet_temp && `${b.billet_temp} °C`, b.running_pressure && `${b.running_pressure} bar`].filter(Boolean).join(' · ') || '—',
    })),
    { label: 'Age', value: qd.closed_at ? 'Settled' : `${qd.age_days} days` },
  ];
  const supplierFacts = [
    { label: 'ETA from supplier', value: qd.eta_display || '—', field: 'eta_date', type: 'date', current: qd.eta_date ? String(qd.eta_date).slice(0, 10) : '' },
    // Part-B — filled in once the supplier has responded.
    { label: 'Supplier acceptance', value: qd.supplier_acceptance || '—', field: 'supplier_acceptance', type: 'select', options: QD_YES_NO, current: qd.supplier_acceptance || '' },
    { label: 'Action taken', value: qd.action_taken || '—', field: 'action_taken', type: 'text', current: qd.action_taken || '', placeholder: 'e.g. Die reworked and re-trialled' },
    { label: 'Supplier comments', value: qd.supplier_comments || '—', field: 'supplier_comments', type: 'text', current: qd.supplier_comments || '', placeholder: 'Supplier\'s remarks' },
    { label: 'Received by (supplier)', value: qd.received_by_supplier || '—', field: 'received_by_supplier', type: 'text', current: qd.received_by_supplier || '', placeholder: 'e.g. Name of contact' },
    {
      label: 'QD requested',
      value: dateOnly(qd.qd_requested_date),
      field: 'qd_requested_date', type: 'date',
      current: dateVal(qd.qd_requested_date),
    },
    {
      label: 'Sent to purchase',
      value: dateOnly(qd.sent_to_purchase_date),
      field: 'sent_to_purchase_date', type: 'date',
      current: dateVal(qd.sent_to_purchase_date),
      hint: qd.handoff?.toPurchase === null || qd.handoff?.toPurchase === undefined
        ? null : `${qd.handoff.toPurchase}d after raising`,
    },
    {
      label: 'Sent to supplier',
      value: dateOnly(qd.sent_to_supplier_date),
      field: 'sent_to_supplier_date', type: 'date',
      current: dateVal(qd.sent_to_supplier_date),
      hint: qd.handoff?.purchaseToSupplier === null || qd.handoff?.purchaseToSupplier === undefined
        ? (qd.handoff?.toSupplier == null ? null : `${qd.handoff.toSupplier}d after raising`)
        : `${qd.handoff.purchaseToSupplier}d after purchase`,
    },
  ];
  const dieFacts = [
    { label: 'Die no', value: qd.die_no || '—' },
    { label: 'Profile', value: qd.profile_number || '—' },
    { label: 'Plant', value: qd.plant || '—' },
    { label: 'Supplier', value: qd.supplier || '—' },
    { label: 'Press', value: qd.press || '—' },
    { label: 'Die type', value: qd.die_type || '—' },
    { label: 'Die size', value: qd.die_size || '—' },
    { label: 'Cavities', value: qd.no_of_cavity || '—' },
    { label: 'Tooling', value: qd.tooling || '—' },
  ];
  const facts = [...issueFacts, ...supplierFacts];

  const startEdit = (f) => { setEditing(f.field); setDraft(f.current); };
  const cancelEdit = () => { setEditing(null); setDraft(''); };
  // valueOverride lets the date picker commit the date it just produced,
  // without waiting for the draft state to settle.
  const commitEdit = async (field, valueOverride) => {
    const value = valueOverride === undefined ? draft : valueOverride;
    const original = facts.find(f => f.field === field)?.current ?? '';
    if (value === original) return cancelEdit();
    setBusy(true);
    setError('');
    try {
      await qualityDiscrepanciesAPI.update(qd.id, { [field]: value });
      cancelEdit();
      await onChanged();
    } catch (e) {
      setError(e.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  // Approval actions — each shows the busy spinner via `run`, and refreshes the
  // drawer/list through onChanged so the new state and badge appear immediately.
  const handleSubmit = () => run(() => qualityDiscrepanciesAPI.submit(qd.id, Number(approverId)));

  // A failed Purchase email must not hide that the approval itself went
  // through, so this reports the warning after refreshing rather than via `run`'s
  // catch (which would skip onChanged and make it look like approval failed).
  const handleApprove = async () => {
    const warnings = (checks || []).filter((c) => !c.ok);
    if (warnings.length) {
      const ok = await dialogs.confirm({
        title: `Approve QD ${qd.qd_no} anyway?`,
        message: warnings.map((w) => w.label).join('. ') + '.',
        confirmLabel: 'Approve anyway',
        tone: 'warning',
      });
      if (!ok) return;
    }
    // Taken before the refresh, which removes this QD from the queue and moves on
    // the props. A failed email stays here so the warning is seen; the Next button
    // on the approved QD carries on from there.
    const next = nextQd;
    setBusy(true);
    setError('');
    try {
      const r = await qualityDiscrepanciesAPI.approve(qd.id);
      await onChanged();
      if (r?.emailWarning) setError(`Approved, but the Purchase email failed: ${r.emailWarning}`);
      else if (next && onOpenNext) onOpenNext(next.id);
    } catch (e) {
      setError(e.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const handleResend = () => run(() => qualityDiscrepanciesAPI.resendPurchase(qd.id));

  // Only for a QD brought in by the importer (the server refuses any other).
  // It exists so a wrong import can be redone, which is why it takes everything
  // recorded since with it.
  const handleUndoImport = async () => {
    const ok = await dialogs.confirm({
      title: `Undo import of QD ${qd.qd_no}`,
      message: 'This QD leaves the register together with everything recorded on it since it was imported: status changes, notes, FOC rounds and attachments. Its number becomes free to import again.',
      confirmLabel: 'Undo import',
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await qualityDiscrepanciesAPI.undoImport(qd.id);
      onClose();
      await onChanged();
    } catch (e) {
      setError(e.message || 'Could not undo the import');
      setBusy(false);
    }
  };

  // Streams the rendered QD form as a PDF — doesn't touch any data, so it
  // skips the onChanged refresh that `run` would otherwise trigger.
  const handleDownloadDocument = async () => {
    setBusy(true);
    setError('');
    try {
      await qualityDiscrepanciesAPI.downloadDocument(qd.id, qd.qd_no);
    } catch (e) {
      setError(e.message || 'Could not download the document');
    } finally {
      setBusy(false);
    }
  };

  // Mirrors handleApprove: the send-back itself has already happened, so a
  // failure to notify the raiser is reported after the refresh rather than
  // through `run`'s catch, which would make it look like nothing was sent back.
  const submitSendBack = async () => {
    if (!sendBackReason.trim()) return;
    setBusy(true);
    setError('');
    try {
      const r = await qualityDiscrepanciesAPI.sendBack(qd.id, sendBackReason.trim());
      setSendBackOpen(false);
      setSendBackReason('');
      await onChanged();
      if (r?.emailWarning) setError(`Sent back, but the raiser was not notified: ${r.emailWarning}`);
    } catch (e) {
      setError(e.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const secondaryBtn = { padding: '8px 14px', background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, fontWeight: 500, fontSize: 13, cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 };
  const primaryBtn = { ...secondaryBtn, background: primary, border: 'none', color: primaryFg, fontWeight: 600 };
  const stepCard = { border: `1px solid ${border}`, borderRadius: 8, padding: 16, marginBottom: 20 };
  const stepTitle = { fontSize: 14, fontWeight: 700, marginBottom: 10 };

  // One fact card. Editable ones open an inline editor on click.
  const renderFact = (f) => {
            const isEditing = editing === f.field;
            // Part-A fields stop being editable once the QD is out for approval,
            // and progress fields open only once it is approved. The server
            // refuses both with a 409, so don't offer the pencil.
            const editable = !!f.field && (QD_PROGRESS_FIELDS.has(f.field) ? isApproved : isDraftOrSentBack);
            const fieldStyle = {
              width: '100%', marginTop: 4, padding: '5px 8px', background: inputBg,
              border: `1px solid ${theme.accent || '#3B82F6'}`, borderRadius: 6, color: text,
              fontSize: 13, outline: 'none', boxSizing: 'border-box',
            };
            return (
              <div key={f.label}
                onClick={() => { if (editable && !isEditing) startEdit(f); }}
                title={editable && !isEditing ? `Click to edit ${f.label.toLowerCase()}` : undefined}
                className={editable && !isEditing ? 'qd-fact' : undefined}
                style={{ border: `1px solid ${border}`, borderRadius: 8, padding: '12px 14px', cursor: editable && !isEditing ? 'pointer' : 'default', position: 'relative' }}>
                <div style={{ ...label, display: 'flex', alignItems: 'center', gap: 5 }}>
                  {f.label}
                  {editable && !isEditing && <Pencil size={9} className="qd-fact-pen" style={{ opacity: 0, transition: 'opacity .15s ease' }} />}
                </div>

                {!isEditing && <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 4 }}>{f.value}</div>}
                {!isEditing && f.hint && (
                  <div style={{ fontSize: 10.5, color: dim, marginTop: 2 }}>{f.hint}</div>
                )}

                {isEditing && f.type === 'select' && (
                  <select aria-label={f.label} autoFocus value={draft} disabled={busy} style={{ ...fieldStyle, cursor: 'pointer' }}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commitEdit(f.field)}
                    onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); }}>
                    <option value="">—</option>
                    {(f.options || QD_OUTCOMES).map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}

                {isEditing && f.type === 'date' && (
                  <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 4 }}
                    // Escape cancels the edit, as it does in the text and select
                    // editors. The picker stops the event itself while its
                    // calendar is open, so that keypress only dismisses the popover.
                    onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cancelEdit(); } }}>
                    {/* The shared picker commits the date it produces directly —
                        it also provides Today and Clear. */}
                    <DatePickerField
                      autoFocus
                      aria-label={f.label}
                      value={draft}
                      theme={theme}
                      disabled={busy}
                      onChange={(iso) => commitEdit(f.field, iso)}
                    />
                  </div>
                )}

                {isEditing && f.type === 'text' && (
                  <input aria-label={f.label} autoFocus type="text" value={draft} disabled={busy}
                    placeholder={f.placeholder} style={fieldStyle}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commitEdit(f.field)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit(f.field);
                      if (e.key === 'Escape') cancelEdit();
                    }} />
                )}
              </div>
            );
  };

  const canSend = !missing.length && !!approverId;
  const approveLabel = nextQd ? 'Approve & next' : 'Approve & send to Purchase';
  const waitingDays = qd.submitted_at
    ? Math.max(0, Math.floor((Date.now() - new Date(qd.submitted_at).getTime()) / 86400000))
    : null;
  const waitingFor = waitingDays === null ? ''
    : waitingDays === 0 ? ' · submitted today'
      : ` · submitted ${waitingDays} day${waitingDays === 1 ? '' : 's'} ago`;

  return (
    <>
      <style>{`@keyframes qdSlideIn { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } }
        .qd-chip:hover { background: ${surfaceHover}; }
        .qd-action { transition: all .15s ease; }
        .qd-action:hover { background: ${surfaceHover}; color: ${text}; }
        .qd-fact { transition: border-color .15s ease, background .15s ease; }
        .qd-fact:hover { border-color: ${theme.accent || '#3B82F6'} !important; background: ${surfaceHover}; }
        .qd-fact:hover .qd-fact-pen { opacity: 1 !important; }
        .qd-sendback-cta:hover { filter: brightness(1.06); }
        .qd-cancel-link:hover { color: #FCA5A5 !important; text-decoration: underline; }`}</style>

      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex: 200 }} />

      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Quality discrepancy ${qd.qd_no || ''}`} tabIndex={-1} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 840, maxWidth: '92vw', background: bg, borderLeft: `1px solid ${border}`, zIndex: 201, overflowY: 'auto', padding: '28px 32px', animation: 'qdSlideIn 0.2s ease-out', color: text, boxSizing: 'border-box' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h2 style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, margin: 0 }}>{qd.qd_no ? `QD ${qd.qd_no}` : 'QD · unnumbered'}</h2>
              <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: sc.bg, color: sc.fg }}>{qd.status}</span>
              {aBadge && (
                <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: aBadge.bg, color: aBadge.fg }}>{aBadge.label}</span>
              )}
              {qd.imported && (
                <span title="Brought in from an existing QD form" style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: QD_IMPORTED_BADGE.bg, color: QD_IMPORTED_BADGE.fg }}>{QD_IMPORTED_BADGE.label}</span>
              )}
            </div>
            <div style={{ fontSize: 13, color: dim, marginTop: 6 }}>
              Die <span style={{ fontFamily: mono, fontWeight: 600, color: muted }}>{qd.die_no}</span>
              {' · '}{qd.supplier}{' · '}{qd.plant}{' · '}Raised {qd.raised_date}
              {qd.corrector ? ` · by ${qd.corrector}` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ width: 34, height: 34, background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={16} />
          </button>
        </div>

        {/* Where the QD is and whether it is late, before anything else. */}
        <QdJourneyStrip qd={qd} theme={theme} />

        {/* Reading the form changes nothing, so these are there in every state. */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => setPreviewOpen(true)} className="qd-action" title="Read the QD form without leaving the app"
            style={{ ...secondaryBtn, cursor: 'pointer' }}>
            <Eye size={15} /> Preview QD form
          </button>
          <button onClick={handleDownloadDocument} disabled={busy} className="qd-action" title="Download the QD form as a PDF"
            style={secondaryBtn}>
            <Download size={15} /> Download QD PDF
          </button>
          {me?.role === 'admin' && qd.imported && (
            <button onClick={handleUndoImport} disabled={busy} className="qd-action" title="Remove this imported QD so it can be imported again correctly"
              style={{ ...secondaryBtn, border: '1px solid rgba(239,68,68,0.35)', color: '#FCA5A5' }}>
              <Undo2 size={15} /> Undo import
            </button>
          )}
          {/* Withdrawing an unapproved QD. Quiet on purpose: it is the rare exit. */}
          {qd.can_cancel && !isCancelled && (
            <button type="button" onClick={() => setCancelOpen(true)} disabled={busy} className="qd-cancel-link"
              style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: dim, fontSize: 12.5, cursor: busy ? 'wait' : 'pointer', padding: '4px 2px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Ban size={13} /> Cancel QD
            </button>
          )}
        </div>

        {isCancelled && (
          <div style={{ border: `1px solid ${border}`, background: 'rgba(113,113,122,0.08)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: muted }}>
            <strong>Cancelled</strong>{qd.cancelled_at ? ` ${dateOnly(qd.cancelled_at)}` : ''}{qd.cancelled_by_name ? ` by ${qd.cancelled_by_name}` : ''}{qd.cancel_reason ? ` — ${qd.cancel_reason}` : ''}
          </div>
        )}

        {qd.approval_state === 'SentBack' && qd.sent_back_reason && (
          <div style={{ border: `1px solid rgba(239,68,68,0.35)`, background: 'rgba(239,68,68,0.08)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#FCA5A5' }}>
            <strong>Sent back:</strong> {qd.sent_back_reason}
          </div>
        )}

        {/* The next step, decided by the approval state. */}
        {needsApprover && (
          <div style={stepCard}>
            <div style={stepTitle}>{qd.approval_state === 'SentBack' ? 'Fix and resubmit' : 'Finish and submit'}</div>
            {missing.length > 0 ? (
              <div style={{ marginBottom: 12, fontSize: 13, color: '#EAB308' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Still needed before this can be submitted:</div>
                {missing.map((m) => (
                  <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    <AlertTriangle size={13} style={{ flexShrink: 0 }} /> {m}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ marginBottom: 12, fontSize: 13, color: '#22C55E', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Check size={14} /> Everything required is filled in.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {onEdit && (
                <button onClick={onEdit} disabled={busy} className={missing.length ? undefined : 'qd-action'} title="Edit this QD's details and images"
                  style={missing.length ? primaryBtn : secondaryBtn}>
                  <Pencil size={15} /> Edit QD
                </button>
              )}
              <select aria-label="Approver" value={approverId} onChange={(e) => setApproverId(e.target.value)} disabled={busy || !approvers.length}
                title="Who should approve this QD"
                style={{ padding: '8px 12px', background: bg, border: `1px solid ${border}`, borderRadius: 8, color: approverId ? text : muted, fontSize: 13, fontWeight: 500, cursor: busy ? 'wait' : 'pointer' }}>
                <option value="">{approvers.length ? 'Send to approver…' : 'No approvers configured'}</option>
                {approvers.map((a) => <option key={a.id} value={a.id}>{a.username}</option>)}
              </select>
              <button onClick={handleSubmit} disabled={busy || !canSend}
                title={missing.length ? 'Fill in what is still needed first' : (approverId ? '' : 'Choose who should approve this QD first')}
                style={{ ...(canSend ? primaryBtn : { ...primaryBtn, background: border, color: muted }), cursor: busy ? 'wait' : (canSend ? 'pointer' : 'not-allowed') }}>
                <ArrowUpCircle size={15} /> {qd.approval_state === 'SentBack' ? 'Resubmit for approval' : 'Submit for approval'}
              </button>
            </div>
          </div>
        )}

        {!needsApprover && qd.approval_state === 'SentBack' && (
          <div style={{ ...stepCard, fontSize: 13, color: muted }}>
            Waiting for {qd.prepared_by || 'the raiser'} to fix and resubmit this QD.
          </div>
        )}

        {!needsApprover && qd.approval_state === 'Draft' && (
          <div style={{ ...stepCard, fontSize: 13, color: muted }}>
            This QD is still a draft. {qd.prepared_by || 'The raiser'} has not submitted it.
          </div>
        )}

        {/* Who a pending QD is sitting with, so the raiser knows who to chase
            and another approver knows why they cannot act on it. */}
        {isPending && !(canDecide && qd.assigned_approver === me?.id) && (
          <div style={{ border: `1px solid rgba(234,179,8,0.35)`, background: 'rgba(234,179,8,0.08)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#EAB308' }}>
            <strong>Awaiting approval{qd.assigned_approver_name ? ` from: ${qd.assigned_approver_name}` : ''}</strong>{waitingFor}
            {!mayApprove && qd.assigned_approver_name && '. Only they can approve or send it back.'}
          </div>
        )}

        {canDecide && (
          <div style={stepCard}>
            <div style={stepTitle}>Your decision{waitingFor}</div>
            {checksFailed && (
              <div style={{ marginBottom: 12, fontSize: 13, color: '#EAB308' }}>Could not run the pre-approval checks. Read the form before deciding.</div>
            )}
            {checks && (
              <div style={{ marginBottom: 12, fontSize: 13 }}>
                {checks.map((c) => (
                  <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, color: c.ok ? muted : '#EAB308' }}>
                    {c.ok ? <Check size={13} style={{ color: '#22C55E', flexShrink: 0 }} /> : <AlertTriangle size={13} style={{ flexShrink: 0 }} />}
                    {c.label}
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginBottom: 12, fontSize: 12.5, color: dim }}>
              Approving signs this as Authorized By and releases it for the supplier.
              {queueLeft > 0 && ` ${queueLeft} more waiting for you after this.`}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={handleApprove} disabled={busy}
                style={{ ...primaryBtn, background: '#22C55E', color: '#052e16' }}>
                <Check size={15} /> {approveLabel}
              </button>
              <button onClick={() => setSendBackOpen(true)} disabled={busy} className="qd-action" style={secondaryBtn}>
                <CornerUpLeft size={15} /> Send back
              </button>
            </div>
          </div>
        )}

        {isApproved && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={composeEmail} className={qd.status === 'Open' ? undefined : 'qd-action'} title={mailTitle}
              style={{ ...(qd.status === 'Open' ? primaryBtn : secondaryBtn), cursor: 'pointer' }}>
              <Mail size={15} /> Email supplier
            </button>
            {!qd.closed_at && (
              <button onClick={composeReminder} className="qd-action" title={mailTitle} style={{ ...secondaryBtn, cursor: 'pointer' }}>
                <Bell size={15} /> Send reminder
              </button>
            )}
            {mayApprove && (
              <button onClick={handleResend} disabled={busy} className="qd-action" style={secondaryBtn}>
                <Repeat size={15} /> Resend to Purchase
              </button>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: muted }}>
              Status
              <select aria-label="Change QD status" value={pendingStatus || qd.status} onChange={changeStatus} disabled={busy}
                style={{ padding: '8px 12px', background: bg, color: text, border: `1px solid ${border}`, borderRadius: 8, fontWeight: 500, fontSize: 13, cursor: busy ? 'wait' : 'pointer' }}>
                {QD_STATUSES.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            {qd.foc?.state === 'awaiting-trial' && (
              <button onClick={() => setTrialOpen(true)} disabled={busy} className="qd-action" title="Record how the replacement die trialled" style={secondaryBtn}>
                <FlaskConical size={15} /> Record trial
              </button>
            )}
            {nextQd && onOpenNext && (
              <button onClick={() => onOpenNext(nextQd.id)} className="qd-action" style={{ ...secondaryBtn, cursor: 'pointer', marginLeft: 'auto' }}>
                Next: {nextQd.qd_no ? `QD ${nextQd.qd_no}` : `die ${nextQd.die_no}`} <ArrowRight size={15} />
              </button>
            )}
          </div>
        )}

        {error && <div style={{ fontSize: 12.5, color: '#FCA5A5', marginBottom: 20 }}>{error}</div>}

        {/* Tabs — the strip and the action row above answer "where is it";
            these answer "what is it". */}
        <div role="tablist" aria-label="QD details" style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${border}`, marginBottom: 20, overflowX: 'auto' }}>
          {TABS.map((t) => {
            const active = tab === t.key;
            const count = t.key === 'photos' ? (qd.files || []).length : t.key === 'activity' ? (qd.activity || []).length : null;
            return (
              <button key={t.key} type="button" role="tab" aria-selected={active} onClick={() => setTab(t.key)}
                style={{ padding: '9px 14px', background: 'transparent', border: 'none', borderBottom: `2px solid ${active ? (theme.accent || '#3B82F6') : 'transparent'}`, marginBottom: -1, color: active ? text : muted, fontWeight: active ? 700 : 500, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {t.label}{count ? <span style={{ marginLeft: 6, fontSize: 11, color: dim, fontWeight: 600 }}>{count}</span> : null}
              </button>
            );
          })}
        </div>

        {tab === 'issue' && (
          <>
            <div style={{ border: `1px solid ${border}`, borderRadius: 8, padding: 16, marginBottom: 20 }}>
              <div style={{ ...sectionLabel, marginBottom: 8 }}>Quality issue</div>
              <p style={{ fontSize: 13.5, color: muted, lineHeight: 1.55, margin: 0, whiteSpace: 'pre-line' }}>
                {qd.issue_detail || qd.issue_summary}
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginBottom: 20 }}>
              {issueFacts.map(renderFact)}
            </div>
          </>
        )}

        {tab === 'photos' && (
          <QdPhotoGrid files={qd.files || []} theme={theme} busy={busy} fileRef={fileRef} onFilesChosen={onFilesChosen}
            onAdd={isCancelled ? null : () => { if (fileRef.current) { fileRef.current.value = ''; fileRef.current.click(); } }} />
        )}

        {tab === 'supplier' && (
          <>
            {/* Wide enough for the date picker (trigger + calendar button) to sit
                inside the card instead of spilling past its border. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginBottom: 20 }}>
              {supplierFacts.map(renderFact)}
            </div>
            {/* FOC replacement rounds — only shown once a FOC has been accepted */}
            <FocRounds qd={qd} theme={theme} />
          </>
        )}

        {tab === 'die' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginBottom: 20 }}>
              {dieFacts.map(renderFact)}
            </div>
            {qd.die_order_id && onOpenOrder && (
              <button type="button" className="qd-action" onClick={() => { onClose(); onOpenOrder(qd.die_order_id); }} style={{ ...secondaryBtn, cursor: 'pointer' }}>
                <ExternalLink size={15} /> Open die order
              </button>
            )}
          </>
        )}

        {tab === 'activity' && (
          <>
            {/* Activity timeline */}
            <div style={{ ...sectionLabel, marginBottom: 14 }}>Activity</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {(qd.activity || []).map(a => {
                const tone = QD_ACTIVITY_TONES[a.tone] || QD_ACTIVITY_TONES.neutral;
                const Icon = ACTIVITY_ICON[a.icon] || MessageSquare;
                return (
                  <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ width: 24, height: 24, borderRadius: '50%', background: tone.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon size={12} style={{ color: tone.fg }} />
                      </span>
                      <span style={{ width: 1, flex: 1, background: border, minHeight: 14 }} />
                    </div>
                    <div style={{ paddingBottom: 18 }}>
                      <div style={{ fontSize: 13 }}><strong style={{ fontWeight: 600 }}>{a.actor}</strong> {a.action}</div>
                      <div style={{ fontSize: 11.5, color: dim, marginTop: 2 }}>{fmtWhen(a.occurred_at)}</div>
                    </div>
                  </div>
                );
              })}

              {/* Note composer */}
              <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 12, alignItems: 'center' }}>
                <span style={{ width: 24, height: 24, borderRadius: '50%', background: BRAND.navy, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>ME</span>
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={note} onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') postNote(); }}
                    placeholder="Add an update… (e.g. reminder sent to supplier)"
                    style={{ flex: 1, padding: '10px 14px', background: inputBg, border: `1px solid ${border}`, borderRadius: 8, color: text, fontSize: 13, outline: 'none' }} />
                  <button onClick={postNote} disabled={busy || !note.trim()}
                    style={{ padding: '10px 14px', background: primary, color: primaryFg, border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: busy || !note.trim() ? 'not-allowed' : 'pointer', opacity: busy || !note.trim() ? 0.6 : 1 }}>
                    Post
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {pendingStatus && (
        <StatusChangeModal
          qd={qd}
          nextStatus={pendingStatus}
          theme={theme}
          onClose={() => setPendingStatus(null)}
          onDone={onChanged}
        />
      )}

      {cancelOpen && (
        <QdCancelModal
          qd={qd}
          theme={theme}
          onClose={() => setCancelOpen(false)}
          onDone={async (r) => { await onChanged(); if (r?.emailWarning) setError(`Cancelled, but the raiser was not notified: ${r.emailWarning}`); }}
        />
      )}

      {trialOpen && (
        <FocTrialModal
          qd={qd}
          theme={theme}
          onClose={() => setTrialOpen(false)}
          onDone={onChanged}
        />
      )}

      {previewOpen && (
        <QDFormPreviewModal
          qd={qd}
          theme={theme}
          mayApprove={mayApprove}
          approveLabel={approveLabel}
          busy={busy}
          // Both close the preview first, deliberately: handleApprove reports a
          // failed Purchase email into the drawer's error line, and the
          // send-back reason box lives in the drawer — either one left
          // underneath an open preview would be invisible.
          onApprove={async () => { setPreviewOpen(false); await handleApprove(); }}
          onSendBack={() => { setPreviewOpen(false); setSendBackOpen(true); }}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {sendBackOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => { setSendBackOpen(false); setSendBackReason(''); }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: bg, border: `1px solid ${border}`, borderRadius: 16, width: 460, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', animation: 'qdSlideIn 0.2s ease-out', color: text }}>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '20px 24px', borderBottom: `1px solid ${border}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '1rem', fontWeight: 700 }}>Send back to owner</div>
                <div style={{ fontSize: '0.8rem', color: dim, marginTop: 6 }}>QD {qd.qd_no}</div>
              </div>
              <button onClick={() => { setSendBackOpen(false); setSendBackReason(''); }}
                style={{ width: 32, height: 32, background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <X size={15} />
              </button>
            </div>

            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: '0.72rem', fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' }} htmlFor="qddetailpanel-reason">
                  Reason <span style={{ color: '#FCA5A5' }}>*</span>
                </label>
                <textarea id="qddetailpanel-reason" autoFocus value={sendBackReason} onChange={(e) => setSendBackReason(e.target.value)} rows={3}
                  placeholder="Why is this being sent back? e.g. missing input-at-failure figure"
                  style={{ padding: '9px 12px', background: inputBg, border: `1px solid ${border}`, borderRadius: 8, color: text, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box', width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
              </div>
              {error && <div style={{ fontSize: '0.78rem', color: '#FCA5A5' }}>{error}</div>}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: `1px solid ${border}` }}>
              <button onClick={() => { setSendBackOpen(false); setSendBackReason(''); }}
                style={{ padding: '9px 16px', background: bg, border: `1px solid ${border}`, borderRadius: 10, color: muted, fontWeight: 500, fontSize: '0.85rem', cursor: 'pointer' }}>Cancel</button>
              <button onClick={submitSendBack} disabled={!sendBackReason.trim() || busy} className="qd-sendback-cta"
                style={{ padding: '9px 18px', background: BRAND.navy, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: '0.85rem', cursor: (!sendBackReason.trim() || busy) ? 'not-allowed' : 'pointer', opacity: (!sendBackReason.trim() || busy) ? 0.55 : 1, boxShadow: `0 4px 12px ${BRAND_ALPHA.navyGlow}` }}>
                {busy ? 'Sending back…' : 'Send back'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
