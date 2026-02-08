import React from 'react';
import { X, History } from 'lucide-react';

function ChangeLogModal({ order, onClose, theme }) {
    if (!order) return null;

    const changeLog = order['Change Log'] || [];

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
                    {changeLog.length === 0 ? (
                        <div style={{
                            textAlign: 'center',
                            padding: '3rem 1rem',
                            color: theme?.textMuted || '#94A3B8'
                        }}>
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
                                    {changeLog.length} {changeLog.length === 1 ? 'change' : 'changes'} recorded
                                </span>
                                <span style={{
                                    fontSize: '0.75rem',
                                    color: '#3B82F6',
                                    background: 'rgba(59,130,246,0.15)',
                                    padding: '4px 8px',
                                    borderRadius: '6px'
                                }}>
                                    Size Change History
                                </span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {[...changeLog].reverse().map((entry, idx) => (
                                    <div
                                        key={idx}
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
                                                    {entry.date}
                                                </span>
                                                <span style={{
                                                    fontWeight: 600,
                                                    color: '#3B82F6',
                                                    fontSize: '0.85rem'
                                                }}>
                                                    {entry.field}
                                                </span>
                                            </div>
                                            <span style={{
                                                fontSize: '0.7rem',
                                                color: theme?.textMuted || '#94A3B8',
                                                padding: '2px 6px',
                                                background: 'rgba(100,116,139,0.15)',
                                                borderRadius: '4px'
                                            }}>
                                                {entry.stage}
                                            </span>
                                        </div>

                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px',
                                            marginBottom: '6px'
                                        }}>
                                            <span style={{
                                                fontSize: '0.9rem',
                                                color: '#EF4444',
                                                textDecoration: 'line-through',
                                                fontFamily: 'monospace'
                                            }}>
                                                {entry.oldValue || 'N/A'}
                                            </span>
                                            <span style={{ color: theme?.textMuted || '#94A3B8' }}>→</span>
                                            <span style={{
                                                fontSize: '0.9rem',
                                                color: '#10B981',
                                                fontWeight: 600,
                                                fontFamily: 'monospace'
                                            }}>
                                                {entry.newValue}
                                            </span>
                                        </div>

                                        <div style={{
                                            fontSize: '0.75rem',
                                            color: theme?.textMuted || '#94A3B8'
                                        }}>
                                            Changed by <strong style={{ color: theme?.text || '#F1F5F9' }}>{entry.changedBy}</strong>
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

export default ChangeLogModal;
