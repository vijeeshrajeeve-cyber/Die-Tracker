import React, { useState, useRef } from 'react';
import {
  X, Upload, FileText, Image as ImageIcon, Flag, Send, Bell, Wrench,
  Calendar, Check, MessageSquare, Pencil, XCircle, Mail,
} from 'lucide-react';
import { qualityDiscrepanciesAPI } from '../../api';
import { QD_STATUS_CONFIG, QD_STATUSES, QD_ACTIVITY_TONES, QD_OUTCOMES } from '../../utils/constants';

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

const isPdf = (name) => /\.pdf$/i.test(String(name || ''));

const esc = (v) => String(v == null || v === '' ? '—' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Shared markup for the QD summary table used by both outbound emails.
const detailsTable = (qd) => `
  <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;color:#0F172A;">
    <tbody>
      <tr><td style="padding:6px 12px;border:1px solid #CBD5E1;font-weight:600;">QD No</td><td style="padding:6px 12px;border:1px solid #CBD5E1;">${esc(qd.qd_no)}</td></tr>
      <tr><td style="padding:6px 12px;border:1px solid #CBD5E1;font-weight:600;">Die No</td><td style="padding:6px 12px;border:1px solid #CBD5E1;">${esc(qd.die_no)}</td></tr>
      <tr><td style="padding:6px 12px;border:1px solid #CBD5E1;font-weight:600;">Plant</td><td style="padding:6px 12px;border:1px solid #CBD5E1;">${esc(qd.plant)}</td></tr>
      <tr><td style="padding:6px 12px;border:1px solid #CBD5E1;font-weight:600;">Raised</td><td style="padding:6px 12px;border:1px solid #CBD5E1;">${esc(qd.raised_date)}</td></tr>
      <tr><td style="padding:6px 12px;border:1px solid #CBD5E1;font-weight:600;">Outcome sought</td><td style="padding:6px 12px;border:1px solid #CBD5E1;">${esc(qd.outcome)}</td></tr>
      <tr><td style="padding:6px 12px;border:1px solid #CBD5E1;font-weight:600;">Status</td><td style="padding:6px 12px;border:1px solid #CBD5E1;">${esc(qd.status)}</td></tr>
    </tbody>
  </table>`;

const attachmentNote = (qd) => ((qd.files || []).length
  ? `<p>Supporting evidence on record: ${qd.files.map(f => esc(f.original_name)).join(', ')}. Please attach any of these that are needed before sending.</p>`
  : '');
const fmtWhen = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' });
};

