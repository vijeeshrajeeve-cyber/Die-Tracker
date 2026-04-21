import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, AreaChart, Area, LabelList, ComposedChart, Line } from 'recharts';
import { Search, ChevronDown, ChevronUp, Package, Clock, CheckCircle, AlertTriangle, XCircle, Truck, Plane, Factory, TrendingUp, Layers, ArrowRight, X, Eye, ChevronLeft, ChevronRight, Upload, FileSpreadsheet, Download, FileText, Sun, Moon, Settings, Trash2, BarChart3, User, Bell, Key, Lock, ShieldCheck, RotateCcw, History, Copy, ClipboardList } from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Configure PDF.js worker (Vite-compatible approach)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

import { authAPI, ordersAPI, usersAPI, suppliersAPI, plantsAPI, backupRequestsAPI, apiKeysAPI, emailAPI, sampleFollowupsAPI, plantBudgetsAPI, getUser, logout as apiLogout, isLoggedIn as checkLoggedIn } from './api';
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';

import PDFViewer from './components/PDFViewer';
import { PIImportModal, RevisionModal, ChangeLogModal } from './components/modals';
import BackupDieRequests from './components/backup/BackupDieRequests';
import EmailCompose from './components/email/EmailCompose';
import EmailInbox from './components/email/EmailInbox';
import EmailSettings from './components/email/EmailSettings';
import AddUserModal from './components/modals/AddUserModal';
import { CONTROLLABLE_PAGES, MONTHS, BACKUP_REQUEST_STATUS_CONFIG } from './utils/constants';
import { parseDateDMY } from './utils/helpers';



// Status configuration
const STATUS_CONFIG = {
  'AWAITING FOR DESIGN': { color: '#DC2626', bgColor: '#FEF2F2', icon: Clock, label: 'Awaiting Design' },
  'PENDING FOR DESIGN APPROVAL': { color: '#EA580C', bgColor: '#FFF7ED', icon: AlertTriangle, label: 'Design Approval' },
  'UNDER SIMULATION': { color: '#7C3AED', bgColor: '#F5F3FF', icon: Layers, label: 'Simulation' },
  'PENDING FOR DESIGN TO EMS': { color: '#2563EB', bgColor: '#EFF6FF', icon: Package, label: 'Design to EMS' },
  'PENDING FOR PR': { color: '#D97706', bgColor: '#FFFBEB', icon: TrendingUp, label: 'Pending PR' },
  'PENDING FOR ORACLE ENTRY': { color: '#C2410C', bgColor: '#FFF7ED', icon: Factory, label: 'Oracle Entry' },
  'PENDING FOR ORDERING': { color: '#0D9488', bgColor: '#F0FDFA', icon: Truck, label: 'Pending Order' },
  'DONE': { color: '#16A34A', bgColor: '#F0FDF4', icon: CheckCircle, label: 'In Manufacturing' },
  'DIE RECEIVED': { color: '#0891B2', bgColor: '#ECFEFF', icon: Package, label: 'Die Received' },
  'CANCELLED': { color: '#6B7280', bgColor: '#F3F4F6', icon: XCircle, label: 'Cancelled' },
  'HOLD': { color: '#4B5563', bgColor: '#F9FAFB', icon: AlertTriangle, label: 'On Hold' },
};

const CHART_COLORS = ['#0EA5E9', '#8B5CF6', '#F59E0B', '#10B981', '#EF4444', '#EC4899', '#6366F1', '#14B8A6', '#F97316', '#84CC16'];
const PLANT_COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#EF4444', '#EC4899', '#06B6D4', '#F97316', '#84CC16', '#A855F7', '#F43F5E'];
const PLANT_COLOR_MAP = { 'GEX 1': '#32a838', 'GEX 2': '#3234a8' };
const getPlantColor = (plant, index) => PLANT_COLOR_MAP[plant] || PLANT_COLORS[index % PLANT_COLORS.length];

// Utility functions for data import
const parseExcelDate = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    const date = new Date((value - 25569) * 86400 * 1000);
    return date.toISOString().split('T')[0];
  }
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return null;
};

const getMonthFromDate = (dateStr) => {
  if (!dateStr) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  try { return months[new Date(dateStr).getMonth()]; } catch { return null; }
};

const normalizeColumnName = (col) => {
  const mappings = {
    'pr no.:': 'PR Number', 'pr no': 'PR Number', 'pr number': 'PR Number',
    'customer name': 'Customer Name', 'customer': 'Customer Name',
    'die received date': 'Die Received Date', 'submission date': 'Submission Date',
    'sample approval date': 'Sample Approval Date',
    'no of trial': 'No of Trial', 'no. of trial': 'No of Trial',
    'corrector': 'Corrector',
    'press': 'Press',
    'ascona reference': 'Ascona Reference', 'ascona ref': 'Ascona Reference',
    'sample status': 'Sample Status',
    'remark': 'Remark', 'remarks': 'Remark',
    'die no': 'DIE NO', 'order no': 'Order No',
    'die size': 'Die Size', 'die requested date': 'Die Requested Date', 'ordered date': 'Ordered date',
    'type of shipment': 'Type of shipment', 'mandrels per cavity': 'Mandrels per Cavity',
    'total mandrels': 'Total Mandrels', 'design received date': 'Design Received Date',
    'design approved date': 'Design Approved Date', 'pr entry': 'PR Entry', 'oracle entry': 'Oracle Entry',
    'overall delay': 'OVERALL DELAY', 'status': 'STATUS', 'plant': 'Plant', 'type': 'TYPE',
    'supplier': 'Supplier', 'eta': 'ETA', 'delay': 'Delay',
  };
  return mappings[col.toLowerCase().trim()] || col;
};

// Components
const StatusBadge = ({ status }) => {
  const config = STATUS_CONFIG[status] || { color: '#6B7280', bgColor: '#F3F4F6', label: status };
  return <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 600, backgroundColor: config.bgColor, color: config.color }}>{config.label}</span>;
};

const ProgressPipeline = ({ order }) => {
  // Include 3D Model stage only if simulation is enabled for this order
  const baseStages = ['Ordered date', 'Design Received Date'];
  const simulationStage = order.simulationEnabled ? ['3D Model Received Date'] : [];
  const endStages = ['Design Approved Date', 'PR Entry', 'Oracle Entry'];
  const stages = [...baseStages, ...simulationStage, ...endStages];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
      {stages.map((key, idx) => {
        const complete = order.STATUS !== 'CANCELLED' && order[key];
        return (
          <React.Fragment key={key}>
            <div style={{ width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, background: complete ? '#10B981' : '#1E293B', color: complete ? 'white' : '#64748B', border: complete ? 'none' : '2px solid #334155' }}>
              {complete ? '✓' : idx + 1}
            </div>
            {idx < stages.length - 1 && <div style={{ width: '8px', height: '2px', background: complete ? '#10B981' : '#334155' }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// Import Modal Component
const ImportModal = ({ onClose, onImport }) => {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);

  const processData = (rawData) => {
    return rawData.map(row => {
      const normalized = {};
      Object.keys(row).forEach(key => {
        const normKey = normalizeColumnName(key);
        let value = row[key];
        if (normKey.toLowerCase().includes('date') || normKey === 'ETA' || normKey === 'PR Entry' || normKey === 'Oracle Entry') {
          value = parseExcelDate(value);
        }
        if (['Delay', 'OVERALL DELAY', 'Mandrels per Cavity', 'Total Mandrels', 'No of Trial'].includes(normKey)) {
          value = parseFloat(value) || 0;
        }
        normalized[normKey] = value === '' || value === undefined ? null : value;
      });
      if (!normalized.month && normalized['Die Requested Date']) {
        normalized.month = getMonthFromDate(normalized['Die Requested Date']);
      }
      // Auto-mark SF as 'Sample Submitted' when a submission date is present
      // and no meaningful sample status has been set yet.
      if (normalized['Submission Date']) {
        const cur = (normalized['Sample Status'] || '').toString().trim();
        if (!cur || cur.toLowerCase() === 'pending') {
          normalized['Sample Status'] = 'Sample Submitted';
        }
      }
      return normalized;
    }).filter(row => row['DIE NO'] || row['Order No']);
  };

  const processFile = useCallback((file) => {
    setError(null);
    const reader = new FileReader();
    if (file.name.endsWith('.csv')) {
      reader.onload = (e) => {
        Papa.parse(e.target.result, {
          header: true, skipEmptyLines: true,
          complete: (results) => { const processed = processData(results.data); setPreview({ data: processed, count: processed.length }); },
          error: (err) => setError(`CSV error: ${err.message}`)
        });
      };
      reader.readAsText(file);
    } else if (file.name.match(/\.xlsx?$/)) {
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
          const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('die') || n.toLowerCase().includes('order')) || wb.SheetNames[0];
          const jsonData = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
          const processed = processData(jsonData);
          setPreview({ data: processed, count: processed.length, sheet: sheetName });
        } catch (err) { setError(`Excel error: ${err.message}`); }
      };
      reader.readAsArrayBuffer(file);
    } else { setError('Please upload .xlsx, .xls, or .csv file'); }
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }} onClick={onClose}>
      <div style={{ background: '#1E293B', borderRadius: '20px', width: '100%', maxWidth: '520px', border: '1px solid #334155' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem', borderBottom: '1px solid #334155' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: '#3B82F6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Upload size={24} color="white" /></div>
            <div><h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#F1F5F9' }}>Import Data</h2><p style={{ fontSize: '0.875rem', color: '#64748B' }}>Upload Excel or CSV file</p></div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', padding: '8px', borderRadius: '8px' }}><X size={24} /></button>
        </div>
        <div style={{ padding: '1.5rem' }}>
          <div style={{ border: `2px dashed ${dragActive ? '#3B82F6' : '#334155'}`, borderRadius: '16px', padding: '2.5rem', textAlign: 'center', background: dragActive ? 'rgba(59,130,246,0.1)' : 'transparent', marginBottom: '1rem' }}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => { e.preventDefault(); setDragActive(false); processFile(e.dataTransfer.files[0]); }}>
            <FileSpreadsheet size={48} color="#64748B" />
            <p style={{ fontSize: '1rem', color: '#F1F5F9', marginTop: '1rem' }}>Drag & drop your file here</p>
            <p style={{ color: '#64748B', margin: '0.5rem 0' }}>or</p>
            <label style={{ display: 'inline-block', padding: '0.75rem 1.5rem', background: '#3B82F6', color: 'white', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
              Browse Files<input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => processFile(e.target.files[0])} hidden />
            </label>
            <p style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '1rem' }}>Supports .xlsx, .xls, .csv</p>
          </div>
          {error && <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(244,63,94,0.1)', color: '#F43F5E', padding: '0.875rem 1rem', borderRadius: '10px', marginBottom: '1rem' }}><AlertTriangle size={18} /><span>{error}</span></div>}
          {preview && <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(16,185,129,0.1)', padding: '1rem', borderRadius: '10px', marginBottom: '1rem' }}><CheckCircle size={20} color="#10B981" /><div><p style={{ fontWeight: 600, color: '#10B981' }}>Ready to import</p><p style={{ fontSize: '0.8rem', color: '#94A3B8' }}>{preview.count} records {preview.sheet && `from "${preview.sheet}"`}</p></div></div>}
          <div style={{ background: '#0F172A', padding: '1rem', borderRadius: '10px' }}>
            <h4 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: '#64748B', marginBottom: '0.75rem' }}>Expected Columns:</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {['Plant', 'Order No', 'DIE NO', 'TYPE', 'Die Size', 'STATUS', 'Supplier', 'Die Requested Date'].map(c => <span key={c} style={{ fontSize: '0.7rem', padding: '4px 8px', background: '#334155', color: '#94A3B8', borderRadius: '4px', fontFamily: 'monospace' }}>{c}</span>)}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '1.25rem 1.5rem', borderTop: '1px solid #334155' }}>
          <button onClick={onClose} style={{ padding: '0.75rem 1.5rem', background: '#334155', color: '#F1F5F9', border: '1px solid #475569', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => { if (preview?.data) { onImport(preview.data); onClose(); } }} disabled={!preview} style={{ padding: '0.75rem 1.5rem', background: preview ? 'linear-gradient(135deg, #3B82F6, #8B5CF6)' : '#475569', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: preview ? 'pointer' : 'not-allowed', opacity: preview ? 1 : 0.5 }}>Import {preview?.count || 0} Records</button>
        </div>
      </div>
    </div>
  );
};

// PDF Import Modal Component - PRESS to Plant mapping
const PRESS_TO_PLANT_PDF = {
  '25': 'GEX 2', 'P25': 'GEX 2',
  '35': 'GEX 2', 'P35': 'GEX 2',
  '2': 'GEX 1', 'P2': 'GEX 1',
  '4': 'GEX 1', 'P4': 'GEX 1',
  '5': 'GEX 1', 'P5': 'GEX 1',
  '6': 'GEX 1', 'P6': 'GEX 1',
  'B': 'GEX 1', 'D': 'GEX 1', 'E': 'GEX 1', 'F': 'GEX 1',
};

// Known die supplier names for PDF extraction
const KNOWN_SUPPLIERS = ['PDTMC', 'PHME', 'EKSTEK', 'COMPES', 'ADEX', 'WEFA', 'JIANGSU', 'COMES', 'PHOENIX', 'PRESSMETAL', 'AIT'];
// Map common PDF typos/variants to canonical supplier names
const SUPPLIER_ALIASES = { 'GIANGSU': 'JIANGSU', 'GIANSUN': 'JIANGSU', 'JIANSU': 'JIANGSU' };

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
  const parseSinglePDF = async (file, batchIndex = 0) => {
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
          if (/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}/.test(line.text) || afterLabels.length >= 2) {
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
            const dm = lines[j].text.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/);
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

        // 3D MODULE FOR SIMULATION
        if ((upperLine.includes('3D MODULE') || upperLine.includes('SIMULATION')) && !simulationEnabled) {
          if (/\b(yes|ok)\b/i.test(lineText)) simulationEnabled = true;
          if (!simulationEnabled && i + 1 < lines.length && /\b(yes|ok)\b/i.test(lines[i + 1].text)) {
            simulationEnabled = true;
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
          const dateMatch = supplierLine.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/);
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

        // Line AFTER die size = Cavity + Press (e.g., "1 P4", "8 P4", "1 P25", "2 P 25")
        // OR cavity and press on separate lines: "1" then "P5" or REVERSE: "P2" then "1"
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

        // Lines after cav+press: Solid/Hollow, Insert No, Size, Delivery Date, Simulation, Shipment
        // Walk sequentially from anchorIdx + 2 (or +3 if cav/press were split across 2 lines)
        const cavPressOnOneLine = lines[anchorIdx + 1]?.text.trim().match(/^(\d+)\s+(P?\s*\d+|[A-F])\b/i);
        const startIdx = (cavity !== null && pressCode && !cavPressOnOneLine)
          ? anchorIdx + 3  // cav and press were on separate lines
          : anchorIdx + 2; // cav+press on same line
        const remaining = lines.slice(startIdx).map(l => l.text.trim()).filter(t => t.length > 0);

        for (const val of remaining) {
          // Delivery date: DD/MM/YYYY or DD-MM-YYYY
          if (!requestedDate && /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}/.test(val)) {
            // Skip dates that look like old revision dates (< 2020)
            const yearMatch = val.match(/(\d{4})/);
            if (yearMatch && parseInt(yearMatch[1], 10) >= 2020) {
              requestedDate = parseDateDMY(val.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/)[1]);
            }
          }
          // Simulation: standalone "Yes" or "No" (but not "Old"/"New"/"Solid"/"Hollow")
          if (!simulationEnabled && /^(yes|ok)$/i.test(val)) {
            simulationEnabled = true;
          }
          // Shipment: now derived from supplier table (no PDF extraction needed)
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
        const supplierMatch = text.match(/Supplier\s*[:\-]*\s*(\w+)/i);
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
        const dm = line.text.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/);
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

    return {
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
      'Mandrels per Cavity': cavity || 0,
      'Total Mandrels': 0,
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
  };

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
        const order = await parseSinglePDF(pdfFiles[i], i);
        newOrders.push(order);
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
  }, [existingOrders]);

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
        const cleanOrders = preview.orders.map(({ _urgency, _componentType, _isRevision, _cavity, ...order }) => order);
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
                          <td style={{ padding: '10px 12px', color: '#F1F5F9' }}>{order._cavity || '-'}</td>
                          <td style={{ padding: '10px 12px' }}>
                            <input
                              type="number"
                              min="0"
                              value={order['Mandrels per Cavity'] || 0}
                              onChange={(e) => {
                                const mpc = parseInt(e.target.value, 10) || 0;
                                const cavities = order._cavity || 1;
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

// Password Change Modal - Input Styles (defined outside to prevent re-render)
const passwordInputStyle = {
  width: '100%',
  padding: '12px 40px 12px 12px',
  background: '#0F172A',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#F1F5F9',
  fontSize: '0.95rem'
};

// Password Input Component (defined outside to prevent re-render on each keystroke)
const PasswordInput = ({ name, label, value, show, onToggle, onChange }) => (
  <div style={{ marginBottom: '1rem' }}>
    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: '#94A3B8', marginBottom: '6px' }}>
      {label}
    </label>
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        style={passwordInputStyle}
        required
      />
      <button
        type="button"
        onClick={onToggle}
        style={{
          position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
          background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer'
        }}
      >
        <Eye size={18} />
      </button>
    </div>
  </div>
);

