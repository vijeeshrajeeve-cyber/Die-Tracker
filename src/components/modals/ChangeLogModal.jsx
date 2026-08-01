import React, { useEffect, useState } from 'react';
import { X, History } from 'lucide-react';
import { ordersAPI } from '../../api';

import useDialog from '../../hooks/useDialog';
function ChangeLogModal({ order, onClose, theme }) {
  const dialogRef = useDialog({ open: !!order, onClose });
    const [changes, setChanges] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!order?.id) return;
        setLoading(true);
        ordersAPI.getChangeLog(order.id)
            .then(res => setChanges(res.changes || []))
            .catch(() => setChanges([]))
            .finally(() => setLoading(false));
    }, [order?.id]);

    if (!order) return null;

    const formatDate = (iso) => {
        if (!iso) return '—';
        const d = new Date(iso);
        if (isNaN(d)) return iso;
        return d.toLocaleDateString();
    };

    return (
        <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.7)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                padding: '1rem'
            }}
            onClick={onClose}
        >
            <div
                style={{
                    background: theme?.cardBg || '#1E293B',
                    borderRadius: '20px',
                    width: '100%',
                    maxWidth: '600px',
                    maxHeight: '80vh',
                    overflow: 'hidden',
                    border: `1px solid ${theme?.border || '#334155'}`
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '1.5rem',
                    borderBottom: `1px solid ${theme?.border || '#334155'}`,
                    background: 'rgba(59,130,246,0.1)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '12px',
                            background: '#3B82F6',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <History size={22} color="white" />
                        </div>
                        <div>
                            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: theme?.text || '#F1F5F9', margin: 0 }}>
                                Change Log
                            </h2>
                            <p style={{ color: theme?.textDim || '#64748B', margin: 0, fontSize: '0.85rem' }}>
                                {order['DIE NO']} • Order #{order['Order No']}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: theme?.textDim || '#64748B',
                            cursor: 'pointer',
                            padding: '8px',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Content */}
                <div style={{ padding: '1.5rem', overflowY: 'auto', maxHeight: 'calc(80vh - 100px)' }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: theme?.textMuted || '#94A3B8' }}>
                            <p style={{ margin: 0 }}>Loading change log…</p>
                        </div>
                    ) : changes.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: theme?.textMuted || '#94A3B8' }}>
                            <History size={48} style={{ opacity: 0.3, marginBottom: '12px' }} />
                            <p style={{ margin: 0 }}>No changes recorded for this order</p>
                        </div>
                    ) : (
                        <>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: '1rem',
                                paddingBottom: '0.75rem',
                                borderBottom: `1px solid ${theme?.border || '#334155'}`
                            }}>
                                <span style={{ fontSize: '0.8rem', color: theme?.textMuted || '#94A3B8' }}>
                                    {changes.length} {changes.length === 1 ? 'change' : 'changes'} recorded
                                </span>
                                <span style={{
                                    fontSize: '0.75rem',
                                    color: '#3B82F6',
                                    background: 'rgba(59,130,246,0.15)',
                                    padding: '4px 8px',
                                    borderRadius: '6px'
                                }}>
                                    Change History
                                </span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {changes.map((entry, idx) => (
                                    <div
                                        key={entry.id ?? idx}
                                        style={{
                                            background: idx % 2 === 0 ? 'rgba(59,130,246,0.05)' : 'transparent',
                                            borderRadius: '10px',
                                            padding: '12px 14px',
                                            border: `1px solid ${theme?.border || '#334155'}`
                                        }}
                                    >
                                        <div style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'flex-start',
                                            marginBottom: '8px'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <span style={{
                                                    fontSize: '0.8rem',
                                                    color: theme?.textMuted || '#94A3B8',
                                                    background: 'rgba(100,116,139,0.2)',
                                                    padding: '2px 8px',
                                                    borderRadius: '4px'
                                                }}>
                                                    {formatDate(entry.changed_at)}
                                                </span>
                                                <span style={{ fontWeight: 600, color: '#3B82F6', fontSize: '0.85rem' }}>
                                                    {entry.field_name}
                                                </span>
                                            </div>
                                            {entry.stage && (
                                                <span style={{
                                                    fontSize: '0.7rem',
                                                    color: theme?.textMuted || '#94A3B8',
                                                    padding: '2px 6px',
                                                    background: 'rgba(100,116,139,0.15)',
                                                    borderRadius: '4px'
                                                }}>
                                                    {entry.stage}
                                                </span>
                                            )}
                                        </div>

                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px',
                                            marginBottom: '6px'
                                        }}>
                                            <span style={{ fontSize: '0.9rem', color: '#EF4444', textDecoration: 'line-through', fontFamily: 'monospace' }}>
                                                {entry.old_value || 'N/A'}
                                            </span>
                                            <span style={{ color: theme?.textMuted || '#94A3B8' }}>→</span>
                                            <span style={{ fontSize: '0.9rem', color: '#10B981', fontWeight: 600, fontFamily: 'monospace' }}>
                                                {entry.new_value}
                                            </span>
                                        </div>

                                        <div style={{ fontSize: '0.75rem', color: theme?.textMuted || '#94A3B8' }}>
                                            Changed by <strong style={{ color: theme?.text || '#F1F5F9' }}>{entry.changed_by}</strong>
                                        </div>

                                        {entry.reason && (
                                            <div style={{
                                                marginTop: '8px',
                                                padding: '8px 10px',
                                                background: 'rgba(100,116,139,0.12)',
                                                borderRadius: '6px',
                                                borderLeft: '3px solid rgba(100,116,139,0.4)',
                                                fontSize: '0.78rem',
                                                color: theme?.textMuted || '#94A3B8',
                                                lineHeight: 1.5
                                            }}>
                                                <span style={{ fontWeight: 600, color: theme?.text || '#F1F5F9' }}>Reason: </span>
                                                {entry.reason}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default ChangeLogModal;
