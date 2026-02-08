import React, { useState, useCallback } from 'react';
import { FileText, X, AlertTriangle, CheckCircle, Edit2, Trash2 } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { MONTHS } from '../../utils/constants';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * PI (Purchase Instruction) Import Modal
 * Imports multiple die orders from purchase team PDF documents sent to suppliers
 */
function PIImportModal({ onClose, onImportRecords, existingOrders = [] }) {
    const [dragActive, setDragActive] = useState(false);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [importing, setImporting] = useState(false);
    const [preview, setPreview] = useState(null);
    const [editingIndex, setEditingIndex] = useState(null);

    // Parse date in DD/MM/YYYY format to YYYY-MM-DD
    const parseDateDMY = (dateStr) => {
        if (!dateStr) return null;
        // Handle both DD/MM/YYYY and DD-MM-YYYY formats
        const match = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (match) {
            const [, day, month, year] = match;
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
        return null;
    };

    // Extract Order No from PR number (e.g., "8429-26" -> "8429")
    const extractOrderNo = (prNumber) => {
        if (!prNumber) return null;
        // Get first 4 digits
        const match = prNumber.match(/(\d{4})/);
        return match ? match[1] : null;
    };

    // Parse die size from specification string (e.g., "Dia 355X200; CAV 1; PH" -> "355X200")
    const parseDieSize = (spec) => {
        if (!spec) return null;
        const match = spec.match(/(?:Dia\s*)?(\d{2,4}[Xx]\d{2,4})/i);
        return match ? match[1].toUpperCase() : null;
    };

    // Parse cavity count from specification string (e.g., "CAV 2" or "2 CAV" -> 2)
    const parseCavity = (spec) => {
        if (!spec) return 0;
        // Pattern 1: "CAV 2" or "CAV2"
        let match = spec.match(/CAV\s*(\d+)/i);
        if (match) return parseInt(match[1], 10);
        // Pattern 2: "2 CAV" or "1CAV"
        match = spec.match(/(\d+)\s*CAV/i);
        if (match) return parseInt(match[1], 10);
        // Pattern 3: Just number between semicolons like "; 1 ;" in specs
        match = spec.match(/;\s*(\d+)\s*;/);
        if (match) return parseInt(match[1], 10);
        return 0;
    };

    // Parse die type from specification (PH = Hollow, SF = Solid)
    const parseDieType = (spec, justification) => {
        // First check justification for NEW/BACKUP mapping
        if (justification) {
            const just = justification.toUpperCase().trim();
            if (just === 'NEW') return 'N';
            if (just === 'BACKUP') return 'B';
        }
        // Fallback to specification type
        if (spec) {
            if (/\bPH\b/i.test(spec) || /hollow/i.test(spec)) return 'N'; // Hollow
            if (/\bSF\b/i.test(spec) || /solid/i.test(spec)) return 'B'; // Solid
        }
        return null;
    };

    // Parse the PI PDF content
    const parsePIPDFContent = async (file) => {
        setError(null);
        setLoading(true);
        setPreview(null);

        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            let fullText = '';
            let page1Text = ''; // Die orders are only on page 1 (justification form)

            // Extract text from all pages
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join(' ');
                fullText += pageText + '\n';
                // Store page 1 separately - die orders are only in the justification form
                if (i === 1) {
                    page1Text = pageText;
                }
            }

            // Extract header information
            // PR Number (e.g., "PR 8429-26")
            const prMatch = fullText.match(/PR\s*(\d{4}(?:-\d+)?)/i);
            const prNumber = prMatch ? prMatch[1] : null;
            const orderNo = extractOrderNo(prNumber);

            // Date (e.g., "Date: 16/01/2026" or "Date:" followed by newline and date)
            // NOTE: PDF.js text extraction doesn't always preserve the date text correctly
            // Try multiple patterns since PDF text extraction can vary
            let orderDate = null;
            // Pattern 1: Date followed by date on same line or with whitespace/newlines
            const dateMatch1 = fullText.match(/Date[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i);
            if (dateMatch1) {
                orderDate = parseDateDMY(dateMatch1[1]);
            }
            // Pattern 2: Look for any DD/MM/YYYY pattern in entire text
            if (!orderDate) {
                const dateMatch2 = fullText.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/);
                if (dateMatch2) {
                    orderDate = parseDateDMY(dateMatch2[1]);
                }
            }
            // Pattern 3: If still no date, use today's date as fallback
            if (!orderDate) {
                const today = new Date();
                orderDate = today.toISOString().split('T')[0]; // YYYY-MM-DD
            }

            // Supplier extraction - PDF.js doesn't reliably extract "Die Supplier: PHME" 
            // So we extract from the filename which contains the supplier code (e.g., "8429-26 PHME. DIE ORDER.pdf")
            let supplier = 'UNKNOWN';
            // Try to extract supplier from filename first (most reliable)
            const filenameSupplierMatch = file.name.match(/\d{4}-\d+\s+([A-Z]+)\./i);
            if (filenameSupplierMatch) {
                supplier = filenameSupplierMatch[1].toUpperCase();
            } else {
                // Fallback: try to find supplier in PDF text
                // Look for common supplier names
                const knownSuppliers = ['PHME', 'JIANGSU', 'ALUMAT', 'WEFA', 'AQF'];
                for (const s of knownSuppliers) {
                    if (fullText.toUpperCase().includes(s)) {
                        supplier = s;
                        break;
                    }
                }
            }

            // Shipment type - detect checkmark by looking for patterns
            // In PDF text, checkmarks often appear near the selected option
            // Look for "LAND" or "AIR" that appears with a checkmark indicator
            let shipmentType = 'LAND'; // Default

            // Check for patterns indicating AIR is selected
            // Often checkmarks appear as special characters or the word appears in a specific context
            if (/AIR\s*(?:✓|√|☑|✔|X|x|\*)/i.test(fullText) ||
                /(?:✓|√|☑|✔|X|x|\*)\s*AIR/i.test(fullText) ||
                /By\s*Air/i.test(fullText)) {
                shipmentType = 'AIR';
            } else if (/LAND\s*(?:✓|√|☑|✔|X|x|\*)/i.test(fullText) ||
                /(?:✓|√|☑|✔|X|x|\*)\s*LAND/i.test(fullText) ||
                /By\s*Road/i.test(fullText)) {
                shipmentType = 'LAND';
            }

            // Extract die order rows using multiple patterns
            // Die numbers appear with different formats:
            // - Standard with suffix: "D 11598-438", "E 12003-505", "30559-601"
            // - INS format: "INS-29957" (no suffix)
            // - Exclude PR numbers like "PR 8442-26"
            const dieNumbers = [];

            // Pattern 1: Die numbers with D/E/F prefix (standard format with suffix)
            // Matches: "D   11598-438", "E   12003-505"
            const prefixedDiePattern = /(?:^|[^A-Z])([DEF]\s+)(\d{4,5})\s*[-_]\s*(\d{2,4})/gi;
            for (const m of page1Text.matchAll(prefixedDiePattern)) {
                dieNumbers.push(`${m[2]}-${m[3]}`);
            }

            // Pattern 2: INS prefixed dies (may or may not have suffix)
            // Matches: "INS-29957", "INS29957", "INS-29957-001"
            const insPattern = /INS[-\s]*(\d{5})(?:\s*[-_]\s*(\d{2,4}))?/gi;
            for (const m of page1Text.matchAll(insPattern)) {
                const dieNo = m[2] ? `INS-${m[1]}-${m[2]}` : `INS-${m[1]}`;
                dieNumbers.push(dieNo);
            }

            // Pattern 3: Die numbers in table rows (30559-601 format without letter prefix)
            // Check context to exclude PR numbers
            const tableDiePattern = /(\d{5})\s*[-_]\s*(\d{2,4})/gi;
            for (const m of page1Text.matchAll(tableDiePattern)) {
                const dieNo = `${m[1]}-${m[2]}`;
                // Check if preceded by "PR" in context (within 5 chars before match)
                const idx = page1Text.indexOf(m[0]);
                const prevChars = page1Text.substring(Math.max(0, idx - 5), idx).toUpperCase();
                // Only add if not already captured, not preceded by PR, and is 5-digit
                if (!prevChars.includes('PR') && !dieNumbers.includes(dieNo) && m[1].length === 5) {
                    dieNumbers.push(dieNo);
                }
            }

            const uniqueDieNumbers = [...new Set(dieNumbers)];

            // Extract die specifications using multiple patterns:
            // Pattern 1: "Dia 700X500; 1 CAV; PH" or "Dia 220X130; 1 CAV; SF"
            // Pattern 2: "Dia 250X160 4 P5 Hollow" (no semicolons)
            // Pattern 3: "250x160 1 P4" (no Dia prefix)
            const specRows = [];

            // Pattern 1: Full spec with semicolons - "Dia XXXxYYY; N CAV; PH/SF"
            const specPattern1 = /Dia\s*(\d{2,4}[Xx]\d{2,4})\s*[;,]?\s*(\d+)\s*CAV\s*[;,]?\s*(PH|SF|Hollow|Solid)/gi;
            for (const m of page1Text.matchAll(specPattern1)) {
                specRows.push({
                    size: m[1].toUpperCase(),
                    cavity: parseInt(m[2], 10),
                    type: m[3].toUpperCase()
                });
            }

            // Pattern 2: "Dia XXXxYYY N P# Type" format (no semicolons)
            const specPattern2 = /Dia\s*(\d{2,4}[Xx]\d{2,4})\s+(\d+)\s+P\d+\s+(Hollow|Solid)/gi;
            for (const m of page1Text.matchAll(specPattern2)) {
                specRows.push({
                    size: m[1].toUpperCase(),
                    cavity: parseInt(m[2], 10),
                    type: m[3].toUpperCase()
                });
            }

            // Pattern 3: Specification rows from table with die number context
            // Look for "DieNo ... Dia XXXxYYY ... CAV/cavity ... PH/SF"
            for (const dieNo of uniqueDieNumbers) {
                const escapedDieNo = dieNo.replace(/[-_]/g, '\\s*[-_]\\s*');
                // Look for die number followed by spec within ~200 chars
                const contextPattern = new RegExp(escapedDieNo + '[^]*?(?:Dia\\s*)?(\\d{2,4}[Xx]\\d{2,4})[^]*?(\\d+)\\s*(?:CAV|P\\d)', 'i');
                const contextMatch = page1Text.match(contextPattern);
                if (contextMatch && !specRows.some(s => s.forDie === dieNo)) {
                    const sizeMatch = contextMatch[1];
                    const cavityMatch = contextMatch[2] ? parseInt(contextMatch[2], 10) : 0;
                    // Check for type near this context
                    const typeContext = page1Text.substring(page1Text.indexOf(dieNo), page1Text.indexOf(dieNo) + 200);
                    const typeMatch = typeContext.match(/\b(PH|SF|Hollow|Solid)\b/i);
                    specRows.push({
                        size: sizeMatch?.toUpperCase() || null,
                        cavity: cavityMatch,
                        type: typeMatch ? typeMatch[1].toUpperCase() : null,
                        forDie: dieNo
                    });
                }
            }

            // Extract justifications (NEW, BACKUP, TOP URGENT, URGENT)
            const justificationPattern = /\b(NEW|BACKUP)(?:\s*\((?:TOP\s+)?URGENT\))?/gi;
            const justifications = [...fullText.matchAll(justificationPattern)].map(m => m[1].toUpperCase());

            // Build die orders from extracted data
            // Debug: Log existing orders for matching
            console.log('PI Import - Existing orders count:', existingOrders.length);
            console.log('PI Import - Die numbers to import:', uniqueDieNumbers);
            console.log('PI Import - Extracted specifications:', specRows);

            const orders = uniqueDieNumbers.map((dieNo, index) => {
                // Try to find specification by forDie match first, then by index
                const spec = specRows.find(s => s.forDie === dieNo) || specRows[index] || {};
                const justification = justifications[index] || null;
                const dieType = parseDieType(spec.type || '', justification);

                // Get month from date
                const month = orderDate ? MONTHS[new Date(orderDate).getMonth()] : null;

                // Check if this die order already exists in the system
                const existingOrder = existingOrders.find(o => o['DIE NO'] === dieNo);
                console.log(`PI Import - Checking ${dieNo}: found=${!!existingOrder}, id=${existingOrder?.id}`);

                return {
                    'id': existingOrder?.id || null, // Keep existing ID for updates
                    'isExisting': !!existingOrder, // Flag to indicate if this is an update
                    'Plant': existingOrder?.Plant || 'EXT 1',
                    'Order No': orderNo || existingOrder?.['Order No'] || `PI-${Date.now().toString().slice(-6)}`,
                    'DIE NO': dieNo,
                    'TYPE': dieType || existingOrder?.TYPE,
                    'Die Size': spec.size || existingOrder?.['Die Size'] || 'N/A',
                    'Die Requested Date': existingOrder?.['Die Requested Date'] || null,
                    'Ordered date': orderDate, // Set from PI document date
                    'Type of shipment': shipmentType,
                    'Mandrels per Cavity': spec.cavity || existingOrder?.['Mandrels per Cavity'] || 0,
                    'Total Mandrels': (spec.cavity || existingOrder?.['Total Mandrels']) || 0,
                    'Design Received Date': existingOrder?.['Design Received Date'] || null,
                    '3D Model Received Date': existingOrder?.['3D Model Received Date'] || null,
                    'simulationEnabled': existingOrder?.simulationEnabled || false,
                    'Design Approved Date': existingOrder?.['Design Approved Date'] || null,
                    'Delay': existingOrder?.Delay || 0,
                    'PR Entry': existingOrder?.['PR Entry'] || null,
                    'Oracle Entry': existingOrder?.['Oracle Entry'] || null,
                    'Supplier': supplier,
                    'STATUS': 'AWAITING FOR DESIGN', // PI import means order placed, now awaiting design
                    'OVERALL DELAY': existingOrder?.['OVERALL DELAY'] || 0,
                    'ETA': existingOrder?.ETA || null,
                    'month': month,
                };
            });

            if (orders.length === 0) {
                setError('No die orders found in the PDF. Please check if this is a valid Die Order PI document.');
                return;
            }

            setPreview({
                orders,
                headerInfo: {
                    prNumber,
                    orderNo,
                    supplier,
                    shipmentType,
                    orderDate
                },
                rawText: fullText.substring(0, 500)
            });
        } catch (err) {
            setError(`PDF parsing error: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const processFile = useCallback((file) => {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            setError('Please upload a PDF file');
            return;
        }
        parsePIPDFContent(file);
    }, []);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        setDragActive(false);
        const file = e.dataTransfer.files[0];
        processFile(file);
    }, [processFile]);

    const handleRemoveOrder = (index) => {
        setPreview(prev => ({
            ...prev,
            orders: prev.orders.filter((_, i) => i !== index)
        }));
    };

    const handleEditOrder = (index, field, value) => {
        setPreview(prev => ({
            ...prev,
            orders: prev.orders.map((order, i) =>
                i === index ? { ...order, [field]: value } : order
            )
        }));
    };

    const handleImportAll = async () => {
        if (preview?.orders?.length > 0) {
            setImporting(true);
            try {
                await onImportRecords(preview.orders);
            } catch (error) {
                console.error('Import failed:', error);
            } finally {
                setImporting(false);
                onClose();
            }
        }
    };

    return (
        <div
            style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem'
            }}
            onClick={onClose}
        >
            <div
                style={{
                    background: '#1E293B', borderRadius: '20px', width: '100%', maxWidth: '900px',
                    maxHeight: '90vh', overflow: 'hidden', border: '1px solid #334155'
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem', borderBottom: '1px solid #334155' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #10B981, #3B82F6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <FileText size={24} color="white" />
                        </div>
                        <div>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#F1F5F9' }}>Import from PI Document</h2>
                            <p style={{ fontSize: '0.875rem', color: '#64748B' }}>Upload Die Order PI PDF from purchase team</p>
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', padding: '8px', borderRadius: '8px' }}>
                        <X size={24} />
                    </button>
                </div>

                {/* Content */}
                <div style={{ padding: '1.5rem', overflowY: 'auto', maxHeight: '65vh' }}>
                    {!preview && (
                        <div
                            style={{
                                border: `2px dashed ${dragActive ? '#10B981' : '#334155'}`,
                                borderRadius: '16px', padding: '2.5rem', textAlign: 'center',
                                background: dragActive ? 'rgba(16,185,129,0.1)' : 'transparent', marginBottom: '1rem'
                            }}
                            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                            onDragLeave={() => setDragActive(false)}
                            onDrop={handleDrop}
                        >
                            <FileText size={48} color="#64748B" />
                            <p style={{ fontSize: '1rem', color: '#F1F5F9', marginTop: '1rem' }}>Drag & drop your PI PDF file here</p>
                            <p style={{ color: '#64748B', margin: '0.5rem 0' }}>or</p>
                            <label style={{ display: 'inline-block', padding: '0.75rem 1.5rem', background: 'linear-gradient(135deg, #10B981, #3B82F6)', color: 'white', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
                                Browse PI PDF Files
                                <input type="file" accept=".pdf" onChange={(e) => processFile(e.target.files[0])} hidden />
                            </label>
                            <p style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '1rem' }}>Supports Die Order PI documents with multiple orders</p>
                        </div>
                    )}

                    {loading && (
                        <div style={{ textAlign: 'center', padding: '2rem' }}>
                            <div style={{ width: '40px', height: '40px', border: '3px solid #334155', borderTopColor: '#10B981', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
                            <p style={{ color: '#94A3B8', marginTop: '1rem' }}>Extracting die orders from PI document...</p>
                            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                        </div>
                    )}

                    {error && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(244,63,94,0.1)', color: '#F43F5E', padding: '0.875rem 1rem', borderRadius: '10px', marginBottom: '1rem' }}>
                            <AlertTriangle size={18} />
                            <span>{error}</span>
                        </div>
                    )}

                    {preview && (
                        <>
                            {/* Header Info */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(16,185,129,0.1)', padding: '1rem', borderRadius: '10px', marginBottom: '1rem' }}>
                                <CheckCircle size={20} color="#10B981" />
                                <div style={{ flex: 1 }}>
                                    <p style={{ fontWeight: 600, color: '#10B981' }}>PI Document Parsed Successfully</p>
                                    <p style={{ fontSize: '0.8rem', color: '#94A3B8' }}>
                                        Found {preview.orders.length} die orders • Order: {preview.headerInfo.orderNo || 'N/A'} • Supplier: {preview.headerInfo.supplier} • Shipment: {preview.headerInfo.shipmentType} • Date: {preview.headerInfo.orderDate || 'N/A'}
                                    </p>
                                    {preview.orders.some(o => o.isExisting) && (
                                        <p style={{ fontSize: '0.75rem', color: '#F59E0B', marginTop: '4px' }}>
                                            ⚠️ {preview.orders.filter(o => o.isExisting).length} order(s) already exist and will be updated
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Orders Table */}
                            <div style={{ background: '#0F172A', borderRadius: '12px', overflow: 'hidden', marginBottom: '1rem' }}>
                                <h4 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: '#64748B', padding: '1rem', borderBottom: '1px solid #334155' }}>
                                    Extracted Die Orders ({preview.orders.length})
                                </h4>
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                        <thead>
                                            <tr style={{ background: '#1E293B' }}>
                                                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Die No</th>
                                                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Size</th>
                                                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Type</th>
                                                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Cavity</th>
                                                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Supplier</th>
                                                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Shipment</th>
                                                <th style={{ padding: '10px 12px', textAlign: 'center', color: '#64748B', fontWeight: 600 }}>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {preview.orders.map((order, index) => (
                                                <tr key={index} style={{ borderBottom: '1px solid #334155', background: order.isExisting ? 'rgba(245,158,11,0.05)' : 'transparent' }}>
                                                    <td style={{ padding: '10px 12px', color: '#F1F5F9', fontFamily: 'monospace' }}>
                                                        {order['DIE NO']}
                                                        {order.isExisting && <span style={{ marginLeft: '6px', fontSize: '0.65rem', padding: '2px 6px', background: 'rgba(245,158,11,0.2)', color: '#F59E0B', borderRadius: '4px' }}>UPDATE</span>}
                                                    </td>
                                                    <td style={{ padding: '10px 12px', color: '#F1F5F9' }}>{order['Die Size']}</td>
                                                    <td style={{ padding: '10px 12px' }}>
                                                        <select
                                                            value={order.TYPE || ''}
                                                            onChange={(e) => handleEditOrder(index, 'TYPE', e.target.value || null)}
                                                            style={{ background: '#334155', border: 'none', borderRadius: '4px', padding: '4px 8px', color: '#F1F5F9', fontSize: '0.8rem' }}
                                                        >
                                                            <option value="">—</option>
                                                            <option value="N">N - New</option>
                                                            <option value="B">B - Backup</option>
                                                            <option value="T">T - Tooling</option>
                                                            <option value="C">C - Cancelled</option>
                                                            <option value="H">H - Hold</option>
                                                        </select>
                                                    </td>
                                                    <td style={{ padding: '10px 12px', color: '#F1F5F9' }}>{order['Mandrels per Cavity']}</td>
                                                    <td style={{ padding: '10px 12px', color: '#F1F5F9' }}>{order.Supplier}</td>
                                                    <td style={{ padding: '10px 12px' }}>
                                                        <span style={{
                                                            padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600,
                                                            background: order['Type of shipment'] === 'AIR' ? 'rgba(14,165,233,0.2)' : 'rgba(16,185,129,0.2)',
                                                            color: order['Type of shipment'] === 'AIR' ? '#0EA5E9' : '#10B981'
                                                        }}>
                                                            {order['Type of shipment']}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                                        <button
                                                            onClick={() => handleRemoveOrder(index)}
                                                            style={{ padding: '6px', background: 'rgba(239,68,68,0.1)', border: 'none', borderRadius: '6px', color: '#EF4444', cursor: 'pointer' }}
                                                            title="Remove this order"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <button
                                onClick={() => setPreview(null)}
                                style={{ width: '100%', padding: '0.5rem', background: 'transparent', border: '1px solid #334155', borderRadius: '8px', color: '#94A3B8', cursor: 'pointer' }}
                            >
                                Upload Different PI Document
                            </button>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '1.25rem 1.5rem', borderTop: '1px solid #334155' }}>
                    <button onClick={onClose} disabled={importing} style={{ padding: '0.75rem 1.5rem', background: '#334155', color: '#F1F5F9', border: '1px solid #475569', borderRadius: '10px', fontWeight: 600, cursor: importing ? 'not-allowed' : 'pointer', opacity: importing ? 0.5 : 1 }}>
                        Cancel
                    </button>
                    <button
                        onClick={handleImportAll}
                        disabled={!preview || preview.orders.length === 0 || importing}
                        style={{
                            padding: '0.75rem 1.5rem',
                            background: (preview?.orders?.length > 0 && !importing) ? 'linear-gradient(135deg, #10B981, #3B82F6)' : '#475569',
                            color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600,
                            cursor: (preview?.orders?.length > 0 && !importing) ? 'pointer' : 'not-allowed',
                            opacity: (preview?.orders?.length > 0 && !importing) ? 1 : 0.5,
                            display: 'flex', alignItems: 'center', gap: '8px'
                        }}
                    >
                        {importing && <div style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />}
                        {importing ? 'Importing...' : `Import ${preview?.orders?.length || 0} Die Orders`}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default PIImportModal;
