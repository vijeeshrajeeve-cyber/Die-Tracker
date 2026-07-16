import React, { useEffect, useState } from 'react';
import { X, RotateCcw, FileText } from 'lucide-react';
import { ordersAPI } from '../../api';

function RevisionHistoryModal({ order, onClose, theme }) {
    const [revisions, setRevisions] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!order?.id) return;
        setLoading(true);
        ordersAPI.getRevisions(order.id)
            .then(res => setRevisions(res.revisions || []))
            .catch(() => setRevisions([]))
            .finally(() => setLoading(false));
    }, [order?.id]);

    if (!order) return null;

    const statusLabel = (s) => {
        if (s === 'AWAITING FOR DESIGN') return 'Design';
        if (s === 'UNDER SIMULATION') return 'Simulation';
        return s || '—';
    };

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.7)',
                backdropFilter: 'blur(8px)',
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
                    maxWidth: '620px',
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
                    background: 'rgba(245,158,11,0.1)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                            width: '44px',
                            height: '44px',
                            borderRadius: '12px',
                            background: '#F59E0B',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <RotateCcw size={22} color="white" />
                        </div>
                        <div>
                            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: theme?.text || '#F1F5F9', margin: 0 }}>
                                Revision History
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
                            <p style={{ margin: 0 }}>Loading revision history…</p>
                        </div>
                    ) : revisions.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: theme?.textMuted || '#94A3B8' }}>
                            <RotateCcw size={48} style={{ opacity: 0.3, marginBottom: '12px' }} />
                            <p style={{ margin: 0 }}>No revisions recorded for this order</p>
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
                                    {revisions.length} {revisions.length === 1 ? 'revision' : 'revisions'} recorded
                                </span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {revisions.map((rev) => (
                                    <div
                                        key={rev.id}
                                        style={{
                                            background: 'rgba(245,158,11,0.05)',
                                            borderRadius: '10px',
                                            padding: '12px 14px',
                                            border: `1px solid ${theme?.border || '#334155'}`
                                        }}
                                    >
                                        <div style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            marginBottom: '8px'
                                        }}>
                                            <span style={{
                                                fontWeight: 700,
                                                color: '#F59E0B',
                                                fontSize: '0.9rem'
                                            }}>
                                                Revision #{rev.revision_number}
                                            </span>
                                            <span style={{
                                                fontSize: '0.8rem',
                                                color: theme?.textMuted || '#94A3B8',
                                                background: 'rgba(100,116,139,0.2)',
                                                padding: '2px 8px',
                                                borderRadius: '4px'
                                            }}>
                                                {rev.revision_date || '—'}
                                            </span>
                                        </div>

                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            marginBottom: '8px',
                                            fontSize: '0.82rem'
                                        }}>
                                            <span style={{ color: theme?.textMuted || '#94A3B8' }}>Sent back to</span>
                                            <span style={{ color: '#F59E0B', fontWeight: 600 }}>{statusLabel(rev.to_status)}</span>
                                            {rev.from_status && (
                                                <span style={{ color: theme?.textDim || '#64748B' }}>
                                                    (from {statusLabel(rev.from_status)})
                                                </span>
                                            )}
                                        </div>

                                        {rev.notes && (
                                            <div style={{
                                                padding: '8px 10px',
                                                background: 'rgba(100,116,139,0.12)',
                                                borderRadius: '6px',
                                                borderLeft: '3px solid rgba(245,158,11,0.5)',
                                                fontSize: '0.8rem',
                                                color: theme?.textMuted || '#94A3B8',
                                                lineHeight: 1.5,
                                                marginBottom: '8px',
                                                whiteSpace: 'pre-wrap'
                                            }}>
                                                <span style={{ fontWeight: 600, color: theme?.text || '#F1F5F9' }}>Notes: </span>
                                                {rev.notes}
                                            </div>
                                        )}

                                        {(rev.design_received_date || rev.model_received_date) && (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                                                {rev.design_received_date && (
                                                    <span style={{ fontSize: '0.75rem', color: '#10B981', background: 'rgba(16,185,129,0.12)', padding: '2px 8px', borderRadius: '4px' }}>
                                                        Design re-received: {rev.design_received_date}
                                                    </span>
                                                )}
                                                {rev.model_received_date && (
                                                    <span style={{ fontSize: '0.75rem', color: '#10B981', background: 'rgba(16,185,129,0.12)', padding: '2px 8px', borderRadius: '4px' }}>
                                                        3D model re-received: {rev.model_received_date}
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                                            <div style={{ fontSize: '0.75rem', color: theme?.textMuted || '#94A3B8' }}>
                                                By <strong style={{ color: theme?.text || '#F1F5F9' }}>{rev.created_by}</strong>
                                            </div>
                                            {rev.revision_pdf && (
                                                <span style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    fontSize: '0.75rem',
                                                    color: '#3B82F6'
                                                }}>
                                                    <FileText size={14} /> {rev.revision_pdf}
                                                </span>
                                            )}
                                        </div>
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

export default RevisionHistoryModal;
