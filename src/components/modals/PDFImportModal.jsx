import React, { useCallback, useState } from 'react';
import { AlertTriangle, CheckCircle, FileText, Trash2, X } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { MONTHS } from '../../utils/constants';
import { parseDateDMY } from '../../utils/helpers';

// Configure PDF.js worker (Vite-compatible approach)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// PDF Import Modal Component - PRESS to Plant mapping
const PRESS_TO_PLANT_PDF = {
  '25': 'GEX 2', 'P25': 'GEX 2',
  '35': 'GEX 2', 'P35': 'GEX 2',
  '2': 'GEX 1', 'P2': 'GEX 1',
  '4': 'GEX 1', 'P4': 'GEX 1',
  '5': 'GEX 1', 'P5': 'GEX 1',
  '6': 'GEX 1', 'P6': 'GEX 1',
  '7': 'GEX 2', 'P7': 'GEX 2',
  '8': 'GEX 2', 'P8': 'GEX 2',
  'B': 'GEX 1', 'D': 'GEX 1', 'E': 'GEX 1', 'F': 'GEX 1',
};

// Known die supplier names for PDF extraction
const KNOWN_SUPPLIERS = ['PDTMC', 'PHME', 'EKSTEK', 'COMPES', 'ADEX', 'WEFA', 'JIANGSU', 'COMES', 'PHOENIX', 'PRESSMETAL', 'AIT'];
// Map common PDF typos/variants to canonical supplier names
const SUPPLIER_ALIASES = { 'GIANGSU': 'JIANGSU', 'GIANSUN': 'JIANGSU', 'JIANSU': 'JIANGSU' };

const parseSimulationFlag = (value) => {
  const normalized = (value || '').replace(/^[-:\s]+/, '').trim().toUpperCase();
  if (!normalized || /^NO\b/.test(normalized)) return false;
  return /^(REQUIRED|OK|YES)\b/.test(normalized);
};