export default function QDDetailPanel({ qd, theme = {}, supplier = null, onCompose, onClose, onChanged }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // column name being edited
  const [draft, setDraft] = useState('');
  const fileRef = useRef(null);

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

  const changeStatus = (e) => {
    const value = e.target.value;
    run(() => qualityDiscrepanciesAPI.setStatus(qd.id, value));
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
      body: `
        <p>Dear ${esc(qd.supplier)} Team,</p>
        <p>A quality discrepancy has been raised against the following die received from you.</p>
        ${detailsTable(qd)}
        <p><strong>Quality issue</strong></p>
        <p>${esc(qd.issue_detail || qd.issue_summary).replace(/\n/g, '<br/>')}</p>
        ${attachmentNote(qd)}
        <p>Please review and confirm the corrective action along with an ETA.</p>
        <p>Best regards,<br/>Die Ordering Team</p>`,
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
      body: `
        <p>Dear ${esc(qd.supplier)} Team,</p>
        <p>This is a reminder regarding the quality discrepancy below, raised
           <strong>${days} day${days === 1 ? '' : 's'}</strong> ago and still open.</p>
        ${detailsTable(qd)}
        <p><strong>Quality issue</strong></p>
        <p>${esc(qd.issue_detail || qd.issue_summary).replace(/\n/g, '<br/>')}</p>
        <p>We have not yet received your confirmation${qd.eta_date ? '' : ' or an ETA'}.
           Please respond at the earliest so this can be closed out.</p>
        <p>Best regards,<br/>Die Ordering Team</p>`,
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

  // Three of the four facts are editable in place; Age is derived from the
  // dates, so it stays read-only.
  const facts = [
    { label: 'Outcome sought', value: qd.outcome || '—', field: 'outcome', type: 'select', current: qd.outcome || '' },
    { label: 'Input at failure', value: qd.input_at_failure || '—', field: 'input_at_failure', type: 'text', current: qd.input_at_failure || '', placeholder: 'e.g. 3,417 kg' },
    { label: 'ETA from supplier', value: qd.eta_display || '—', field: 'eta_date', type: 'date', current: qd.eta_date ? String(qd.eta_date).slice(0, 10) : '' },
    { label: 'Age', value: qd.closed_at ? 'Closed' : `${qd.age_days} days` },
  ];

  const startEdit = (f) => { setEditing(f.field); setDraft(f.current); };
  const cancelEdit = () => { setEditing(null); setDraft(''); };
  const commitEdit = async (field) => {
    const original = facts.find(f => f.field === field)?.current ?? '';
    if (draft === original) return cancelEdit();
    setBusy(true);
    setError('');
    try {
      await qualityDiscrepanciesAPI.update(qd.id, { [field]: draft });
      cancelEdit();
      await onChanged();
    } catch (e) {
      setError(e.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <style>{`@keyframes qdSlideIn { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } }
        .qd-chip:hover { background: ${surfaceHover}; }
        .qd-action { transition: all .15s ease; }
        .qd-action:hover { background: ${surfaceHover}; color: ${text}; }
        .qd-fact { transition: border-color .15s ease, background .15s ease; }
        .qd-fact:hover { border-color: ${theme.accent || '#3B82F6'} !important; background: ${surfaceHover}; }
        .qd-fact:hover .qd-fact-pen { opacity: 1 !important; }`}</style>

      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', zIndex: 200 }} />

      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 720, maxWidth: '92vw', background: bg, borderLeft: `1px solid ${border}`, zIndex: 201, overflowY: 'auto', padding: '28px 32px', animation: 'qdSlideIn 0.2s ease-out', color: text, boxSizing: 'border-box' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h2 style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, margin: 0 }}>QD {qd.qd_no}</h2>
              <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: sc.bg, color: sc.fg }}>{qd.status}</span>
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

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={composeEmail} className="qd-action" title={mailTitle}
            style={{ padding: '8px 14px', background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, fontWeight: 500, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Mail size={15} /> Email supplier
          </button>
          <button onClick={composeReminder} className="qd-action" title={mailTitle}
            style={{ padding: '8px 14px', background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, fontWeight: 500, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Bell size={15} /> Send reminder
          </button>
          <select value={qd.status} onChange={changeStatus} disabled={busy}
            style={{ padding: '8px 14px', background: primary, color: primaryFg, border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: busy ? 'wait' : 'pointer' }}>
            {QD_STATUSES.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          {error && <span style={{ fontSize: 12.5, color: '#FCA5A5' }}>{error}</span>}
        </div>

        {/* Facts — click an editable one to change it */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {facts.map(f => {
            const isEditing = editing === f.field;
            const editable = !!f.field;
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

                {isEditing && f.type === 'select' && (
                  <select autoFocus value={draft} disabled={busy} style={{ ...fieldStyle, cursor: 'pointer' }}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commitEdit(f.field)}
                    onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); }}>
                    <option value="">—</option>
                    {QD_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}

                {isEditing && f.type !== 'select' && (
                  <input autoFocus type={f.type === 'date' ? 'date' : 'text'} value={draft} disabled={busy}
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
          })}
        </div>

        {/* Quality issue + attachments */}
        <div style={{ border: `1px solid ${border}`, borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <div style={{ ...sectionLabel, marginBottom: 8 }}>Quality issue</div>
          <p style={{ fontSize: 13.5, color: muted, lineHeight: 1.55, margin: 0, whiteSpace: 'pre-line' }}>
            {qd.issue_detail || qd.issue_summary}
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            {(qd.files || []).map(f => {
              const Icon = isPdf(f.original_name) ? FileText : ImageIcon;
              return (
                <button key={f.id} type="button" className="qd-chip"
                  onClick={() => qualityDiscrepanciesAPI.downloadFile(f.id, f.original_name)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: `1px solid ${border}`, borderRadius: 8, fontSize: 12, color: muted, cursor: 'pointer', background: bg }}>
                  <Icon size={15} style={{ color: isPdf(f.original_name) ? '#F87171' : '#60A5FA' }} /> {f.original_name}
                </button>
              );
            })}
            <input ref={fileRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp" style={{ display: 'none' }} onChange={onFilesChosen} />
            <button type="button" onClick={() => { if (fileRef.current) { fileRef.current.value = ''; fileRef.current.click(); } }} disabled={busy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: `2px dashed ${border}`, borderRadius: 8, fontSize: 12, color: dim, cursor: busy ? 'wait' : 'pointer', background: 'transparent' }}>
              <Upload size={15} /> {busy ? 'Working…' : 'Add file'}
            </button>
          </div>
        </div>

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
            <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg,#3B82F6,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
      </div>
    </>
  );
}
