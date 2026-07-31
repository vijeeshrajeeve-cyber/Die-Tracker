import React, { useState } from 'react';
import { X, Send, Paperclip, ChevronDown } from 'lucide-react';
import { emailAPI } from '../../api';
import useDialog from '../../hooks/useDialog';
import { BRAND } from '../../utils/brand';

const EmailCompose = ({ onClose, onSent, theme, prefill = {} }) => {
  const dialogRef = useDialog({ open: true, onClose });
    const [isHtmlBody] = useState(!!prefill.isHtml);
    const [form, setForm] = useState({
        to: prefill.to || '',
        cc: prefill.cc || '',
        subject: prefill.subject || '',
        body: prefill.body || '',
        importance: prefill.importance || 'normal',
        orderId: prefill.orderId || null,
        // When set, the server renders that QD's form and attaches it.
        qdId: prefill.qdId || null
    });
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');

    const handleSend = async (e) => {
        e.preventDefault();
        if (!form.to || !form.subject || !form.body) {
            setError('To, Subject, and Body are required');
            return;
        }
        setSending(true);
        setError('');
        try {
            await emailAPI.sendEmail(form);
            if (onSent) onSent();
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to send email');
        } finally {
            setSending(false);
        }
    };

    const inputStyle = {
        width: '100%',
        padding: '10px 14px',
        background: theme.inputBg,
        border: `1px solid ${theme.cardBorder}`,
        borderRadius: '8px',
        color: theme.text,
        fontSize: '0.875rem',
        outline: 'none',
        boxSizing: 'border-box'
    };

    return (
        <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1} style={{
            position: 'fixed', inset: 0, zIndex: 2000,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div style={{
                background: theme.cardBg, borderRadius: '20px',
                width: '100%', maxWidth: '640px', maxHeight: '90vh',
                border: `1px solid ${theme.cardBorder}`,
                boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden'
            }}>
                {/* Header */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '20px 24px', borderBottom: `1px solid ${theme.cardBorder}`
                }}>
                    <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: theme.text, margin: 0 }}>
                        ✉️ Compose Email
                    </h2>
                    <button onClick={onClose} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: theme.textMuted, padding: '4px'
                    }}>
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSend} style={{
                    padding: '20px 24px', flex: 1, overflowY: 'auto',
                    display: 'flex', flexDirection: 'column', gap: '14px'
                }}>
                    {/* To */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }}>To</label>
                        <input
                            type="text"
                            value={form.to}
                            onChange={(e) => setForm({ ...form, to: e.target.value })}
                            placeholder="recipient@company.com"
                            style={inputStyle}
                            required
                        />
                    </div>

                    {/* CC */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }}>CC</label>
                        <input
                            type="text"
                            value={form.cc}
                            onChange={(e) => setForm({ ...form, cc: e.target.value })}
                            placeholder="Optional CC recipients"
                            style={inputStyle}
                        />
                    </div>

                    {/* Subject */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }}>Subject</label>
                        <input
                            type="text"
                            value={form.subject}
                            onChange={(e) => setForm({ ...form, subject: e.target.value })}
                            placeholder="Email subject"
                            style={inputStyle}
                            required
                        />
                    </div>

                    {/* Importance */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }}>Importance</label>
                        <select
                            value={form.importance}
                            onChange={(e) => setForm({ ...form, importance: e.target.value })}
                            style={{ ...inputStyle, cursor: 'pointer' }}
                        >
                            <option value="low">Low</option>
                            <option value="normal">Normal</option>
                            <option value="high">High</option>
                        </select>
                    </div>

                    {/* Body */}
                    <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }}>Body</label>
                        {isHtmlBody ? (
                            <div
                                contentEditable
                                suppressContentEditableWarning
                                onInput={(e) => setForm({ ...form, body: e.currentTarget.innerHTML })}
                                dangerouslySetInnerHTML={{ __html: form.body }}
                                style={{
                                    ...inputStyle,
                                    minHeight: '220px',
                                    maxHeight: '360px',
                                    overflow: 'auto',
                                    resize: 'vertical',
                                    lineHeight: 1.5,
                                    background: '#FFFFFF',
                                    color: '#0F172A',
                                }}
                            />
                        ) : (
                            <textarea
                                value={form.body}
                                onChange={(e) => setForm({ ...form, body: e.target.value })}
                                placeholder="Email content..."
                                style={{
                                    ...inputStyle,
                                    minHeight: '200px',
                                    resize: 'vertical',
                                    fontFamily: 'inherit',
                                    lineHeight: 1.6
                                }}
                                required
                            />
                        )}
                    </div>

                    {/* Linked Order */}
                    {form.orderId && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '8px 12px', borderRadius: '8px',
                            background: 'rgba(59,130,246,0.1)', fontSize: '0.8rem', color: '#3B82F6'
                        }}>
                            📎 Linked to Order #{form.orderId}
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div style={{
                            padding: '10px 14px', borderRadius: '8px',
                            background: 'rgba(239,68,68,0.1)', color: '#EF4444',
                            fontSize: '0.85rem'
                        }}>
                            {error}
                        </div>
                    )}
                </form>

                {/* Footer */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                    gap: '12px', padding: '16px 24px',
                    borderTop: `1px solid ${theme.cardBorder}`
                }}>
                    {/* The QD form is rendered and attached by the server on
                        send; show it so the sender knows it is going. */}
                    {form.qdId && (
                        <span style={{
                            marginRight: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px',
                            padding: '6px 10px', borderRadius: '8px',
                            background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
                            color: theme.textMuted, fontSize: '0.78rem', fontWeight: 500
                        }}>
                            <Paperclip size={14} />
                            {prefill.attachmentName || 'QD form'} will be attached
                        </span>
                    )}
                    <button onClick={onClose} style={{
                        padding: '10px 20px', borderRadius: '10px',
                        border: `1px solid ${theme.cardBorder}`,
                        background: 'transparent', color: theme.textMuted,
                        cursor: 'pointer', fontWeight: 500, fontSize: '0.875rem'
                    }}>
                        Cancel
                    </button>
                    <button onClick={handleSend} disabled={sending} style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '10px 24px', borderRadius: '10px', border: 'none',
                        background: sending ? '#475569' : BRAND.navy,
                        color: 'white', cursor: sending ? 'not-allowed' : 'pointer',
                        fontWeight: 600, fontSize: '0.875rem',
                        boxShadow: '0 4px 12px rgba(59,130,246,0.3)'
                    }}>
                        <Send size={16} />
                        {sending ? 'Sending...' : 'Send Email'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EmailCompose;