// Password Change Modal Component
const PasswordChangeModal = ({ onClose, onSuccess, isForced = false }) => {
  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false
  });

  const passwordRequirements = [
    { label: 'At least 8 characters', test: (p) => p.length >= 8 },
    { label: 'Contains uppercase letter', test: (p) => /[A-Z]/.test(p) },
    { label: 'Contains lowercase letter', test: (p) => /[a-z]/.test(p) },
    { label: 'Contains number', test: (p) => /[0-9]/.test(p) },
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validate passwords match
    if (formData.newPassword !== formData.confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    // Validate password requirements
    const unmetRequirements = passwordRequirements.filter(r => !r.test(formData.newPassword));
    if (unmetRequirements.length > 0) {
      setError('Password does not meet all requirements');
      return;
    }

    setLoading(true);
    try {
      await authAPI.changePassword(formData.currentPassword, formData.newPassword);
      onSuccess();
    } catch (err) {
      setError(err.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (name) => (e) => {
    setFormData(prev => ({ ...prev, [name]: e.target.value }));
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1rem'
      }}
      onClick={isForced ? undefined : onClose}
    >
      <div
        style={{
          background: '#1E293B', borderRadius: '20px', width: '100%', maxWidth: '440px',
          border: '1px solid #334155', overflow: 'hidden'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem', borderBottom: '1px solid #334155' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '14px',
              background: isForced ? 'linear-gradient(135deg, #F59E0B, #EF4444)' : 'linear-gradient(135deg, #3B82F6, #8B5CF6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              {isForced ? <ShieldCheck size={24} color="white" /> : <Key size={24} color="white" />}
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#F1F5F9' }}>
                {isForced ? 'Password Change Required' : 'Change Password'}
              </h2>
              <p style={{ fontSize: '0.875rem', color: '#64748B' }}>
                {isForced ? 'You must change your password to continue' : 'Update your account password'}
              </p>
            </div>
          </div>
          {!isForced && (
            <button
              onClick={onClose}
              style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', padding: '8px', borderRadius: '8px' }}
            >
              <X size={24} />
            </button>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>
          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: 'rgba(244,63,94,0.1)', color: '#F43F5E',
              padding: '0.875rem 1rem', borderRadius: '10px', marginBottom: '1rem'
            }}>
              <AlertTriangle size={18} />
              <span style={{ fontSize: '0.9rem' }}>{error}</span>
            </div>
          )}

          {isForced && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              background: 'rgba(245,158,11,0.1)', padding: '1rem',
              borderRadius: '10px', marginBottom: '1.25rem'
            }}>
              <Lock size={18} color="#F59E0B" style={{ marginTop: '2px', flexShrink: 0 }} />
              <p style={{ fontSize: '0.85rem', color: '#F59E0B', lineHeight: 1.5 }}>
                For security reasons, you must change your default password before accessing the system.
              </p>
            </div>
          )}

          <PasswordInput
            name="currentPassword"
            label="Current Password"
            value={formData.currentPassword}
            show={showPasswords.current}
            onToggle={() => setShowPasswords(prev => ({ ...prev, current: !prev.current }))}
            onChange={handleInputChange('currentPassword')}
          />

          <PasswordInput
            name="newPassword"
            label="New Password"
            value={formData.newPassword}
            show={showPasswords.new}
            onToggle={() => setShowPasswords(prev => ({ ...prev, new: !prev.new }))}
            onChange={handleInputChange('newPassword')}
          />

          <PasswordInput
            name="confirmPassword"
            label="Confirm New Password"
            value={formData.confirmPassword}
            show={showPasswords.confirm}
            onToggle={() => setShowPasswords(prev => ({ ...prev, confirm: !prev.confirm }))}
            onChange={handleInputChange('confirmPassword')}
          />

          {/* Password Requirements */}
          <div style={{ background: '#0F172A', borderRadius: '10px', padding: '1rem', marginBottom: '1.25rem' }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
              Password Requirements
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {passwordRequirements.map((req, idx) => {
                const met = req.test(formData.newPassword);
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{
                      width: '16px', height: '16px', borderRadius: '50%',
                      background: met ? '#10B981' : '#334155',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      {met && <CheckCircle size={10} color="white" />}
                    </div>
                    <span style={{ fontSize: '0.75rem', color: met ? '#10B981' : '#64748B' }}>
                      {req.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '14px',
              background: loading ? '#475569' : 'linear-gradient(135deg, #3B82F6, #8B5CF6)',
              color: 'white', border: 'none', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
            }}
          >
            {loading ? (
              <>
                <div style={{
                  width: '18px', height: '18px', border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: 'white', borderRadius: '50%', animation: 'spin 1s linear infinite'
                }} />
                Changing Password...
              </>
            ) : (
              <>
                <Key size={18} />
                Change Password
              </>
            )}
          </button>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </form>
      </div>
    </div>
  );
};

// Order Detail Modal with Editing
const OrderDetailModal = ({ order, onClose, onUpdate, theme, suppliers = [], plants = [], currentUser }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedOrder, setEditedOrder] = useState({ ...order });
  const [isSaving, setIsSaving] = useState(false);
  const [viewingFile, setViewingFile] = useState(null); // { file, type, notes, signature }
  const [statusReasonModal, setStatusReasonModal] = useState({ show: false, newStatus: '', oldStatus: '', reason: '' });
  const [pendingStatusLog, setPendingStatusLog] = useState(null);

  const handleFileChange = (field, file) => {
    setEditedOrder(prev => ({ ...prev, [field]: file }));
  };

  const handleViewerSave = (data) => {
    // Save notes/signature back to the editedOrder state
    setEditedOrder(prev => ({
      ...prev,
      [`${viewingFile.type}Notes`]: data.notes,
      [`${viewingFile.type}Signature`]: data.signature
    }));
  };

  if (!order) return null;

  const currentOrder = isEditing ? editedOrder : order;
  const config = STATUS_CONFIG[currentOrder.STATUS] || { color: '#6B7280', icon: Package };
  const StatusIcon = config.icon;

  // Auto-determine status based on filled fields
  const determineStatus = (orderData) => {
    if (orderData.STATUS === 'CANCELLED' || orderData.STATUS === 'HOLD') return orderData.STATUS;

    // Check dates in reverse order of progress to find current stage
    if (orderData['Oracle Entry'] && orderData['PR Entry'] && orderData['Design Approved Date'] && orderData['Design Received Date'] && orderData['Ordered date']) {
      return 'DONE';
    }
    if (orderData['PR Entry'] && orderData['Design Approved Date'] && orderData['Design Received Date'] && orderData['Ordered date']) {
      return 'PENDING FOR ORACLE ENTRY';
    }
    if (orderData['Design Approved Date'] && orderData['Design Received Date'] && orderData['Ordered date']) {
      return 'PENDING FOR PR';
    }
    // Check for 3D Model Received (simulation in progress) - only if simulation is enabled
    if (orderData.simulationEnabled && orderData['3D Model Received Date'] && orderData['Design Received Date'] && orderData['Ordered date']) {
      return 'UNDER SIMULATION';
    }
    if (orderData['Design Received Date'] && orderData['Ordered date']) {
      return 'PENDING FOR DESIGN APPROVAL';
    }
    if (orderData['Ordered date']) {
      return 'AWAITING FOR DESIGN';
    }
    return 'PENDING FOR ORDERING';
  };

  const handleFieldChange = (field, value) => {
    if (field === 'STATUS' && (value === 'CANCELLED' || value === 'HOLD')) {
      const oldStatus = editedOrder.STATUS || order.STATUS;
      setStatusReasonModal({ show: true, newStatus: value, oldStatus, reason: '' });
      return;
    }
    setEditedOrder(prev => {
      const updated = { ...prev, [field]: value };
      // Auto-update status when date fields change (except if manually setting STATUS)
      if (field !== 'STATUS') {
        updated.STATUS = determineStatus(updated);
      }
      return updated;
    });
  };

  const handleStatusReasonConfirm = () => {
    const { newStatus, oldStatus, reason } = statusReasonModal;
    const now = new Date();
    const logEntry = {
      date: now.toISOString().split('T')[0],
      time: now.toTimeString().split(' ')[0],
      field: 'STATUS',
      oldValue: oldStatus,
      newValue: newStatus,
      reason: reason.trim(),
      changedBy: currentUser?.username || 'unknown',
      stage: oldStatus,
    };
    setPendingStatusLog(logEntry);
    setEditedOrder(prev => ({ ...prev, STATUS: newStatus }));
    setStatusReasonModal({ show: false, newStatus: '', oldStatus: '', reason: '' });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      let orderToSave = { ...editedOrder };
      if (pendingStatusLog) {
        const existingLog = order['Change Log'] || [];
        orderToSave['Change Log'] = [...existingLog, pendingStatusLog];
      }
      await ordersAPI.update(order.id, orderToSave);
      if (onUpdate) onUpdate(orderToSave);
      setIsEditing(false);
      setPendingStatusLog(null);
    } catch (error) {
      alert('Failed to save: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedOrder({ ...order });
    setIsEditing(false);
    setPendingStatusLog(null);
  };

  const inputStyle = {
    width: '100%',
    padding: '8px 12px',
    background: theme?.inputBg || '#0F172A',
    border: `1px solid ${theme?.cardBorder || '#334155'}`,
    borderRadius: '8px',
    color: theme?.text || '#F1F5F9',
    fontSize: '0.875rem',
    textAlign: 'right',
    outline: 'none',
    transition: 'border-color 0.2s',
  };

  const dateInputStyle = {
    ...inputStyle,
    minWidth: '140px',
    cursor: 'pointer',
    colorScheme: theme?.text === '#F1F5F9' ? 'dark' : 'light',
  };

  const selectStyle = { ...inputStyle, cursor: 'pointer' };

  const InfoRow = ({ label, field, value, type = 'text', options = null }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${theme?.cardBorder || '#334155'}` }}>
      <span style={{ fontSize: '0.8rem', color: theme?.textDim || '#64748B', minWidth: '80px' }}>{label}</span>
      {isEditing ? (
        type === 'select' && options ? (
          <select style={selectStyle} value={editedOrder[field] || ''} onChange={(e) => handleFieldChange(field, e.target.value)}>
            <option value="">—</option>
            {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        ) : type === 'date' ? (
          <input
            type="date"
            style={dateInputStyle}
            value={editedOrder[field] || ''}
            onChange={(e) => handleFieldChange(field, e.target.value)}
            onClick={(e) => e.target.showPicker && e.target.showPicker()}
          />
        ) : (
          <input type="text" style={inputStyle} value={editedOrder[field] || ''} onChange={(e) => handleFieldChange(field, e.target.value)} />
        )
      ) : (
        <span style={{ fontSize: '0.875rem', fontWeight: 500, color: theme?.text || '#F1F5F9' }}>{value || '—'}</span>
      )}
    </div>
  );

  const FileRow = ({ label, field, value, notesField, signatureField }) => (
    <div style={{ marginBottom: '16px' }}>
      <label style={{ display: 'block', fontSize: '0.8rem', color: theme?.textDim || '#64748B', marginBottom: '4px' }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {isEditing ? (
          <>
            <label style={{
              flex: 1, cursor: 'pointer', background: theme?.cardBg, border: `1px dashed ${theme?.cardBorder}`,
              borderRadius: '8px', padding: '8px', display: 'flex', alignItems: 'center', gap: '8px',
              color: theme?.textDim, fontSize: '0.8rem'
            }}>
              <input
                type="file"
                accept=".pdf"
                onChange={(e) => e.target.files[0] && handleFileChange(field, e.target.files[0])}
                style={{ display: 'none' }}
              />
              <Upload size={16} />
              {value ? (value.name || 'File selected') : 'Upload PDF'}
            </label>
            {value && (
              <button
                onClick={() => setViewingFile({ file: value, type: field, notes: editedOrder[notesField] || '', signature: editedOrder[signatureField] })}
                style={{ padding: '8px', background: '#3B82F6', color: 'white', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
                title="View & Sign"
              >
                <Eye size={16} />
              </button>
            )}
          </>
        ) : (
          value ? (
            <button
              onClick={() => setViewingFile({ file: value, type: field, notes: editedOrder[notesField] || '', signature: editedOrder[signatureField] })}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#3B82F6', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '0.9rem' }}
            >
              <FileText size={16} /> View Document
              {(editedOrder[signatureField]) && <span style={{ fontSize: '0.7rem', background: '#10B981', color: 'white', padding: '2px 6px', borderRadius: '4px' }}>Signed</span>}
            </button>
          ) : (
            <span style={{ fontSize: '0.875rem', color: theme?.textMuted || '#64748B', fontStyle: 'italic' }}>No document attached</span>
          )
        )}
      </div>
    </div>
  );

  const statusOptions = Object.keys(STATUS_CONFIG);
  const typeOptions = ['N', 'B', 'T', 'C', 'H'];
  const plantOptions = ['EXT 1', 'EXT 2'];
  const shipmentOptions = ['AIR', 'LAND'];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }} onClick={onClose}>
      <div style={{ background: theme?.cardBg || '#1E293B', borderRadius: '20px', width: '100%', maxWidth: '680px', maxHeight: '90vh', overflow: 'hidden', border: `1px solid ${theme?.cardBorder || '#334155'}` }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem', borderBottom: `1px solid ${theme?.cardBorder || '#334155'}`, background: `${config.color}10` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: config.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><StatusIcon size={24} color="white" /></div>
            <div><h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: theme?.text || '#F1F5F9' }}>{order['DIE NO']}</h2><p style={{ color: theme?.textDim || '#64748B' }}>Order #{order['Order No']}</p></div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {!isEditing ? (
              <button onClick={() => setIsEditing(true)} style={{ padding: '8px 16px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 500, cursor: 'pointer' }}>Edit</button>
            ) : (
              <>
                <button onClick={handleCancel} style={{ padding: '8px 16px', background: theme?.cardBg || '#334155', color: theme?.text || '#F1F5F9', border: `1px solid ${theme?.cardBorder || '#334155'}`, borderRadius: '8px', fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
                <button onClick={handleSave} disabled={isSaving} style={{ padding: '8px 16px', background: isSaving ? '#475569' : '#10B981', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 500, cursor: isSaving ? 'not-allowed' : 'pointer' }}>{isSaving ? 'Saving...' : 'Save'}</button>
              </>
            )}
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: theme?.textDim || '#64748B', cursor: 'pointer', padding: '8px', borderRadius: '8px' }}><X size={24} /></button>
          </div>
        </div>
        <div style={{ padding: '1.5rem', overflowY: 'auto', maxHeight: '65vh' }}>
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme?.textDim || '#64748B', marginBottom: '12px' }}>Progress</h3>
            <ProgressPipeline order={currentOrder} />
            {isEditing && <p style={{ fontSize: '0.7rem', color: theme?.textDim || '#64748B', marginTop: '8px', fontStyle: 'italic' }}>Fill in date fields below to update progress</p>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
            <div style={{ background: theme?.inputBg || '#0F172A', borderRadius: '12px', padding: '1rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme?.textDim || '#64748B', marginBottom: '12px' }}>Order Details</h3>
              <InfoRow label="Plant" field="Plant" value={currentOrder.Plant} type="select" options={plants.map(p => p.name)} />
              <InfoRow label="Type" field="TYPE" value={currentOrder.TYPE} type="select" options={typeOptions} />
              <InfoRow label="Die Size" field="Die Size" value={currentOrder['Die Size']} />
              <InfoRow label="Mandrels/Cav" field="Mandrels per Cavity" value={currentOrder['Mandrels per Cavity'] || 0} />
              <InfoRow label="Total Mandrels" field="Total Mandrels" value={currentOrder['Total Mandrels'] || 0} />
              <InfoRow label="Shipment" field="Type of shipment" value={currentOrder['Type of shipment']} type="select" options={shipmentOptions} />
              <InfoRow label="Supplier" field="Supplier" value={currentOrder.Supplier} type="select" options={suppliers.map(s => s.name)} />
              <InfoRow label="Customer" field="Customer Name" value={currentOrder['Customer Name']} />
              <InfoRow label="PR Number" field="PR Number" value={currentOrder['PR Number']} />
              <InfoRow label="Status" field="STATUS" value={currentOrder.STATUS} type="select" options={statusOptions} />
            </div>
            <div style={{ background: theme?.inputBg || '#0F172A', borderRadius: '12px', padding: '1rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme?.textDim || '#64748B', marginBottom: '12px' }}>Timeline</h3>
              <InfoRow label="Requested" field="Die Requested Date" value={currentOrder['Die Requested Date']} type="date" />
              <InfoRow label="Design Received" field="Design Received Date" value={currentOrder['Design Received Date']} type="date" />
              {currentOrder.simulationEnabled && <InfoRow label="3D Model Received" field="3D Model Received Date" value={currentOrder['3D Model Received Date']} type="date" />}
              <InfoRow label="Design Approved" field="Design Approved Date" value={currentOrder['Design Approved Date']} type="date" />
              <InfoRow label="PR Entry" field="PR Entry" value={currentOrder['PR Entry']} type="date" />
              <InfoRow label="Oracle Entry" field="Oracle Entry" value={currentOrder['Oracle Entry']} type="date" />
              <InfoRow label="Ordered" field="Ordered date" value={currentOrder['Ordered date']} type="date" />
              <InfoRow label="ETA" field="ETA" value={currentOrder.ETA} type="date" />
              <InfoRow label="Die Received" field="Die Received Date" value={currentOrder['Die Received Date']} type="date" />
              <InfoRow label="Submission" field="Submission Date" value={currentOrder['Submission Date']} type="date" />
              <InfoRow label="Sample Approval" field="Sample Approval Date" value={currentOrder['Sample Approval Date']} type="date" />
              <InfoRow label="No of Trial" field="No of Trial" value={currentOrder['No of Trial'] || 0} />
              <InfoRow label="Corrector" field="Corrector" value={currentOrder['Corrector']} />
            </div>
          </div>

          {/* Attachments Section */}
          <div style={{ marginTop: '1rem', background: theme?.inputBg || '#0F172A', borderRadius: '12px', padding: '1rem' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme?.textDim || '#64748B', marginBottom: '12px' }}>Attachments</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
              <FileRow label="Die Order Form" field="dieOrderFile" value={editedOrder.dieOrderFile} notesField="dieOrderFileNotes" signatureField="dieOrderFileSignature" />
              <FileRow label="Die Design PDF" field="designFile" value={editedOrder.designFile} notesField="designFileNotes" signatureField="designFileSignature" />
            </div>
          </div>

          {(currentOrder.Delay > 0 || currentOrder['OVERALL DELAY'] > 0) && (<div style={{ background: 'rgba(244,63,94,0.1)', borderRadius: '12px', padding: '1rem', marginTop: '1rem' }}><h3 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: '#F43F5E', marginBottom: '12px' }}>Delays</h3><div style={{ display: 'flex', gap: '2rem' }}><div><span style={{ fontSize: '0.8rem', color: '#F43F5E', opacity: 0.8 }}>Design</span><span style={{ display: 'block', fontSize: '1.5rem', fontWeight: 700, color: '#F43F5E' }}>{currentOrder.Delay || 0}d</span></div><div><span style={{ fontSize: '0.8rem', color: '#F43F5E', opacity: 0.8 }}>Overall</span><span style={{ display: 'block', fontSize: '1.5rem', fontWeight: 700, color: '#F43F5E' }}>{currentOrder['OVERALL DELAY'] || 0}d</span></div></div></div>)}
        </div>
      </div>

      {viewingFile && (
        <PDFViewer
          file={viewingFile.file}
          initialNotes={viewingFile.notes}
          initialSignature={viewingFile.signature}
          onSave={handleViewerSave}
          onClose={() => setViewingFile(null)}
        />
      )}

      {/* Status Change Reason Modal */}
      {statusReasonModal.show && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '1rem' }} onClick={e => e.stopPropagation()}>
          <div style={{ background: theme?.cardBg || '#1E293B', borderRadius: '16px', width: '100%', maxWidth: '440px', border: `1px solid ${theme?.cardBorder || '#334155'}`, overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: `1px solid ${theme?.cardBorder || '#334155'}`, background: statusReasonModal.newStatus === 'CANCELLED' ? 'rgba(239,68,68,0.1)' : 'rgba(75,85,99,0.15)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: statusReasonModal.newStatus === 'CANCELLED' ? '#EF4444' : '#4B5563', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <XCircle size={18} color="white" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: theme?.text || '#F1F5F9' }}>Reason Required</h3>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: theme?.textDim || '#64748B' }}>
                    Status → <strong style={{ color: statusReasonModal.newStatus === 'CANCELLED' ? '#EF4444' : '#9CA3AF' }}>{statusReasonModal.newStatus}</strong>
                  </p>
                </div>
              </div>
            </div>
            {/* Body */}
            <div style={{ padding: '1.25rem 1.5rem' }}>
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: theme?.textDim || '#64748B' }}>
                Changing from <strong style={{ color: theme?.text || '#F1F5F9' }}>{statusReasonModal.oldStatus}</strong> to <strong style={{ color: statusReasonModal.newStatus === 'CANCELLED' ? '#EF4444' : '#9CA3AF' }}>{statusReasonModal.newStatus}</strong>. Please provide a reason — this will be recorded in the order's change log.
              </p>
              <textarea
                autoFocus
                rows={4}
                placeholder="Enter reason..."
                value={statusReasonModal.reason}
                onChange={(e) => setStatusReasonModal(prev => ({ ...prev, reason: e.target.value }))}
                style={{ width: '100%', padding: '10px 12px', background: theme?.inputBg || '#0F172A', border: `1px solid ${theme?.cardBorder || '#334155'}`, borderRadius: '8px', color: theme?.text || '#F1F5F9', fontSize: '0.875rem', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            {/* Footer */}
            <div style={{ padding: '0 1.5rem 1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setStatusReasonModal({ show: false, newStatus: '', oldStatus: '', reason: '' })} style={{ padding: '8px 18px', background: 'transparent', border: `1px solid ${theme?.cardBorder || '#334155'}`, borderRadius: '8px', color: theme?.textDim || '#64748B', fontSize: '0.875rem', cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                disabled={!statusReasonModal.reason.trim()}
                onClick={handleStatusReasonConfirm}
                style={{ padding: '8px 18px', background: statusReasonModal.reason.trim() ? (statusReasonModal.newStatus === 'CANCELLED' ? '#EF4444' : '#4B5563') : '#334155', border: 'none', borderRadius: '8px', color: 'white', fontSize: '0.875rem', cursor: statusReasonModal.reason.trim() ? 'pointer' : 'not-allowed', fontWeight: 600 }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Main App Component
export default function DieOrderingSystem() {
  const [data, setData] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({ plant: 'all', status: 'all', supplier: 'all', type: 'all', month: 'all' });
  const [sortConfig, setSortConfig] = useState({ key: 'Die Requested Date', direction: 'desc' });
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showPDFImportModal, setShowPDFImportModal] = useState(false);
  const [showPIImportModal, setShowPIImportModal] = useState(false);
  const [revisionOrder, setRevisionOrder] = useState(null); // For revision modal
  const [changelogOrder, setChangelogOrder] = useState(null); // For changelog modal
  const [currentPage, setCurrentPage] = useState(1);
  const [showCompletedInChart, setShowCompletedInChart] = useState(false);
  const [showCancelledInChart, setShowCancelledInChart] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebarCollapsed') === 'true';
    } catch {
      return false;
    }
  });
  // Get dark mode preference from localStorage, default to true (dark mode)
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('die-ordering-app-theme');
      return saved !== null ? saved === 'dark' : true; // Default to dark mode
    } catch {
      return true;
    }
  });

  // Persist dark mode preference to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('die-ordering-app-theme', isDarkMode ? 'dark' : 'light');
    } catch (e) {
      console.warn('Unable to save theme preference');
    }
  }, [isDarkMode]);

  useEffect(() => {
    try {
      localStorage.setItem('sidebarCollapsed', sidebarCollapsed ? 'true' : 'false');
    } catch {
      console.warn('Unable to save sidebar preference');
    }
  }, [sidebarCollapsed]);

  const [analyticsFilter, setAnalyticsFilter] = useState({ period: 'all', quarter: 'all' });
  const [trendYear, setTrendYear] = useState(new Date().getFullYear().toString());
  const itemsPerPage = 10;

  // Plant budget state (fetched from DB)
  const [plantBudgets, setPlantBudgets] = useState({}); // { year: { plantName: { backup: [], new: [] } } }
  // Budget editing in Settings
  const [budgetYear, setBudgetYear] = useState(new Date().getFullYear().toString());
  const [budgetActivePlant, setBudgetActivePlant] = useState(null);
  const [budgetEdits, setBudgetEdits] = useState({}); // { backup: [12], new: [12] }
  const [budgetSaving, setBudgetSaving] = useState(false);

  // Auth state
  const [isLoggedIn, setIsLoggedIn] = useState(checkLoggedIn());
  const [user, setUser] = useState(getUser());
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user', pageAccess: null });
  const [suppliers, setSuppliers] = useState([]);
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierShipment, setNewSupplierShipment] = useState('LAND');
  const [plants, setPlants] = useState([]);
  const [showAddPlant, setShowAddPlant] = useState(false);
  const [newPlantName, setNewPlantName] = useState('');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showPasswordChangeModal, setShowPasswordChangeModal] = useState(false);
  const [forcePasswordChange, setForcePasswordChange] = useState(false);
  const [toast, setToast] = useState(null); // { message: string, type: 'success' | 'error' }
  const [backupRequests, setBackupRequests] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [newApiKeyName, setNewApiKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState(null);
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [showEmailCompose, setShowEmailCompose] = useState(null); // null or { to, cc, subject, body, orderId }
  const [showSampleFollowupForm, setShowSampleFollowupForm] = useState(false);
  const [editingSampleFollowup, setEditingSampleFollowup] = useState(null);
  const [sampleFollowupForm, setSampleFollowupForm] = useState({
    die: '', press: '', supplier: '', customer: '', die_received_date: '',
    ascona_reference: 'No', submission_date: '', sample_approval_date: '',
    delay_days: 0, status: 'Pending', no_of_trial: 0, remark: '', corrector: ''
  });
  const [dieReceivanceOrder, setDieReceivanceOrder] = useState(null);
  const [dieReceivanceForm, setDieReceivanceForm] = useState({ die_received_date: '', corrector: '' });
  const [sfStatusFilter, setSfStatusFilter] = useState('Pending');
  const [sfPlantFilter, setSfPlantFilter] = useState('All');

  // Clipboard helper - falls back to execCommand for HTTP (non-localhost) contexts
  const copyToClipboard = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback for HTTP
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  };

  // Fetch orders from API
  const fetchOrders = useCallback(async () => {
    try {
      const response = await ordersAPI.getAll();
      setData(response.orders || []);
    } catch (error) {
      console.error('Failed to fetch orders:', error);
      // If unauthorized, log out
      if (error.message.includes('401') || error.message.includes('token')) {
        handleLogout();
      }
    }
  }, []);

  // Fetch users (admin only)
  const fetchUsers = useCallback(async () => {
    if (user?.role === 'admin') {
      try {
        const response = await usersAPI.getAll();
        setUsers(response.users || []);
      } catch (error) {
        console.error('Failed to fetch users:', error);
      }
    }
  }, [user]);

  // Fetch suppliers (for dropdown and management)
  const fetchSuppliers = useCallback(async () => {
    try {
      const response = await suppliersAPI.getAll();
      setSuppliers(response || []);
    } catch (error) {
      console.error('Failed to fetch suppliers:', error);
    }
  }, []);

  // Fetch plants (for dropdown and management)
  const fetchPlants = useCallback(async () => {
    try {
      const response = await plantsAPI.getAll();
      setPlants(response || []);
    } catch (error) {
      console.error('Failed to fetch plants:', error);
    }
  }, []);

  // Fetch plant budget targets
  const fetchPlantBudgets = useCallback(async () => {
    try {
      const rows = await plantBudgetsAPI.getAll();
      const budgets = {};
      (rows || []).forEach(row => {
        const yr = String(row.year);
        if (!budgets[yr]) budgets[yr] = {};
        if (!budgets[yr][row.plant_name]) budgets[yr][row.plant_name] = {};
        budgets[yr][row.plant_name][row.type] = row.values;
      });
      setPlantBudgets(budgets);
    } catch (error) {
      console.error('Failed to fetch plant budgets:', error);
    }
  }, []);

  // Fetch backup requests
  const fetchBackupRequests = useCallback(async () => {
    try {
      const response = await backupRequestsAPI.getAll();
      setBackupRequests(response.requests || []);
    } catch (error) {
      console.error('Failed to fetch backup requests:', error);
    }
  }, []);

  // Standalone SF records live in sample_followups — rows entered manually via the SF page's
  // "Add Record" button. Process-flow SF data lives on die_orders itself; both are merged below.
  const [sampleFollowupsStandalone, setSampleFollowupsStandalone] = useState([]);
  const fetchSampleFollowups = useCallback(async () => {
    try {
      const response = await sampleFollowupsAPI.getAll();
      setSampleFollowupsStandalone(response.sampleFollowups || []);
    } catch (error) {
      console.error('Failed to fetch sample followups:', error);
    }
  }, []);

  // Profile = everything before the first "-" in DIE NO (e.g. "14716-235" → "14716"). Derived only.
  const extractProfile = (dieNo) => {
    if (!dieNo) return '';
    const s = String(dieNo).trim();
    const idx = s.indexOf('-');
    return idx > 0 ? s.slice(0, idx) : s;
  };

  // SF rows come from two sources:
  //  - 'order': die_orders past the receiving stage (created by the normal process flow).
  //  - 'standalone': rows in the sample_followups table (entered manually via the SF page's Add Record).
  // The row's id is namespaced per source so edit/delete handlers can route correctly.
  const sampleFollowups = useMemo(() => {
    const fromOrders = (data || [])
      .filter(o => o['Die Received Date'] || o['Sample Status'] || o.STATUS === 'DIE RECEIVED')
      .map(o => ({
        id: `order-${o.id}`,
        _source: 'order',
        _order: o,
        die: o['DIE NO'] || '',
        profile: extractProfile(o['DIE NO']),
        press: o['Press'] || o['Plant'] || '',
        supplier: o['Supplier'] || '',
        customer: o['Customer Name'] || '',
        die_received_date: o['Die Received Date'] || '',
        ascona_reference: o['Ascona Reference'] || 'No',
        submission_date: o['Submission Date'] || '',
        sample_approval_date: o['Sample Approval Date'] || '',
        delay_days: 0,
        status: o['Sample Status'] || 'Pending',
        no_of_trial: o['No of Trial'] || 0,
        remark: o['Remark'] || '',
        corrector: o['Corrector'] || '',
      }));

    const fromStandalone = (sampleFollowupsStandalone || []).map(sf => ({
      id: `sf-${sf.id}`,
      _source: 'standalone',
      _raw: sf,
      die: sf.profile || '',
      profile: extractProfile(sf.profile),
      press: sf.press || '',
      supplier: sf.supplier || '',
      customer: sf.customer || '',
      die_received_date: sf.die_received_date || '',
      ascona_reference: sf.ascona_reference || 'No',
      submission_date: sf.submission_date || '',
      sample_approval_date: sf.sample_approval_date || '',
      delay_days: 0,
      status: sf.status || 'Pending',
      no_of_trial: sf.no_of_trial || 0,
      remark: sf.remark || '',
      corrector: sf.corrector || '',
    }));

    return [...fromOrders, ...fromStandalone];
  }, [data, sampleFollowupsStandalone]);

  // Fetch API keys (admin only)
  const fetchApiKeys = useCallback(async () => {
    if (user?.role === 'admin') {
      try {
        const response = await apiKeysAPI.getAll();
        setApiKeys(response.keys || []);
      } catch (error) {
        console.error('Failed to fetch API keys:', error);
      }
    }
  }, [user]);

  // Check auth on mount and fetch data
  useEffect(() => {
    if (isLoggedIn) {
      fetchOrders();
      fetchUsers();
      fetchSuppliers();
      fetchPlants();
      fetchBackupRequests();
      fetchSampleFollowups();
      fetchApiKeys();
      fetchPlantBudgets();

      // Check if password change is required (persisted in localStorage)
      const currentUser = getUser();
      if (currentUser?.passwordMustChange) {
        setForcePasswordChange(true);
        setShowPasswordChangeModal(true);
      }
    }
  }, [isLoggedIn, fetchOrders, fetchUsers, fetchSuppliers, fetchPlants, fetchBackupRequests, fetchSampleFollowups, fetchPlantBudgets]);

  // Login handler
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const response = await authAPI.login(loginForm.username, loginForm.password);
      setUser(response.user);
      setIsLoggedIn(true);
      setLoginForm({ username: '', password: '' });

      // Check if password change is required
      if (response.user?.passwordMustChange) {
        setForcePasswordChange(true);
        setShowPasswordChangeModal(true);
      }
    } catch (error) {
      setLoginError(error.message || 'Login failed');
    } finally {
      setLoginLoading(false);
    }
  };

  // Handle successful password change
  const handlePasswordChangeSuccess = () => {
    setShowPasswordChangeModal(false);
    setForcePasswordChange(false);
    // Refresh user data
    const updatedUser = getUser();
    if (updatedUser) {
      setUser(updatedUser);
    }
  };

  // Logout handler
  const handleLogout = () => {
    apiLogout();
    setIsLoggedIn(false);
    setUser(null);
    setData([]);
    setUsers([]);
  };

  // Add user handler (admin)
  const handleAddUser = async (e) => {
    e.preventDefault();
    try {
      await usersAPI.create(newUser.username, newUser.password, newUser.role, newUser.pageAccess);
      setNewUser({ username: '', password: '', role: 'user', pageAccess: null });
      setShowAddUser(false);
      fetchUsers();
    } catch (error) {
      alert(error.message);
    }
  };

  // Delete user handler (admin)
  const handleDeleteUser = async (id) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    try {
      await usersAPI.delete(id);
      fetchUsers();
    } catch (error) {
      alert(error.message);
    }
  };

  // Check if user has access to a page
  const hasPageAccess = useCallback((pageId) => {
    if (user?.role === 'admin') return true;
    if (!user?.pageAccess) return true; // null = all pages
    // Support granular flow page IDs directly
    if (user.pageAccess.includes(pageId)) return true;
    // Backward compat: old 'process-flow' permission grants all flow pages
    if (pageId.startsWith('flow-') && user.pageAccess.includes('process-flow')) return true;
    return false;
  }, [user]);

  // Redirect if user lands on a restricted tab
  useEffect(() => {
    if (!user || !isLoggedIn) return;
    if (hasPageAccess(activeTab)) return;
    // Find first accessible page from CONTROLLABLE_PAGES
    const firstAccessible = CONTROLLABLE_PAGES.map(p => p.id).find(p => hasPageAccess(p));
    if (firstAccessible) {
      setActiveTab(firstAccessible);
    }
  }, [activeTab, user, isLoggedIn, hasPageAccess]);

  // Sync budget edits when plant or year selection changes in Settings
  useEffect(() => {
    if (budgetActivePlant) {
      const existing = plantBudgets[budgetYear]?.[budgetActivePlant] || {};
      setBudgetEdits({
        backup: existing.backup ? [...existing.backup] : Array(12).fill(0),
        new: existing.new ? [...existing.new] : Array(12).fill(0),
      });
    }
  }, [budgetActivePlant, budgetYear, plantBudgets]);

  // Handle revision request for design/simulation
  const handleRevision = async ({ orderId, targetStatus, notes, pdfFile, revisionDate }) => {
    try {
      const order = data.find(o => o.id === orderId);
      if (!order) throw new Error('Order not found');

      const currentRevisionCount = order['Design Revision Count'] || 0;

      // Prepare updated order data
      const updatedOrder = {
        ...order,
        STATUS: targetStatus,
        'Design Revision Count': currentRevisionCount + 1,
        'Last Revision Date': revisionDate,
        'Revision Notes': notes
      };

      // Handle PDF upload if provided
      if (pdfFile) {
        // For now, store the PDF name - in production this would upload to storage
        updatedOrder['Revision PDF'] = pdfFile.name;
      }

      await ordersAPI.update(orderId, updatedOrder);
      setData(prev => prev.map(o => o.id === orderId ? updatedOrder : o));

      const targetLabel = targetStatus === 'AWAITING FOR DESIGN' ? 'Design' : 'Simulation';
      setToast({
        message: `Revision #${currentRevisionCount + 1} requested - sent back to ${targetLabel}`,
        type: 'warning'
      });
      setTimeout(() => setToast(null), 4000);
    } catch (error) {
      console.error('Revision error:', error);
      throw error;
    }
  };

  // Parse Die Size into Diameter and Thickness (format: "300X100" or "Dia 300X100" → { diameter: 300, thickness: 100 })
  const parseDieSize = (dieSize) => {
    if (!dieSize) return { diameter: null, thickness: null };
    // Strip "Dia " prefix if present (legacy format from older imports)
    const cleaned = String(dieSize).toUpperCase().replace(/^DIA\s+/i, '');
    const parts = cleaned.split('X');
    return {
      diameter: parts[0] ? parseInt(parts[0], 10) || null : null,
      thickness: parts[1] ? parseInt(parts[1], 10) || null : null
    };
  };

  // Handle die size changes with change log tracking
  const handleSizeChange = async (order, field, newValue) => {
    try {
      const oldValue = field === 'Diameter'
        ? parseDieSize(order['Die Size']).diameter
        : parseDieSize(order['Die Size']).thickness;

      if (oldValue === newValue) return; // No change

      const parsed = parseDieSize(order['Die Size']);
      const newDiameter = field === 'Diameter' ? newValue : parsed.diameter;
      const newThickness = field === 'Thickness' ? newValue : parsed.thickness;
      const newDieSize = `${newDiameter || ''}X${newThickness || ''}`;

      // Create change log entry
      const changeLogEntry = {
        date: new Date().toISOString().split('T')[0],
        field,
        oldValue,
        newValue,
        changedBy: user?.username || 'unknown',
        stage: order.STATUS
      };

      const existingLog = order['Change Log'] || [];
      const updatedOrder = {
        ...order,
        'Die Size': newDieSize,
        'Change Log': [...existingLog, changeLogEntry]
      };

      await ordersAPI.update(order.id, updatedOrder);
      setData(prev => prev.map(o => o.id === order.id ? updatedOrder : o));

      setToast({
        message: `${field} updated: ${oldValue || 'N/A'} → ${newValue}`,
        type: 'success'
      });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      console.error('Size change error:', error);
      setToast({ message: 'Failed to update: ' + error.message, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  };

  // Copy order details to clipboard in ERP format: Die Number, Dia DxT; CAV n; SF/PH
  const copyForERP = async (order) => {
    const parsed = parseDieSize(order['Die Size']);
    const diameter = parsed.diameter || '';
    const thickness = parsed.thickness || '';
    const cavities = order['Mandrels per Cavity'] || 1;
    // SF = Solid (T type), PH = Hollow (others)
    const dieType = order.TYPE === 'T' ? 'SF' : 'PH';

    // Format: 30533_201,Dia 355X200; CAV 1; PH
    const erpString = `${order['DIE NO']},Dia ${diameter}X${thickness}; CAV ${cavities}; ${dieType}`;

    try {
      await copyToClipboard(erpString);
      setToast({ message: `Copied: ${erpString}`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      console.error('Copy error:', error);
      setToast({ message: 'Failed to copy', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    }
  };

  // Handle PR Number update
  const handlePRNumberChange = async (order, prNumber) => {
    if (order['PR Number'] === prNumber) return; // No change

    try {
      const updatedOrder = { ...order, 'PR Number': prNumber };
      await ordersAPI.update(order.id, updatedOrder);
      setData(prev => prev.map(o => o.id === order.id ? updatedOrder : o));
      setToast({ message: `PR Number saved: ${prNumber}`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      console.error('PR Number update error:', error);
      setToast({ message: 'Failed to save PR Number', type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  };

  // Generic inline field save for flow tables (e.g., Order No, Supplier on Pending Ordering)
  const handleInlineFieldSave = async (order, field, value) => {
    if (order[field] === value) return;
    try {
      const updatedOrder = { ...order, [field]: value };
      await ordersAPI.update(order.id, updatedOrder);
      setData(prev => prev.map(o => o.id === order.id ? updatedOrder : o));
      setToast({ message: `${field} saved`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      console.error(`${field} update error:`, error);
      setToast({ message: `Failed to save ${field}`, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  };

  // Handle mandrels per cavity change - auto-calculates Total Mandrels
  const handleMandrelsChange = async (order, mandrelsPerCavity) => {
    const mpc = parseInt(mandrelsPerCavity, 10) || 0;
    const cavities = order._cavity || 1;
    const totalMandrels = mpc * cavities;
    if (order['Mandrels per Cavity'] === mpc && order['Total Mandrels'] === totalMandrels) return;
    try {
      const updatedOrder = { ...order, 'Mandrels per Cavity': mpc, 'Total Mandrels': totalMandrels };
      await ordersAPI.update(order.id, updatedOrder);
      setData(prev => prev.map(o => o.id === order.id ? updatedOrder : o));
      setToast({ message: `Mandrels updated: ${mpc}/cav, ${totalMandrels} total`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      console.error('Mandrels update error:', error);
      setToast({ message: 'Failed to save mandrels', type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  };

  const handleImport = useCallback(async (newData) => {
    try {
      // Save each imported record to the database
      for (const record of newData) {
        await ordersAPI.create(record);
      }
      // Refresh orders from database
      await fetchOrders();
      setCurrentPage(1);
      alert(`Successfully imported ${newData.length} orders to database`);
    } catch (error) {
      console.error('Import error:', error);
      alert('Failed to import some records: ' + error.message);
    }
  }, [fetchOrders]);
  const handleAddRecord = useCallback(async (newRecord) => {
    try {
      await ordersAPI.create(newRecord);
      fetchOrders();
    } catch (error) {
      alert(error.message);
      // Fallback to local add
      setData(prev => [newRecord, ...prev]);
    }
    setCurrentPage(1);
  }, [fetchOrders]);

  // Handle PI Import with support for updating existing orders
  const handlePIImport = useCallback(async (importData) => {
    try {
      let created = 0;
      let updated = 0;

      for (const record of importData) {
        // Remove the isExisting flag before sending to API
        const { isExisting, ...orderData } = record;
        if (isExisting && orderData.id) {
          // Update existing order
          await ordersAPI.update(orderData.id, orderData);
          updated++;
        } else {
          // Create new order
          await ordersAPI.create(orderData);
          created++;
        }
      }

      // Refresh orders from database
      await fetchOrders();
      setCurrentPage(1);

      // Show appropriate message
      const messages = [];
      if (created > 0) messages.push(`${created} new order(s) created`);
      if (updated > 0) messages.push(`${updated} order(s) updated`);
      const msg = `PI Import successful: ${messages.join(', ')}`;
      setToast({ message: msg, type: 'success' });
      setTimeout(() => setToast(null), 5000); // Auto-hide after 5 seconds
    } catch (error) {
      console.error('PI Import error:', error);
      setToast({ message: 'Failed to import: ' + error.message, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  }, [fetchOrders]);

  const filteredData = useMemo(() => {
    return data.filter(order => {
      const matchesSearch = !searchTerm || order['DIE NO']?.toLowerCase().includes(searchTerm.toLowerCase()) || order['Order No']?.toString().toLowerCase().includes(searchTerm.toLowerCase()) || order.Supplier?.toLowerCase().includes(searchTerm.toLowerCase());
      const statusMatch = filters.status === 'all' ||
        (filters.status === 'active' ? !['DONE', 'CANCELLED'].includes(order.STATUS) : order.STATUS === filters.status);
      return matchesSearch && (filters.plant === 'all' || order.Plant === filters.plant) && statusMatch && (filters.supplier === 'all' || order.Supplier === filters.supplier) && (filters.type === 'all' || order.TYPE === filters.type) && (filters.month === 'all' || order.month === filters.month);
    }).sort((a, b) => {
      const aVal = a[sortConfig.key] || '', bVal = b[sortConfig.key] || '';
      return (aVal > bVal ? 1 : -1) * (sortConfig.direction === 'asc' ? 1 : -1);
    });
  }, [data, searchTerm, filters, sortConfig]);

  const paginatedData = useMemo(() => filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage), [filteredData, currentPage]);
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);

  const allChangeLogs = useMemo(() => {
    const logs = [];
    data.forEach(order => {
      (order['Change Log'] || []).forEach(entry => {
        logs.push({ ...entry, dieNo: order['DIE NO'], orderNo: order['Order No'] });
      });
    });
    return logs.sort((a, b) => {
      const da = `${a.date || ''} ${a.time || '00:00:00'}`;
      const db = `${b.date || ''} ${b.time || '00:00:00'}`;
      return db.localeCompare(da);
    });
  }, [data]);

  const stats = useMemo(() => {
    const total = data.length, completed = data.filter(o => o.STATUS === 'DONE').length;
    const pending = data.filter(o => !['DONE', 'CANCELLED'].includes(o.STATUS)).length;
    const cancelled = data.filter(o => o.STATUS === 'CANCELLED').length;
    const delayedOrders = data.filter(o => o.Delay > 0);
    const avgDelay = delayedOrders.length > 0 ? (delayedOrders.reduce((sum, o) => sum + (o.Delay || 0), 0) / delayedOrders.length).toFixed(1) : '0';
    return { total, completed, pending, cancelled, avgDelay };
  }, [data]);

  const statusChartData = useMemo(() => {
    const counts = {};
    data.forEach(o => { if (o.STATUS) counts[o.STATUS] = (counts[o.STATUS] || 0) + 1; });
    return Object.entries(counts)
      .filter(([name]) => name && (showCompletedInChart || name !== 'DONE') && (showCancelledInChart || name !== 'CANCELLED'))
      .map(([name, value]) => ({ name: STATUS_CONFIG[name]?.label || name, value, color: STATUS_CONFIG[name]?.color || '#6B7280' }));
  }, [data, showCompletedInChart, showCancelledInChart]);

  const availableYears = useMemo(() => {
    const years = new Set();
    data.forEach(o => {
      const d = o['Die Requested Date'];
      if (d) years.add(d.split('-')[0]);
    });
    return [...years].sort().reverse();
  }, [data]);

  const monthlyTrendData = useMemo(() => {
    const plants = [...new Set(data.map(o => o.Plant))].filter(Boolean).sort();
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(month => {
      const monthOrders = data.filter(o => {
        if (o.month !== month) return false;
        if (trendYear !== 'all') {
          const d = o['Die Requested Date'];
          if (!d || d.split('-')[0] !== trendYear) return false;
        }
        return true;
      });
      const entry = { month, new_ghost: 0, backup_ghost: 0 };
      let newTotal = 0, backupTotal = 0;
      plants.forEach(plant => {
        const newCount = monthOrders.filter(o => o.TYPE === 'N' && o.Plant === plant).length;
        const backupCount = monthOrders.filter(o => o.TYPE === 'B' && o.Plant === plant).length;
        entry[`new_${plant}`] = newCount;
        entry[`backup_${plant}`] = backupCount;
        newTotal += newCount;
        backupTotal += backupCount;
      });
      entry.new_total = newTotal;
      entry.backup_total = backupTotal;
      return entry;
    });
  }, [data, trendYear]);

  const trendPlants = useMemo(() => [...new Set(data.map(o => o.Plant))].filter(Boolean).sort(), [data]);

  const monthlyTrendDataByPlant = useMemo(() => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const plants = [...new Set(data.map(o => o.Plant))].filter(Boolean).sort();
    const yearBudgets = trendYear !== 'all' ? (plantBudgets[trendYear] || {}) : {};
    const result = {};
    plants.forEach(plant => {
      const budget = yearBudgets[plant];
      result[plant] = months.map((month, mi) => {
        const monthOrders = data.filter(o => {
          if (o.month !== month || o.Plant !== plant) return false;
          if (trendYear !== 'all') {
            const d = o['Die Requested Date'];
            if (!d || d.split('-')[0] !== trendYear) return false;
          }
          return true;
        });
        const entry = {
          month,
          backup: monthOrders.filter(o => o.TYPE === 'B').length,
          new: monthOrders.filter(o => o.TYPE === 'N').length,
        };
        if (budget) {
          entry.backup_target = budget.backup[mi];
          entry.new_target = budget.new[mi];
        }
        return entry;
      });
    });
    return result;
  }, [data, trendYear, plantBudgets]);

  // Filtered data for analytics
  const analyticsData = useMemo(() => {
    const quarterMonths = {
      'Q1': ['Jan', 'Feb', 'Mar'],
      'Q2': ['Apr', 'May', 'Jun'],
      'Q3': ['Jul', 'Aug', 'Sep'],
      'Q4': ['Oct', 'Nov', 'Dec']
    };

    return data.filter(o => {
      if (analyticsFilter.period !== 'all' && o.month !== analyticsFilter.period) return false;
      if (analyticsFilter.quarter !== 'all' && !quarterMonths[analyticsFilter.quarter]?.includes(o.month)) return false;
      return true;
    });
  }, [data, analyticsFilter]);

  const supplierData = useMemo(() => {
    const counts = {};
    analyticsData.forEach(o => { if (o.Supplier) counts[o.Supplier] = (counts[o.Supplier] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [analyticsData]);

  const typeData = useMemo(() => {
    const labels = { 'N': 'New', 'B': 'Backup', 'T': 'Tooling', 'C': 'Canceled', 'H': 'Hold' };
    const counts = {};
    analyticsData.forEach(o => { counts[labels[o.TYPE] || o.TYPE] = (counts[labels[o.TYPE] || o.TYPE] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [analyticsData]);

  const uniquePlants = [...new Set(data.map(o => o.Plant))].filter(Boolean).sort();
  const uniqueStatuses = [...new Set(data.map(o => o.STATUS))].filter(Boolean);
  const uniqueSuppliers = [...new Set(data.map(o => o.Supplier))].filter(Boolean).sort();
  const uniqueTypes = [...new Set(data.map(o => o.TYPE))].filter(Boolean).sort();
  const uniqueMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Map die_no → die_received_date from sample followups (for lead time columns)
  const dieReceivedDateMap = useMemo(() => {
    const map = {};
    sampleFollowups.forEach(sf => {
      if (sf.profile && sf.die_received_date) map[sf.profile.trim()] = sf.die_received_date;
    });
    return map;
  }, [sampleFollowups]);

  const calcLeadDays = (startDate, endDate) => {
    if (!startDate || !endDate) return null;
    const start = new Date(startDate), end = new Date(endDate);
    if (isNaN(start) || isNaN(end)) return null;
    const days = Math.round((end - start) / (1000 * 60 * 60 * 24));
    return days >= 0 ? days : null;
  };

  // Date when the order entered its current stage (used to compute delay days)
  const getStageEntryDate = (order) => {
    switch (order.STATUS) {
      case 'PENDING FOR ORDERING': return order['Die Requested Date'] || order.created_at;
      case 'AWAITING FOR DESIGN': return order['Ordered date'];
      case 'UNDER SIMULATION': return order['Design Received Date'];
      case 'PENDING FOR DESIGN APPROVAL':
        return order.simulationEnabled ? order['3D Model Received Date'] : order['Design Received Date'];
      case 'PENDING FOR PR': return order['Design Approved Date'];
      case 'PENDING FOR ORACLE ENTRY': return order['PR Entry'];
      case 'PENDING FOR DESIGN TO EMS': return order['Oracle Entry'];
      case 'DONE': return order['Design to EMS Date'];
      default: return null;
    }
  };

  const daysInStage = (order) => {
    const entry = getStageEntryDate(order);
    if (!entry) return null;
    const iso = typeof entry === 'string' && /\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}/.test(entry)
      ? parseDateDMY(entry)
      : entry;
    const start = new Date(iso);
    if (isNaN(start)) return null;
    const today = new Date();
    const days = Math.floor((today.setHours(0,0,0,0) - start.setHours(0,0,0,0)) / (1000 * 60 * 60 * 24));
    return days >= 0 ? days : null;
  };

  const DaysBadge = ({ order }) => {
    const days = daysInStage(order);
    if (days === null) return <span style={{ color: '#64748B' }}>—</span>;
    const red = days > 1;
    return (
      <span style={{ fontFamily: 'monospace', fontWeight: 700, padding: '3px 8px', borderRadius: '6px', fontSize: '0.75rem', background: red ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)', color: red ? '#EF4444' : '#10B981' }}>
        {days}d
      </span>
    );
  };

  const handleSort = (key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));

  const exportData = () => {
    const exportRows = data.map(order => {
      const receivedDate = dieReceivedDateMap[order['DIE NO']?.trim()];
      const deliveryDays = calcLeadDays(order['Ordered date'], receivedDate);
      const mfgDays = calcLeadDays(order['Design Approved Date'], receivedDate);
      return {
        ...order,
        'Delivery Lead Time (days)': deliveryDays !== null ? deliveryDays : '',
        'Manufacturing Lead Time (days)': mfgDays !== null ? mfgDays : '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Die Orders');
    XLSX.writeFile(wb, 'die_orders_export.xlsx');
  };

  // Theme colors - Shadcn Zinc Aesthetic
  const theme = isDarkMode ? {
    bg: '#09090b',
    text: '#fafafa',
    textMuted: '#a1a1aa',
    textDim: '#71717a',
    cardBg: '#09090b',
    cardBorder: '#27272a',
    inputBg: '#09090b',
    headerBg: '#09090b', 
    navBg: 'transparent',
    tableBg: 'transparent',
    tooltipBg: '#27272a',
    sidebarBg: '#09090b',
    primary: '#fafafa',
    primaryText: '#18181b',
    primaryLight: '#27272a',
    accent: '#fafafa'
  } : {
    bg: '#ffffff',
    text: '#09090b',
    textMuted: '#71717a',
    textDim: '#a1a1aa',
    cardBg: '#ffffff',
    cardBorder: '#e4e4e7',
    inputBg: '#ffffff',
    headerBg: '#ffffff',
    navBg: 'transparent',
    tableBg: 'transparent',
    tooltipBg: '#09090b',
    sidebarBg: '#ffffff',
    primary: '#18181b',
    primaryText: '#fafafa',
    primaryLight: '#f4f4f5',
    accent: '#18181b'
  };

  // Inline styles - Strict Shadcn UI
  const styles = {
    appLayout: { display: 'flex', minHeight: '100vh', background: theme.bg, transition: 'background 0.15s ease' },
    sidebar: { width: '260px', background: theme.sidebarBg, borderRight: `1px solid ${theme.cardBorder}`, padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', position: 'fixed', height: '100vh', zIndex: 100, transition: 'background 0.15s ease' },
    sidebarNav: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '1.5rem' },
    sidebarNavItem: (active) => ({ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '8px', fontWeight: 500, fontSize: '0.875rem', color: active ? theme.text : theme.textMuted, background: active ? theme.primaryLight : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'all 0.15s' }),
    mainContent: {
      flex: 1,
      marginLeft: sidebarCollapsed ? '64px' : '260px',
      background: theme.bg,
      minHeight: '100vh',
      transition: 'margin-left 0.2s ease, background 0.15s ease'
    },
    topBar: { background: theme.headerBg, borderBottom: `1px solid ${theme.cardBorder}`, padding: '1rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50, transition: 'background 0.15s ease' },
    
    app: { minHeight: '100vh', background: theme.bg, fontFamily: "'Inter', sans-serif", color: theme.text },
    header: { background: theme.headerBg, borderBottom: `1px solid ${theme.cardBorder}`, position: 'sticky', top: 0, zIndex: 100, transition: 'background 0.15s ease' },
    headerContent: { maxWidth: '1800px', margin: '0 auto', padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'nowrap' },
    logoSection: { display: 'flex', alignItems: 'center', gap: '12px' },
    logoIcon: { width: '40px', height: '40px', background: theme.primary, color: theme.primaryText, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    navTabs: { display: 'flex', gap: '4px', background: theme.navBg, padding: '4px', borderRadius: '8px' },
    navTab: (active) => ({ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '8px', fontWeight: 500, fontSize: '0.875rem', color: active ? theme.text : theme.textMuted, background: active ? theme.primaryLight : 'transparent', border: 'none', cursor: 'pointer', transition: 'all 0.15s' }),
    actionBtn: (primary) => ({ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderRadius: '8px', fontWeight: 500, fontSize: '0.875rem', border: primary ? 'none' : `1px solid ${theme.cardBorder}`, cursor: 'pointer', background: primary ? theme.primary : theme.cardBg, color: primary ? theme.primaryText : theme.text, transition: 'all 0.15s ease', boxShadow: primary ? '0 1px 2px rgba(0,0,0,0.05)' : '0 1px 2px rgba(0,0,0,0.02)' }),
    main: { maxWidth: '100%', margin: '0 auto', padding: '2rem 1.5rem' },
    kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '2.5rem' },
    kpiCard: { background: theme.cardBg, borderRadius: '8px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}`, boxShadow: '0 1px 2px rgba(0,0,0,0.02)' },
    chartsGrid: { display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '2.5rem' },
    chartCard: { background: theme.cardBg, borderRadius: '8px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}`, boxShadow: '0 1px 2px rgba(0,0,0,0.02)' },
    filterBar: { background: theme.cardBg, borderRadius: '8px', padding: '1.25rem', border: `1px solid ${theme.cardBorder}`, marginBottom: '1.5rem', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' },
    filterRow: { display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' },
    searchBox: { flex: 1, minWidth: '250px', position: 'relative' },
    searchInput: { width: '100%', padding: '10px 16px 10px 40px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem', transition: 'all 0.15s', outline: 'none' },
    filterSelect: { padding: '10px 16px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem', cursor: 'pointer', minWidth: '130px', transition: 'all 0.15s', outline: 'none' },
    tableContainer: { background: theme.cardBg, borderRadius: '8px', border: `1px solid ${theme.cardBorder}`, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' },
    table: { width: '100%', borderCollapse: 'collapse' },
    th: { padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 500, color: theme.textMuted, background: theme.tableBg, cursor: 'pointer', borderBottom: `1px solid ${theme.cardBorder}` },
    td: { padding: '1rem', borderBottom: `1px solid ${theme.cardBorder}`, fontSize: '0.875rem', color: theme.text },
    pipelineSection: { background: theme.cardBg, borderRadius: '8px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}`, boxShadow: '0 1px 2px rgba(0,0,0,0.02)' },
    pipelineColumns: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' },
    pipelineColumn: (color) => ({ borderRadius: '8px', padding: '1rem', background: isDarkMode ? `${color}10` : `${color}1A`, border: `1px solid ${color}33` }), 
    pipelineItem: { background: theme.cardBg, borderRadius: '6px', padding: '12px', marginBottom: '8px', cursor: 'pointer', border: `1px solid ${theme.cardBorder}`, boxShadow: '0 1px 2px rgba(0,0,0,0.03)', width: 'calc(100% - 2px)', overflow: 'hidden', transition: 'all 0.15s ease' },
  };

  // Login Screen
  if (!isLoggedIn) {
    return (
      <div style={{
        ...styles.app,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundImage: 'url(/login-bg.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        position: 'relative'
      }}>
        {/* Dark overlay for better readability */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(2px)'
        }} />
        <div style={{ background: '#1E293B', borderRadius: '20px', padding: '2.5rem', width: '100%', maxWidth: '400px', border: '1px solid #334155', position: 'relative', zIndex: 1 }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div style={{ width: '64px', height: '64px', background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
              <Factory size={32} color="white" />
            </div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, background: 'linear-gradient(135deg, #60A5FA, #A78BFA)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Die Ordering System</h1>
            <p style={{ fontSize: '0.875rem', color: '#64748B', marginTop: '0.5rem' }}>Sign in to continue</p>
          </div>
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', color: '#94A3B8', marginBottom: '0.5rem' }}>Username</label>
              <input type="text" value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} style={{ width: '100%', padding: '12px 16px', background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', color: '#F1F5F9', fontSize: '0.875rem' }} placeholder="Enter username" required />
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', color: '#94A3B8', marginBottom: '0.5rem' }}>Password</label>
              <input type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} style={{ width: '100%', padding: '12px 16px', background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', color: '#F1F5F9', fontSize: '0.875rem' }} placeholder="Enter password" required />
            </div>
            {loginError && <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(244,63,94,0.1)', color: '#F43F5E', padding: '0.75rem 1rem', borderRadius: '10px', marginBottom: '1rem', fontSize: '0.875rem' }}><AlertTriangle size={16} />{loginError}</div>}
            <button type="submit" disabled={loginLoading} style={{ width: '100%', padding: '12px', background: loginLoading ? '#475569' : 'linear-gradient(135deg, #3B82F6, #8B5CF6)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, fontSize: '0.875rem', cursor: loginLoading ? 'not-allowed' : 'pointer' }}>{loginLoading ? 'Signing in...' : 'Sign In'}</button>
          </form>
        </div>
      </div>
    );
  }

  // Notification Logic (Extracted)
  const notificationDropdown = (() => {
    const now = new Date();
    // Design overdue > 48 hours
    const designOverdueOrders = data.filter(o => {
      if (o.STATUS !== 'AWAITING FOR DESIGN') return false;
      const requestedDate = new Date(o['Die Requested Date']);
      if (isNaN(requestedDate)) return false;
      const hoursDiff = (now - requestedDate) / (1000 * 60 * 60);
      return hoursDiff > 48;
    });

    // Pending ordering > 24 hours
    const pendingOrderingOrders = data.filter(o => {
      if (o.STATUS !== 'PENDING FOR ORDERING') return false;
      const oracleDate = new Date(o['Oracle Entry']);
      if (isNaN(oracleDate)) return false;
      const hoursDiff = (now - oracleDate) / (1000 * 60 * 60);
      return hoursDiff > 24;
    });

    const totalNotifications = designOverdueOrders.length + pendingOrderingOrders.length;

    // Group design overdue by supplier
    const designSupplierGroups = {};
    designOverdueOrders.forEach(o => {
      if (!designSupplierGroups[o.Supplier]) designSupplierGroups[o.Supplier] = [];
      designSupplierGroups[o.Supplier].push(o);
    });

    // Group pending ordering by plant
    const orderingPlantGroups = {};
    pendingOrderingOrders.forEach(o => {
      if (!orderingPlantGroups[o.Plant]) orderingPlantGroups[o.Plant] = [];
      orderingPlantGroups[o.Plant].push(o);
    });

    const generateDesignEmail = (supplier, orders) => {
      const dieList = orders.map(o => `  - ${o['DIE NO']} | Order No: ${o['Order No']} (Requested: ${o['Die Requested Date']}, Plant: ${o.Plant})`).join('\n');
      return `Subject: URGENT: Design Pending for ${orders.length} Die Order(s) - ${supplier}\n\nDear ${supplier} Team,\n\nThis is a reminder that the following die order(s) have been awaiting design for more than 48 hours:\n\n${dieList}\n\nPlease provide the design drawings at the earliest to avoid further delays in production.\n\nBest regards,\nDie Ordering Team`;
    };

    const generateOrderingEmail = (plant, orders) => {
      const dieList = orders.map(o => `  - ${o['DIE NO']} | Requested: ${o['Die Requested Date']} | Supplier: ${o.Supplier}`).join('\n');
      return `Subject: URGENT: ${orders.length} Die Order(s) Pending Ordering - ${plant}\n\nDear Purchase Team,\n\nThe following die order(s) for ${plant} have been pending ordering for more than 24 hours:\n\n${dieList}\n\nPlease process these orders at the earliest to avoid production delays.\n\nBest regards,\nDie Ordering Team`;
    };

    const copyEmail = (type, key, orders) => {
      const emailText = type === 'design' ? generateDesignEmail(key, orders) : generateOrderingEmail(key, orders);
      copyToClipboard(emailText);
      setToast({ message: 'Email copied to clipboard!', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    };

    const sendEmailDirect = (type, key, orders) => {
      const dieList = orders.map(o => `  - ${o['DIE NO']} | Order No: ${o['Order No']} (${o.Plant})`).join('\n');
      let subject, body;
      if (type === 'design') {
        subject = `URGENT: Design Pending for ${orders.length} Die Order(s) - ${key}`;
        body = `Dear ${key} Team,\n\nThis is a reminder that the following die order(s) have been awaiting design for more than 48 hours:\n\n${dieList}\n\nPlease provide the design drawings at the earliest to avoid further delays in production.\n\nBest regards,\nDie Ordering Team`;
      } else {
        subject = `URGENT: ${orders.length} Die Order(s) Pending Ordering - ${key}`;
        body = `Dear Purchase Team,\n\nThe following die order(s) for ${key} have been pending ordering for more than 24 hours:\n\n${dieList}\n\nPlease process these orders at the earliest to avoid production delays.\n\nBest regards,\nDie Ordering Team`;
      }
      setShowEmailCompose({ to: '', subject, body, importance: 'high' });
    };

    return (
      <div style={{
        position: 'absolute', top: '100%', right: 0, marginTop: '8px',
        background: theme.cardBg, border: `1px solid ${theme.border}`,
        borderRadius: '16px', padding: '0', width: '380px',
        boxShadow: '0 10px 50px rgba(0,0,0,0.4)', zIndex: 1000,
        maxHeight: '550px', overflow: 'hidden'
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: `1px solid ${theme.border}`
        }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: theme.text }}>Notifications</h3>
          {totalNotifications > 0 && (
            <span style={{ background: '#EF4444', color: 'white', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>
              {totalNotifications} pending
            </span>
          )}
        </div>
        <div style={{ maxHeight: '480px', overflowY: 'auto', padding: '8px' }}>
          {totalNotifications === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: theme.textDim }}>
              <Bell size={32} style={{ opacity: 0.3, marginBottom: '12px' }} />
              <p style={{ margin: 0, fontSize: '0.9rem' }}>No pending notifications</p>
            </div>
          ) : (
            <>
              {/* Design Overdue Section */}
              {designOverdueOrders.length > 0 && (
                <>
                  <div style={{
                    background: 'rgba(239,68,68,0.1)', borderRadius: '12px',
                    padding: '12px 16px', margin: '8px', marginBottom: '8px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                      <AlertTriangle size={16} color="#EF4444" />
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#EF4444' }}>
                        Design Overdue ({'>'}48 hrs) - {designOverdueOrders.length}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.7rem', color: theme.textDim, margin: 0 }}>Click to copy email for supplier</p>
                  </div>
                  {Object.entries(designSupplierGroups).map(([supplier, orders]) => (
                    <div key={`design-${supplier}`} style={{ margin: '4px 8px' }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '10px 16px', borderRadius: '10px',
                        background: 'transparent'
                      }}>
                        <div style={{
                          width: '36px', height: '36px', borderRadius: '50%',
                          background: 'linear-gradient(135deg, #EF4444, #F59E0B)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.75rem', fontWeight: 700, color: 'white'
                        }}>{supplier.substring(0, 2)}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: theme.text }}>{supplier}</div>
                          <div style={{ fontSize: '0.7rem', color: theme.textDim }}>{orders.length} order(s) pending design</div>
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button onClick={(e) => { e.stopPropagation(); sendEmailDirect('design', supplier, orders); }} style={{ padding: '4px 10px', borderRadius: '6px', border: 'none', background: 'rgba(59,130,246,0.2)', color: '#3B82F6', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600 }} title="Send via email">✉ Send</button>
                          <button onClick={(e) => { e.stopPropagation(); copyEmail('design', supplier, orders); }} style={{ padding: '4px 10px', borderRadius: '6px', border: `1px solid ${theme.cardBorder}`, background: 'transparent', color: theme.textDim, cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600 }} title="Copy to clipboard">📋 Copy</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* Pending Ordering Section */}
              {pendingOrderingOrders.length > 0 && (
                <>
                  <div style={{
                    background: 'rgba(139,92,246,0.1)', borderRadius: '12px',
                    padding: '12px 16px', margin: '8px', marginTop: designOverdueOrders.length > 0 ? '16px' : '8px', marginBottom: '8px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                      <Clock size={16} color="#8B5CF6" />
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#8B5CF6' }}>
                        Pending Ordering ({'>'}24 hrs) - {pendingOrderingOrders.length}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.7rem', color: theme.textDim, margin: 0 }}>Click to copy email for Purchase Team</p>
                  </div>
                  {Object.entries(orderingPlantGroups).map(([plant, orders]) => (
                    <div key={`ordering-${plant}`} style={{ margin: '4px 8px' }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '10px 16px', borderRadius: '10px',
                        background: 'transparent'
                      }}>
                        <div style={{
                          width: '36px', height: '36px', borderRadius: '50%',
                          background: 'linear-gradient(135deg, #8B5CF6, #3B82F6)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.75rem', fontWeight: 700, color: 'white'
                        }}>{plant.substring(0, 2)}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: theme.text }}>{plant}</div>
                          <div style={{ fontSize: '0.7rem', color: theme.textDim }}>{orders.length} order(s) pending ordering</div>
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button onClick={(e) => { e.stopPropagation(); sendEmailDirect('ordering', plant, orders); }} style={{ padding: '4px 10px', borderRadius: '6px', border: 'none', background: 'rgba(59,130,246,0.2)', color: '#3B82F6', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600 }} title="Send via email">✉ Send</button>
                          <button onClick={(e) => { e.stopPropagation(); copyEmail('ordering', plant, orders); }} style={{ padding: '4px 10px', borderRadius: '6px', border: `1px solid ${theme.cardBorder}`, background: 'transparent', color: theme.textDim, cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600 }} title="Copy to clipboard">📋 Copy</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    );
  })();

  return (
    <div style={styles.appLayout}>
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        user={user}
        theme={theme}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />

      <div style={styles.mainContent}>
        <TopBar
          user={user}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          theme={theme}
          isDarkMode={isDarkMode}
          setIsDarkMode={setIsDarkMode}
          setShowPDFImportModal={setShowPDFImportModal}
          setShowPIImportModal={setShowPIImportModal}
          setShowImportModal={setShowImportModal}
          exportData={exportData}
          data={data}
          showNotifications={showNotifications}
          setShowNotifications={setShowNotifications}
          notificationDropdown={notificationDropdown}
          onLogout={handleLogout}
          onChangePassword={() => setShowPasswordChangeModal(true)}
        />

        <main style={styles.main}>


          {activeTab === 'dashboard' && hasPageAccess('dashboard') && (
            <>
              <div style={styles.kpiGrid}>
                {[
                  { title: 'Total Orders', value: stats.total, color: '#3B82F6', icon: Package, sub: 'Year to date', filter: 'all' },
                  { title: 'In Manufacturing', value: stats.completed, color: '#10B981', icon: CheckCircle, sub: `${stats.total > 0 ? ((stats.completed / stats.total) * 100).toFixed(0) : 0}% rate`, filter: 'DONE' },
                  { title: 'In Progress', value: stats.pending, color: '#F59E0B', icon: Clock, sub: 'Active orders', filter: 'active' },
                  { title: 'Cancelled', value: stats.cancelled, color: '#EF4444', icon: XCircle, sub: `${stats.total > 0 ? ((stats.cancelled / stats.total) * 100).toFixed(1) : 0}%`, filter: 'CANCELLED' },
                  { title: 'Avg Delay', value: `${stats.avgDelay}d`, color: '#8B5CF6', icon: AlertTriangle, sub: 'Design approval' },
                ].map((kpi, index) => {
                  // Fallback drill-down flow page when user lacks Orders access
                  const flowFallback = { 'DONE': 'flow-completed' }[kpi.filter];
                  const canUseOrders = !!kpi.filter && hasPageAccess('orders');
                  const canUseFlow = !canUseOrders && flowFallback && hasPageAccess(flowFallback);
                  const clickable = canUseOrders || canUseFlow;
                  return (
                  <div
                    key={kpi.title}
                    style={{
                      ...styles.kpiCard,
                      cursor: clickable ? 'pointer' : 'default',
                      transition: 'transform 0.2s, box-shadow 0.2s'
                    }}
                    onClick={() => {
                      if (canUseOrders) {
                        setFilters(prev => ({ ...prev, status: kpi.filter }));
                        setActiveTab('orders');
                      } else if (canUseFlow) {
                        setActiveTab(flowFallback);
                      }
                    }}
                    onMouseEnter={(e) => {
                      if (clickable) {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.3)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (clickable) {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = styles.kpiCard.boxShadow;
                      }
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div>
                        <p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: '#64748B' }}>{kpi.title}</p>
                        <h3 style={{ fontSize: '2rem', fontWeight: 700, color: kpi.color, marginTop: '8px', fontFamily: 'monospace' }}>{kpi.value}</h3>
                        <p style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '4px' }}>{kpi.sub}</p>
                      </div>
                      <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: `${kpi.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><kpi.icon size={24} color={kpi.color} /></div>
                    </div>
                  </div>
                  );
                })}
              </div>
              <div style={styles.chartsGrid}>
                {/* Monthly Orders Trend — full width, top row */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Shared header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text, margin: 0 }}>Monthly Orders Trend</h3>
                    <select value={trendYear} onChange={(e) => setTrendYear(e.target.value)} style={{ padding: '6px 12px', borderRadius: '8px', border: `1px solid ${theme.cardBorder}`, background: theme.inputBg, color: theme.text, fontSize: '0.8rem', cursor: 'pointer', outline: 'none' }}>
                      <option value="all">All Years</option>
                      {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                  {/* One card per plant, side by side */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
                    {trendPlants.map((plant) => {
                      const plantData = monthlyTrendDataByPlant[plant] || [];
                      const hasBudget = trendYear !== 'all' && !!(plantBudgets[trendYear]?.[plant]);
                      const allValues = plantData.flatMap(d => {
                        const vals = [d.new || 0, d.backup || 0];
                        if (hasBudget) { vals.push(d.backup_target || 0, d.new_target || 0); }
                        return vals;
                      });
                      const yMax = Math.max(...allValues, 0) + 15;
                      return (
                        <div key={plant} style={styles.chartCard}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: theme.text }}>{plant}</span>
                            {hasBudget && (
                              <span style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.68rem', color: '#94A3B8' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                  <svg width="18" height="4" viewBox="0 0 18 4"><line x1="0" y1="2" x2="18" y2="2" stroke="#EF4444" strokeWidth="2" strokeDasharray="4 2"/></svg>
                                  Backup Target
                                </span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                  <svg width="18" height="4" viewBox="0 0 18 4"><line x1="0" y1="2" x2="18" y2="2" stroke="#22C55E" strokeWidth="2" strokeDasharray="4 2"/></svg>
                                  New Target
                                </span>
                              </span>
                            )}
                          </div>
                          <ResponsiveContainer width="100%" height={220}>
                            <ComposedChart data={plantData} barCategoryGap="10%" barGap={2} margin={{ top: 16, right: 10, left: 0, bottom: 0 }}>
                              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11 }} />
                              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11 }} domain={[0, yMax]} />
                              <Tooltip
                                contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', padding: '10px 14px' }}
                                itemStyle={{ color: '#FFFFFF', fontWeight: 500 }}
                                labelStyle={{ color: '#94A3B8', marginBottom: '4px' }}
                                formatter={(value, name) => (value === 0 || value == null ? null : [value, name])}
                              />
                              <Bar dataKey="new" name="New Dies" fill="#3B82F6" radius={[4, 4, 0, 0]}>
                                <LabelList dataKey="new" position="top" fill="#94A3B8" fontSize={10} fontWeight={700} formatter={(v) => v > 0 ? v : ''} />
                              </Bar>
                              <Bar dataKey="backup" name="Backup Dies" fill="#F59E0B" radius={[4, 4, 0, 0]}>
                                <LabelList dataKey="backup" position="top" fill="#94A3B8" fontSize={10} fontWeight={700} formatter={(v) => v > 0 ? v : ''} />
                              </Bar>
                              {hasBudget && <Line dataKey="backup_target" name="Backup Target" type="monotone" stroke="#EF4444" strokeWidth={2} dot={false} strokeDasharray="5 3" />}
                              {hasBudget && <Line dataKey="new_target" name="New Target" type="monotone" stroke="#22C55E" strokeWidth={2} dot={false} strokeDasharray="5 3" />}
                            </ComposedChart>
                          </ResponsiveContainer>
                          <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', marginTop: '6px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.75rem', color: '#94A3B8' }}>
                              <span style={{ width: 10, height: 10, borderRadius: '2px', background: '#3B82F6', display: 'inline-block' }} /> New Dies
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.75rem', color: '#94A3B8' }}>
                              <span style={{ width: 10, height: 10, borderRadius: '2px', background: '#F59E0B', display: 'inline-block' }} /> Backup Dies
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* Status Distribution + Backup Request Status — second row, side-by-side */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.25rem' }}>
                <div style={styles.chartCard}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text }}>Status Distribution</h3>
                  </div>
                  <div style={{ overflowX: 'auto', maxHeight: '320px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                          <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase' }}>Status</th>
                          <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase' }}>Count</th>
                          <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase' }}>%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const statusCounts = {};
                          data.forEach(o => { if (o.STATUS) statusCounts[o.STATUS] = (statusCounts[o.STATUS] || 0) + 1; });
                          const total = data.length;
                          const statusColors = {
                            'DONE': '#10B981', 'DIE RECEIVED': '#0891B2', 'CANCELLED': '#6B7280', 'AWAITING DESIGN': '#EF4444',
                            'DESIGN APPROVAL': '#F59E0B', 'PENDING ORDER': '#8B5CF6', 'ORACLE ENTRY': '#3B82F6',
                            'ON HOLD': '#64748B', 'DESIGN TO EMS': '#14B8A6', 'SIMULATION': '#EC4899'
                          };
                          const statusLabels = {
                            'DONE': 'In Manufacturing',
                            'DIE RECEIVED': 'Sample Followup',
                          };
                          return Object.entries(statusCounts)
                            .sort((a, b) => b[1] - a[1])
                            .map(([status, count]) => (
                              <tr key={status} style={{ borderBottom: `1px solid ${theme.border}` }}>
                                <td style={{ padding: '10px 12px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: statusColors[status] || '#94A3B8' }} />
                                    <span style={{ fontSize: '0.85rem', color: theme.text, fontWeight: 500 }}>{statusLabels[status] || status}</span>
                                  </div>
                                </td>
                                <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '0.9rem', fontWeight: 600, color: theme.text }}>{count}</td>
                                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                  <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: `${statusColors[status] || '#94A3B8'}20`, color: statusColors[status] || '#94A3B8' }}>
                                    {total > 0 ? ((count / total) * 100).toFixed(1) : 0}%
                                  </span>
                                </td>
                              </tr>
                            ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
                {/* Backup Request Status — status × plant matrix */}
                <div style={styles.chartCard}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text }}>Backup Request Status</h3>
                  </div>
                  <div style={{ overflowX: 'auto', maxHeight: '320px', overflowY: 'auto' }}>
                    {(() => {
                      const statuses = Object.keys(BACKUP_REQUEST_STATUS_CONFIG);
                      const plantSet = new Set();
                      (backupRequests || []).forEach(r => { if (r['Plant']) plantSet.add(r['Plant']); });
                      const plantList = Array.from(plantSet).sort();
                      const matrix = {};
                      statuses.forEach(s => { matrix[s] = { total: 0 }; plantList.forEach(p => { matrix[s][p] = 0; }); });
                      (backupRequests || []).forEach(r => {
                        const s = r['Status'] || 'Pending';
                        const p = r['Plant'];
                        if (!matrix[s]) matrix[s] = { total: 0, ...Object.fromEntries(plantList.map(pl => [pl, 0])) };
                        if (p && matrix[s][p] === undefined) matrix[s][p] = 0;
                        matrix[s].total += 1;
                        if (p) matrix[s][p] += 1;
                      });
                      const plantTotals = Object.fromEntries(plantList.map(p => [p, 0]));
                      let grandTotal = 0;
                      Object.keys(matrix).forEach(s => { plantList.forEach(p => { plantTotals[p] += matrix[s][p] || 0; }); grandTotal += matrix[s].total; });
                      const thStyle = { padding: '10px 12px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase' };
                      const tdStyle = { padding: '10px 12px', textAlign: 'center', fontSize: '0.9rem', fontWeight: 600, color: theme.text };
                      if (plantList.length === 0 && grandTotal === 0) {
                        return <div style={{ padding: '1.5rem', textAlign: 'center', color: theme.textMuted, fontSize: '0.875rem' }}>No backup requests yet</div>;
                      }
                      return (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                              <th style={{ ...thStyle, textAlign: 'left' }}>Status</th>
                              {plantList.map(p => <th key={p} style={thStyle}>{p}</th>)}
                              <th style={thStyle}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.keys(matrix).map(s => {
                              const cfg = BACKUP_REQUEST_STATUS_CONFIG[s] || { color: '#94A3B8', label: s };
                              return (
                                <tr key={s} style={{ borderBottom: `1px solid ${theme.border}` }}>
                                  <td style={{ padding: '10px 12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: cfg.color }} />
                                      <span style={{ fontSize: '0.85rem', color: theme.text, fontWeight: 500 }}>{cfg.label}</span>
                                    </div>
                                  </td>
                                  {plantList.map(p => <td key={p} style={tdStyle}>{matrix[s][p] || 0}</td>)}
                                  <td style={tdStyle}>
                                    <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: `${cfg.color}20`, color: cfg.color }}>{matrix[s].total}</span>
                                  </td>
                                </tr>
                              );
                            })}
                            <tr>
                              <td style={{ padding: '10px 12px', fontSize: '0.8rem', fontWeight: 700, color: theme.textMuted, textTransform: 'uppercase' }}>Total</td>
                              {plantList.map(p => <td key={p} style={{ ...tdStyle, fontWeight: 700 }}>{plantTotals[p]}</td>)}
                              <td style={{ ...tdStyle, fontWeight: 700 }}>{grandTotal}</td>
                            </tr>
                          </tbody>
                        </table>
                      );
                    })()}
                  </div>
                </div>
                </div>
              </div>
              <div style={styles.pipelineSection}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text }}>Active Pipeline</h3>
                  <button onClick={() => setActiveTab('flow-pending-order')} style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#3B82F6', fontSize: '0.875rem', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer' }}>View all <ArrowRight size={16} /></button>
                </div>
                <div style={styles.pipelineColumns}>
                  {['AWAITING FOR DESIGN', 'PENDING FOR DESIGN APPROVAL', 'PENDING FOR ORACLE ENTRY', 'PENDING FOR ORDERING'].map(status => {
                    const config = STATUS_CONFIG[status];
                    const orders = data.filter(o => o.STATUS === status).slice(0, 3);
                    const count = data.filter(o => o.STATUS === status).length;
                    return (
                      <div key={status} style={styles.pipelineColumn(config.bgColor)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                          <config.icon size={16} color={config.color} />
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: config.color }}>{config.label}</span>
                          <span style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 700, color: config.color }}>{count}</span>
                        </div>
                        {orders.map(order => (<div key={order['DIE NO']} style={styles.pipelineItem} onClick={() => setSelectedOrder(order)}><div style={{ fontWeight: 600, fontSize: '0.875rem', color: theme.text, fontFamily: 'monospace' }}>{order['DIE NO']}</div><div style={{ fontSize: '0.75rem', color: theme.textDim, marginTop: '4px' }}>{order.Supplier}</div></div>))}
                        {count === 0 && <div style={{ textAlign: 'center', padding: '1rem', color: '#64748B', fontSize: '0.8rem' }}>No orders</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {activeTab === 'orders' && hasPageAccess('orders') && (
            <>
              <div style={styles.filterBar}>
                <div style={styles.filterRow}>

                  <select style={styles.filterSelect} value={filters.plant} onChange={(e) => setFilters({ ...filters, plant: e.target.value })}><option value="all">All Plants</option>{uniquePlants.map(p => <option key={p} value={p}>{p}</option>)}</select>
                  <select style={styles.filterSelect} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="all">All Status</option>{uniqueStatuses.map(s => <option key={s} value={s}>{STATUS_CONFIG[s]?.label || s}</option>)}</select>
                  <select style={styles.filterSelect} value={filters.supplier} onChange={(e) => setFilters({ ...filters, supplier: e.target.value })}><option value="all">All Suppliers</option>{uniqueSuppliers.map(s => <option key={s} value={s}>{s}</option>)}</select>
                  <select style={styles.filterSelect} value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}><option value="all">All Types</option>{uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}</select>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #334155' }}>
                  <span style={{ fontSize: '0.875rem', color: '#94A3B8' }}>Showing <strong style={{ color: '#F1F5F9' }}>{filteredData.length}</strong> orders</span>
                  <button onClick={() => { setFilters({ plant: 'all', status: 'all', supplier: 'all', type: 'all', month: 'all' }); setSearchTerm(''); }} style={{ fontSize: '0.875rem', color: '#3B82F6', background: 'none', border: 'none', cursor: 'pointer' }}>Clear filters</button>
                </div>
              </div>
              <div style={styles.tableContainer}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        {[{ key: 'DIE NO', label: 'Die No' }, { key: 'Order No', label: 'Order' }, { key: 'Plant', label: 'Plant' }, { key: 'TYPE', label: 'Type' }, { key: 'Diameter', label: 'Ø' }, { key: 'Thickness', label: 'T' }, { key: 'Supplier', label: 'Supplier' }, { key: 'Customer Name', label: 'Customer' }, { key: 'PR Number', label: 'PR#' }, { key: 'Mandrels per Cavity', label: 'Mandrels/Cav' }, { key: 'Total Mandrels', label: 'Total Mandrels' }, { key: 'Die Requested Date', label: 'Requested' }, { key: 'Type of shipment', label: 'Ship' }, { key: 'STATUS', label: 'Status' }, { key: 'Delivery Lead Time', label: 'Delivery LT' }, { key: 'Mfg Lead Time', label: 'Mfg LT' }].map(col => (
                          <th key={col.key} style={styles.th} onClick={() => handleSort(col.key)}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>{col.label}{sortConfig.key === col.key ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} color="#3B82F6" /> : <ChevronDown size={14} color="#3B82F6" />) : <ChevronDown size={14} color="#64748B" />}</div>
                          </th>
                        ))}
                        <th style={{ ...styles.th, textAlign: 'center' }}>Log</th>
                        <th style={{ ...styles.th, textAlign: 'center' }}>Days</th>
                        <th style={{ ...styles.th, textAlign: 'center' }}>View</th>
                        {user?.role === 'admin' && <th style={{ ...styles.th, textAlign: 'center' }}>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedData.map((order, idx) => (
                        <tr key={`${order['DIE NO']}-${idx}`} style={{ cursor: 'pointer' }} onClick={() => setSelectedOrder(order)}>
                          <td style={{ ...styles.td, whiteSpace: 'nowrap', minWidth: '120px' }}><span style={{ fontWeight: 600, color: theme.text, fontFamily: 'monospace' }}>{order['DIE NO']}</span></td>
                          <td style={styles.td}>{order['Order No']}</td>
                          <td style={{ ...styles.td, whiteSpace: 'nowrap' }}><span style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, background: order.Plant === 'EXT 1' ? 'rgba(59,130,246,0.2)' : 'rgba(139,92,246,0.2)', color: order.Plant === 'EXT 1' ? '#60A5FA' : '#A78BFA' }}>{order.Plant}</span></td>
                          <td style={styles.td}>{order.TYPE}</td>
                          <td style={styles.td}><span style={{ fontFamily: 'monospace' }}>{parseDieSize(order['Die Size']).diameter || '—'}</span></td>
                          <td style={styles.td}><span style={{ fontFamily: 'monospace' }}>{parseDieSize(order['Die Size']).thickness || '—'}</span></td>
                          <td style={styles.td}>{order.Supplier}</td>
                          <td style={styles.td}>{order['Customer Name'] || <span style={{ color: '#64748B' }}>—</span>}</td>
                          <td style={styles.td}><span style={{ fontFamily: 'monospace', color: order['PR Number'] ? theme.text : '#64748B' }}>{order['PR Number'] || '—'}</span></td>
                          <td style={styles.td}><span style={{ fontFamily: 'monospace' }}>{order['Mandrels per Cavity'] || 0}</span></td>
                          <td style={styles.td}><span style={{ fontFamily: 'monospace' }}>{order['Total Mandrels'] || 0}</span></td>
                          <td style={styles.td}>{order['Die Requested Date']}</td>
                          <td style={styles.td}><div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>{order['Type of shipment'] === 'AIR' ? <Plane size={14} color="#0EA5E9" /> : <Truck size={14} color="#10B981" />}{order['Type of shipment']}</div></td>
                          <td style={styles.td}><StatusBadge status={order.STATUS} /></td>
                          {/* Delivery Lead Time */}
                          {(() => {
                            const receivedDate = dieReceivedDateMap[order['DIE NO']?.trim()];
                            const days = calcLeadDays(order['Ordered date'], receivedDate);
                            return (
                              <td style={styles.td}>
                                {days !== null
                                  ? <span style={{ fontFamily: 'monospace', fontWeight: 600, color: days > 90 ? '#EF4444' : days > 60 ? '#F59E0B' : '#10B981' }}>{days}d</span>
                                  : <span style={{ color: '#64748B' }}>—</span>}
                              </td>
                            );
                          })()}
                          {/* Manufacturing Lead Time */}
                          {(() => {
                            const receivedDate = dieReceivedDateMap[order['DIE NO']?.trim()];
                            const days = calcLeadDays(order['Design Approved Date'], receivedDate);
                            return (
                              <td style={styles.td}>
                                {days !== null
                                  ? <span style={{ fontFamily: 'monospace', fontWeight: 600, color: days > 90 ? '#EF4444' : days > 60 ? '#F59E0B' : '#10B981' }}>{days}d</span>
                                  : <span style={{ color: '#64748B' }}>—</span>}
                              </td>
                            );
                          })()}
                          {/* Change Log indicator */}
                          <td style={{ ...styles.td, textAlign: 'center' }}>
                            {order['Change Log'] && order['Change Log'].length > 0 ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); setChangelogOrder(order); }}
                                style={{ padding: '6px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '6px', cursor: 'pointer', color: '#3B82F6', display: 'flex', alignItems: 'center', gap: '4px' }}
                                title={`${order['Change Log'].length} change(s) logged - Click to view`}
                              >
                                <History size={14} />
                                <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>{order['Change Log'].length}</span>
                              </button>
                            ) : (
                              <span style={{ color: '#64748B', fontSize: '0.8rem' }}>—</span>
                            )}
                          </td>
                          <td style={{ ...styles.td, textAlign: 'center' }}><DaysBadge order={order} /></td>
                          <td style={{ ...styles.td, textAlign: 'center' }}><button onClick={(e) => { e.stopPropagation(); setSelectedOrder(order); }} style={{ padding: '8px', background: 'transparent', border: 'none', borderRadius: '8px', cursor: 'pointer', color: '#64748B' }}><Eye size={18} /></button></td>
                          {user?.role === 'admin' && <td style={{ ...styles.td, textAlign: 'center' }}>
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                if (window.confirm(`Delete order "${order['DIE NO']}"? This cannot be undone.`)) {
                                  try {
                                    await ordersAPI.delete(order.id);
                                    setToast({ message: `Order ${order['DIE NO']} deleted successfully`, type: 'success' });
                                    setTimeout(() => setToast(null), 3000);
                                    fetchOrders();
                                  } catch (error) {
                                    console.error('Delete error:', error);
                                    setToast({ message: 'Failed to delete: ' + error.message, type: 'error' });
                                    setTimeout(() => setToast(null), 5000);
                                  }
                                }
                              }}
                              style={{ padding: '8px', background: 'rgba(239,68,68,0.1)', border: 'none', borderRadius: '8px', cursor: 'pointer', color: '#EF4444' }}
                              title="Delete Order"
                            >
                              <Trash2 size={18} />
                            </button>
                          </td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.5rem', borderTop: '1px solid #334155' }}>
                    <span style={{ fontSize: '0.875rem', color: '#64748B' }}>Page {currentPage} of {totalPages}</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} style={{ minWidth: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0F172A', border: '1px solid #334155', borderRadius: '8px', color: '#94A3B8', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', opacity: currentPage === 1 ? 0.4 : 1 }}><ChevronLeft size={18} /></button>
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + 1).map(page => (
                        <button key={page} onClick={() => setCurrentPage(page)} style={{ minWidth: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: currentPage === page ? '#3B82F6' : '#0F172A', border: '1px solid', borderColor: currentPage === page ? '#3B82F6' : '#334155', borderRadius: '8px', color: currentPage === page ? 'white' : '#94A3B8', cursor: 'pointer' }}>{page}</button>
                      ))}
                      <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} style={{ minWidth: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0F172A', border: '1px solid #334155', borderRadius: '8px', color: '#94A3B8', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', opacity: currentPage === totalPages ? 0.4 : 1 }}><ChevronRight size={18} /></button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Process Flow Pages */}
          {activeTab.startsWith('flow-') && hasPageAccess(activeTab) && (() => {
            // Dynamic import would be cleaner but this works for inline
            const flowTabs = [
              { id: 'flow-pending-order', status: 'PENDING FOR ORDERING' },
              { id: 'flow-awaiting-design', status: 'AWAITING FOR DESIGN' },
              { id: 'flow-simulation', status: 'UNDER SIMULATION' },
              { id: 'flow-design-approval', status: 'PENDING FOR DESIGN APPROVAL' },
              { id: 'flow-pending-pr', status: 'PENDING FOR PR' },
              { id: 'flow-oracle-entry', status: 'PENDING FOR ORACLE ENTRY' },
              { id: 'flow-design-ems', status: 'PENDING FOR DESIGN TO EMS' },
              { id: 'flow-completed', status: 'DONE' },
            ];
            const currentFlow = flowTabs.find(f => f.id === activeTab);
            if (!currentFlow) return null;

            const config = STATUS_CONFIG[currentFlow.status] || { color: '#6B7280', label: currentFlow.status };
            const StatusIcon = config.icon || Package;
            const flowOrders = data.filter(o => o.STATUS === currentFlow.status);

            // Workflow steps configuration
            const WORKFLOW_STEPS = {
              'PENDING FOR ORDERING': { dateField: 'Ordered date', nextStatus: 'AWAITING FOR DESIGN', completionLabel: 'Mark as Ordered' },
              'AWAITING FOR DESIGN': { dateField: 'Design Received Date', nextStatus: 'PENDING FOR DESIGN APPROVAL', completionLabel: 'Design Received' },
              'UNDER SIMULATION': { dateField: '3D Model Received Date', nextStatus: 'PENDING FOR DESIGN APPROVAL', completionLabel: 'Simulation Complete' },
              'PENDING FOR DESIGN APPROVAL': { dateField: 'Design Approved Date', nextStatus: 'PENDING FOR PR', completionLabel: 'Approve Design' },
              'PENDING FOR PR': { dateField: 'PR Entry', nextStatus: 'PENDING FOR ORACLE ENTRY', completionLabel: 'PR Completed' },
              'PENDING FOR ORACLE ENTRY': { dateField: 'Oracle Entry', nextStatus: 'PENDING FOR DESIGN TO EMS', completionLabel: 'Oracle Entry Done' },
              'PENDING FOR DESIGN TO EMS': { dateField: 'Design to EMS Date', nextStatus: 'DONE', completionLabel: 'Sent to EMS' },
              'DONE': { dateField: null, nextStatus: null, completionLabel: null }
            };
            const workflow = WORKFLOW_STEPS[currentFlow.status];

            const handleCompleteStep = async (order, e) => {
              e.stopPropagation();
              if (!workflow || !workflow.nextStatus) return;

              const today = new Date().toISOString().split('T')[0];
              const updatedOrder = { ...order, STATUS: workflow.nextStatus, [workflow.dateField]: today };

              try {
                await ordersAPI.update(order.id, updatedOrder);
                setData(prev => prev.map(o => o.id === order.id ? updatedOrder : o));
                setToast({ message: `Order ${order['DIE NO']} moved to ${STATUS_CONFIG[workflow.nextStatus]?.label || workflow.nextStatus}`, type: 'success' });
                setTimeout(() => setToast(null), 3000);
              } catch (error) {
                console.error('Complete step error:', error);
                setToast({ message: 'Failed to update: ' + error.message, type: 'error' });
                setTimeout(() => setToast(null), 5000);
              }
            };

            return (
              <div>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: `${config.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <StatusIcon size={24} color={config.color} />
                    </div>
                    <div>
                      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: theme.text, margin: 0 }}>{config.label}</h1>
                      <p style={{ fontSize: '0.85rem', color: theme.textMuted, margin: '4px 0 0' }}>Orders in {config.label.toLowerCase()} stage</p>
                    </div>
                    <span style={{ background: config.color, color: 'white', padding: '4px 12px', borderRadius: '20px', fontSize: '0.875rem', fontWeight: 600 }}>{flowOrders.length}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: theme.inputBg || '#0F172A', borderRadius: '10px', padding: '10px 14px', border: `1px solid ${theme.border || '#334155'}`, minWidth: '280px' }}>
                    <Search size={18} color={theme.textMuted} />
                    <input
                      type="text"
                      placeholder="Search orders..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{ border: 'none', background: 'transparent', color: theme.text, fontSize: '0.9rem', outline: 'none', width: '100%' }}
                    />
                  </div>
                </div>

                {/* Table */}
                <div style={styles.tableContainer}>
                  {flowOrders.length > 0 ? (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={styles.table}>
                        <thead>
                          <tr>
                            {[{ key: 'DIE NO', label: 'Die No' }, { key: 'Order No', label: 'Order' }, { key: 'Plant', label: 'Plant' }, { key: 'TYPE', label: 'Type' }, { key: 'Diameter', label: 'Diameter' }, { key: 'Thickness', label: 'Thickness' }, { key: 'Supplier', label: 'Supplier' }, ...(currentFlow.status === 'PENDING FOR ORDERING' ? [{ key: 'Customer Name', label: 'Customer' }, { key: 'Mandrels per Cavity', label: 'Mandrels/Cav' }, { key: 'Total Mandrels', label: 'Total Mandrels' }, { key: 'Die Requested Date', label: 'Requested' }, { key: 'Type of shipment', label: 'Shipment' }] : [])].map(col => (
                              <th key={col.key} style={styles.th} onClick={() => handleSort(col.key)}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  {col.label}
                                  {sortConfig.key === col.key ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} color={config.color} /> : <ChevronDown size={14} color={config.color} />) : <ChevronDown size={14} color="#64748B" style={{ opacity: 0.3 }} />}
                                </div>
                              </th>
                            ))}
                            <th style={{ ...styles.th, textAlign: 'center' }}>Days</th>
                            <th style={{ ...styles.th, textAlign: 'center' }}>View</th>
                            <th style={{ ...styles.th, textAlign: 'center' }}>Rev</th>
                            {/* PR Entry specific columns */}
                            {currentFlow.status === 'PENDING FOR PR' && (
                              <>
                                <th style={{ ...styles.th, textAlign: 'center' }}>Copy ERP</th>
                                <th style={{ ...styles.th, textAlign: 'center' }}>PR Number</th>
                              </>
                            )}
                            {workflow && workflow.nextStatus && <th style={{ ...styles.th, textAlign: 'center' }}>Complete</th>}
                            {currentFlow.status === 'DONE' && <th style={{ ...styles.th, textAlign: 'center' }}>Confirm Receivance</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {flowOrders
                            .filter(o => !searchTerm || (o['DIE NO'] && o['DIE NO'].toLowerCase().includes(searchTerm.toLowerCase())) || (o['Order No'] && o['Order No'].toLowerCase().includes(searchTerm.toLowerCase())) || (o.Supplier && o.Supplier.toLowerCase().includes(searchTerm.toLowerCase())))
                            .sort((a, b) => {
                              if (!sortConfig.key) return 0;
                              const aVal = a[sortConfig.key] || '';
                              const bVal = b[sortConfig.key] || '';
                              if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                              if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                              return 0;
                            })
                            .map((order, idx) => (
                              <tr key={`${order['DIE NO']}-${idx}`} style={{ cursor: 'pointer' }} onClick={() => setSelectedOrder(order)}>
                                <td style={{ ...styles.td, whiteSpace: 'nowrap', minWidth: '120px' }}><span style={{ fontWeight: 600, color: theme.text, fontFamily: 'monospace' }}>{order['DIE NO']}</span></td>
                                {/* Order No - editable on Pending Ordering */}
                                <td style={styles.td}>
                                  {currentFlow.status === 'PENDING FOR ORDERING' ? (
                                    <input
                                      type="text"
                                      defaultValue={order['Order No'] || ''}
                                      onBlur={(e) => handleInlineFieldSave(order, 'Order No', e.target.value.trim())}
                                      onClick={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); } }}
                                      style={{ width: '90px', padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem' }}
                                      placeholder="Order No"
                                    />
                                  ) : (
                                    order['Order No']
                                  )}
                                </td>
                                <td style={{ ...styles.td, whiteSpace: 'nowrap' }}><span style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, background: order.Plant === 'EXT 1' ? 'rgba(59,130,246,0.2)' : 'rgba(139,92,246,0.2)', color: order.Plant === 'EXT 1' ? '#60A5FA' : '#A78BFA' }}>{order.Plant}</span></td>
                                <td style={styles.td}><span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, background: order.TYPE === 'N' ? '#3B82F620' : order.TYPE === 'B' ? '#F59E0B20' : '#64748B20', color: order.TYPE === 'N' ? '#3B82F6' : order.TYPE === 'B' ? '#F59E0B' : '#64748B' }}>{order.TYPE === 'N' ? 'New' : order.TYPE === 'B' ? 'Backup' : order.TYPE}</span></td>
                                {/* Diameter - editable on Simulation and Design Approval */}
                                <td style={styles.td}>
                                  {(currentFlow.status === 'UNDER SIMULATION' || currentFlow.status === 'PENDING FOR DESIGN APPROVAL') ? (
                                    <input
                                      type="number"
                                      defaultValue={parseDieSize(order['Die Size']).diameter || ''}
                                      onBlur={(e) => handleSizeChange(order, 'Diameter', parseInt(e.target.value, 10))}
                                      onClick={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); } }}
                                      style={{ width: '65px', padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', textAlign: 'center' }}
                                      placeholder="Ø"
                                    />
                                  ) : (
                                    <span style={{ fontFamily: 'monospace' }}>{parseDieSize(order['Die Size']).diameter || '—'}</span>
                                  )}
                                </td>
                                {/* Thickness - editable on Simulation and Design Approval */}
                                <td style={styles.td}>
                                  {(currentFlow.status === 'UNDER SIMULATION' || currentFlow.status === 'PENDING FOR DESIGN APPROVAL') ? (
                                    <input
                                      type="number"
                                      defaultValue={parseDieSize(order['Die Size']).thickness || ''}
                                      onBlur={(e) => handleSizeChange(order, 'Thickness', parseInt(e.target.value, 10))}
                                      onClick={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); } }}
                                      style={{ width: '65px', padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', textAlign: 'center' }}
                                      placeholder="T"
                                    />
                                  ) : (
                                    <span style={{ fontFamily: 'monospace' }}>{parseDieSize(order['Die Size']).thickness || '—'}</span>
                                  )}
                                </td>
                                {/* Supplier - editable dropdown on Pending Ordering */}
                                <td style={styles.td}>
                                  {currentFlow.status === 'PENDING FOR ORDERING' ? (
                                    <select
                                      defaultValue={order.Supplier || ''}
                                      onChange={(e) => { handleInlineFieldSave(order, 'Supplier', e.target.value); }}
                                      onClick={(e) => e.stopPropagation()}
                                      style={{ padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', cursor: 'pointer', maxWidth: '120px' }}
                                    >
                                      <option value="">—</option>
                                      {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                    </select>
                                  ) : (
                                    order.Supplier
                                  )}
                                </td>
                                {currentFlow.status === 'PENDING FOR ORDERING' && (
                                  <>
                                    <td style={styles.td}>
                                      <input
                                        type="text"
                                        defaultValue={order['Customer Name'] || ''}
                                        onBlur={(e) => handleInlineFieldSave(order, 'Customer Name', e.target.value.trim())}
                                        onClick={(e) => e.stopPropagation()}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); } }}
                                        style={{ width: '130px', padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem' }}
                                        placeholder="Customer"
                                      />
                                    </td>
                                    <td style={styles.td}>
                                      <input
                                        type="number"
                                        min="0"
                                        defaultValue={order['Mandrels per Cavity'] || 0}
                                        onBlur={(e) => handleMandrelsChange(order, e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); } }}
                                        style={{ width: '55px', padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', textAlign: 'center' }}
                                      />
                                    </td>
                                    <td style={styles.td}><span style={{ fontFamily: 'monospace' }}>{order['Total Mandrels'] || 0}</span></td>
                                  </>
                                )}
                                {currentFlow.status === 'PENDING FOR ORDERING' && (
                                  <>
                                    <td style={styles.td}>{order['Die Requested Date']}</td>
                                    <td style={styles.td}><div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>{order['Type of shipment'] === 'AIR' ? <Plane size={14} color="#0EA5E9" /> : <Truck size={14} color="#10B981" />}{order['Type of shipment']}</div></td>
                                  </>
                                )}
                                <td style={{ ...styles.td, textAlign: 'center' }}><DaysBadge order={order} /></td>
                                <td style={{ ...styles.td, textAlign: 'center' }}><button onClick={(e) => { e.stopPropagation(); setSelectedOrder(order); }} style={{ padding: '8px', background: 'transparent', border: 'none', borderRadius: '8px', cursor: 'pointer', color: '#64748B' }}><Eye size={18} /></button></td>
                                <td style={{ ...styles.td, textAlign: 'center' }}>
                                  {order['Design Revision Count'] > 0 ? (
                                    <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: 'rgba(245,158,11,0.2)', color: '#F59E0B' }} title={order['Last Revision Date'] ? `Last: ${order['Last Revision Date']}` : ''}>
                                      {order['Design Revision Count']}
                                    </span>
                                  ) : (
                                    <span style={{ color: '#64748B' }}>—</span>
                                  )}
                                </td>
                                {/* PR Entry specific cells */}
                                {currentFlow.status === 'PENDING FOR PR' && (
                                  <>
                                    {/* Copy ERP button */}
                                    <td style={{ ...styles.td, textAlign: 'center' }}>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); copyForERP(order); }}
                                        style={{ padding: '6px 12px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '8px', cursor: 'pointer', color: '#3B82F6', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 600, transition: 'all 0.2s' }}
                                        title="Copy for ERP"
                                        onMouseEnter={(e) => { e.currentTarget.style.background = '#3B82F6'; e.currentTarget.style.color = 'white'; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(59,130,246,0.2)'; e.currentTarget.style.color = '#3B82F6'; }}
                                      >
                                        <Copy size={14} /> Copy
                                      </button>
                                    </td>
                                    {/* PR Number input */}
                                    <td style={styles.td}>
                                      <input
                                        type="text"
                                        defaultValue={order['PR Number'] || ''}
                                        onBlur={(e) => handlePRNumberChange(order, e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); } }}
                                        style={{ width: '100px', padding: '6px 8px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', textAlign: 'center' }}
                                        placeholder="PR-XXXX"
                                      />
                                    </td>
                                  </>
                                )}
                                {workflow && workflow.nextStatus && (
                                  <td style={{ ...styles.td, textAlign: 'center' }}>
                                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                      {/* Request Revision button - Design Approval and Simulation stages */}
                                      {(currentFlow.status === 'PENDING FOR DESIGN APPROVAL' || currentFlow.status === 'UNDER SIMULATION') && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setRevisionOrder(order); }}
                                          style={{ padding: '6px 12px', background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '8px', cursor: 'pointer', color: '#F59E0B', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, transition: 'all 0.2s' }}
                                          title="Request Revision"
                                          onMouseEnter={(e) => { e.currentTarget.style.background = '#F59E0B'; e.currentTarget.style.color = 'white'; }}
                                          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(245,158,11,0.2)'; e.currentTarget.style.color = '#F59E0B'; }}
                                        >
                                          <RotateCcw size={16} />
                                        </button>
                                      )}
                                      <button
                                        onClick={(e) => handleCompleteStep(order, e)}
                                        style={{ padding: '6px 12px', background: `${config.color}20`, border: `1px solid ${config.color}40`, borderRadius: '8px', cursor: 'pointer', color: config.color, display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, transition: 'all 0.2s' }}
                                        title={workflow.completionLabel}
                                        onMouseEnter={(e) => { e.currentTarget.style.background = config.color; e.currentTarget.style.color = 'white'; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.background = `${config.color}20`; e.currentTarget.style.color = config.color; }}
                                      >
                                        <CheckCircle size={16} />
                                      </button>
                                    </div>
                                  </td>
                                )}
                                {currentFlow.status === 'DONE' && (
                                  <td style={{ ...styles.td, textAlign: 'center' }}>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setDieReceivanceOrder(order); setDieReceivanceForm({ die_received_date: new Date().toISOString().split('T')[0], corrector: '' }); }}
                                      style={{ padding: '6px 14px', background: 'rgba(8,145,178,0.15)', border: '1px solid rgba(8,145,178,0.4)', borderRadius: '8px', cursor: 'pointer', color: '#0891B2', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, transition: 'all 0.2s', whiteSpace: 'nowrap' }}
                                      title="Confirm Die Receivance"
                                      onMouseEnter={(e) => { e.currentTarget.style.background = '#0891B2'; e.currentTarget.style.color = 'white'; }}
                                      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(8,145,178,0.15)'; e.currentTarget.style.color = '#0891B2'; }}
                                    >
                                      <Package size={16} /> Confirm
                                    </button>
                                  </td>
                                )}
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '4rem 2rem', color: theme.textMuted }}>
                      <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: `${config.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                        <StatusIcon size={28} color={config.color} />
                      </div>
                      <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: theme.text, marginBottom: '0.5rem' }}>No Orders in {config.label}</h3>
                      <p style={{ fontSize: '0.9rem', color: theme.textMuted }}>There are currently no orders at this stage</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Die Receivance Confirmation Modal */}
          {dieReceivanceOrder && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '2rem', width: '90%', maxWidth: '480px', border: `1px solid ${theme.cardBorder}`, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                  <div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: theme.text, margin: 0 }}>Confirm Die Receivance</h2>
                    <p style={{ fontSize: '0.85rem', color: theme.textMuted, margin: '4px 0 0' }}>Die No: <strong style={{ color: theme.text, fontFamily: 'monospace' }}>{dieReceivanceOrder['DIE NO']}</strong></p>
                  </div>
                  <button onClick={() => setDieReceivanceOrder(null)} style={{ padding: '8px', background: 'transparent', border: 'none', borderRadius: '8px', cursor: 'pointer', color: theme.textMuted }}>
                    <X size={20} />
                  </button>
                </div>

                <div style={{ background: `rgba(8,145,178,0.08)`, borderRadius: '12px', padding: '12px 16px', marginBottom: '1.5rem', border: '1px solid rgba(8,145,178,0.2)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.8rem' }}>
                    <div><span style={{ color: theme.textDim }}>Supplier:</span> <strong style={{ color: theme.text }}>{dieReceivanceOrder.Supplier}</strong></div>
                    <div><span style={{ color: theme.textDim }}>Plant:</span> <strong style={{ color: theme.text }}>{dieReceivanceOrder.Plant}</strong></div>
                    <div><span style={{ color: theme.textDim }}>Type:</span> <strong style={{ color: theme.text }}>{dieReceivanceOrder.TYPE === 'N' ? 'New' : dieReceivanceOrder.TYPE === 'B' ? 'Backup' : dieReceivanceOrder.TYPE}</strong></div>
                    <div><span style={{ color: theme.textDim }}>Size:</span> <strong style={{ color: theme.text }}>{dieReceivanceOrder['Die Size'] || '—'}</strong></div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Die Received Date *</label>
                    <input
                      type="date"
                      value={dieReceivanceForm.die_received_date}
                      onChange={(e) => setDieReceivanceForm({ ...dieReceivanceForm, die_received_date: e.target.value })}
                      style={{ width: '100%', padding: '10px 12px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.text, fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Assign Corrector *</label>
                    <input
                      type="text"
                      value={dieReceivanceForm.corrector}
                      onChange={(e) => setDieReceivanceForm({ ...dieReceivanceForm, corrector: e.target.value })}
                      placeholder="Enter corrector name"
                      style={{ width: '100%', padding: '10px 12px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.text, fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '1.5rem', paddingTop: '1rem', borderTop: `1px solid ${theme.border || '#334155'}` }}>
                  <button
                    onClick={() => setDieReceivanceOrder(null)}
                    style={{ padding: '10px 20px', background: 'transparent', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '10px', color: theme.textMuted, fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      if (!dieReceivanceForm.die_received_date) {
                        setToast({ message: 'Please enter the die received date', type: 'error' });
                        setTimeout(() => setToast(null), 3000);
                        return;
                      }
                      if (!dieReceivanceForm.corrector.trim()) {
                        setToast({ message: 'Please assign a corrector', type: 'error' });
                        setTimeout(() => setToast(null), 3000);
                        return;
                      }
                      try {
                        // Merge SF defaults directly into the die_order: it now carries all
                        // sample-followup fields, so there's no separate SF row to create.
                        const updatedOrder = {
                          ...dieReceivanceOrder,
                          STATUS: 'DIE RECEIVED',
                          'Die Received Date': dieReceivanceForm.die_received_date,
                          'Corrector': dieReceivanceForm.corrector.trim(),
                          'Press': dieReceivanceOrder['Press'] || dieReceivanceOrder.Plant || '',
                          'Ascona Reference': dieReceivanceOrder['Ascona Reference'] || 'No',
                          'Sample Status': dieReceivanceOrder['Sample Status'] || 'Pending',
                        };
                        await ordersAPI.update(dieReceivanceOrder.id, updatedOrder);
                        setData(prev => prev.map(o => o.id === dieReceivanceOrder.id ? updatedOrder : o));
                        setDieReceivanceOrder(null);
                        setToast({ message: `Die ${dieReceivanceOrder['DIE NO']} confirmed & moved to Sample Followup`, type: 'success' });
                        // Navigate to Sample Followup page
                        setActiveTab('flow-sample-followup');
                        setTimeout(() => setToast(null), 3000);
                      } catch (error) {
                        console.error('Confirm receivance error:', error);
                        setToast({ message: 'Failed to confirm: ' + error.message, type: 'error' });
                        setTimeout(() => setToast(null), 5000);
                      }
                    }}
                    style={{ padding: '10px 24px', background: '#0891B2', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', boxShadow: '0 4px 12px rgba(8,145,178,0.4)', display: 'flex', alignItems: 'center', gap: '8px' }}
                  >
                    <CheckCircle size={18} /> Confirm Receivance
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Sample Followup Page */}
          {activeTab === 'flow-sample-followup' && hasPageAccess('flow-sample-followup') && (() => {
            const sfColor = '#0891B2';

            // Delay = (submission_date - die_received_date) if submission set, else (today - die_received_date)
            const computeSfDelay = (received, submission) => {
              if (!received) return 0;
              const start = new Date(received);
              if (isNaN(start)) return 0;
              const end = submission ? new Date(submission) : new Date();
              if (isNaN(end)) return 0;
              const diff = Math.floor((end.setHours(0, 0, 0, 0) - start.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24));
              return diff > 0 ? diff : 0;
            };

            // Map the SF form shape to die_orders field names (used for 'order'-source edits)
            const formToOrderFields = (form) => ({
              'DIE NO': form.die || '',
              'Press': form.press || '',
              'Supplier': form.supplier || '',
              'Customer Name': form.customer || '',
              'Die Received Date': form.die_received_date || '',
              'Ascona Reference': form.ascona_reference || 'No',
              'Submission Date': form.submission_date || '',
              'Sample Approval Date': form.sample_approval_date || '',
              'Sample Status': form.status || 'Pending',
              'No of Trial': form.no_of_trial || 0,
              'Remark': form.remark || '',
              'Corrector': form.corrector || '',
            });

            // Map the SF form shape to sample_followups (snake_case) columns.
            // Note: the sample_followups table stores the full die number in its legacy `profile` column.
            const formToSfFields = (form) => ({
              profile: form.die || '',
              press: form.press || '',
              supplier: form.supplier || '',
              customer: form.customer || '',
              die_received_date: form.die_received_date || '',
              ascona_reference: form.ascona_reference || 'No',
              submission_date: form.submission_date || '',
              sample_approval_date: form.sample_approval_date || '',
              delay_days: computeSfDelay(form.die_received_date, form.submission_date),
              status: form.status || 'Pending',
              no_of_trial: form.no_of_trial || 0,
              remark: form.remark || '',
              corrector: form.corrector || '',
            });

            const handleSampleFollowupSubmit = async () => {
              try {
                if (editingSampleFollowup) {
                  // Edit: route by source — order-backed rows update die_orders, standalone rows update sample_followups
                  if (editingSampleFollowup._source === 'order') {
                    const existing = editingSampleFollowup._order;
                    const updated = { ...existing, ...formToOrderFields(sampleFollowupForm) };
                    await ordersAPI.update(existing.id, updated);
                    fetchOrders();
                  } else {
                    const raw = editingSampleFollowup._raw;
                    await sampleFollowupsAPI.update(raw.id, formToSfFields(sampleFollowupForm));
                    fetchSampleFollowups();
                  }
                  setToast({ message: 'Sample followup updated successfully', type: 'success' });
                } else {
                  // Add Record: always creates a standalone row in sample_followups.
                  await sampleFollowupsAPI.create(formToSfFields(sampleFollowupForm));
                  fetchSampleFollowups();
                  setToast({ message: 'Sample followup created successfully', type: 'success' });
                }
                setTimeout(() => setToast(null), 3000);
                setShowSampleFollowupForm(false);
                setEditingSampleFollowup(null);
                setSampleFollowupForm({ die: '', press: '', supplier: '', customer: '', die_received_date: '', ascona_reference: 'No', submission_date: '', sample_approval_date: '', delay_days: 0, status: 'Pending', no_of_trial: 0, remark: '', corrector: '' });
              } catch (error) {
                console.error('Sample followup error:', error);
                setToast({ message: 'Failed: ' + error.message, type: 'error' });
                setTimeout(() => setToast(null), 5000);
              }
            };

            const handleDeleteSampleFollowup = async (sf) => {
              if (sf._source === 'standalone') {
                if (!window.confirm('Delete this sample followup record? This cannot be undone.')) return;
                try {
                  await sampleFollowupsAPI.delete(sf._raw.id);
                  setToast({ message: 'Sample followup deleted', type: 'success' });
                  setTimeout(() => setToast(null), 3000);
                  fetchSampleFollowups();
                } catch (error) {
                  setToast({ message: 'Failed to delete: ' + error.message, type: 'error' });
                  setTimeout(() => setToast(null), 5000);
                }
                return;
              }
              // Order-backed row: clear SF fields on the die_order, keep the order itself.
              if (!window.confirm('Clear the sample-followup data for this die? The underlying die order will remain; only sample/trial fields will be reset.')) return;
              try {
                const existing = sf._order;
                const cleared = {
                  ...existing,
                  'Die Received Date': '',
                  'Submission Date': '',
                  'Sample Approval Date': '',
                  'Ascona Reference': 'No',
                  'Sample Status': '',
                  'No of Trial': 0,
                  'Remark': '',
                  'Press': '',
                };
                await ordersAPI.update(existing.id, cleared);
                setToast({ message: 'Sample followup cleared', type: 'success' });
                setTimeout(() => setToast(null), 3000);
                fetchOrders();
              } catch (error) {
                setToast({ message: 'Failed to clear: ' + error.message, type: 'error' });
                setTimeout(() => setToast(null), 5000);
              }
            };

            // Inline save for the 5 editable cells — routes to the correct backend by source.
            const SF_DISPLAY_TO_SNAKE = {
              'Ascona Reference': 'ascona_reference',
              'Submission Date': 'submission_date',
              'Sample Approval Date': 'sample_approval_date',
              'No of Trial': 'no_of_trial',
              'Remark': 'remark',
              'Sample Status': 'status',
              'Corrector': 'corrector',
            };
            const handleSfInlineSave = async (sf, displayField, value) => {
              if (sf._source === 'order') {
                await handleInlineFieldSave(sf._order, displayField, value);
                return;
              }
              const snake = SF_DISPLAY_TO_SNAKE[displayField];
              if (!snake) return;
              const raw = sf._raw;
              if (raw[snake] === value) return;
              try {
                const updated = { ...raw, [snake]: value };
                await sampleFollowupsAPI.update(raw.id, updated);
                setSampleFollowupsStandalone(prev => prev.map(r => r.id === raw.id ? updated : r));
                setToast({ message: `${displayField} saved`, type: 'success' });
                setTimeout(() => setToast(null), 3000);
              } catch (error) {
                console.error(`${displayField} update error:`, error);
                setToast({ message: `Failed to save ${displayField}`, type: 'error' });
                setTimeout(() => setToast(null), 5000);
              }
            };

            const SF_STATUSES = ['Pending', 'Sample Submitted', 'Approved', 'Rejected', 'On hold'];

            const sfStatusColors = {
              'Pending': { color: '#F59E0B', bg: '#FFFBEB' },
              'Sample Submitted': { color: '#3B82F6', bg: '#EFF6FF' },
              'Approved': { color: '#16A34A', bg: '#F0FDF4' },
              'Rejected': { color: '#EF4444', bg: '#FEF2F2' },
              'On hold': { color: '#6B7280', bg: '#F3F4F6' },
            };

            const sfPlants = Array.from(new Set(sampleFollowups.map(sf => (sf.press || '').trim()).filter(Boolean))).sort();

            const filteredFollowups = sampleFollowups.filter(sf => {
              const matchesStatus = sfStatusFilter === 'All' || (sf.status || 'Pending') === sfStatusFilter;
              const matchesPlant = sfPlantFilter === 'All' || (sf.press || '').trim() === sfPlantFilter;
              const matchesSearch = !searchTerm ||
                (sf.profile && sf.profile.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (sf.supplier && sf.supplier.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (sf.customer && sf.customer.toLowerCase().includes(searchTerm.toLowerCase())) ||
                (sf.corrector && sf.corrector.toLowerCase().includes(searchTerm.toLowerCase()));
              return matchesStatus && matchesPlant && matchesSearch;
            });

            return (
              <div>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: `${sfColor}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <ClipboardList size={24} color={sfColor} />
                    </div>
                    <div>
                      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: theme.text, margin: 0 }}>Sample Followup</h1>
                      <p style={{ fontSize: '0.85rem', color: theme.textMuted, margin: '4px 0 0' }}>Track sample submissions, approvals and trials</p>
                    </div>
                    <span style={{ background: sfColor, color: 'white', padding: '4px 12px', borderRadius: '20px', fontSize: '0.875rem', fontWeight: 600 }}>{filteredFollowups.length}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: theme.inputBg || '#0F172A', borderRadius: '10px', padding: '10px 14px', border: `1px solid ${theme.border || '#334155'}`, minWidth: '240px' }}>
                      <Search size={18} color={theme.textMuted} />
                      <input
                        type="text"
                        placeholder="Search followups..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{ border: 'none', background: 'transparent', color: theme.text, fontSize: '0.9rem', outline: 'none', width: '100%' }}
                      />
                    </div>
                    <button
                      onClick={() => { setEditingSampleFollowup(null); setSampleFollowupForm({ die: '', press: '', supplier: '', customer: '', die_received_date: '', ascona_reference: 'No', submission_date: '', sample_approval_date: '', delay_days: 0, status: 'Pending', no_of_trial: 0, remark: '', corrector: '' }); setShowSampleFollowupForm(true); }}
                      style={{ padding: '10px 20px', background: sfColor, color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.2s', boxShadow: `0 4px 12px ${sfColor}40` }}
                    >
                      + Add Record
                    </button>
                  </div>
                </div>

                {/* Status Filter Tabs + Plant Filter */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {['All', ...SF_STATUSES].map(s => {
                      const active = sfStatusFilter === s;
                      const sc = sfStatusColors[s];
                      const count = s === 'All' ? sampleFollowups.length : sampleFollowups.filter(sf => (sf.status || 'Pending') === s).length;
                      return (
                        <button
                          key={s}
                          onClick={() => setSfStatusFilter(s)}
                          style={{
                            padding: '6px 14px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 600,
                            cursor: 'pointer', border: `1px solid ${active ? (sc?.color || sfColor) : theme.cardBorder}`,
                            background: active ? (sc?.bg || `${sfColor}20`) : 'transparent',
                            color: active ? (sc?.color || sfColor) : theme.textMuted,
                            transition: 'all 0.15s'
                          }}
                        >
                          {s} <span style={{ marginLeft: '4px', opacity: 0.8 }}>({count})</span>
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Plant</span>
                    <select
                      value={sfPlantFilter}
                      onChange={(e) => setSfPlantFilter(e.target.value)}
                      style={{
                        padding: '6px 10px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600,
                        border: `1px solid ${sfPlantFilter === 'All' ? theme.cardBorder : sfColor}`,
                        background: sfPlantFilter === 'All' ? 'transparent' : `${sfColor}15`,
                        color: sfPlantFilter === 'All' ? theme.textMuted : sfColor,
                        cursor: 'pointer', outline: 'none', minWidth: '120px'
                      }}
                    >
                      <option value="All">All Plants ({sampleFollowups.length})</option>
                      {sfPlants.map(p => {
                        const count = sampleFollowups.filter(sf => (sf.press || '').trim() === p).length;
                        return <option key={p} value={p}>{p} ({count})</option>;
                      })}
                    </select>
                  </div>
                </div>

                {/* Table */}
                <div style={styles.tableContainer}>
                  {filteredFollowups.length > 0 ? (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={styles.table}>
                        <thead>
                          <tr>
                            <th style={styles.th}>Die</th>
                            <th style={{ ...styles.th, whiteSpace: 'nowrap' }}>Profile</th>
                            <th style={{ ...styles.th, whiteSpace: 'nowrap' }}>Plant</th>
                            <th style={{ ...styles.th, whiteSpace: 'nowrap' }}>Supplier</th>
                            <th style={styles.th}>Customer</th>
                            <th style={{ ...styles.th, whiteSpace: 'nowrap' }}>Die Received Date</th>
                            <th style={{ ...styles.th, whiteSpace: 'nowrap' }}>Ascona Ref</th>
                            <th style={{ ...styles.th, whiteSpace: 'nowrap' }}>Submission Date</th>
                            <th style={{ ...styles.th, whiteSpace: 'nowrap' }}>Sample Approval Date</th>
                            <th style={{ ...styles.th, textAlign: 'center', whiteSpace: 'nowrap' }}>Delay Days</th>
                            <th style={styles.th}>Status</th>
                            <th style={{ ...styles.th, textAlign: 'center', whiteSpace: 'nowrap' }}>No. of Trial</th>
                            <th style={styles.th}>Remark</th>
                            <th style={{ ...styles.th, whiteSpace: 'nowrap' }}>Corrector</th>
                            <th style={{ ...styles.th, textAlign: 'center' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredFollowups.map((sf, idx) => {
                            const statusStyle = sfStatusColors[sf.status] || { color: '#6B7280', bg: '#F3F4F6' };
                            return (
                              <tr key={sf.id}>
                                <td style={{ ...styles.td, fontWeight: 600, color: theme.text }}>{sf.die || '—'}</td>
                                <td style={{ ...styles.td, whiteSpace: 'nowrap', color: theme.textMuted }}>{sf.profile || '—'}</td>
                                <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{sf.press || '—'}</td>
                                <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{sf.supplier || '—'}</td>
                                <td style={styles.td}>{sf.customer || '—'}</td>
                                <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{sf.die_received_date || '—'}</td>
                                <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                                  <select
                                    defaultValue={sf.ascona_reference || 'No'}
                                    onChange={(e) => handleSfInlineSave(sf, 'Ascona Reference', e.target.value)}
                                    style={{ padding: '4px 8px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', cursor: 'pointer' }}
                                  >
                                    <option value="No">No</option>
                                    <option value="Yes">Yes</option>
                                  </select>
                                </td>
                                <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                                  <input
                                    type="date"
                                    defaultValue={sf.submission_date || ''}
                                    onBlur={(e) => handleSfInlineSave(sf, 'Submission Date', e.target.value)}
                                    style={{ padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem' }}
                                  />
                                </td>
                                <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                                  <input
                                    type="date"
                                    defaultValue={sf.sample_approval_date || ''}
                                    onBlur={(e) => handleSfInlineSave(sf, 'Sample Approval Date', e.target.value)}
                                    style={{ padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem' }}
                                  />
                                </td>
                                <td style={{ ...styles.td, textAlign: 'center' }}>
                                  {(() => {
                                    const d = computeSfDelay(sf.die_received_date, sf.submission_date);
                                    return (
                                      <span style={{ fontFamily: 'monospace', fontWeight: 600, color: d > 0 ? '#EF4444' : '#10B981' }}>
                                        {d}
                                      </span>
                                    );
                                  })()}
                                </td>
                                <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                                  <span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600, background: statusStyle.bg, color: statusStyle.color }}>
                                    {sf.status || 'Pending'}
                                  </span>
                                </td>
                                <td style={{ ...styles.td, textAlign: 'center' }}>
                                  <input
                                    type="number"
                                    min="0"
                                    defaultValue={sf.no_of_trial || 0}
                                    onBlur={(e) => handleSfInlineSave(sf, 'No of Trial', parseInt(e.target.value, 10) || 0)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                                    style={{ width: '60px', padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', textAlign: 'center', fontFamily: 'monospace' }}
                                  />
                                </td>
                                <td style={{ ...styles.td, minWidth: '160px' }}>
                                  <input
                                    type="text"
                                    defaultValue={sf.remark || ''}
                                    onBlur={(e) => handleSfInlineSave(sf, 'Remark', e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                                    placeholder="—"
                                    style={{ width: '100%', padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem' }}
                                  />
                                </td>
                                <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{sf.corrector || '—'}</td>
                                <td style={{ ...styles.td, textAlign: 'center' }}>
                                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                    <button
                                      onClick={() => { setEditingSampleFollowup(sf); setSampleFollowupForm({ die: sf.die || '', press: sf.press || '', supplier: sf.supplier || '', customer: sf.customer || '', die_received_date: sf.die_received_date || '', ascona_reference: sf.ascona_reference || 'No', submission_date: sf.submission_date || '', sample_approval_date: sf.sample_approval_date || '', delay_days: sf.delay_days || 0, status: sf.status || 'Pending', no_of_trial: sf.no_of_trial || 0, remark: sf.remark || '', corrector: sf.corrector || '' }); setShowSampleFollowupForm(true); }}
                                      style={{ padding: '6px', background: 'rgba(59,130,246,0.15)', border: 'none', borderRadius: '6px', cursor: 'pointer', color: '#3B82F6' }}
                                      title="Edit"
                                    >
                                      <Eye size={16} />
                                    </button>
                                    {user?.role === 'admin' && (
                                      <button
                                        onClick={() => handleDeleteSampleFollowup(sf)}
                                        style={{ padding: '6px', background: 'rgba(239,68,68,0.15)', border: 'none', borderRadius: '6px', cursor: 'pointer', color: '#EF4444' }}
                                        title="Delete"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '4rem 2rem', color: theme.textMuted }}>
                      <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: `${sfColor}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                        <ClipboardList size={28} color={sfColor} />
                      </div>
                      <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: theme.text, marginBottom: '0.5rem' }}>No Sample Followup Records</h3>
                      <p style={{ fontSize: '0.9rem', color: theme.textMuted }}>Click "Add Record" to create a new sample followup entry</p>
                    </div>
                  )}
                </div>

                {/* Add/Edit Modal */}
                {showSampleFollowupForm && (
                  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '2rem', width: '90%', maxWidth: '700px', maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${theme.cardBorder}`, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: theme.text, margin: 0 }}>
                          {editingSampleFollowup ? 'Edit Sample Followup' : 'New Sample Followup'}
                        </h2>
                        <button onClick={() => { setShowSampleFollowupForm(false); setEditingSampleFollowup(null); }} style={{ padding: '8px', background: 'transparent', border: 'none', borderRadius: '8px', cursor: 'pointer', color: theme.textMuted }}>
                          <X size={20} />
                        </button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        {[
                          { key: 'die', label: 'Die', type: 'text' },
                          { key: 'profile', label: 'Profile', type: 'readonly' },
                          { key: 'press', label: 'Plant', type: 'text' },
                          { key: 'supplier', label: 'Supplier', type: 'text' },
                          { key: 'customer', label: 'Customer', type: 'text' },
                          { key: 'die_received_date', label: 'Die Received Date', type: 'date' },
                          { key: 'ascona_reference', label: 'Ascona Reference', type: 'select', options: ['Yes', 'No'] },
                          { key: 'submission_date', label: 'Submission Date', type: 'date' },
                          { key: 'sample_approval_date', label: 'Sample Approval Date', type: 'date' },
                          { key: 'delay_days', label: 'Delay Days', type: 'number' },
                          { key: 'status', label: 'Status', type: 'select', options: SF_STATUSES },
                          { key: 'no_of_trial', label: 'No. of Trial', type: 'number' },
                          { key: 'corrector', label: 'Corrector', type: 'text' },
                        ].map(field => (
                          <div key={field.key}>
                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{field.label}</label>
                            {field.type === 'select' ? (
                              <select
                                value={sampleFollowupForm[field.key] || ''}
                                onChange={(e) => setSampleFollowupForm({ ...sampleFollowupForm, [field.key]: e.target.value })}
                                style={{ width: '100%', padding: '10px 12px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.text, fontSize: '0.9rem', outline: 'none' }}
                              >
                                {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                              </select>
                            ) : field.key === 'delay_days' ? (
                              <input
                                type="number"
                                value={computeSfDelay(sampleFollowupForm.die_received_date, sampleFollowupForm.submission_date)}
                                readOnly
                                title="Auto-calculated: submission date − die received date (or today − die received date if submission is empty)"
                                style={{ width: '100%', padding: '10px 12px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.textMuted, fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', cursor: 'not-allowed' }}
                              />
                            ) : field.type === 'readonly' ? (
                              <input
                                type="text"
                                value={extractProfile(sampleFollowupForm.die)}
                                readOnly
                                title="Auto-derived from Die (everything before the first '-')"
                                style={{ width: '100%', padding: '10px 12px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.textMuted, fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', cursor: 'not-allowed' }}
                              />
                            ) : (
                              <input
                                type={field.type}
                                value={sampleFollowupForm[field.key] || ''}
                                onChange={(e) => setSampleFollowupForm({ ...sampleFollowupForm, [field.key]: field.type === 'number' ? parseInt(e.target.value, 10) || 0 : e.target.value })}
                                style={{ width: '100%', padding: '10px 12px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.text, fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
                              />
                            )}
                          </div>
                        ))}
                        <div style={{ gridColumn: 'span 2' }}>
                          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Remark</label>
                          <textarea
                            value={sampleFollowupForm.remark || ''}
                            onChange={(e) => setSampleFollowupForm({ ...sampleFollowupForm, remark: e.target.value })}
                            rows={3}
                            style={{ width: '100%', padding: '10px 12px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.text, fontSize: '0.9rem', outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
                          />
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '1.5rem', paddingTop: '1rem', borderTop: `1px solid ${theme.border || '#334155'}` }}>
                        <button
                          onClick={() => { setShowSampleFollowupForm(false); setEditingSampleFollowup(null); }}
                          style={{ padding: '10px 20px', background: 'transparent', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '10px', color: theme.textMuted, fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSampleFollowupSubmit}
                          style={{ padding: '10px 24px', background: sfColor, color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', boxShadow: `0 4px 12px ${sfColor}40` }}
                        >
                          {editingSampleFollowup ? 'Update' : 'Create'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {activeTab === 'backup-requests' && hasPageAccess('backup-requests') && (
            <BackupDieRequests
              theme={theme}
              backupRequests={backupRequests}
              onRefresh={fetchBackupRequests}
              plants={plants}
              user={user}
            />
          )}

          {activeTab === 'email-inbox' && hasPageAccess('email-inbox') && (
            <EmailInbox
              theme={theme}
              onCompose={(prefill) => setShowEmailCompose(prefill || {})}
            />
          )}

          {activeTab === 'email-settings' && user?.role === 'admin' && (
            <EmailSettings theme={theme} />
          )}

          {activeTab === 'analytics' && hasPageAccess('analytics') && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1.25rem' }}>
              {/* Analytics Filter Bar */}
              <div style={{ ...styles.chartCard, gridColumn: 'span 2', padding: '1rem 1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: theme.textMuted }}>Filter Analytics:</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.8rem', color: theme.textDim }}>Quarter:</label>
                    <select
                      value={analyticsFilter.quarter}
                      onChange={(e) => setAnalyticsFilter({ ...analyticsFilter, quarter: e.target.value, period: 'all' })}
                      style={styles.filterSelect}
                    >
                      <option value="all">All Quarters</option>
                      <option value="Q1">Q1 (Jan-Mar)</option>
                      <option value="Q2">Q2 (Apr-Jun)</option>
                      <option value="Q3">Q3 (Jul-Sep)</option>
                      <option value="Q4">Q4 (Oct-Dec)</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.8rem', color: theme.textDim }}>Month:</label>
                    <select
                      value={analyticsFilter.period}
                      onChange={(e) => setAnalyticsFilter({ ...analyticsFilter, period: e.target.value, quarter: 'all' })}
                      style={styles.filterSelect}
                    >
                      <option value="all">All Months</option>
                      {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <span style={{ fontSize: '0.8rem', color: theme.textDim, marginLeft: 'auto' }}>
                    Showing <strong style={{ color: theme.text }}>{analyticsData.length}</strong> orders
                  </span>
                  {(analyticsFilter.period !== 'all' || analyticsFilter.quarter !== 'all') && (
                    <button onClick={() => setAnalyticsFilter({ period: 'all', quarter: 'all' })} style={{ fontSize: '0.8rem', color: '#3B82F6', background: 'none', border: 'none', cursor: 'pointer' }}>Clear filter</button>
                  )}
                </div>
              </div>
              <div style={{ ...styles.chartCard, gridColumn: 'span 2' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem', color: theme.text }}>Supplier Performance</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={styles.table}>
                    <thead><tr><th style={styles.th}>Supplier</th><th style={{ ...styles.th, textAlign: 'center' }}>Total</th><th style={{ ...styles.th, textAlign: 'center' }}>Completed</th><th style={{ ...styles.th, textAlign: 'center' }}>In Progress</th><th style={styles.th}>Completion Rate</th></tr></thead>
                    <tbody>
                      {[...new Set(analyticsData.map(o => o.Supplier))].filter(Boolean).sort().map(supplier => {
                        const supplierOrders = analyticsData.filter(o => o.Supplier === supplier);
                        const completed = supplierOrders.filter(o => o.STATUS === 'DONE').length;
                        const inProgress = supplierOrders.filter(o => !['DONE', 'CANCELLED'].includes(o.STATUS)).length;
                        const rate = supplierOrders.length > 0 ? ((completed / supplierOrders.length) * 100).toFixed(0) : 0;
                        return (
                          <tr key={supplier}>
                            <td style={styles.td}><span style={{ fontWeight: 600, color: theme.text }}>{supplier}</span></td>
                            <td style={{ ...styles.td, textAlign: 'center' }}>{supplierOrders.length}</td>
                            <td style={{ ...styles.td, textAlign: 'center' }}><span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600, background: '#F0FDF4', color: '#16A34A' }}>{completed}</span></td>
                            <td style={{ ...styles.td, textAlign: 'center' }}><span style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 600, background: '#FFFBEB', color: '#D97706' }}>{inProgress}</span></td>
                            <td style={styles.td}><div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><div style={{ flex: 1, height: '6px', background: theme.cardBorder, borderRadius: '3px', overflow: 'hidden' }}><div style={{ height: '100%', width: `${rate}%`, background: '#10B981', borderRadius: '3px' }} /></div><span style={{ fontSize: '0.8rem', fontWeight: 600, color: theme.textMuted, minWidth: '40px' }}>{rate}%</span></div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div style={styles.chartCard}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem', color: theme.text }}>Orders by Supplier</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={supplierData} layout="vertical" margin={{ right: 60 }}>
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
                    <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={90} />
                    <Tooltip contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', padding: '10px 14px' }} itemStyle={{ color: '#FFFFFF', fontWeight: 500 }} labelStyle={{ color: '#94A3B8', marginBottom: '4px' }} />
                    <Bar dataKey="value" fill="#3B82F6" radius={[0, 6, 6, 0]}>
                      <LabelList dataKey="value" position="right" fill="#94A3B8" fontSize={11} fontWeight={600} formatter={(v) => { const total = supplierData.reduce((s, d) => s + d.value, 0); return `${v} (${Math.round(v / total * 100)}%)`; }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={styles.chartCard}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem', color: theme.text }}>Avg Design Lead Time by Supplier</h3>
                <p style={{ fontSize: '0.75rem', color: theme.textDim, marginBottom: '1rem' }}>Days from Ordered Date to Design Received Date</p>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={(() => {
                    const supplierLeadTimes = {};
                    analyticsData.forEach(o => {
                      if (o.Supplier && o['Ordered date'] && o['Design Received Date']) {
                        const orderedDate = new Date(o['Ordered date']);
                        const designDate = new Date(o['Design Received Date']);
                        if (!isNaN(orderedDate) && !isNaN(designDate)) {
                          const days = Math.round((designDate - orderedDate) / (1000 * 60 * 60 * 24));
                          if (days >= 0) {
                            if (!supplierLeadTimes[o.Supplier]) supplierLeadTimes[o.Supplier] = [];
                            supplierLeadTimes[o.Supplier].push(days);
                          }
                        }
                      }
                    });
                    return Object.entries(supplierLeadTimes)
                      .map(([name, times]) => ({ name, avgDays: Math.round(times.reduce((a, b) => a + b, 0) / times.length), count: times.length }))
                      .sort((a, b) => a.avgDays - b.avgDays);
                  })()} layout="vertical" margin={{ right: 60 }}>
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit=" days" domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
                    <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={90} />
                    <Tooltip
                      contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', padding: '10px 14px' }}
                      itemStyle={{ color: '#FFFFFF', fontWeight: 500 }}
                      labelStyle={{ color: '#94A3B8', marginBottom: '4px' }}
                      formatter={(value, name, props) => [`${value} days (${props.payload.count} orders)`, 'Avg Lead Time']}
                    />
                    <Bar dataKey="avgDays" fill="#10B981" radius={[0, 6, 6, 0]} name="Avg Days">
                      <LabelList dataKey="avgDays" position="right" fill="#64748B" fontSize={11} fontWeight={600} formatter={(v) => `${v}d`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={styles.chartCard}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem', color: theme.text }}>Orders by Die Type</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart><Pie data={typeData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>{typeData.map((entry, idx) => <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />)}</Pie><Tooltip contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', padding: '10px 14px' }} itemStyle={{ color: '#FFFFFF', fontWeight: 500 }} labelStyle={{ color: '#94A3B8', marginBottom: '4px' }} /></PieChart>
                </ResponsiveContainer>
              </div>
              {/* Design Approval Lead Time Charts */}
              <div style={styles.chartCard}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem', color: theme.text }}>Avg Design Approval Lead Time by Supplier</h3>
                <p style={{ fontSize: '0.75rem', color: theme.textDim, marginBottom: '1rem' }}>Days from Design Received to Design Approved</p>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={(() => {
                    const supplierTimes = {};
                    analyticsData.forEach(o => {
                      if (o.Supplier && o['Design Received Date'] && o['Design Approved Date']) {
                        const receivedDate = new Date(o['Design Received Date']);
                        const approvedDate = new Date(o['Design Approved Date']);
                        if (!isNaN(receivedDate) && !isNaN(approvedDate)) {
                          const days = Math.round((approvedDate - receivedDate) / (1000 * 60 * 60 * 24));
                          if (days >= 0) {
                            if (!supplierTimes[o.Supplier]) supplierTimes[o.Supplier] = [];
                            supplierTimes[o.Supplier].push(days);
                          }
                        }
                      }
                    });
                    return Object.entries(supplierTimes)
                      .map(([name, times]) => ({ name, avgDays: Math.round(times.reduce((a, b) => a + b, 0) / times.length), count: times.length }))
                      .sort((a, b) => a.avgDays - b.avgDays);
                  })()} layout="vertical" margin={{ right: 60 }}>
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit=" days" domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
                    <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={90} />
                    <Tooltip
                      contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', padding: '10px 14px' }}
                      formatter={(value, name, props) => [`${value} days (${props.payload.count} orders)`, 'Avg Approval Time']}
                    />
                    <Bar dataKey="avgDays" fill="#8B5CF6" radius={[0, 6, 6, 0]} name="Avg Days">
                      <LabelList dataKey="avgDays" position="right" fill="#64748B" fontSize={11} fontWeight={600} formatter={(v) => `${v}d`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={styles.chartCard}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem', color: theme.text }}>Avg Design Approval Time by Month</h3>
                <p style={{ fontSize: '0.75rem', color: theme.textDim, marginBottom: '1rem' }}>Days from Design Received to Approved</p>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={(() => {
                    const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const monthTimes = {};
                    analyticsData.forEach(o => {
                      if (o.month && o['Design Received Date'] && o['Design Approved Date']) {
                        const receivedDate = new Date(o['Design Received Date']);
                        const approvedDate = new Date(o['Design Approved Date']);
                        if (!isNaN(receivedDate) && !isNaN(approvedDate)) {
                          const days = Math.round((approvedDate - receivedDate) / (1000 * 60 * 60 * 24));
                          if (days >= 0) {
                            if (!monthTimes[o.month]) monthTimes[o.month] = [];
                            monthTimes[o.month].push(days);
                          }
                        }
                      }
                    });
                    return monthOrder
                      .filter(m => monthTimes[m])
                      .map(month => ({ month, avgDays: Math.round(monthTimes[month].reduce((a, b) => a + b, 0) / monthTimes[month].length), count: monthTimes[month].length }));
                  })()} margin={{ top: 20 }}>
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit="d" domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
                    <Tooltip
                      contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', padding: '10px 14px' }}
                      formatter={(value, name, props) => [`${value} days (${props.payload.count} orders)`, 'Avg Days']}
                    />
                    <Bar dataKey="avgDays" fill="#F59E0B" radius={[6, 6, 0, 0]}>
                      <LabelList dataKey="avgDays" position="top" fill="#64748B" fontSize={11} fontWeight={600} formatter={(v) => `${v}d`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={styles.chartCard}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem', color: theme.text }}>Avg Design Approval Time by Plant</h3>
                <p style={{ fontSize: '0.75rem', color: theme.textDim, marginBottom: '1rem' }}>Days from Design Received to Approved</p>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={(() => {
                    const plantTimes = {};
                    analyticsData.forEach(o => {
                      if (o.Plant && o['Design Received Date'] && o['Design Approved Date']) {
                        const receivedDate = new Date(o['Design Received Date']);
                        const approvedDate = new Date(o['Design Approved Date']);
                        if (!isNaN(receivedDate) && !isNaN(approvedDate)) {
                          const days = Math.round((approvedDate - receivedDate) / (1000 * 60 * 60 * 24));
                          if (days >= 0) {
                            if (!plantTimes[o.Plant]) plantTimes[o.Plant] = [];
                            plantTimes[o.Plant].push(days);
                          }
                        }
                      }
                    });
                    return Object.entries(plantTimes)
                      .map(([plant, times]) => ({ plant, avgDays: Math.round(times.reduce((a, b) => a + b, 0) / times.length), count: times.length }))
                      .sort((a, b) => a.avgDays - b.avgDays);
                  })()} margin={{ top: 20 }}>
                    <XAxis dataKey="plant" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit="d" domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
                    <Tooltip
                      contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', padding: '10px 14px' }}
                      formatter={(value, name, props) => [`${value} days (${props.payload.count} orders)`, 'Avg Days']}
                    />
                    <Bar dataKey="avgDays" fill="#EC4899" radius={[6, 6, 0, 0]}>
                      <LabelList dataKey="avgDays" position="top" fill="#64748B" fontSize={11} fontWeight={600} formatter={(v) => `${v}d`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Delivery & Manufacturing Lead Time — computed once, split into two charts */}
              {(() => {
                const supplierDelivery = {};
                const supplierMfg = {};

                sampleFollowups.forEach(sf => {
                  if (!sf.die_received_date || !sf.supplier) return;
                  const receivedDate = new Date(sf.die_received_date);
                  if (isNaN(receivedDate)) return;

                  const order = data.find(o => o['DIE NO'] && sf.profile && o['DIE NO'].trim() === sf.profile.trim());
                  if (!order) return;

                  if (order['Ordered date']) {
                    const orderedDate = new Date(order['Ordered date']);
                    if (!isNaN(orderedDate)) {
                      const days = Math.round((receivedDate - orderedDate) / (1000 * 60 * 60 * 24));
                      if (days >= 0) {
                        if (!supplierDelivery[sf.supplier]) supplierDelivery[sf.supplier] = [];
                        supplierDelivery[sf.supplier].push(days);
                      }
                    }
                  }

                  if (order['Design Approved Date']) {
                    const approvedDate = new Date(order['Design Approved Date']);
                    if (!isNaN(approvedDate)) {
                      const days = Math.round((receivedDate - approvedDate) / (1000 * 60 * 60 * 24));
                      if (days >= 0) {
                        if (!supplierMfg[sf.supplier]) supplierMfg[sf.supplier] = [];
                        supplierMfg[sf.supplier].push(days);
                      }
                    }
                  }
                });

                const deliveryData = Object.entries(supplierDelivery)
                  .map(([name, times]) => ({ name, avgDays: Math.round(times.reduce((a, b) => a + b, 0) / times.length), count: times.length }))
                  .sort((a, b) => a.avgDays - b.avgDays);

                const mfgData = Object.entries(supplierMfg)
                  .map(([name, times]) => ({ name, avgDays: Math.round(times.reduce((a, b) => a + b, 0) / times.length), count: times.length }))
                  .sort((a, b) => a.avgDays - b.avgDays);

                const tooltipStyle = { background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', padding: '10px 14px' };

                return (
                  <>
                    {deliveryData.length > 0 && (
                      <div style={styles.chartCard}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem', color: theme.text }}>
                          Avg Delivery Lead Time by Supplier
                        </h3>
                        <p style={{ fontSize: '0.75rem', color: theme.textDim, marginBottom: '1rem' }}>
                          Days from Die Order Date to Die Received Date
                        </p>
                        <ResponsiveContainer width="100%" height={280}>
                          <BarChart data={deliveryData} layout="vertical" margin={{ right: 60 }}>
                            <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit=" days" domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
                            <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={90} />
                            <Tooltip
                              contentStyle={tooltipStyle}
                              itemStyle={{ color: '#FFFFFF', fontWeight: 500 }}
                              labelStyle={{ color: '#94A3B8', marginBottom: '4px' }}
                              formatter={(value, _, props) => [`${value} days (${props.payload.count} dies)`, 'Avg Delivery Lead Time']}
                            />
                            <Bar dataKey="avgDays" fill="#0EA5E9" radius={[0, 6, 6, 0]}>
                              <LabelList dataKey="avgDays" position="right" fill="#64748B" fontSize={11} fontWeight={600} formatter={(v) => `${v}d`} />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {mfgData.length > 0 && (
                      <div style={styles.chartCard}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem', color: theme.text }}>
                          Avg Manufacturing Lead Time by Supplier
                        </h3>
                        <p style={{ fontSize: '0.75rem', color: theme.textDim, marginBottom: '1rem' }}>
                          Days from Design Approval Date to Die Received Date
                        </p>
                        <ResponsiveContainer width="100%" height={280}>
                          <BarChart data={mfgData} layout="vertical" margin={{ right: 60 }}>
                            <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit=" days" domain={[0, (dataMax) => Math.ceil((dataMax || 0) + Math.max(15, (dataMax || 0) * 0.15))]} />
                            <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={90} />
                            <Tooltip
                              contentStyle={tooltipStyle}
                              itemStyle={{ color: '#FFFFFF', fontWeight: 500 }}
                              labelStyle={{ color: '#94A3B8', marginBottom: '4px' }}
                              formatter={(value, _, props) => [`${value} days (${props.payload.count} dies)`, 'Avg Manufacturing Lead Time']}
                            />
                            <Bar dataKey="avgDays" fill="#F59E0B" radius={[0, 6, 6, 0]}>
                              <LabelList dataKey="avgDays" position="right" fill="#64748B" fontSize={11} fontWeight={600} formatter={(v) => `${v}d`} />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </>
                );
              })()}

            </div>
          )}
          {/* Settings Tab (Admin Only) - Plants and Suppliers Management */}
          {activeTab === 'settings' && user?.role === 'admin' && (
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem', color: theme.text }}>Settings</h2>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1.5rem' }}>
                {/* Plants Section */}
                <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: theme.text }}><Factory size={20} /> Plants</h3>
                    <button onClick={() => setShowAddPlant(true)} style={{ padding: '8px 16px', background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>+ Add Plant</button>
                  </div>
                  <div style={{ background: theme.inputBg, borderRadius: '12px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={{ padding: '12px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg }}>Name</th>
                          <th style={{ padding: '12px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plants.map(plant => (
                          <tr key={plant.id}>
                            <td style={{ padding: '12px', borderTop: `1px solid ${theme.cardBorder}`, fontWeight: 500, color: theme.text }}>{plant.name}</td>
                            <td style={{ padding: '12px', borderTop: `1px solid ${theme.cardBorder}`, textAlign: 'right' }}>
                              <button onClick={async () => { if (window.confirm(`Delete plant "${plant.name}"?`)) { try { await plantsAPI.delete(plant.id); fetchPlants(); } catch (error) { alert('Failed to delete: ' + error.message); } } }} style={{ padding: '4px 10px', background: '#EF4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>Delete</button>
                            </td>
                          </tr>
                        ))}
                        {plants.length === 0 && <tr><td colSpan={2} style={{ padding: '24px', textAlign: 'center', color: theme.textDim }}>No plants configured</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Suppliers Section */}
                <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: theme.text }}><Truck size={20} /> Suppliers</h3>
                    <button onClick={() => setShowAddSupplier(true)} style={{ padding: '8px 16px', background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>+ Add Supplier</button>
                  </div>
                  <div style={{ background: theme.inputBg, borderRadius: '12px', overflow: 'hidden', maxHeight: '400px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={{ padding: '12px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg, position: 'sticky', top: 0 }}>Name</th>
                          <th style={{ padding: '12px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg, position: 'sticky', top: 0 }}>Shipment</th>
                          <th style={{ padding: '12px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg, position: 'sticky', top: 0 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {suppliers.map(supplier => (
                          <tr key={supplier.id}>
                            <td style={{ padding: '12px', borderTop: `1px solid ${theme.cardBorder}`, fontWeight: 500, color: theme.text }}>{supplier.name}</td>
                            <td style={{ padding: '12px', borderTop: `1px solid ${theme.cardBorder}`, textAlign: 'center' }}>
                              <select
                                value={supplier.shipment_mode || 'LAND'}
                                onChange={async (e) => { try { await suppliersAPI.update(supplier.id, { shipment_mode: e.target.value }); fetchSuppliers(); } catch (error) { alert('Failed to update: ' + error.message); } }}
                                style={{ padding: '4px 8px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', cursor: 'pointer' }}
                              >
                                <option value="AIR">AIR</option>
                                <option value="LAND">LAND</option>
                              </select>
                            </td>
                            <td style={{ padding: '12px', borderTop: `1px solid ${theme.cardBorder}`, textAlign: 'right' }}>
                              <button onClick={async () => { if (window.confirm(`Delete supplier "${supplier.name}"?`)) { try { await suppliersAPI.delete(supplier.id); fetchSuppliers(); } catch (error) { alert('Failed to delete: ' + error.message); } } }} style={{ padding: '4px 10px', background: '#EF4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>Delete</button>
                            </td>
                          </tr>
                        ))}
                        {suppliers.length === 0 && <tr><td colSpan={3} style={{ padding: '24px', textAlign: 'center', color: theme.textDim }}>No suppliers configured</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Budget Targets Section - full width */}
              <div style={{ gridColumn: 'span 2', background: theme.cardBg, borderRadius: '16px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}`, marginTop: '0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '10px' }}>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: theme.text }}><TrendingUp size={20} /> Budget Targets</h3>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '0.8rem', color: theme.textDim }}>Year:</span>
                      <input
                        type="number"
                        value={budgetYear}
                        onChange={(e) => { setBudgetYear(e.target.value); setBudgetActivePlant(null); }}
                        style={{ width: '80px', padding: '6px 10px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem' }}
                      />
                    </div>
                    <label style={{ padding: '7px 14px', background: 'linear-gradient(135deg, #0EA5E9, #06B6D4)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                      Import CSV
                      <input
                        type="file"
                        accept=".csv"
                        style={{ display: 'none' }}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const text = await file.text();
                          const result = Papa.parse(text, { header: true, skipEmptyLines: true });
                          const rows = (result.data || []).map(row => ({
                            plant_name: (row.Plant || row.plant || '').trim(),
                            year: parseInt(row.Year || row.year, 10),
                            type: (row.Type || row.type || '').toLowerCase().trim(),
                            values: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map(m => parseInt(row[m] || row[m.toLowerCase()]) || 0),
                          })).filter(r => r.plant_name && r.year && ['backup','new'].includes(r.type));
                          if (rows.length === 0) { alert('No valid rows found. Check CSV format.'); e.target.value = ''; return; }
                          try {
                            await plantBudgetsAPI.import(rows);
                            await fetchPlantBudgets();
                            setToast({ message: `Imported ${rows.length} budget rows`, type: 'success' });
                            setTimeout(() => setToast(null), 3000);
                          } catch (err) {
                            setToast({ message: 'Import failed: ' + err.message, type: 'error' });
                            setTimeout(() => setToast(null), 4000);
                          }
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <button
                      onClick={() => {
                        const header = 'Year,Plant,Type,Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec';
                        const sample = [
                          `${budgetYear},GEX 1,backup,55,56,56,58,58,58,58,54,59,59,58,50`,
                          `${budgetYear},GEX 1,new,35,35,35,36,36,36,37,34,37,37,37,31`,
                          `${budgetYear},GEX 2,backup,31,31,31,33,32,32,33,30,33,33,33,28`,
                          `${budgetYear},GEX 2,new,13,13,13,14,14,14,14,13,14,14,14,12`,
                        ].join('\n');
                        const blob = new Blob([header + '\n' + sample], { type: 'text/csv' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a'); a.href = url; a.download = `budget_template_${budgetYear}.csv`; a.click(); URL.revokeObjectURL(url);
                      }}
                      style={{ padding: '7px 14px', background: 'transparent', border: `1px solid ${theme.cardBorder}`, color: theme.textMuted, borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem' }}
                    >
                      Download Template
                    </button>
                  </div>
                </div>

                {/* Plant tabs */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                  {uniquePlants.map(plant => {
                    const hasData = !!(plantBudgets[budgetYear]?.[plant]);
                    return (
                      <button
                        key={plant}
                        onClick={() => setBudgetActivePlant(budgetActivePlant === plant ? null : plant)}
                        style={{
                          padding: '8px 18px', borderRadius: '10px', border: 'none', cursor: 'pointer',
                          fontWeight: 600, fontSize: '0.875rem', transition: 'all 0.15s',
                          background: budgetActivePlant === plant ? 'linear-gradient(135deg, #3B82F6, #8B5CF6)' : theme.inputBg,
                          color: budgetActivePlant === plant ? 'white' : theme.textMuted,
                          outline: hasData ? '2px solid #10B981' : 'none',
                          outlineOffset: '2px',
                        }}
                      >
                        {plant} {hasData && <span style={{ fontSize: '0.65rem', marginLeft: '4px' }}>✓</span>}
                      </button>
                    );
                  })}
                  {uniquePlants.length === 0 && <span style={{ fontSize: '0.8rem', color: theme.textDim }}>No plants configured. Add plants above first.</span>}
                </div>

                {/* Editable budget table */}
                {budgetActivePlant && (() => {
                  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                  const backupVals = budgetEdits.backup || Array(12).fill(0);
                  const newVals = budgetEdits.new || Array(12).fill(0);
                  return (
                    <div>
                      <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                          <thead>
                            <tr>
                              <th style={{ padding: '10px 12px', textAlign: 'left', color: theme.textDim, background: theme.tableBg, borderRadius: '8px 0 0 0', minWidth: '110px', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase' }}>Type</th>
                              {months.map(m => (
                                <th key={m} style={{ padding: '10px 6px', textAlign: 'center', color: theme.textDim, background: theme.tableBg, fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', minWidth: '54px' }}>{m}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {[{ key: 'backup', label: 'Backup Dies', color: '#F59E0B', vals: backupVals }, { key: 'new', label: 'New Dies', color: '#3B82F6', vals: newVals }].map(({ key, label, color, vals }) => (
                              <tr key={key}>
                                <td style={{ padding: '10px 12px', fontWeight: 600, color, borderTop: `1px solid ${theme.cardBorder}` }}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '2px', background: color, display: 'inline-block' }} />
                                    {label}
                                  </span>
                                </td>
                                {vals.map((v, mi) => (
                                  <td key={mi} style={{ padding: '6px 4px', borderTop: `1px solid ${theme.cardBorder}`, textAlign: 'center' }}>
                                    <input
                                      type="number"
                                      min="0"
                                      value={v}
                                      onChange={(e) => {
                                        const arr = [...vals];
                                        arr[mi] = parseInt(e.target.value) || 0;
                                        setBudgetEdits(prev => ({ ...prev, [key]: arr }));
                                      }}
                                      style={{
                                        width: '48px', padding: '5px 4px', textAlign: 'center',
                                        background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
                                        borderRadius: '6px', color: theme.text, fontSize: '0.8rem',
                                      }}
                                    />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <button
                          disabled={budgetSaving}
                          onClick={async () => {
                            setBudgetSaving(true);
                            try {
                              await plantBudgetsAPI.save(budgetActivePlant, budgetYear, 'backup', backupVals);
                              await plantBudgetsAPI.save(budgetActivePlant, budgetYear, 'new', newVals);
                              await fetchPlantBudgets();
                              setToast({ message: `Budget saved for ${budgetActivePlant} (${budgetYear})`, type: 'success' });
                              setTimeout(() => setToast(null), 3000);
                            } catch (err) {
                              setToast({ message: 'Save failed: ' + err.message, type: 'error' });
                              setTimeout(() => setToast(null), 4000);
                            } finally {
                              setBudgetSaving(false);
                            }
                          }}
                          style={{ padding: '9px 22px', background: budgetSaving ? theme.cardBorder : 'linear-gradient(135deg, #10B981, #059669)', color: 'white', border: 'none', borderRadius: '8px', cursor: budgetSaving ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.875rem' }}
                        >
                          {budgetSaving ? 'Saving…' : `Save ${budgetActivePlant} Budget`}
                        </button>
                        <span style={{ fontSize: '0.75rem', color: theme.textDim }}>
                          {budgetActivePlant} · {budgetYear}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {!budgetActivePlant && uniquePlants.length > 0 && (
                  <div style={{ padding: '2rem', textAlign: 'center', color: theme.textDim, fontSize: '0.875rem', background: theme.inputBg, borderRadius: '10px' }}>
                    Select a plant above to edit its monthly budget targets
                  </div>
                )}

                <div style={{ marginTop: '1rem', padding: '10px 14px', background: theme.inputBg, borderRadius: '8px', fontSize: '0.75rem', color: theme.textDim, lineHeight: 1.6 }}>
                  <strong style={{ color: theme.textMuted }}>CSV Format:</strong> Year, Plant, Type (backup/new), Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec — one row per plant/type combination.
                </div>
              </div>

              {/* Excel Integration Section - full width */}
              <div style={{ gridColumn: 'span 2', background: theme.cardBg, borderRadius: '16px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: theme.text }}><Download size={20} /> Excel Integration</h3>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                  {/* API Keys Management */}
                  <div>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: theme.textMuted, marginBottom: '0.75rem' }}>API Keys</h4>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem' }}>
                      <input
                        type="text"
                        value={newApiKeyName}
                        onChange={(e) => setNewApiKeyName(e.target.value)}
                        placeholder="Key name (e.g. My Excel)"
                        style={{ flex: 1, padding: '10px 14px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem' }}
                      />
                      <button
                        disabled={apiKeyLoading || !newApiKeyName.trim()}
                        onClick={async () => {
                          setApiKeyLoading(true);
                          try {
                            const response = await apiKeysAPI.create(newApiKeyName.trim());
                            setGeneratedKey(response.rawKey);
                            setNewApiKeyName('');
                            fetchApiKeys();
                            setToast({ message: 'API key created! Copy it now.', type: 'success' });
                            setTimeout(() => setToast(null), 5000);
                          } catch (error) {
                            setToast({ message: 'Failed to create key: ' + error.message, type: 'error' });
                            setTimeout(() => setToast(null), 5000);
                          } finally {
                            setApiKeyLoading(false);
                          }
                        }}
                        style={{ padding: '10px 16px', background: !newApiKeyName.trim() ? theme.cardBorder : 'linear-gradient(135deg, #3B82F6, #8B5CF6)', color: 'white', border: 'none', borderRadius: '8px', cursor: !newApiKeyName.trim() ? 'not-allowed' : 'pointer', fontSize: '0.875rem', fontWeight: 600, opacity: !newApiKeyName.trim() ? 0.5 : 1 }}
                      >
                        + Generate
                      </button>
                    </div>

                    {/* Show generated key */}
                    {generatedKey && (
                      <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                          <CheckCircle size={16} color="#10B981" />
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#10B981' }}>New API Key — copy now, it won't be shown again!</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <code style={{ flex: 1, padding: '8px 12px', background: theme.inputBg, borderRadius: '6px', fontSize: '0.75rem', color: theme.text, wordBreak: 'break-all', fontFamily: 'monospace' }}>{generatedKey}</code>
                          <button
                            onClick={() => { copyToClipboard(generatedKey); setToast({ message: 'Key copied to clipboard!', type: 'success' }); setTimeout(() => setToast(null), 3000); }}
                            style={{ padding: '8px', background: '#10B981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', display: 'flex' }}
                          ><Copy size={16} /></button>
                        </div>
                        <button onClick={() => setGeneratedKey(null)} style={{ marginTop: '8px', padding: '4px 10px', background: 'transparent', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '6px', color: '#10B981', cursor: 'pointer', fontSize: '0.75rem' }}>Dismiss</button>
                      </div>
                    )}

                    {/* List existing keys */}
                    <div style={{ background: theme.inputBg, borderRadius: '12px', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg }}>Name</th>
                            <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg }}>Created</th>
                            <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg }}>Last Used</th>
                            <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {apiKeys.map(k => (
                            <tr key={k.id}>
                              <td style={{ padding: '10px 12px', borderTop: `1px solid ${theme.cardBorder}`, fontWeight: 500, color: theme.text, fontSize: '0.875rem' }}>{k.name}</td>
                              <td style={{ padding: '10px 12px', borderTop: `1px solid ${theme.cardBorder}`, color: theme.textDim, fontSize: '0.8rem' }}>{k.created_at ? new Date(k.created_at).toLocaleDateString() : '—'}</td>
                              <td style={{ padding: '10px 12px', borderTop: `1px solid ${theme.cardBorder}`, color: theme.textDim, fontSize: '0.8rem' }}>{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}</td>
                              <td style={{ padding: '10px 12px', borderTop: `1px solid ${theme.cardBorder}`, textAlign: 'right' }}>
                                <button onClick={async () => { if (window.confirm(`Revoke API key "${k.name}"?`)) { try { await apiKeysAPI.delete(k.id); fetchApiKeys(); setToast({ message: 'API key revoked', type: 'success' }); setTimeout(() => setToast(null), 3000); } catch (error) { alert('Failed to revoke: ' + error.message); } } }} style={{ padding: '4px 10px', background: '#EF4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>Revoke</button>
                              </td>
                            </tr>
                          ))}
                          {apiKeys.length === 0 && <tr><td colSpan={4} style={{ padding: '20px', textAlign: 'center', color: theme.textDim, fontSize: '0.875rem' }}>No API keys generated yet</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Instructions */}
                  <div>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: theme.textMuted, marginBottom: '0.75rem' }}>Connect Excel to Live Data</h4>
                    <div style={{ background: theme.inputBg, borderRadius: '12px', padding: '1.25rem' }}>
                      <ol style={{ margin: 0, paddingLeft: '1.25rem', color: theme.textMuted, fontSize: '0.85rem', lineHeight: 1.8 }}>
                        <li>Generate an API key using the form on the left</li>
                        <li>Open Excel → <b style={{ color: theme.text }}>Data</b> tab → <b style={{ color: theme.text }}>Get Data</b> → <b style={{ color: theme.text }}>From Web</b></li>
                        <li>Paste the URL below (with your API key):</li>
                      </ol>
                      <div style={{ marginTop: '12px', padding: '10px 14px', background: theme.cardBg, borderRadius: '8px', border: `1px solid ${theme.cardBorder}` }}>
                        <code style={{ fontSize: '0.75rem', color: '#3B82F6', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                          {`${window.location.origin}/api/export/orders?key=YOUR_API_KEY&format=csv`}
                        </code>
                      </div>
                      <div style={{ marginTop: '1rem' }}>
                        <h5 style={{ fontSize: '0.8rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px' }}>Optional Parameters</h5>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {[
                            { label: 'format=json', desc: 'JSON output' },
                            { label: 'fields=die_no,status,...', desc: 'Select columns' },
                            { label: 'status=DONE', desc: 'Filter by status' },
                            { label: 'plant=EXT 1', desc: 'Filter by plant' },
                            { label: 'supplier=COMPES', desc: 'Filter by supplier' },
                          ].map(p => (
                            <span key={p.label} title={p.desc} style={{ fontSize: '0.7rem', padding: '4px 8px', background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, color: '#3B82F6', borderRadius: '4px', fontFamily: 'monospace', cursor: 'help' }}>{p.label}</span>
                          ))}
                        </div>
                      </div>
                      <div style={{ marginTop: '1rem' }}>
                        <h5 style={{ fontSize: '0.8rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px' }}>Available Fields</h5>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {['plant', 'order_no', 'die_no', 'type', 'die_size', 'die_requested_date', 'ordered_date', 'shipment_type', 'mandrels_per_cavity', 'total_mandrels', 'design_received_date', 'three_d_model_received_date', 'simulation_enabled', 'design_approved_date', 'delay', 'pr_entry', 'pr_number', 'customer_name', 'oracle_entry', 'supplier', 'status', 'overall_delay', 'eta', 'month', 'die_received_date', 'submission_date', 'sample_approval_date', 'no_of_trial', 'corrector'].map(f => (
                            <span key={f} style={{ fontSize: '0.65rem', padding: '2px 6px', background: theme.cardBg, color: theme.textDim, borderRadius: '3px', fontFamily: 'monospace' }}>{f}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Change Log Section */}
              <div style={{ marginTop: '1.5rem', background: theme.cardBg, borderRadius: '16px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: theme.text, margin: 0 }}>
                    <History size={20} /> Change Log
                  </h3>
                  <span style={{ fontSize: '0.8rem', color: theme.textDim, background: theme.inputBg, padding: '4px 10px', borderRadius: '20px' }}>
                    {allChangeLogs.length} {allChangeLogs.length === 1 ? 'entry' : 'entries'}
                  </span>
                </div>
                <div style={{ background: theme.inputBg, borderRadius: '12px', overflow: 'hidden', maxHeight: '520px', overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['Date', 'Time', 'Die No', 'Order No', 'Changed By', 'Field', 'Change', 'Reason'].map(h => (
                          <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg, position: 'sticky', top: 0, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {allChangeLogs.length === 0 ? (
                        <tr><td colSpan={8} style={{ padding: '2.5rem', textAlign: 'center', color: theme.textDim, fontSize: '0.875rem' }}>No changes recorded yet</td></tr>
                      ) : allChangeLogs.map((entry, idx) => (
                        <tr key={idx} style={{ background: idx % 2 === 0 ? 'transparent' : `${theme.tableBg}55` }}>
                          <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.8rem', color: theme.textDim, whiteSpace: 'nowrap' }}>{entry.date || '—'}</td>
                          <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.8rem', color: theme.textDim, whiteSpace: 'nowrap' }}>{entry.time || '—'}</td>
                          <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.8rem', fontWeight: 600, color: theme.text, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{entry.dieNo || '—'}</td>
                          <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.8rem', color: theme.textDim, whiteSpace: 'nowrap' }}>{entry.orderNo || '—'}</td>
                          <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.8rem', color: '#3B82F6', fontWeight: 500, whiteSpace: 'nowrap' }}>{entry.changedBy || '—'}</td>
                          <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.8rem', color: theme.textDim, whiteSpace: 'nowrap' }}>
                            <span style={{ padding: '2px 8px', borderRadius: '4px', background: entry.field === 'STATUS' ? 'rgba(139,92,246,0.15)' : 'rgba(59,130,246,0.1)', color: entry.field === 'STATUS' ? '#8B5CF6' : '#3B82F6', fontSize: '0.75rem', fontWeight: 600 }}>{entry.field}</span>
                          </td>
                          <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                            <span style={{ color: '#EF4444', textDecoration: 'line-through', fontFamily: 'monospace' }}>{entry.oldValue ?? '—'}</span>
                            <span style={{ color: theme.textDim, margin: '0 6px' }}>→</span>
                            <span style={{ color: '#10B981', fontWeight: 600, fontFamily: 'monospace' }}>{entry.newValue ?? '—'}</span>
                          </td>
                          <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.8rem', color: theme.textDim, maxWidth: '220px' }}>
                            {entry.reason ? (
                              <span title={entry.reason} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.reason}</span>
                            ) : <span style={{ color: theme.cardBorder }}>—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Add Plant Modal */}
              {showAddPlant && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowAddPlant(false)}>
                  <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '2rem', width: '400px', border: `1px solid ${theme.cardBorder}` }} onClick={e => e.stopPropagation()}>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem', color: theme.text }}>Add New Plant</h3>
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.875rem', color: theme.textMuted, marginBottom: '0.5rem' }}>Plant Name</label>
                      <input type="text" value={newPlantName} onChange={(e) => setNewPlantName(e.target.value)} style={{ width: '100%', padding: '12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text }} placeholder="Enter plant name (e.g., EXT 3)" />
                    </div>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                      <button onClick={() => { setShowAddPlant(false); setNewPlantName(''); }} style={{ padding: '10px 20px', background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, cursor: 'pointer' }}>Cancel</button>
                      <button onClick={async () => { if (!newPlantName.trim()) { alert('Plant name is required'); return; } try { await plantsAPI.create(newPlantName); fetchPlants(); setShowAddPlant(false); setNewPlantName(''); } catch (error) { alert('Failed to create: ' + error.message); } }} style={{ padding: '10px 20px', background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Add Plant</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Add Supplier Modal */}
              {showAddSupplier && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowAddSupplier(false)}>
                  <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '2rem', width: '400px', border: `1px solid ${theme.cardBorder}` }} onClick={e => e.stopPropagation()}>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem', color: theme.text }}>Add New Supplier</h3>
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.875rem', color: theme.textMuted, marginBottom: '0.5rem' }}>Supplier Name</label>
                      <input type="text" value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} style={{ width: '100%', padding: '12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text }} placeholder="Enter supplier name" />
                    </div>
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.875rem', color: theme.textMuted, marginBottom: '0.5rem' }}>Mode of Shipment</label>
                      <select value={newSupplierShipment} onChange={(e) => setNewSupplierShipment(e.target.value)} style={{ width: '100%', padding: '12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, cursor: 'pointer' }}>
                        <option value="LAND">LAND</option>
                        <option value="AIR">AIR</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                      <button onClick={() => { setShowAddSupplier(false); setNewSupplierName(''); setNewSupplierShipment('LAND'); }} style={{ padding: '10px 20px', background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, cursor: 'pointer' }}>Cancel</button>
                      <button onClick={async () => { if (!newSupplierName.trim()) { alert('Supplier name is required'); return; } try { await suppliersAPI.create(newSupplierName, newSupplierShipment); fetchSuppliers(); setShowAddSupplier(false); setNewSupplierName(''); setNewSupplierShipment('LAND'); } catch (error) { alert('Failed to create: ' + error.message); } }} style={{ padding: '10px 20px', background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Add Supplier</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Users Management Tab (Admin Only) */}
          {activeTab === 'users' && user?.role === 'admin' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: theme.text }}>User Management</h2>
                <button onClick={() => setShowAddUser(true)} style={styles.actionBtn(true)}>Add New User</button>
              </div>
              <div style={styles.tableContainer}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>ID</th>
                      <th style={styles.th}>Username</th>
                      <th style={styles.th}>Role</th>
                      <th style={styles.th}>Page Access</th>
                      <th style={styles.th}>Created At</th>
                      <th style={styles.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td style={styles.td}>{u.id}</td>
                        <td style={{ ...styles.td, fontWeight: 600, color: '#F1F5F9' }}>{u.username}</td>
                        <td style={styles.td}><span style={{ padding: '4px 10px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 600, background: u.role === 'admin' ? '#3B82F620' : '#64748B20', color: u.role === 'admin' ? '#3B82F6' : '#94A3B8' }}>{u.role}</span></td>
                        <td style={styles.td}>
                          {u.role === 'admin' ? (
                            <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 600, background: '#10B98120', color: '#10B981' }}>All Pages</span>
                          ) : !u.page_access ? (
                            <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 600, background: '#10B98120', color: '#10B981' }}>All Pages</span>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {u.page_access.map(pageId => {
                                const page = CONTROLLABLE_PAGES.find(p => p.id === pageId);
                                return page ? (
                                  <span key={pageId} style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 500, background: '#3B82F620', color: '#60A5FA' }}>{page.label}</span>
                                ) : null;
                              })}
                            </div>
                          )}
                        </td>
                        <td style={styles.td}>{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
                        <td style={styles.td}>{u.id !== user.id && <button onClick={() => handleDeleteUser(u.id)} style={{ padding: '6px 12px', background: '#EF4444', color: 'white', border: 'none', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer' }}>Delete</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Add User Modal */}
              {showAddUser && (
                <AddUserModal
                  onClose={() => setShowAddUser(false)}
                  onSubmit={async (userData) => {
                    try {
                      await usersAPI.create(userData.username, userData.password, userData.role, userData.pageAccess);
                      setShowAddUser(false);
                      fetchUsers();
                    } catch (error) {
                      alert(error.message);
                    }
                  }}
                  theme={theme}
                />
              )}
            </div>
          )}
        </main>

        {selectedOrder && <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} theme={theme} suppliers={suppliers} plants={plants} currentUser={user} onUpdate={(updated) => { setData(prev => prev.map(o => o.id === updated.id ? { ...o, ...updated } : o)); setSelectedOrder(null); fetchBackupRequests(); }} />}
        {showImportModal && <ImportModal onClose={() => setShowImportModal(false)} onImport={handleImport} />}
        {showPDFImportModal && <PDFImportModal onClose={() => setShowPDFImportModal(false)} onImportRecords={handlePIImport} existingOrders={data} suppliers={suppliers} />}
        {showPIImportModal && <PIImportModal onClose={() => setShowPIImportModal(false)} onImportRecords={handlePIImport} existingOrders={data} />}
        {showPasswordChangeModal && (
          <PasswordChangeModal
            onClose={() => !forcePasswordChange && setShowPasswordChangeModal(false)}
            onSuccess={handlePasswordChangeSuccess}
            isForced={forcePasswordChange}
          />
        )}
        {revisionOrder && (
          <RevisionModal
            isOpen={!!revisionOrder}
            onClose={() => setRevisionOrder(null)}
            order={revisionOrder}
            onRevision={handleRevision}
            sourceStatus={revisionOrder.STATUS}
            theme={theme}
          />
        )}
        {changelogOrder && (
          <ChangeLogModal
            order={changelogOrder}
            onClose={() => setChangelogOrder(null)}
            theme={theme}
          />
        )}
        {showEmailCompose && (
          <EmailCompose
            onClose={() => setShowEmailCompose(null)}
            onSent={() => {
              setToast({ message: 'Email sent successfully!', type: 'success' });
              setTimeout(() => setToast(null), 3000);
            }}
            theme={theme}
            prefill={showEmailCompose}
          />
        )}

        {/* Toast Notification */}
        {toast && (
          <div style={{
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '16px 24px',
            borderRadius: '12px',
            background: toast.type === 'success' ? 'linear-gradient(135deg, #10B981, #059669)' : 'linear-gradient(135deg, #EF4444, #DC2626)',
            color: 'white',
            fontWeight: 600,
            boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            animation: 'slideDown 0.3s ease-out'
          }}>
            {toast.type === 'success' ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
            {toast.message}
            <button
              onClick={() => setToast(null)}
              style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%', padding: '4px', cursor: 'pointer', display: 'flex' }}
            >
              <X size={16} color="white" />
            </button>
          </div>
        )}
        <style>{`@keyframes slideDown { from { opacity: 0; transform: translateX(-50%) translateY(-20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }`}</style>


      </div>
    </div>
  );
}
