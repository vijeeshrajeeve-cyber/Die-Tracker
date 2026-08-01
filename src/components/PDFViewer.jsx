import React, { useState, useRef, useEffect } from 'react';
import { X, Save, PenTool, Type, Eraser, Download } from 'lucide-react';

const PDFViewer = ({ file, onClose, onSave, initialNotes = '', initialSignature = null }) => {
    const [notes, setNotes] = useState(initialNotes);
    const [activeTab, setActiveTab] = useState('view'); // view, notes, sign
    const canvasRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [signatureData, setSignatureData] = useState(initialSignature);

    // Initialize canvas for signature
    useEffect(() => {
        let isMounted = true;
        if (activeTab === 'sign' && canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (!ctx) return;

            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.strokeStyle = '#000000';

            // Load existing signature if any
            if (signatureData) {
                const img = new Image();
                img.onload = () => {
                    // Only draw if component matches expected state and refs are valid
                    if (isMounted && activeTab === 'sign' && canvasRef.current) {
                        const currentCtx = canvasRef.current.getContext('2d');
                        if (currentCtx) {
                            currentCtx.drawImage(img, 0, 0);
                        }
                    }
                };
                img.src = signatureData;
            }
        }
        return () => { isMounted = false; };
    }, [activeTab, signatureData]);

    // Create Object URL for the file if it's a File object, carefully managing memory
    const fileUrl = React.useMemo(() => {
        return file instanceof File ? URL.createObjectURL(file) : file;
    }, [file]);

    // Cleanup Object URL on unmount or file change
    useEffect(() => {
        return () => {
            if (file instanceof File && fileUrl) {
                URL.revokeObjectURL(fileUrl);
            }
        };
    }, [file, fileUrl]);

    const startDrawing = ({ nativeEvent }) => {
        if (activeTab !== 'sign' || !canvasRef.current) return;
        const { offsetX, offsetY } = nativeEvent;
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        ctx.beginPath();
        ctx.moveTo(offsetX, offsetY);
        setIsDrawing(true);
    };

    const draw = ({ nativeEvent }) => {
        if (!isDrawing || activeTab !== 'sign' || !canvasRef.current) return;
        const { offsetX, offsetY } = nativeEvent;
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;

        ctx.lineTo(offsetX, offsetY);
        ctx.stroke();
    };

    const stopDrawing = () => {
        if (!isDrawing || !canvasRef.current) return;
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
            ctx.closePath();
            setSignatureData(canvasRef.current.toDataURL());
        }
        setIsDrawing(false);
    };

    const clearSignature = () => {
        if (!canvasRef.current) return;
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            setSignatureData(null);
        }
    };

    const handleSave = () => {
        onSave({
            notes,
            signature: signatureData
        });
        onClose();
    };

    return (
        <div
            onClick={(e) => e.stopPropagation()}
            style={{
                position: 'fixed', inset: 0, zIndex: 2000,
                background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(5px)',
                display: 'flex', flexDirection: 'column'
            }}>
            {/* Toolbar */}
            <div style={{
                height: '60px', background: '#1E293B', borderBottom: '1px solid #334155',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0 20px', color: 'white'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem' }}>PDF Viewer</h3>
                    <div style={{ display: 'flex', background: '#0F172A', borderRadius: '8px', padding: '4px' }}>
                        <button
                            type="button"
                            onClick={() => setActiveTab('view')}
                            style={{
                                background: activeTab === 'view' ? '#3B82F6' : 'transparent',
                                color: activeTab === 'view' ? 'white' : '#94A3B8',
                                border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem'
                            }}
                        >
                            View
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('notes')}
                            style={{
                                background: activeTab === 'notes' ? '#3B82F6' : 'transparent',
                                color: activeTab === 'notes' ? 'white' : '#94A3B8',
                                border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem'
                            }}
                        >
                            <Type size={16} /> Notes
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('sign')}
                            style={{
                                background: activeTab === 'sign' ? '#3B82F6' : 'transparent',
                                color: activeTab === 'sign' ? 'white' : '#94A3B8',
                                border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem'
                            }}
                        >
                            <PenTool size={16} /> Signature
                        </button>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        type="button"
                        onClick={handleSave}
                        style={{
                            background: '#10B981', color: 'white', border: 'none',
                            padding: '8px 16px', borderRadius: '8px', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 500
                        }}
                    >
                        <Save size={18} /> Save & Close
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            background: 'transparent', color: '#94A3B8', border: 'none',
                            cursor: 'pointer', padding: '8px', borderRadius: '8px'
                        }}
                    >
                        <X size={24} />
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {/* PDF View (Always visible on left/center) */}
                <div style={{ flex: 1, background: '#334155', position: 'relative' }}>
                    <iframe
                        src={`${fileUrl}#toolbar=0`}
                        style={{ width: '100%', height: '100%', border: 'none' }}
                        title="PDF Preview"
                    />
                </div>

                {/* Sidebar for Notes/Signature */}
                {(activeTab === 'notes' || activeTab === 'sign') && (
                    <div style={{
                        width: '350px', background: '#1E293B', borderLeft: '1px solid #334155',
                        padding: '20px', display: 'flex', flexDirection: 'column'
                    }}>
                        {activeTab === 'notes' && (
                            <>
                                <h4 style={{ color: 'white', marginTop: 0 }}>Comments & Notes</h4>
                                <textarea
                                    aria-label="Comments and notes"
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="Add your comments here..."
                                    style={{
                                        flex: 1, width: '100%', background: '#0F172A', border: '1px solid #334155',
                                        borderRadius: '8px', padding: '12px', color: 'white', resize: 'none',
                                        fontSize: '0.95rem', lineHeight: '1.5', outline: 'none'
                                    }}
                                />
                            </>
                        )}

                        {activeTab === 'sign' && (
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                    <h4 style={{ color: 'white', margin: 0 }}>Add Signature</h4>
                                    <button type="button" onClick={clearSignature} style={{ background: '#EF4444', border: 'none', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <Eraser size={14} /> Clear
                                    </button>
                                </div>
                                <div style={{ background: 'white', borderRadius: '8px', overflow: 'hidden', height: '200px', cursor: 'crosshair' }}>
                                    <canvas
                                        ref={canvasRef}
                                        width={310}
                                        height={200}
                                        onMouseDown={startDrawing}
                                        onMouseMove={draw}
                                        onMouseUp={stopDrawing}
                                        onMouseLeave={stopDrawing}
                                        style={{ width: '100%', height: '100%', touchAction: 'none' }}
                                    />
                                </div>
                                <p style={{ color: '#94A3B8', fontSize: '0.8rem', marginTop: '10px' }}>
                                    Sign in the white box above using your mouse or trackpad.
                                    Your signature will be saved with this document.
                                </p>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PDFViewer;
