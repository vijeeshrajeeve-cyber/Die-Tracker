import React, { useState, useEffect, useCallback } from 'react';
import { Mail, Send, Inbox, ArrowLeft, ExternalLink, Link2, RefreshCw, ChevronLeft, ChevronRight, Filter, Bell } from 'lucide-react';
import { emailAPI } from '../../api';

const EmailInbox = ({ theme, onCompose }) => {
    const [emails, setEmails] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [direction, setDirection] = useState(null); // null = all, 'sent', 'received'
    const [loading, setLoading] = useState(true);
    const [selectedEmail, setSelectedEmail] = useState(null);
    const [threadEmails, setThreadEmails] = useState([]);
    const pageSize = 15;

    const fetchEmails = useCallback(async () => {
        setLoading(true);
        try {
            const result = await emailAPI.getInbox(page, pageSize, direction);
            setEmails(result.emails || []);
            setTotal(result.total || 0);
            setTotalPages(result.totalPages || 1);
        } catch (err) {
            console.error('Failed to fetch emails:', err);
        } finally {
            setLoading(false);
        }
    }, [page, direction]);

    useEffect(() => { fetchEmails(); }, [fetchEmails]);

    const viewThread = async (email) => {
        setSelectedEmail(email);
        if (email.conversation_id) {
            try {
                const result = await emailAPI.getThread(email.conversation_id);
                setThreadEmails(result.emails || [email]);
            } catch {
                setThreadEmails([email]);
            }
        } else {
            setThreadEmails([email]);
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const parseAddresses = (json) => {
        if (!json) return '';
        try { return JSON.parse(json).join(', '); } catch { return json; }
    };

    // A reminder applies only to a sent "PDF Drawing Request" email. The sent
    // subject is always "URGENT: PDF Drawing Request for N Backup Die Request(s)".
    const isPdfDrawingRequest = (email) =>
        !!email && (email.subject || '').includes('PDF Drawing Request');

    const handleSendReminder = (email) => {
        if (!onCompose || !email) return;
        const rawSubject = email.subject || 'PDF Drawing Request';
        const subject = /^reminder:/i.test(rawSubject) ? rawSubject : `REMINDER: ${rawSubject}`;
        const reminderNote =
            '<p>This is a reminder regarding our earlier PDF drawing request below. ' +
            'The drawings for the die number(s) listed are still pending — please share them at the earliest.</p>';
        onCompose({
            to: parseAddresses(email.to_addresses),
            cc: parseAddresses(email.cc_addresses),
            subject,
            body: reminderNote + (email.body_content || email.body_preview || ''),
            importance: 'high',
            isHtml: true,
            orderId: email.order_id || null,
        });
    };

    // Convert stored HTML email bodies to readable plain text.
    // DOMParser documents are inert (no script execution, no resource loads),
    // so this is safe for untrusted received emails.
    const htmlToText = (str) => {
        if (!str) return '';
        if (!/<[a-z!/][\s\S]*>/i.test(str) && !/&[a-z#0-9]+;/i.test(str)) return str;
        const doc = new DOMParser().parseFromString(str, 'text/html');
        doc.querySelectorAll('style, script, title').forEach(el => el.remove());
        // Render tables as readable rows. Without this, the whitespace between
        // <td>/<th> tags survives as newlines and drops every cell onto its own
        // line, turning a table into an unreadable vertical list.
        doc.querySelectorAll('table').forEach(table => {
            const rows = Array.from(table.querySelectorAll('tr')).map(tr =>
                Array.from(tr.querySelectorAll('th, td'))
                    .map(cell => (cell.textContent || '').replace(/\s+/g, ' ').trim())
                    .join('  |  ')
            );
            table.replaceWith(doc.createTextNode('\n' + rows.join('\n') + '\n'));
        });
        doc.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
        doc.querySelectorAll('p, div, tr, li, blockquote, h1, h2, h3, h4, h5, h6').forEach(el => el.append('\n'));
        return (doc.body?.textContent || '')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    };

    const cardStyle = {
        background: theme.cardBg, borderRadius: '20px',
        border: `1px solid ${theme.cardBorder}`,
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
    };

    const filterBtnStyle = (active) => ({
        padding: '8px 16px', borderRadius: '8px',
        border: active ? 'none' : `1px solid ${theme.cardBorder}`,
        background: active ? theme.primary : 'transparent',
        color: active ? theme.primaryText : theme.textMuted,
        cursor: 'pointer', fontWeight: 500, fontSize: '0.8rem',
        transition: 'all 0.2s'
    });

    // Thread View
    if (selectedEmail) {
        return (
            <div>
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: '1rem', gap: '12px'
                }}>
                    <button onClick={() => { setSelectedEmail(null); setThreadEmails([]); }} style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        background: 'none', border: 'none', color: theme.primary,
                        cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500,
                        padding: 0
                    }}>
                        <ArrowLeft size={18} /> Back to Inbox
                    </button>
                    {onCompose && isPdfDrawingRequest(selectedEmail) && (
                        <button onClick={() => handleSendReminder(selectedEmail)} style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '10px 18px', borderRadius: '10px', border: 'none',
                            background: 'linear-gradient(135deg, #F59E0B, #EF4444)',
                            color: 'white', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                            boxShadow: '0 4px 12px rgba(239,68,68,0.3)'
                        }}>
                            <Bell size={16} /> Send Reminder
                        </button>
                    )}
                </div>

                <div style={{ ...cardStyle, padding: '24px' }}>
                    <div style={{ marginBottom: '20px', borderBottom: `1px solid ${theme.cardBorder}`, paddingBottom: '16px' }}>
                        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: theme.text, margin: '0 0 8px 0' }}>
                            {selectedEmail.subject || '(No Subject)'}
                        </h2>
                        <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', color: theme.textMuted }}>
                            <span>From: <strong style={{ color: theme.text }}>{selectedEmail.from_address}</strong></span>
                            <span>To: {parseAddresses(selectedEmail.to_addresses)}</span>
                        </div>
                        {selectedEmail.order_id && (
                            <div style={{
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                marginTop: '8px', padding: '4px 10px', borderRadius: '6px',
                                background: 'rgba(59,130,246,0.1)', fontSize: '0.75rem', color: '#3B82F6'
                            }}>
                                <Link2 size={12} /> Linked to Order #{selectedEmail.order_id}
                            </div>
                        )}
                    </div>

                    {/* Thread messages */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {threadEmails.map((email, i) => (
                            <div key={email.id || i} style={{
                                padding: '16px', borderRadius: '12px',
                                background: email.direction === 'sent'
                                    ? 'rgba(59,130,246,0.08)'
                                    : theme.inputBg,
                                borderLeft: `3px solid ${email.direction === 'sent' ? '#3B82F6' : '#10B981'}`
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: theme.text }}>
                                        {email.direction === 'sent' ? '📤 Sent' : '📥 Received'} — {email.from_address}
                                    </span>
                                    <span style={{ fontSize: '0.75rem', color: theme.textDim }}>
                                        {formatDate(email.direction === 'sent' ? email.created_at : email.received_at)}
                                    </span>
                                </div>
                                <div style={{
                                    fontSize: '0.875rem', color: theme.textMuted,
                                    lineHeight: 1.7, whiteSpace: 'pre-wrap'
                                }}>
                                    {htmlToText(email.body_content || email.body_preview) || '(No content)'}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // Inbox List View
    return (
        <div>
            {/* Header */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                        width: '48px', height: '48px', borderRadius: '12px',
                        background: 'rgba(59,130,246,0.15)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        <Mail size={24} color="#3B82F6" />
                    </div>
                    <div>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: theme.text, margin: 0 }}>Email Inbox</h2>
                        <p style={{ fontSize: '0.8rem', color: theme.textDim, margin: 0 }}>{total} total emails</p>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={fetchEmails} style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        padding: '10px 16px', borderRadius: '10px',
                        border: `1px solid ${theme.cardBorder}`,
                        background: theme.cardBg, color: theme.textMuted,
                        cursor: 'pointer', fontWeight: 500, fontSize: '0.85rem'
                    }}>
                        <RefreshCw size={16} /> Refresh
                    </button>
                    {onCompose && (
                        <button onClick={() => onCompose()} style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '10px 20px', borderRadius: '10px', border: 'none',
                            background: 'linear-gradient(135deg, #3B82F6, #6366F1)',
                            color: 'white', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                            boxShadow: '0 4px 12px rgba(59,130,246,0.3)'
                        }}>
                            <Send size={16} /> Compose
                        </button>
                    )}
                </div>
            </div>

            {/* Filter bar */}
            <div style={{ ...cardStyle, padding: '12px 16px', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <Filter size={16} color={theme.textDim} />
                    <button onClick={() => { setDirection(null); setPage(1); }} style={filterBtnStyle(!direction)}>All</button>
                    <button onClick={() => { setDirection('received'); setPage(1); }} style={filterBtnStyle(direction === 'received')}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Inbox size={14} /> Received</span>
                    </button>
                    <button onClick={() => { setDirection('sent'); setPage(1); }} style={filterBtnStyle(direction === 'sent')}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Send size={14} /> Sent</span>
                    </button>
                </div>
            </div>

            {/* Email list */}
            <div style={cardStyle}>
                {loading ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: theme.textDim }}>
                        Loading emails...
                    </div>
                ) : emails.length === 0 ? (
                    <div style={{ padding: '60px 20px', textAlign: 'center' }}>
                        <Mail size={48} style={{ opacity: 0.15, marginBottom: '12px' }} color={theme.textDim} />
                        <p style={{ color: theme.textDim, fontSize: '0.9rem', margin: 0 }}>No emails yet</p>
                        <p style={{ color: theme.textDim, fontSize: '0.8rem', margin: '4px 0 0' }}>
                            Send an email or configure the inbox webhook to receive emails.
                        </p>
                    </div>
                ) : (
                    <>
                        {emails.map(email => (
                            <div
                                key={email.id}
                                onClick={() => viewThread(email)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '14px',
                                    padding: '14px 20px', cursor: 'pointer',
                                    borderBottom: `1px solid ${theme.cardBorder}`,
                                    transition: 'background 0.15s'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = theme.primaryLight}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                            >
                                {/* Direction icon */}
                                <div style={{
                                    width: '36px', height: '36px', borderRadius: '50%',
                                    background: email.direction === 'sent'
                                        ? 'rgba(59,130,246,0.15)' : 'rgba(16,185,129,0.15)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    flexShrink: 0
                                }}>
                                    {email.direction === 'sent'
                                        ? <Send size={16} color="#3B82F6" />
                                        : <Inbox size={16} color="#10B981" />}
                                </div>

                                {/* Content */}
                                <div style={{ flex: 1, overflow: 'hidden' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                        <span style={{
                                            fontSize: '0.85rem', fontWeight: 600, color: theme.text,
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                                        }}>
                                            {email.direction === 'sent'
                                                ? `To: ${parseAddresses(email.to_addresses)}`
                                                : email.from_address}
                                        </span>
                                        <span style={{ fontSize: '0.7rem', color: theme.textDim, flexShrink: 0, marginLeft: '12px' }}>
                                            {formatDate(email.direction === 'sent' ? email.created_at : email.received_at)}
                                        </span>
                                    </div>
                                    <div style={{
                                        fontSize: '0.85rem', color: theme.text, fontWeight: 500,
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                                    }}>
                                        {email.subject || '(No Subject)'}
                                    </div>
                                    <div style={{
                                        fontSize: '0.8rem', color: theme.textDim, marginTop: '2px',
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                                    }}>
                                        {htmlToText(email.body_preview).replace(/\s+/g, ' ')}
                                    </div>
                                </div>

                                {/* Order link badge */}
                                {email.order_id && (
                                    <div style={{
                                        padding: '3px 8px', borderRadius: '6px',
                                        background: 'rgba(59,130,246,0.1)', fontSize: '0.7rem',
                                        color: '#3B82F6', fontWeight: 600, flexShrink: 0
                                    }}>
                                        #{email.order_id}
                                    </div>
                                )}

                                {/* Status badge for sent */}
                                {email.direction === 'sent' && email.status === 'failed' && (
                                    <div style={{
                                        padding: '3px 8px', borderRadius: '6px',
                                        background: 'rgba(239,68,68,0.1)', fontSize: '0.7rem',
                                        color: '#EF4444', fontWeight: 600, flexShrink: 0
                                    }}>
                                        Failed
                                    </div>
                                )}
                            </div>
                        ))}

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '12px 20px', borderTop: `1px solid ${theme.cardBorder}`
                            }}>
                                <span style={{ fontSize: '0.8rem', color: theme.textDim }}>
                                    Page {page} of {totalPages}
                                </span>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <button
                                        onClick={() => setPage(Math.max(1, page - 1))}
                                        disabled={page === 1}
                                        style={{
                                            width: '32px', height: '32px', display: 'flex',
                                            alignItems: 'center', justifyContent: 'center',
                                            borderRadius: '8px', border: `1px solid ${theme.cardBorder}`,
                                            background: theme.inputBg, color: theme.textMuted,
                                            cursor: page === 1 ? 'not-allowed' : 'pointer',
                                            opacity: page === 1 ? 0.4 : 1
                                        }}
                                    >
                                        <ChevronLeft size={16} />
                                    </button>
                                    <button
                                        onClick={() => setPage(Math.min(totalPages, page + 1))}
                                        disabled={page === totalPages}
                                        style={{
                                            width: '32px', height: '32px', display: 'flex',
                                            alignItems: 'center', justifyContent: 'center',
                                            borderRadius: '8px', border: `1px solid ${theme.cardBorder}`,
                                            background: theme.inputBg, color: theme.textMuted,
                                            cursor: page === totalPages ? 'not-allowed' : 'pointer',
                                            opacity: page === totalPages ? 0.4 : 1
                                        }}
                                    >
                                        <ChevronRight size={16} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default EmailInbox;
