import React, { useEffect } from 'react';
import { X, Download } from 'lucide-react';

// Full-screen, view-only preview of a PDF: a File (a picked or fetched one) or a URL.
const PDFViewer = ({ file, name, onClose }) => {
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

    const fileName = name || (file instanceof File ? file.name : 'document.pdf');

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
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                padding: '0 20px', color: 'white'
            }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</h3>
                <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
                    <a
                        href={fileUrl}
                        download={fileName}
                        style={{
                            background: '#3B82F6', color: 'white', textDecoration: 'none',
                            padding: '8px 16px', borderRadius: '8px',
                            display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 500
                        }}
                    >
                        <Download size={18} /> Download
                    </a>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        style={{
                            background: 'transparent', color: '#94A3B8', border: 'none',
                            cursor: 'pointer', padding: '8px', borderRadius: '8px'
                        }}
                    >
                        <X size={24} />
                    </button>
                </div>
            </div>

            <div style={{ flex: 1, background: '#334155' }}>
                <iframe
                    src={`${fileUrl}#toolbar=0`}
                    style={{ width: '100%', height: '100%', border: 'none' }}
                    title={fileName}
                />
            </div>
        </div>
    );
};

export default PDFViewer;
