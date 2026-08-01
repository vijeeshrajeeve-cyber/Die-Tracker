import React, { useState } from 'react';
import { X, RotateCcw, Upload, FileText, AlertTriangle } from 'lucide-react';
import { dialogs } from '../ui/DialogProvider';
import useDialog from '../../hooks/useDialog';

function RevisionModal({
    isOpen,
    onClose,
    order,
    onRevision,
    sourceStatus,
    theme
}) {
  const dialogRef = useDialog({ open: !!isOpen && !!order, onClose });
    const allOptions = [
        { value: 'AWAITING FOR DESIGN', label: 'Design' },
        { value: 'UNDER SIMULATION', label: 'Simulation' }
    ];
    const options = allOptions.filter(o => o.value !== sourceStatus);
    const [targetStatus, setTargetStatus] = useState(options[0]?.value || 'AWAITING FOR DESIGN');
    const [notes, setNotes] = useState('');
    const [pdfFile, setPdfFile] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!isOpen || !order) return null;

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file && file.type === 'application/pdf') {
            setPdfFile(file);
        } else if (file) {
            dialogs.notify('That file is not a PDF. Choose a PDF to attach.', 'error');
        }
    };

    const handleSubmit = async () => {
        if (!notes.trim()) {
            dialogs.notify('Revision notes are required.', 'error');
            return;
        }

        setIsSubmitting(true);
        try {
            await onRevision({
                orderId: order.id,
                targetStatus,
                notes: notes.trim(),
                pdfFile,
                revisionDate: new Date().toISOString().split('T')[0]
            });
            onClose();
            setNotes('');
            setPdfFile(null);
            setTargetStatus(options[0]?.value || 'AWAITING FOR DESIGN');
        } catch (error) {
            console.error('Revision error:', error);
            dialogs.notify('Failed to submit revision: ' + error.message, 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const modalStyle = {
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)'
    };

    const contentStyle = {
        background: theme?.cardBg || '#1E293B',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '500px',
        border: `1px solid ${theme?.border || '#334155'}`,
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)'
    };

    const inputStyle = {
        width: '100%',
        padding: '12px 14px',
        background: theme?.inputBg || '#0F172A',
        border: `1px solid ${theme?.border || '#334155'}`,
        borderRadius: '10px',
        color: theme?.text || '#F1F5F9',
        fontSize: '0.9rem',
        outline: 'none'
    };

    return (
        <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1} style={modalStyle} onClick={onClose}>
            <div style={contentStyle} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '1.25rem 1.5rem',
                    borderBottom: `1px solid ${theme?.border || '#334155'}`
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '10px',
                            background: 'rgba(245,158,11,0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <RotateCcw size={20} color="#F59E0B" />
                        </div>
                        <div>
                            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: theme?.text || '#F1F5F9', margin: 0 }}>
                                Request Revision
                            </h2>
                            <p style={{ fontSize: '0.8rem', color: theme?.textMuted || '#94A3B8', margin: '2px 0 0' }}>
                                {order['DIE NO']} - Order #{order['Order No']}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '8px',
                            background: 'transparent',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            color: theme?.textMuted || '#94A3B8'
                        }}
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div style={{ padding: '1.5rem' }}>
                    {/* Target Status Selection */}
                    <div style={{ marginBottom: '1.25rem' }}>
                        <label style={{
                            display: 'block',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            color: theme?.textMuted || '#94A3B8',
                            marginBottom: '8px'
                        }}>
                            Send Back To
                        </label>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            {options.map(option => (
                                <button
                                    key={option.value}
                                    onClick={() => setTargetStatus(option.value)}
                                    style={{
                                        flex: 1,
                                        padding: '12px 16px',
                                        background: targetStatus === option.value
                                            ? 'rgba(245,158,11,0.2)'
                                            : theme?.inputBg || '#0F172A',
                                        border: `2px solid ${targetStatus === option.value ? '#F59E0B' : (theme?.border || '#334155')}`,
                                        borderRadius: '10px',
                                        color: targetStatus === option.value ? '#F59E0B' : (theme?.text || '#F1F5F9'),
                                        fontSize: '0.9rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Revision Notes */}
                    <div style={{ marginBottom: '1.25rem' }}>
                        <label style={{
                            display: 'block',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            color: theme?.textMuted || '#94A3B8',
                            marginBottom: '8px'
                        }} htmlFor="revisionmodal-revision-notes">
                            Revision Notes <span style={{ color: '#EF4444' }}>*</span>
                        </label>
                        <textarea id="revisionmodal-revision-notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Describe what needs to be revised..."
                            rows={4}
                            style={{
                                ...inputStyle,
                                resize: 'vertical',
                                minHeight: '100px'
                            }}
                        />
                    </div>

                    {/* PDF Upload */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{
                            display: 'block',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            color: theme?.textMuted || '#94A3B8',
                            marginBottom: '8px'
                        }}>
                            Revision Document (optional)
                        </label>
                        <div style={{
                            border: `2px dashed ${theme?.border || '#334155'}`,
                            borderRadius: '10px',
                            padding: '1.25rem',
                            textAlign: 'center',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            background: pdfFile ? 'rgba(16,185,129,0.1)' : 'transparent'
                        }}
                            onClick={() => document.getElementById('revision-pdf-input').click()}
                        >
                            <input
                                id="revision-pdf-input"
                                type="file"
                                accept=".pdf"
                                onChange={handleFileChange}
                                style={{ display: 'none' }}
                            />
                            {pdfFile ? (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                                    <FileText size={20} color="#10B981" />
                                    <span style={{ color: '#10B981', fontWeight: 600 }}>{pdfFile.name}</span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setPdfFile(null); }}
                                        style={{
                                            padding: '4px',
                                            background: 'rgba(239,68,68,0.2)',
                                            border: 'none',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            color: '#EF4444'
                                        }}
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <Upload size={24} color={theme?.textMuted || '#94A3B8'} style={{ marginBottom: '8px' }} />
                                    <p style={{ color: theme?.textMuted || '#94A3B8', fontSize: '0.85rem', margin: 0 }}>
                                        Click to upload PDF with revision details
                                    </p>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Warning */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '10px',
                        padding: '12px',
                        background: 'rgba(245,158,11,0.1)',
                        borderRadius: '8px',
                        marginBottom: '1.5rem'
                    }}>
                        <AlertTriangle size={18} color="#F59E0B" style={{ flexShrink: 0, marginTop: '2px' }} />
                        <p style={{ fontSize: '0.8rem', color: '#F59E0B', margin: 0 }}>
                            This will increment the revision counter and send the order back for rework.
                            The revision date and notes will be recorded.
                        </p>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button
                            onClick={onClose}
                            style={{
                                flex: 1,
                                padding: '12px',
                                background: 'transparent',
                                border: `1px solid ${theme?.border || '#334155'}`,
                                borderRadius: '10px',
                                color: theme?.text || '#F1F5F9',
                                fontSize: '0.9rem',
                                fontWeight: 600,
                                cursor: 'pointer'
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={isSubmitting || !notes.trim()}
                            style={{
                                flex: 1,
                                padding: '12px',
                                background: isSubmitting || !notes.trim() ? '#64748B' : '#F59E0B',
                                border: 'none',
                                borderRadius: '10px',
                                color: 'white',
                                fontSize: '0.9rem',
                                fontWeight: 600,
                                cursor: isSubmitting || !notes.trim() ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px'
                            }}
                        >
                            <RotateCcw size={16} />
                            {isSubmitting ? 'Submitting...' : 'Request Revision'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default RevisionModal;
