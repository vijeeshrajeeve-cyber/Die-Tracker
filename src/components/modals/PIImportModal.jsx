import React, { useState, useCallback } from 'react';
import { FileText, X, AlertTriangle, CheckCircle, Trash2 } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { MONTHS } from '../../utils/constants';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Plant mapping: Org code from PI document -> Plant name in system
const PLANT_MAP = {
    'AUH': 'GEX 2',
    'DXB': 'GEX 1',
};

// Press code -> Plant fallback (when Org column has checkboxes instead of text)
// Numeric press codes (25, 35) are AUH/GEX 2 presses; letter codes (B, D, E, F) are DXB/GEX 1 presses
const PRESS_TO_PLANT = {
    '25': 'GEX 2',
    '35': 'GEX 2',
    'B': 'GEX 1',
    'D': 'GEX 1',
    'E': 'GEX 1',
    'F': 'GEX 1',
};

/**
 * PI (Purchase Instruction) Import Modal
 * Imports multiple die orders from purchase team PDF documents sent to suppliers.
 *
 * Parsing approach: Uses PDF.js text extraction with Y-position grouping to
 * reconstruct table rows from the Die Order Justification Form (page 1).
 * Each row is parsed as a unit, keeping die number, spec, plant, and customer ref together.
 */
function PIImportModal({ onClose, onImportRecords, existingOrders = [] }) {
    const [dragActive, setDragActive] = useState(false);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [importing, setImporting] = useState(false);
    const [preview, setPreview] = useState(null);

    // Parse date in DD/MM/YYYY format to YYYY-MM-DD
    const parseDateDMY = (dateStr) => {
        if (!dateStr) return null;
        const match = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (match) {
            const [, day, month, year] = match;
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
        return null;
    };

    /**
     * Parse a single table row text into structured die order data.
     * Row format from PDF extraction (pipe-separated by position):
     *   PressCode | DieNo | DieSpec | [Mandrel] | [Wt/m] | [DeliveryDate] | Org | CustomerRef
     *
     * Examples from real PDFs:
     *   "E | 28836-514 | Dia 440X250; 4 CAV; PH | 2 | DXB | BACKUP (TOP URGENT)"
     *   "25 | 005037-2503 | DIA 280X160; 2 CAV; PH | 1 | AUH | BACKUP"
     *   "35 | 051150-3502 | Dia 450X260; 1 CAV; PH | 7 | 5.573 | AUH | NEW (TOP URGENT)"
     *   "F | INS-30573 | DIA 460X150; 1 CAV | DXB | NEW (TOP URGENT)"
     *   "35 | 024216-3506 | 450X250; 2 CAV; SF | 2.800 | 01/03/2026 | AUH | BACKUP (TOP URGENT)"
     *   "F | 28115-603 | Dia 700x312 | BACKUP (TOP URGENT)"
     */
    const parseTableRow = (rowText) => {
        if (!rowText || rowText.trim().length < 10) return null;

        const text = rowText.trim();

        // Extract die number - the most reliable anchor point
        // Formats: "28836-514", "005037-2503", "032029-2501", "INS-30573", "14488-501", "30559 -601"
        const dieNoMatch = text.match(/\b(INS[-\s]*\d{5}(?:\s*[-]\s*\d{1,4})?|\d{3,6}\s*[-]\s*\d{2,4})\b/i);
        if (!dieNoMatch) return null;

        const rawDieNo = dieNoMatch[0].replace(/\s+/g, '');
        // Normalize INS format
        const dieNo = rawDieNo.replace(/^INS\s*-?\s*/i, 'INS-');

        // Extract die specifications - look for size pattern
        // Formats: "Dia 440X250; 4 CAV; PH", "DIA 280X160; 2 CAV; PH", "450X250; 2 CAV; SF", "Dia 700x312"
        const sizeMatch = text.match(/(?:Dia\s*)?(\d{2,4}[Xx×]\d{2,4})/i);
        const dieSize = sizeMatch ? sizeMatch[1].toUpperCase().replace('×', 'X') : null;

        // Extract cavity count: "N CAV" or "CAV N"
        let cavity = 0;
        const cavMatch = text.match(/(\d+)\s*CAV/i) || text.match(/CAV\s*(\d+)/i);
        if (cavMatch) cavity = parseInt(cavMatch[1], 10);

        // Extract mandrel count - a standalone small digit (1-9) that appears after the spec
        // and before Wt/m or Org. It's typically the mandrel count.
        let mandrel = 0;
        const specEndIdx = text.indexOf(dieSize || '') + (dieSize?.length || 0);
        const afterSpec = text.substring(specEndIdx);
        // Look for PH/SF followed by a standalone digit
        const mandrelMatch = afterSpec.match(/(?:PH|SF)\s+(\d)\s/i);
        if (mandrelMatch) mandrel = parseInt(mandrelMatch[1], 10);

        // Extract Org/Plant (AUH or DXB)
        let plant = null;
        const orgMatch = text.match(/\b(AUH|DXB)\b/i);
        if (orgMatch) {
            plant = PLANT_MAP[orgMatch[1].toUpperCase()] || orgMatch[1].toUpperCase();
        }

        // Extract press code (before die number) - needed for plant fallback
        const beforeDieNo = text.substring(0, text.indexOf(dieNoMatch[0])).trim();
        const pressCode = beforeDieNo || null;

        // Fallback: infer plant from press code when Org column has checkboxes instead of text
        if (!plant && pressCode) {
            plant = PRESS_TO_PLANT[pressCode.toUpperCase()] || null;
        }

        // Extract Customer Ref for TYPE determination
        // Look for BACKUP or NEW keywords - these determine the order type
        let type = null;
        if (/\bBACKUP\b/i.test(text)) {
            type = 'B';
        } else if (/\bNEW\b/i.test(text)) {
            type = 'N';
        }

        // Extract urgency level
        let urgency = null;
        if (/TOP\s*URGENT/i.test(text)) {
            urgency = 'TOP URGENT';
        } else if (/URGENT/i.test(text)) {
            urgency = 'URGENT';
        }

        // Extract Wt/m (weight per meter) - a decimal number like 0.705, 2.800, 5.573
        let weightPerMeter = null;
        const wtMatch = text.match(/\b(\d+\.\d{2,3})\b/);
        if (wtMatch) {
            const val = parseFloat(wtMatch[1]);
            // Wt/m is typically between 0.1 and 20.0
            if (val >= 0.1 && val <= 20.0) {
                weightPerMeter = val;
            }
        }

        // Extract delivery request date from row (e.g., "01/03/2026")
        let deliveryDate = null;
        const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (dateMatch) {
            deliveryDate = parseDateDMY(dateMatch[1]);
        }

        return {
            dieNo,
            dieSize,
            cavity,
            mandrel,
            plant,
            type,
            urgency,
            weightPerMeter,
            deliveryDate,
            pressCode,
        };
    };

    // Parse the PI PDF content using position-based line grouping
    const parsePIPDFContent = async (file) => {
        setError(null);
        setLoading(true);
        setPreview(null);

        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

            // ── Extract page 1 text with positional data ──
            const page1 = await pdf.getPage(1);
            const textContent = await page1.getTextContent();

            // Group text items by Y position to reconstruct lines
            const linesByY = {};
            for (const item of textContent.items) {
                const y = Math.round(item.transform[5]);
                if (!linesByY[y]) linesByY[y] = [];
                linesByY[y].push({
                    text: item.str,
                    x: Math.round(item.transform[4]),
                });
            }

            // Merge nearby Y positions (within 3px) to handle text wrapping
            // e.g., "BACKUP" at Y=371 should merge into the die row at Y=372
            const sortedYsRaw = Object.keys(linesByY).map(Number).sort((a, b) => b - a);
            const mergedLinesByY = {};
            let currentY = null;
            for (const y of sortedYsRaw) {
                if (currentY !== null && currentY - y <= 3) {
                    // Merge into the current group
                    mergedLinesByY[currentY].push(...linesByY[y]);
                } else {
                    currentY = y;
                    mergedLinesByY[y] = [...(linesByY[y] || [])];
                }
            }

            // Sort merged Y positions descending (top-to-bottom in PDF coords)
            const sortedYs = Object.keys(mergedLinesByY).map(Number).sort((a, b) => b - a);

            // Build line texts sorted by X within each merged Y group
            const lines = sortedYs.map(y => {
                const items = mergedLinesByY[y].sort((a, b) => a.x - b.x);
                return {
                    y,
                    text: items.map(i => i.text).join(' ').trim(),
                    items,
                };
            });

            // Also build the flat page1 text for fallback patterns
            const page1Text = lines.map(l => l.text).join(' ');

            // ── Extract header information from known Y positions ──

            // PR Number - look for "PR NNNN-NN" pattern
            let prNumber = null;
            let orderNo = null;
            for (const line of lines) {
                const prMatch = line.text.match(/PR\s*(\d{4}[-]\d{1,2})/i);
                if (prMatch) {
                    prNumber = prMatch[1];
                    const noMatch = prNumber.match(/(\d{4})/);
                    orderNo = noMatch ? noMatch[1] : null;
                    break;
                }
            }

            // Date - look for "Date:" followed by DD/MM/YYYY
            let orderDate = null;
            for (const line of lines) {
                if (/Date/i.test(line.text)) {
                    const dateMatch = line.text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/);
                    if (dateMatch) {
                        orderDate = parseDateDMY(dateMatch[1]);
                        break;
                    }
                }
            }
            if (!orderDate) {
                // Fallback: first date found in page 1
                const anyDate = page1Text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/);
                if (anyDate) orderDate = parseDateDMY(anyDate[1]);
            }
            if (!orderDate) {
                orderDate = new Date().toISOString().split('T')[0];
            }

            // Supplier - extract from "Die Supplier:" line (always on same line as SHIPMENT VIA)
            let supplier = 'UNKNOWN';
            for (const line of lines) {
                const supplierMatch = line.text.match(/Die\s+Supplier\s*:\s*(\S+)/i);
                if (supplierMatch) {
                    supplier = supplierMatch[1].toUpperCase();
                    break;
                }
            }
            // Fallback: extract from filename (e.g., "8469-26 EKSTEK.pdf")
            if (supplier === 'UNKNOWN') {
                const fnMatch = file.name.match(/\d{4}-\d+\s+([A-Za-z]+)/i);
                if (fnMatch) {
                    supplier = fnMatch[1].toUpperCase();
                }
            }

            // Shipment type - LAND and AIR appear on the SHIPMENT VIA line
            // In the PI form, the selected option has a checkbox mark (often not extractable as text).
            // Heuristic: The supplier name appears next to the SELECTED shipment type in the text.
            // From testing: "SHIPMENT VIA: | LAND | Die Supplier: PHME" and "AIR" on separate line
            // means LAND was checked. When AIR is checked, the layout stays the same but
            // the supplier name appears on the AIR line instead.
            // Safest approach: check page 1 for "By Air" vs "By Road" in the drawing sheet info,
            // but those are on page 2+. For page 1, default to checking if supplier appears
            // next to LAND or AIR line.
            let shipmentType = 'LAND'; // default

            // Find the lines containing LAND and AIR around SHIPMENT VIA
            const shipmentLine = lines.find(l => /SHIPMENT VIA/i.test(l.text));
            const airLine = lines.find(l => /^\s*AIR\s*$/i.test(l.text));

            if (shipmentLine && airLine) {
                // If supplier name is on the SHIPMENT VIA line (which also has LAND), it means LAND is checked
                // If supplier is NOT on that line, check if it's near AIR
                const shipmentHasSupplier = shipmentLine.text.toUpperCase().includes(supplier);
                if (shipmentHasSupplier && shipmentLine.text.toUpperCase().includes('LAND')) {
                    shipmentType = 'LAND';
                }
            }

            // ── Scan drawing pages (2+) for shipment type and requested dates per die ──
            // Each drawing page has an info box with: SUPPLIER/DATE, DIE SIZE, REQUESTED DELIVERY DATE, etc.
            // The "Die Requested Date" is the date next to the SUPPLIER field in the info box.
            // Formats: "SUPPLIER - DATE -" with date on next Y line, or date on same Y as supplier name
            let drawingShipment = null;
            const drawingRequestedDates = {}; // dieNo -> date string

            for (let p = 2; p <= pdf.numPages; p++) {
                const pg = await pdf.getPage(p);
                const tc = await pg.getTextContent();

                // Group by Y for line-based extraction
                const pgLinesByY = {};
                for (const item of tc.items) {
                    const y = Math.round(item.transform[5]);
                    if (!pgLinesByY[y]) pgLinesByY[y] = [];
                    pgLinesByY[y].push({ text: item.str, x: Math.round(item.transform[4]) });
                }
                const pgYs = Object.keys(pgLinesByY).map(Number).sort((a, b) => b - a);
                const pgLines = pgYs.map(y => {
                    const items = pgLinesByY[y].sort((a, b) => a.x - b.x);
                    return items.map(i => i.text).join(' ').trim();
                });
                const pgText = pgLines.join(' ');

                // Extract shipment type (first found wins)
                if (!drawingShipment) {
                    if (/By\s*Air/i.test(pgText)) drawingShipment = 'AIR';
                    else if (/By\s*Road/i.test(pgText)) drawingShipment = 'LAND';
                }

                // Extract die number from drawing page (full format NNNNN-NNN)
                const pgDieMatch = pgText.match(/\b(\d{3,6}\s*[-]\s*\d{2,4})\b/);
                let pgDieNo = pgDieMatch ? pgDieMatch[0].replace(/\s+/g, '') : null;

                // If no full die number found, look for section number at bottom of page
                // and match it to table rows by the base number (before the hyphen)
                let pgSectionNo = null;
                if (!pgDieNo) {
                    // Section numbers appear at the bottom of drawing pages (low Y values)
                    for (let li = pgLines.length - 1; li >= Math.max(0, pgLines.length - 10); li--) {
                        const secMatch = pgLines[li].match(/^\s*(\d{4,6})\s*$/);
                        if (secMatch) { pgSectionNo = secMatch[1]; break; }
                    }
                }

                // Extract Die Requested Date from drawing page info box
                // Strategy: Find "SUPPLIER" line, then look at same line and next 2 lines for a date
                // The date is in the first row of the info box, next to the supplier name
                let pgRequestedDate = null;
                for (let li = 0; li < pgLines.length; li++) {
                    if (/SUPPLIER/i.test(pgLines[li])) {
                        // Check same line and next 2 lines for a date (DD/MM/YYYY or DD-MM-YYYY)
                        for (let j = li; j <= Math.min(li + 2, pgLines.length - 1); j++) {
                            const dm = pgLines[j].match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/);
                            if (dm) { pgRequestedDate = dm[1]; break; }
                        }
                        break;
                    }
                }

                // Fallback for pages without explicit SUPPLIER label:
                // The first date at the top of the page (highest Y) is typically the supplier date
                if (!pgRequestedDate && pgYs.length > 0) {
                    // Scan from top (highest Y) - the info box is at the top of the drawing page
                    for (let li = 0; li < Math.min(5, pgLines.length); li++) {
                        const dm = pgLines[li].match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/);
                        if (dm) { pgRequestedDate = dm[1]; break; }
                    }
                }

                if (pgRequestedDate) {
                    const parsedDate = parseDateDMY(pgRequestedDate);
                    if (pgDieNo) {
                        drawingRequestedDates[pgDieNo] = parsedDate;
                    }
                    // Also store by section number for fallback matching
                    if (pgSectionNo) {
                        drawingRequestedDates['_section_' + pgSectionNo] = parsedDate;
                    }
                    // Store all drawing page dates for common-date fallback
                    if (!drawingRequestedDates._allDates) drawingRequestedDates._allDates = [];
                    drawingRequestedDates._allDates.push(parsedDate);
                }
            }
            if (drawingShipment) shipmentType = drawingShipment;

            // ── Extract die order table rows ──
            // Table data rows are between the header row (contains "Die No/str") and "Ordered By"
            // They contain die number patterns like NNNNN-NNN or INS-NNNNN

            const headerLineIdx = lines.findIndex(l =>
                /Die No\/str/i.test(l.text) || /Die Specifications/i.test(l.text)
            );
            const orderedByIdx = lines.findIndex(l => /Ordered By/i.test(l.text));

            // Data rows are between header and "Ordered By"
            const dataLines = [];
            if (headerLineIdx >= 0 && orderedByIdx >= 0) {
                for (let i = headerLineIdx + 1; i < orderedByIdx; i++) {
                    const lineText = lines[i].text;
                    // Skip empty lines and lines that are just checkbox remnants
                    if (lineText.trim().length < 5) continue;
                    // Must contain a die number pattern to be a valid data row
                    if (/\b(?:INS[-\s]*\d{5}|\d{3,6}\s*[-]\s*\d{2,4})\b/i.test(lineText)) {
                        dataLines.push(lineText);
                    }
                }
            }

            // Fallback: if position-based extraction found nothing, scan all lines
            if (dataLines.length === 0) {
                for (const line of lines) {
                    const text = line.text;
                    // Must have a die number pattern and NOT be a header/footer
                    if (/\b(?:INS[-\s]*\d{5}|\d{3,6}\s*[-]\s*\d{2,4})\b/i.test(text) &&
                        !/PR\s*\d{4}/i.test(text) &&
                        !/Die No\/str/i.test(text) &&
                        !/Order received/i.test(text)) {
                        dataLines.push(text);
                    }
                }
            }

            // Parse each data line into structured order data
            const parsedRows = dataLines
                .map(line => parseTableRow(line))
                .filter(Boolean);

            // Enrich with requested dates from drawing pages when not found in table row
            // First pass: match by exact die number
            const allDrawingDates = Object.entries(drawingRequestedDates)
                .filter(([k]) => !k.startsWith('_section_'))
                .map(([, v]) => v);
            for (const row of parsedRows) {
                if (!row.deliveryDate && drawingRequestedDates[row.dieNo]) {
                    row.deliveryDate = drawingRequestedDates[row.dieNo];
                }
                // Try section number match (base number before hyphen)
                if (!row.deliveryDate) {
                    const baseNo = row.dieNo.replace(/^0+/, '').split('-')[0];
                    const sectionDate = drawingRequestedDates['_section_' + baseNo]
                        || drawingRequestedDates['_section_' + row.dieNo.split('-')[0]];
                    if (sectionDate) row.deliveryDate = sectionDate;
                }
            }
            // Second pass: for dies still without dates, use most common drawing date as fallback
            // (dies in the same PI typically share the same requested date)
            const stillMissing = parsedRows.filter(r => !r.deliveryDate);
            const fallbackDates = drawingRequestedDates._allDates || allDrawingDates;
            if (stillMissing.length > 0 && fallbackDates.length > 0) {
                // Find the most common date from all drawing pages
                const dateCounts = {};
                for (const d of fallbackDates) { dateCounts[d] = (dateCounts[d] || 0) + 1; }
                const commonDate = Object.entries(dateCounts).sort((a, b) => b[1] - a[1])[0][0];
                for (const row of stillMissing) {
                    row.deliveryDate = commonDate;
                }
            }

            // ── Build die orders ──
            const orders = parsedRows.map(row => {
                const month = orderDate ? MONTHS[new Date(orderDate).getMonth()] : null;

                // Check if this die order already exists in the system
                const existingOrder = existingOrders.find(o => o['DIE NO'] === row.dieNo);

                return {
                    'id': existingOrder?.id || null,
                    'isExisting': !!existingOrder,
                    'Plant': row.plant || existingOrder?.Plant || 'GEX 1',
                    'Order No': orderNo || existingOrder?.['Order No'] || `PI-${Date.now().toString().slice(-6)}`,
                    'DIE NO': row.dieNo,
                    'TYPE': row.type || existingOrder?.TYPE || null,
                    'Die Size': row.dieSize || existingOrder?.['Die Size'] || 'N/A',
                    'Die Requested Date': row.deliveryDate || existingOrder?.['Die Requested Date'] || null,
                    'Ordered date': orderDate,
                    'Type of shipment': shipmentType,
                    'Mandrels per Cavity': row.mandrel || existingOrder?.['Mandrels per Cavity'] || 0,
                    'Total Mandrels': (row.mandrel * (row.cavity || 1)) || existingOrder?.['Total Mandrels'] || 0,
                    'Design Received Date': existingOrder?.['Design Received Date'] || null,
                    '3D Model Received Date': existingOrder?.['3D Model Received Date'] || null,
                    'simulationEnabled': existingOrder?.simulationEnabled || false,
                    'Design Approved Date': existingOrder?.['Design Approved Date'] || null,
                    'Delay': existingOrder?.Delay || 0,
                    'PR Entry': existingOrder?.['PR Entry'] || null,
                    'Oracle Entry': existingOrder?.['Oracle Entry'] || null,
                    'Supplier': supplier,
                    // PI import sets an Ordered date, which completes the "Pending for Ordering" stage.
                    // Advance that status; otherwise preserve whatever stage the order is already in.
                    'STATUS': (!existingOrder || existingOrder.STATUS === 'PENDING FOR ORDERING')
                        ? 'AWAITING FOR DESIGN'
                        : existingOrder.STATUS,
                    'OVERALL DELAY': existingOrder?.['OVERALL DELAY'] || 0,
                    'ETA': existingOrder?.ETA || null,
                    'month': month,
                    // Extra parsed fields for display (not saved to DB)
                    '_urgency': row.urgency,
                    '_cavity': row.cavity,
                    '_weightPerMeter': row.weightPerMeter,
                    '_pressCode': row.pressCode,
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
                    orderDate,
                },
                rawText: page1Text.substring(0, 500),
            });
        } catch (err) {
            console.error('PI PDF parse error:', err);
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
    }, [existingOrders]);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        setDragActive(false);
        const file = e.dataTransfer.files[0];
        processFile(file);
    }, [processFile]);

    const handleRemoveOrder = (index) => {
        setPreview(prev => ({
            ...prev,
            orders: prev.orders.filter((_, i) => i !== index),
        }));
    };

    const handleEditOrder = (index, field, value) => {
        setPreview(prev => ({
            ...prev,
            orders: prev.orders.map((order, i) =>
                i === index ? { ...order, [field]: value } : order
            ),
        }));
    };

    const handleImportAll = async () => {
        if (preview?.orders?.length > 0) {
            setImporting(true);
            try {
                // Strip internal display-only fields before importing
                const cleanOrders = preview.orders.map(({ _urgency, _cavity, _weightPerMeter, _pressCode, ...order }) => order);
                await onImportRecords(cleanOrders);
            } catch (err) {
                console.error('Import failed:', err);
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
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem',
            }}
            onClick={onClose}
        >
            <div
                style={{
                    background: '#1E293B', borderRadius: '20px', width: '100%', maxWidth: '1000px',
                    maxHeight: '90vh', overflow: 'hidden', border: '1px solid #334155',
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
                                background: dragActive ? 'rgba(16,185,129,0.1)' : 'transparent', marginBottom: '1rem',
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
                                        Found {preview.orders.length} die order{preview.orders.length !== 1 ? 's' : ''} &bull; PR: {preview.headerInfo.prNumber || 'N/A'} &bull; Supplier: {preview.headerInfo.supplier} &bull; Shipment: {preview.headerInfo.shipmentType} &bull; Date: {preview.headerInfo.orderDate || 'N/A'}
                                    </p>
                                    {preview.orders.some(o => o.isExisting) && (
                                        <p style={{ fontSize: '0.75rem', color: '#F59E0B', marginTop: '4px' }}>
                                            {preview.orders.filter(o => o.isExisting).length} order(s) already exist and will be updated
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
                                                <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Plant</th>
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
                                                        {order._urgency && (
                                                            <span style={{
                                                                marginLeft: '6px', fontSize: '0.6rem', padding: '2px 5px', borderRadius: '4px',
                                                                background: order._urgency === 'TOP URGENT' ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)',
                                                                color: order._urgency === 'TOP URGENT' ? '#EF4444' : '#F59E0B',
                                                            }}>
                                                                {order._urgency}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '10px 12px', color: '#F1F5F9' }}>{order['Die Size']}</td>
                                                    <td style={{ padding: '10px 12px' }}>
                                                        <select
                                                            value={order.TYPE || ''}
                                                            onChange={(e) => handleEditOrder(index, 'TYPE', e.target.value || null)}
                                                            style={{ background: '#334155', border: 'none', borderRadius: '4px', padding: '4px 8px', color: '#F1F5F9', fontSize: '0.8rem' }}
                                                        >
                                                            <option value="">--</option>
                                                            <option value="N">N - New</option>
                                                            <option value="B">B - Backup</option>
                                                            <option value="T">T - Tooling</option>
                                                            <option value="C">C - Cancelled</option>
                                                            <option value="H">H - Hold</option>
                                                        </select>
                                                    </td>
                                                    <td style={{ padding: '10px 12px', color: '#F1F5F9' }}>{order._cavity || order['Mandrels per Cavity'] || '-'}</td>
                                                    <td style={{ padding: '10px 12px' }}>
                                                        <select
                                                            value={order.Plant || ''}
                                                            onChange={(e) => handleEditOrder(index, 'Plant', e.target.value || null)}
                                                            style={{ background: '#334155', border: 'none', borderRadius: '4px', padding: '4px 8px', color: '#F1F5F9', fontSize: '0.8rem' }}
                                                        >
                                                            <option value="">--</option>
                                                            <option value="GEX 1">GEX 1</option>
                                                            <option value="GEX 2">GEX 2</option>
                                                        </select>
                                                    </td>
                                                    <td style={{ padding: '10px 12px', color: '#F1F5F9' }}>{order.Supplier}</td>
                                                    <td style={{ padding: '10px 12px' }}>
                                                        <span style={{
                                                            padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600,
                                                            background: order['Type of shipment'] === 'AIR' ? 'rgba(14,165,233,0.2)' : 'rgba(16,185,129,0.2)',
                                                            color: order['Type of shipment'] === 'AIR' ? '#0EA5E9' : '#10B981',
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
                            display: 'flex', alignItems: 'center', gap: '8px',
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