// PDF Import Modal Component
const PDFImportModal = ({ onClose, onImportRecords, existingOrders = [], suppliers = [] }) => {
  const [dragActive, setDragActive] = useState(false);
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0 });
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null); // { orders: [] }

  // Extract metadata from filename
  const extractFilenameMetadata = (filename) => {
    const name = filename.replace(/\.pdf$/i, '');
    const dieNoMatch = name.match(/(\d{3,6}[-_]\d{2,4})/);
    return {
      dieNo: dieNoMatch ? dieNoMatch[1].replace('_', '-') : name,
      isUrgent: /[-\s](urgent|urgetn)/i.test(name),
      isDiePlateOnly: /die\s*plate\s*only/i.test(name),
      isInsertMandrelOnly: /insert\s*mandrel\s*only/i.test(name),
      isRevision: /-R(?:\.|$)/i.test(filename) || /[-_]\d{2,4}-R/i.test(name),
    };
  };

  // Parse a single PDF file and return structured order data
  // Handles two PDF formats:
  //   Format A: Labels + values as text (e.g., "SUPPLIER - PDTMC DATE - 03/01/2025")
  //   Format B: Values-only, labels are form graphics (e.g., "PDTMC 22/01/2026", "Dia 220X130", "1 P4")
  const parseSinglePDF = useCallback(async (file) => {
    const meta = extractFilenameMetadata(file.name);
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // Get page 1 text content with positional data
    const page1 = await pdf.getPage(1);
    const textContent = await page1.getTextContent();

    // Group text items by Y position to reconstruct lines
    const linesByY = {};
    for (const item of textContent.items) {
      const y = Math.round(item.transform[5]);
      if (!linesByY[y]) linesByY[y] = [];
      linesByY[y].push({ text: item.str, x: Math.round(item.transform[4]) });
    }

    // Merge nearby Y positions (within 3px tolerance for text wrapping)
    const sortedYsRaw = Object.keys(linesByY).map(Number).sort((a, b) => b - a);
    const mergedLinesByY = {};
    let currentY = null;
    for (const y of sortedYsRaw) {
      if (currentY !== null && currentY - y <= 3) {
        mergedLinesByY[currentY].push(...linesByY[y]);
      } else {
        currentY = y;
        mergedLinesByY[y] = [...(linesByY[y] || [])];
      }
    }

    const sortedYs = Object.keys(mergedLinesByY).map(Number).sort((a, b) => b - a);
    const lines = sortedYs.map(y => {
      const items = mergedLinesByY[y].sort((a, b) => a.x - b.x);
      return { y, text: items.map(i => i.text).join(' ').trim(), items };
    });

    // Extracted fields
    let supplier = null;
    let requestedDate = null;
    let dieSize = null;
    let cavity = null;
    let pressCode = null;
    let simulationEnabled = false;
    let dieNo = meta.dieNo;
    // Bolster/Insert tracking for sub-orders
    let bolsterNo = null;
    let insertNo = null;
    let bolsterSize = null;
    let insertSize = null;

    // ── Detect format: check if any line has info box LABELS as text ──
    const fullText = lines.map(l => l.text).join(' ');
    const hasLabels = /\bSUPPLIER\b/.test(fullText) || /\bDIE SIZE\b/i.test(fullText) || /\bMODE OF SHIPMENT\b/i.test(fullText);

    // ── Check if Format A labels have actual VALUES filled in (not just empty dashes) ──
    // Some PDFs have labels (SUPPLIER, DIE SIZE, PRESS) but no values filled in —
    // the values were hand-written or added as annotation overlays that pdf.js can't extract.
    // Detect this by checking if the SUPPLIER line has any value after the dash.
    let labelsHaveValues = false;
    if (hasLabels) {
      for (const line of lines) {
        const upper = line.text.toUpperCase();
        // Check if any label line has a value (not just "SUPPLIER - DATE -" with nothing after)
        if (upper.includes('SUPPLIER')) {
          // Count non-label, non-separator content after SUPPLIER
          const afterLabels = line.text.replace(/SUPPLIER|DATE|[-:\s]/gi, '').trim();
          // If there's a date or supplier name, values are filled
          if (/\d{1,2}[/.-]\d{1,2}[/.-]\d{4}/.test(line.text) || afterLabels.length >= 2) {
            labelsHaveValues = true;
          }
          break;
        }
      }
    }

    if (hasLabels && labelsHaveValues) {
      // ═══ FORMAT A: Labels + values as text ═══
      // Lines look like: "SUPPLIER - PDTMC DATE - 12/01/2026"
      //                  "DIE SIZE - Dia 280X160"
      //                  "No OF CAV - 2 PRESS - P 25"
      // Some PDFs have supplier name on a SEPARATE line above the SUPPLIER label line
      for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i].text;
        const upperLine = lineText.toUpperCase();

        // SUPPLIER + DATE extraction
        // The SUPPLIER line may be merged with unrelated text (e.g., "MINIMUM ELECTRICAL... SUPPLIER - PDTMC DATE - 12/01/2026")
        // Use positional items: only consider items at X >= first "SUPPLIER" item X position
        if (upperLine.includes('SUPPLIER') && !supplier) {
          // Extract only the info-box portion (items with X >= first "SUPPLIER" item X position)
          const supplierItem = lines[i].items.find(it => it.text.toUpperCase().includes('SUPPLIER'));
          const infoBoxX = supplierItem ? supplierItem.x : 0;
          const infoBoxItems = lines[i].items.filter(it => it.x >= infoBoxX);
          const infoBoxText = infoBoxItems.map(it => it.text).join(' ').trim();
          const infoBoxUpper = infoBoxText.toUpperCase();

          // Look for known supplier name in the info box portion
          for (const s of KNOWN_SUPPLIERS) {
            if (infoBoxUpper.includes(s)) {
              supplier = s;
              break;
            }
          }
          // Fallback: look for uppercase word between SUPPLIER and DATE
          if (!supplier) {
            const afterSupplier = infoBoxText.replace(/.*SUPPLIER\s*[-:]?\s*/i, '');
            const beforeDate = afterSupplier.replace(/\s*DATE\s*.*/i, '');
            const candidate = beforeDate.replace(/^[-\s]+/, '').trim();
            if (candidate && candidate.length >= 2 && /^[A-Za-z]+$/.test(candidate)) {
              supplier = candidate.toUpperCase();
            }
          }
          // Fallback: check the line ABOVE for a standalone supplier name
          // (some PDFs put "PDTMC" on its own line above "SUPPLIER - DATE - 07/01/2026")
          if (!supplier && i > 0) {
            const prevLine = lines[i - 1].text.trim().toUpperCase();
            for (const s of KNOWN_SUPPLIERS) {
              if (prevLine.includes(s)) {
                supplier = s;
                break;
              }
            }
          }
          // Fallback: check the line BELOW for a standalone supplier name
          // (some PDFs put "PDTMC" on its own line below "SUPPLIER - DATE 12/01/2026 -")
          if (!supplier && i + 1 < lines.length) {
            const nextLine = lines[i + 1].text.trim().toUpperCase();
            for (const s of KNOWN_SUPPLIERS) {
              if (nextLine.includes(s) && nextLine.length < 30) {
                supplier = s;
                break;
              }
            }
          }

          // Extract date from supplier line or adjacent lines
          for (let j = Math.max(0, i - 1); j <= Math.min(i + 2, lines.length - 1); j++) {
            const dm = lines[j].text.match(/(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/);
            if (dm && !requestedDate) {
              requestedDate = parseDateDMY(dm[1]);
              break;
            }
          }
        }

        // DIE SIZE extraction
        if (upperLine.includes('DIE SIZE') && !dieSize) {
          const sizeMatch = lineText.match(/(?:Dia\s*)?(\d{2,4}\s*[Xx\u00D7]\s*\d{2,4})/i);
          if (sizeMatch) {
            dieSize = sizeMatch[1].replace(/\s+/g, '').toUpperCase().replace('\u00D7', 'X');
          }
          if (!dieSize && i + 1 < lines.length) {
            const nextMatch = lines[i + 1].text.match(/(?:Dia\s*)?(\d{2,4}\s*[Xx\u00D7]\s*\d{2,4})/i);
            if (nextMatch) dieSize = nextMatch[1].replace(/\s+/g, '').toUpperCase().replace('\u00D7', 'X');
          }
        }

        // No OF CAV + PRESS extraction (often on same line: "No OF CAV - 2 PRESS - P 25")
        // But sometimes cavity is on a SEPARATE line below (e.g., "No OF CAV - PRESS - P25" then "1" on next line)
        if ((upperLine.includes('NO OF CAV') || upperLine.includes('NO. OF CAV') || upperLine.includes('CAVIT')) && cavity === null) {
          // Extract cavity: digit(s) between "CAV" and "PRESS"
          const cavPressMatch = lineText.match(/CAV\w*\s*[-:.]?\s*(\d+)\s*(?:PRESS|$)/i);
          if (cavPressMatch) {
            cavity = parseInt(cavPressMatch[1], 10);
          }
          // Also try next line for cavity digit (may be standalone "1", "- 2", or "4 P5" combined)
          if (cavity === null && i + 1 < lines.length) {
            const nextText = lines[i + 1].text.trim();
            // Try combined "4 P5" format first
            const nextCombined = nextText.match(/^[-\s]*(\d{1,2})\s+(P?\s*\d+|[A-F])(?:\s|$)/i);
            if (nextCombined) {
              cavity = parseInt(nextCombined[1], 10);
              if (!pressCode) pressCode = nextCombined[2].trim();
            } else {
              // Match standalone digit (e.g., "1") or separator + digit (e.g., "- 2")
              const nextCav = nextText.match(/^[-\s]*(\d{1,2})(?:\s|$)/);
              if (nextCav) cavity = parseInt(nextCav[1], 10);
            }
          }
          // Also try 2 lines down (in case next line is something else)
          if (cavity === null && i + 2 < lines.length) {
            const next2Text = lines[i + 2].text.trim();
            const next2Cav = next2Text.match(/^[-\s]*(\d{1,2})(?:\s|$)/);
            if (next2Cav) cavity = parseInt(next2Cav[1], 10);
          }
        }

        // PRESS extraction (on same line as CAV or standalone)
        // Formats: "PRESS - P25", "PRESS - P 25", "No OF CAV - 2 PRESS - P5"
        // Avoid matching stray letters from notes (e.g., "for powder coating" → "f")
        if (upperLine.includes('PRESS') && !upperLine.includes('SHIPMENT') && !pressCode) {
          const pressMatch = lineText.match(/PRESS\s*[-:=]?\s*(P\s*\d+|\d+|[A-F])(?:\s|$)/i);
          if (pressMatch) {
            // Validate: single letters [A-F] are ok, but avoid matching first letter of unrelated words
            const candidate = pressMatch[1].trim();
            // Only accept single-letter press codes if they appear right after PRESS separator
            if (candidate.length === 1 && /^[a-f]$/i.test(candidate)) {
              // Check it's not just the start of a word like "for"
              const afterPress = lineText.substring(lineText.toUpperCase().indexOf('PRESS') + 5).replace(/^[\s\-:=]+/, '');
              if (/^[A-F]\s*$/i.test(afterPress) || /^[A-F]\b/i.test(afterPress) && afterPress.length <= 2) {
                pressCode = candidate.toUpperCase();
              }
            } else {
              pressCode = candidate;
            }
          }
          if (!pressCode && i + 1 < lines.length) {
            const nextText = lines[i + 1].text.trim();
            // Next line: try "- P25", "P5", "4 P5" (cavity+press on next line)
            const nextPress = nextText.match(/^[-\s]*(?:\d{1,2}\s+)?(P\s*\d+|[A-F])$/i);
            if (nextPress) pressCode = nextPress[1].trim();
          }
        }

        // BOLSTER NO. / INSERT NO. extraction (Format A)
        if ((upperLine.includes('BOLSTER') || upperLine.includes('INSERT')) && !bolsterNo && !insertNo) {
          // Extract Bolster No. value
          const bolsterMatch = lineText.match(/BOLSTER\s*(?:No\.?|NO\.?)\s*[-:.]?\s*([A-Za-z0-9-]+)/i);
          if (bolsterMatch && bolsterMatch[1] !== '-') {
            bolsterNo = bolsterMatch[1].trim();
          }
          // Extract Insert No. value
          const insertMatch = lineText.match(/INSERT\s*(?:No\.?|NO\.?)\s*[-:.]?\s*([A-Za-z0-9-]+)/i);
          if (insertMatch && insertMatch[1] !== '-') {
            insertNo = insertMatch[1].trim();
          }
          // Check surrounding lines for values (may be on next line)
          if (!bolsterNo && !insertNo && i + 1 < lines.length) {
            const nextText = lines[i + 1].text.trim();
            // Look for bolster/insert IDs like "I-30602", "B-12345" or plain alphanumeric
            const idMatch = nextText.match(/([A-Za-z][-]?\d{3,6})/i);
            if (idMatch) {
              if (upperLine.includes('INSERT')) insertNo = idMatch[1].trim();
              else bolsterNo = idMatch[1].trim();
            }
          }
        }

        // SIZE (below Bolster/Insert) extraction (Format A)
        // This is a separate SIZE row after BOLSTER/INSERT row
        if (upperLine.includes('SIZE') && !upperLine.includes('DIE SIZE') && (bolsterNo || insertNo)) {
          // Look for the size values - there may be two SIZE fields on the same line
          const allSizes = [];
          const sizeRegex = /(?:DIA\s+)?(\d{2,4}\s*[Xx\u00D7]\s*\d{2,4})/gi;
          let sizeM;
          while ((sizeM = sizeRegex.exec(lineText)) !== null) {
            allSizes.push(sizeM[1].replace(/\s+/g, '').toUpperCase().replace('\u00D7', 'X'));
          }
          // If we have items positionally, try to map them to bolster/insert columns
          if (lines[i].items && lines[i].items.length > 0) {
            // Use X positions to determine left (bolster) vs right (insert) side
            const pageWidth = Math.max(...lines[i].items.map(it => it.x)) + 100;
            const midX = pageWidth / 2;
            for (const item of lines[i].items) {
              const sizeVal = item.text.match(/(?:DIA\s*)?(\d{2,4}\s*[Xx\u00D7]\s*\d{2,4})/i);
              if (sizeVal) {
                const cleanSize = sizeVal[1].replace(/\s+/g, '').toUpperCase().replace('\u00D7', 'X');
                if (item.x < midX && bolsterNo) bolsterSize = cleanSize;
                else if (insertNo) insertSize = cleanSize;
                else if (bolsterNo) bolsterSize = cleanSize;
              }
            }
          }
          // Fallback: if only one size found, assign to whichever ID exists
          if (!bolsterSize && !insertSize && allSizes.length > 0) {
            if (insertNo) insertSize = allSizes[allSizes.length - 1];
            else if (bolsterNo) bolsterSize = allSizes[0];
          }
          // Check next line for size values
          if (!bolsterSize && !insertSize && i + 1 < lines.length) {
            const nextText = lines[i + 1].text.trim();
            const nextSizeMatch = nextText.match(/(?:DIA\s*)?(\d{2,4}\s*[Xx\u00D7]\s*\d{2,4})/i);
            if (nextSizeMatch) {
              const cleanSize = nextSizeMatch[1].replace(/\s+/g, '').toUpperCase().replace('\u00D7', 'X');
              if (insertNo) insertSize = cleanSize;
              else if (bolsterNo) bolsterSize = cleanSize;
            }
          }
        }

        // 3D MODULE FOR SIMULATION
        if (upperLine.includes('3D MODULE') || upperLine.includes('SIMULATION')) {
          const fieldValue = lineText
            .replace(/.*(?:3D\s*MODULE\s*FOR\s*SIMULATION|SIMULATION)\s*[-:]?\s*/i, '')
            .trim();
          if (fieldValue) {
            simulationEnabled = parseSimulationFlag(fieldValue);
          } else if (i + 1 < lines.length) {
            simulationEnabled = parseSimulationFlag(lines[i + 1].text);
          }
        }

        // MODE OF SHIPMENT - now derived from supplier table (see supplier lookup below)
      }
    } else if (hasLabels && !labelsHaveValues) {
      // ═══ FORMAT C: Labels exist but values are empty (hand-filled, not extractable) ═══
      // The info box has SUPPLIER, DIE SIZE, PRESS labels but all values are blank dashes.
      // Values may have been filled in by hand/annotation overlays that pdf.js can't read.
      // We can only extract metadata from filename and any standalone text elsewhere.
      // Nothing to extract from info box — rely on fallbacks below
    } else {
      // ═══ FORMAT B: Values-only (labels are form graphics/images, not text) ═══
      // The info box values appear as short lines in sequential Y order:
      //   1. Supplier + Date (e.g., "PDTMC 22/01/2026" or just "16/01/2026")
      //   2. Die Size (e.g., "Dia 220X130" or "Dia 250X160")
      //   3. Cavity + Press (e.g., "1 P4" or "8 P4" or "1 P25")
      //      OR Cavity and Press on SEPARATE lines: "1" then "P5"
      //   4. Solid/Hollow, Insert No, Size, Delivery Date, Simulation, Shipment, Weight
      // Find the die size line as anchor - it's the most reliable pattern
      let anchorIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/(?:Dia\s*)?\d{2,4}\s*[Xx\u00D7]\s*\d{2,4}/i.test(lines[i].text)) {
          anchorIdx = i;
          break;
        }
      }

      if (anchorIdx >= 0) {
        // Die size from anchor
        const sizeMatch = lines[anchorIdx].text.match(/(?:Dia\s*)?(\d{2,4}\s*[Xx\u00D7]\s*\d{2,4})/i);
        if (sizeMatch) dieSize = sizeMatch[1].replace(/\s+/g, '').toUpperCase().replace('\u00D7', 'X');

        // Line BEFORE die size = Supplier + Date
        if (anchorIdx > 0) {
          const supplierLine = lines[anchorIdx - 1].text.trim();
          // Extract date first
          const dateMatch = supplierLine.match(/(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/);
          if (dateMatch) requestedDate = parseDateDMY(dateMatch[1]);
          // Supplier = text before the date (or the whole line if no date)
          const supplierPart = dateMatch ? supplierLine.replace(dateMatch[0], '').replace(/[-\s]+$/, '').trim() : supplierLine;
          if (supplierPart && /^[A-Za-z]/.test(supplierPart)) {
            // Check known suppliers
            const upperPart = supplierPart.toUpperCase();
            const knownMatch = KNOWN_SUPPLIERS.find(s => upperPart.includes(s));
            supplier = knownMatch || upperPart;
          }
        }

        // Line AFTER die size = Cavity + Press
        // The form has "No OF CAV - 1   PRESS - 2" on the same row, so text-extraction yields "1 2".
        // Press codes appear as bare digits ("2", "5", "25") OR with prefix ("P25") OR letter ("B"–"F").
        // We accept all three with `(P?\s*\d+|[A-F])`; bare digits are normalized to "P##" later.
        if (anchorIdx + 1 < lines.length) {
          const cavPressLine = lines[anchorIdx + 1].text.trim();
          const cpMatch = cavPressLine.match(/^(\d+)\s+(P?\s*\d+|[A-F])\b/i);
          if (cpMatch) {
            cavity = parseInt(cpMatch[1], 10);
            pressCode = cpMatch[2].trim();
          } else {
            // Try: cavity on this line alone, press on next line
            const cavOnlyMatch = cavPressLine.match(/^(\d{1,2})$/);
            if (cavOnlyMatch) {
              cavity = parseInt(cavOnlyMatch[1], 10);
              // Check next line for press code
              if (anchorIdx + 2 < lines.length) {
                const pressLine = lines[anchorIdx + 2].text.trim();
                const pressOnlyMatch = pressLine.match(/^(P?\s*\d+|[A-F])$/i);
                if (pressOnlyMatch) pressCode = pressOnlyMatch[1].trim();
              }
            } else {
              // REVERSE order: press on this line, cavity on next line (e.g., "P2" then "1")
              const pressFirstMatch = cavPressLine.match(/^(P\s*\d+|[A-F])$/i);
              if (pressFirstMatch) {
                pressCode = pressFirstMatch[1].trim();
                if (anchorIdx + 2 < lines.length) {
                  const cavLine = lines[anchorIdx + 2].text.trim();
                  const cavMatch = cavLine.match(/^(\d{1,2})$/);
                  if (cavMatch) cavity = parseInt(cavMatch[1], 10);
                }
              }
            }
          }
        }

        // Lines after cav+press: Solid/Hollow, Bolster/Insert No, Size, Delivery Date, Simulation, Shipment
        // Walk sequentially from anchorIdx + 2 (or +3 if cav/press were split across 2 lines)
        const cavPressOnOneLine = lines[anchorIdx + 1]?.text.trim().match(/^(\d+)\s+(P?\s*\d+|[A-F])\b/i);
        const startIdx = (cavity !== null && pressCode && !cavPressOnOneLine)
          ? anchorIdx + 3  // cav and press were on separate lines
          : anchorIdx + 2; // cav+press on same line
        const remainingLines = lines.slice(startIdx).filter(l => l.text.trim().length > 0);

        // Extract Bolster/Insert No and Size from remaining lines (Format B)
        // Typical order after cav+press: Solid/Hollow, Bolster No, Insert No, Size(Bolster), Size(Insert), Date, Simulation, Shipment
        let deliveryDateLineIdx = -1;
        for (let ri = 0; ri < remainingLines.length; ri++) {
          const rLine = remainingLines[ri];
          const val = rLine.text.trim();
          // Extract Bolster/Insert IDs (patterns like "I-30602", "B-12345", "BOL-30587", "INS-22772")
          // Also refs like "35IC1-120154" (leading digits + alphanumeric before hyphen) common on supplier PDFs
          if (!bolsterNo && !insertNo) {
            const idMatch = val.match(/^([A-Za-z]{1,4})[-](\d{3,6})$/i);
            if (idMatch) {
              const prefix = idMatch[1].toUpperCase();
              const fullId = `${prefix}-${idMatch[2]}`;
              if (prefix === 'I' || prefix === 'INS') insertNo = fullId;
              else if (prefix === 'B' || prefix === 'BOL') bolsterNo = fullId;
              else insertNo = fullId; // Default to insert for unknown prefixes
              continue;
            }
            const broadIdMatch = val.match(/^(\d+[A-Za-z][A-Za-z0-9]*-\d{3,})$/i);
            if (broadIdMatch) {
              insertNo = broadIdMatch[1];
              continue;
            }
          }

          // Extract Size for bolster/insert (DIA NNNxNNN pattern, NOT the die size which was already captured)
          if ((bolsterNo || insertNo) && !bolsterSize && !insertSize) {
            const sizeMatch = val.match(/(?:DIA\s*)?(\d{2,4}\s*[Xx\u00D7]\s*\d{2,4})/i);
            if (sizeMatch) {
              const cleanSize = sizeMatch[1].replace(/\s+/g, '').toUpperCase().replace('\u00D7', 'X');
              // Only treat as bolster/insert size if it's different from the die size
              if (cleanSize !== dieSize) {
                if (insertNo) insertSize = cleanSize;
                else if (bolsterNo) bolsterSize = cleanSize;
                continue;
              }
            }
          }

          // Delivery date: DD/MM/YYYY or DD-MM-YYYY
          const dateMatch = val.match(/(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/);
          if (dateMatch) {
            // Skip dates that look like old revision dates (< 2020)
            const yearMatch = dateMatch[1].match(/(\d{4})/);
            if (yearMatch && parseInt(yearMatch[1], 10) >= 2020) {
              if (deliveryDateLineIdx === -1) deliveryDateLineIdx = ri;
              if (!requestedDate) requestedDate = parseDateDMY(dateMatch[1]);
            }
          }
          // Shipment: now derived from supplier table (no PDF extraction needed)
        }
        if (deliveryDateLineIdx >= 0) {
          const simulationLine = remainingLines
            .slice(deliveryDateLineIdx + 1)
            .find(line => {
              const val = line.text.trim();
              return val && !/^BY\s+(?:AIR|ROAD|SEA|LAND)\b/i.test(val) && !/^-?\d+(?:\.\d+)?$/.test(val);
            });
          simulationEnabled = parseSimulationFlag(simulationLine?.text);
        }
      }
    }

    // ── Normalize supplier aliases (typo corrections) ──
    if (supplier) {
      const upperSupplier = supplier.toUpperCase();
      if (SUPPLIER_ALIASES[upperSupplier]) supplier = SUPPLIER_ALIASES[upperSupplier];
    }

    // ── Freeform PDF fallback (very short PDFs with key-value pairs) ──
    // Some PDFs are freeform notes (e.g., "Supplier :- PDTMC", "Press-5", "Size 440X200")
    // Also runs when supplier looks like garbage (too long = probably not a real supplier name)
    const supplierLooksInvalid = supplier && supplier.length > 15 && !KNOWN_SUPPLIERS.includes(supplier.toUpperCase());
    if (lines.length <= 10 && (!supplier || supplierLooksInvalid)) {
      for (const line of lines) {
        const text = line.text.trim();
        // "Supplier :- PDTMC" or "Supplier Phoenix"
        const supplierMatch = text.match(/Supplier\s*[:-]*\s*(\w+)/i);
        if (supplierMatch) {
          const name = supplierMatch[1].toUpperCase();
          const known = KNOWN_SUPPLIERS.find(s => name.includes(s));
          supplier = known || (SUPPLIER_ALIASES[name] || name);
        }
        // "Press - 5" or "Press-4" (freeform format, not a label-based PRESS)
        const pressMatch = text.match(/Press\s*[-:]*\s*(\d+)/i);
        if (pressMatch && (!pressCode || supplierLooksInvalid)) {
          pressCode = 'P' + pressMatch[1];
        }
        // "Size 440X200" or "insert Size 45x28"
        if (!dieSize) {
          const sizeMatch = text.match(/(?:Size|Dia)\s*(\d{2,4}\s*[Xx\u00D7]\s*\d{2,4})/i);
          if (sizeMatch) dieSize = sizeMatch[1].replace(/\s+/g, '').toUpperCase().replace('\u00D7', 'X');
        }
      }
    }

    // ── Global fallbacks (both formats) ──

    // Fallback: die size from any line
    if (!dieSize) {
      for (const line of lines) {
        const sizeMatch = line.text.match(/(?:Dia\s*)?(\d{2,4}\s*[Xx\u00D7]\s*\d{2,4})/i);
        if (sizeMatch) {
          dieSize = sizeMatch[1].replace(/\s+/g, '').toUpperCase().replace('\u00D7', 'X');
          break;
        }
      }
    }

    // Fallback: date from any line
    if (!requestedDate) {
      for (const line of lines) {
        const dm = line.text.match(/(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/);
        if (dm) {
          const yearMatch = dm[1].match(/(\d{4})/);
          if (yearMatch && parseInt(yearMatch[1], 10) >= 2020) {
            requestedDate = parseDateDMY(dm[1]);
            break;
          }
        }
      }
    }

    // Fallback: supplier from any line containing a known supplier name
    if (!supplier) {
      for (const line of lines) {
        const upperText = line.text.toUpperCase();
        for (const s of KNOWN_SUPPLIERS) {
          if (upperText.includes(s)) {
            supplier = s;
            break;
          }
        }
        if (supplier) break;
        // Also check aliases
        for (const [alias, canonical] of Object.entries(SUPPLIER_ALIASES)) {
          if (upperText.includes(alias)) {
            supplier = canonical;
            break;
          }
        }
        if (supplier) break;
      }
    }

    // Shipment mode: lookup from supplier table instead of PDF extraction
    const supplierRecord = suppliers.find(s => s.name === (supplier || '').toUpperCase());
    const shipmentFromSupplier = supplierRecord?.shipment_mode || 'LAND';

    // Confirm die number from PDF text
    const pdfDieMatch = fullText.match(/\b(\d{3,6}[-]\d{2,4})\b/);
    if (pdfDieMatch && !meta.dieNo.match(/^\d{3,6}-\d{2,4}$/)) {
      dieNo = pdfDieMatch[1];
    }

    // Normalize press code: add "P" prefix if it's just a bare number (e.g., "6" → "P6")
    if (pressCode) {
      pressCode = pressCode.replace(/\s+/g, '').toUpperCase();
      if (/^\d+$/.test(pressCode)) pressCode = 'P' + pressCode;
    }

    // Determine plant from press code
    let plantFromPress = null;
    if (pressCode) {
      plantFromPress = PRESS_TO_PLANT_PDF[pressCode] || null;
    }

    // Check if order already exists
    const existingOrder = existingOrders.find(o => o['DIE NO'] === dieNo);

    const mainOrder = {
      id: existingOrder?.id || null,
      isExisting: !!existingOrder,
      Plant: plantFromPress || existingOrder?.Plant || 'GEX 1',
      'Order No': existingOrder?.['Order No'] || '',
      'DIE NO': dieNo,
      TYPE: existingOrder?.TYPE || null,
      'Die Size': dieSize || 'N/A',
      'Die Requested Date': requestedDate || null,
      'Ordered date': null,
      'Type of shipment': shipmentFromSupplier,
      // PDF "No OF CAV" goes to the dedicated `cavity` column (used by ERP copy `CAV n`).
      // "Mandrels per Cavity" is a separate concept the user fills in via the preview input;
      // Total Mandrels = mpc * cavity is recomputed by the preview edit handler.
      'Cavity': cavity || existingOrder?.Cavity || 0,
      'Mandrels per Cavity': existingOrder?.['Mandrels per Cavity'] || 0,
      'Total Mandrels': existingOrder?.['Total Mandrels'] || 0,
      'Design Received Date': null,
      '3D Model Received Date': null,
      simulationEnabled: simulationEnabled || false,
      'Design Approved Date': null,
      Delay: 0,
      'PR Entry': null,
      'PR Number': existingOrder?.['PR Number'] || null,
      'Customer Name': existingOrder?.['Customer Name'] || '',
      'Die Received Date': existingOrder?.['Die Received Date'] || null,
      'Submission Date': existingOrder?.['Submission Date'] || null,
      'Sample Approval Date': existingOrder?.['Sample Approval Date'] || null,
      'No of Trial': existingOrder?.['No of Trial'] || 0,
      'Corrector': existingOrder?.['Corrector'] || null,
      'Oracle Entry': null,
      // Press code parsed from PDF (e.g., "P25", "P5", "B"); falls back to existing order's value.
      // Persisted to die_orders.press; used as ERP-copy prefix on the "Pending for PR" page.
      Press: pressCode || existingOrder?.Press || null,
      Supplier: supplier || 'UNKNOWN',
      STATUS: existingOrder?.STATUS || 'PENDING FOR ORDERING',
      'OVERALL DELAY': 0,
      ETA: null,
      month: requestedDate ? MONTHS[parseInt(requestedDate.split('-')[1], 10) - 1] : null,
      // Display-only metadata (stripped before import)
      _urgency: meta.isUrgent ? 'URGENT' : null,
      _componentType: meta.isDiePlateOnly ? 'DIE PLATE ONLY' : meta.isInsertMandrelOnly ? 'INSERT MANDREL ONLY' : null,
      _isRevision: meta.isRevision,
      _cavity: cavity,
    };

    const orders = [mainOrder];

    // ── Create additional orders for Bolster/Insert with Size ──
    // If Bolster No. or Insert No. has a Size value that is not "old" or blank,
    // create a new order with that bolster/insert number as Die No. and the extracted size.
    const createSubOrder = (subDieNo, subSize) => {
      const existingSub = existingOrders.find(o => o['DIE NO'] === subDieNo);
      return {
        ...mainOrder,
        id: existingSub?.id || null,
        isExisting: !!existingSub,
        'Order No': existingSub?.['Order No'] || '',
        'DIE NO': subDieNo,
        'Die Size': subSize,
        'Customer Name': existingSub?.['Customer Name'] || mainOrder['Customer Name'],
        'PR Number': existingSub?.['PR Number'] || null,
        STATUS: existingSub?.STATUS || 'PENDING FOR ORDERING',
        _componentType: 'BOLSTER/INSERT',
      };
    };

    // Helper: check if a size value is valid (not blank, not "old")
    const isValidSize = (size) => size && size.trim().length > 0 && !/^old$/i.test(size.trim());

    if (bolsterNo && isValidSize(bolsterSize)) {
      orders.push(createSubOrder(bolsterNo, bolsterSize));
    }
    if (insertNo && isValidSize(insertSize)) {
      orders.push(createSubOrder(insertNo, insertSize));
    }

    return orders;
  }, [existingOrders, suppliers]);

  // Process multiple PDF files
  const processFiles = useCallback(async (files) => {
    const pdfFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (pdfFiles.length === 0) {
      setErrors(prev => [...prev, 'No PDF files found in selection']);
      return;
    }

    setLoading(true);
    setErrors([]);
    setLoadingProgress({ current: 0, total: pdfFiles.length });

    const newOrders = [];
    const newErrors = [];

    for (let i = 0; i < pdfFiles.length; i++) {
      setLoadingProgress({ current: i + 1, total: pdfFiles.length });
      try {
        const orders = await parseSinglePDF(pdfFiles[i], i);
        newOrders.push(...orders);
      } catch (err) {
        console.error(`PDF Import - Failed to parse ${pdfFiles[i].name}:`, err);
        newErrors.push(`${pdfFiles[i].name}: ${err.message}`);
      }
    }

    if (newErrors.length > 0) {
      setErrors(newErrors);
    }

    if (newOrders.length > 0) {
      setPreview(prev => ({
        orders: [...(prev?.orders || []), ...newOrders],
      }));
    }

    setLoading(false);
  }, [parseSinglePDF]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragActive(false);
    processFiles(e.dataTransfer.files);
  }, [processFiles]);

  const handleRemoveOrder = (index) => {
    setPreview(prev => {
      if (!prev) return null;
      const updated = prev.orders.filter((_, i) => i !== index);
      return updated.length > 0 ? { orders: updated } : null;
    });
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
        const cleanOrders = preview.orders.map((order) => {
          const cleanOrder = { ...order };
          delete cleanOrder._urgency;
          delete cleanOrder._componentType;
          delete cleanOrder._isRevision;
          delete cleanOrder._cavity;
          return cleanOrder;
        });
        await onImportRecords(cleanOrders);
        onClose();
      } catch (err) {
        console.error('PDF Import failed:', err);
        setErrors([`Import failed: ${err.message}`]);
      } finally {
        setImporting(false);
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
          background: '#1E293B', borderRadius: '20px', width: '100%', maxWidth: '1100px',
          maxHeight: '90vh', overflow: 'hidden', border: '1px solid #334155',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem', borderBottom: '1px solid #334155' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #F59E0B, #EF4444)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FileText size={24} color="white" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#F1F5F9' }}>Import Die Order PDFs</h2>
              <p style={{ fontSize: '0.875rem', color: '#64748B' }}>Upload die ordering request PDFs</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', padding: '8px', borderRadius: '8px' }}>
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', maxHeight: '65vh' }}>
          {/* Drop zone - show when no preview or when adding more */}
          {!preview && !loading && (
            <div
              style={{
                border: `2px dashed ${dragActive ? '#F59E0B' : '#334155'}`,
                borderRadius: '16px', padding: '2.5rem', textAlign: 'center',
                background: dragActive ? 'rgba(245,158,11,0.1)' : 'transparent', marginBottom: '1rem',
              }}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              <FileText size={48} color="#64748B" />
              <p style={{ fontSize: '1rem', color: '#F1F5F9', marginTop: '1rem' }}>Drag & drop your PDF files here</p>
              <p style={{ color: '#64748B', margin: '0.5rem 0' }}>or</p>
              <label style={{ display: 'inline-block', padding: '0.75rem 1.5rem', background: 'linear-gradient(135deg, #F59E0B, #EF4444)', color: 'white', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
                Browse PDF Files
                <input type="file" accept=".pdf" multiple onChange={(e) => processFiles(e.target.files)} hidden />
              </label>
              <p style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '1rem' }}>Select multiple PDF files at once. Fields extracted from PDF info box.</p>
            </div>
          )}

          {/* Loading state */}
          {loading && (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <div style={{ width: '40px', height: '40px', border: '3px solid #334155', borderTopColor: '#F59E0B', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
              <p style={{ color: '#94A3B8', marginTop: '1rem' }}>Parsing {loadingProgress.current} of {loadingProgress.total} PDFs...</p>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {/* Errors */}
          {errors.length > 0 && (
            <div style={{ background: 'rgba(244,63,94,0.1)', padding: '0.875rem 1rem', borderRadius: '10px', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#F43F5E', marginBottom: errors.length > 1 ? '8px' : 0 }}>
                <AlertTriangle size={18} />
                <span style={{ fontWeight: 600 }}>{errors.length} file{errors.length !== 1 ? 's' : ''} failed to parse</span>
              </div>
              {errors.map((err, i) => (
                <p key={i} style={{ fontSize: '0.8rem', color: '#F43F5E', marginLeft: '26px', marginTop: '4px' }}>{err}</p>
              ))}
            </div>
          )}

          {/* Preview table */}
          {preview && preview.orders.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(245,158,11,0.1)', padding: '1rem', borderRadius: '10px', marginBottom: '1rem' }}>
                <CheckCircle size={20} color="#F59E0B" />
                <div style={{ flex: 1 }}>
                  <p style={{ fontWeight: 600, color: '#F59E0B' }}>PDFs Parsed Successfully</p>
                  <p style={{ fontSize: '0.8rem', color: '#94A3B8' }}>
                    Found {preview.orders.length} die order{preview.orders.length !== 1 ? 's' : ''}
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
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Supplier</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Plant</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Type</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Cavity</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Mandrels/Cav</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Total Mandrels</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Shipment</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', color: '#64748B', fontWeight: 600 }}>Req Date</th>
                        <th style={{ padding: '10px 12px', textAlign: 'center', color: '#64748B', fontWeight: 600 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.orders.map((order, index) => (
                        <tr key={index} style={{ borderBottom: '1px solid #334155', background: order.isExisting ? 'rgba(245,158,11,0.05)' : 'transparent' }}>
                          <td style={{ padding: '10px 12px', color: '#F1F5F9', fontFamily: 'monospace' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <span>{order['DIE NO']}</span>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {order.isExisting && <span style={{ fontSize: '0.6rem', padding: '2px 5px', background: 'rgba(245,158,11,0.2)', color: '#F59E0B', borderRadius: '4px' }}>UPDATE</span>}
                                {order._urgency && <span style={{ fontSize: '0.6rem', padding: '2px 5px', background: 'rgba(239,68,68,0.2)', color: '#EF4444', borderRadius: '4px' }}>{order._urgency}</span>}
                                {order._componentType === 'DIE PLATE ONLY' && <span style={{ fontSize: '0.6rem', padding: '2px 5px', background: 'rgba(59,130,246,0.2)', color: '#3B82F6', borderRadius: '4px' }}>DIE PLATE ONLY</span>}
                                {order._componentType === 'INSERT MANDREL ONLY' && <span style={{ fontSize: '0.6rem', padding: '2px 5px', background: 'rgba(139,92,246,0.2)', color: '#8B5CF6', borderRadius: '4px' }}>INSERT MANDREL ONLY</span>}
                                {order._componentType === 'BOLSTER/INSERT' && <span style={{ fontSize: '0.6rem', padding: '2px 5px', background: 'rgba(20,184,166,0.2)', color: '#14B8A6', borderRadius: '4px' }}>BOLSTER/INSERT</span>}
                                {order._isRevision && <span style={{ fontSize: '0.6rem', padding: '2px 5px', background: 'rgba(148,163,184,0.2)', color: '#94A3B8', borderRadius: '4px' }}>REVISION</span>}
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '10px 12px', color: '#F1F5F9' }}>{order['Die Size']}</td>
                          <td style={{ padding: '10px 12px', color: '#F1F5F9' }}>{order.Supplier}</td>
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
                          <td style={{ padding: '10px 12px', color: '#F1F5F9' }}>{order['Cavity'] || order._cavity || '-'}</td>
                          <td style={{ padding: '10px 12px' }}>
                            <input
                              type="number"
                              min="0"
                              value={order['Mandrels per Cavity'] || 0}
                              onChange={(e) => {
                                const mpc = parseInt(e.target.value, 10) || 0;
                                const cavities = order['Cavity'] || order._cavity || 1;
                                handleEditOrder(index, 'Mandrels per Cavity', mpc);
                                handleEditOrder(index, 'Total Mandrels', mpc * cavities);
                              }}
                              style={{ width: '50px', padding: '4px 6px', background: '#334155', border: 'none', borderRadius: '4px', color: '#F1F5F9', fontSize: '0.8rem', textAlign: 'center' }}
                            />
                          </td>
                          <td style={{ padding: '10px 12px', color: '#F1F5F9', fontFamily: 'monospace' }}>{order['Total Mandrels'] || 0}</td>
                          <td style={{ padding: '10px 12px' }}>
                            <span style={{
                              padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600,
                              background: order['Type of shipment'] === 'AIR' ? 'rgba(14,165,233,0.2)' : 'rgba(16,185,129,0.2)',
                              color: order['Type of shipment'] === 'AIR' ? '#0EA5E9' : '#10B981',
                            }}>
                              {order['Type of shipment']}
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px', color: '#F1F5F9', fontSize: '0.8rem' }}>{order['Die Requested Date'] || '-'}</td>
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

              {/* Upload More button */}
              <label style={{
                display: 'block', width: '100%', padding: '0.5rem', background: 'transparent',
                border: '1px solid #334155', borderRadius: '8px', color: '#94A3B8', cursor: 'pointer',
                textAlign: 'center', fontSize: '0.875rem',
              }}>
                Upload More PDFs
                <input type="file" accept=".pdf" multiple onChange={(e) => processFiles(e.target.files)} hidden />
              </label>
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
              background: (preview?.orders?.length > 0 && !importing) ? 'linear-gradient(135deg, #F59E0B, #EF4444)' : '#475569',
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
};

export default PDFImportModal;
