import React, { useState, useMemo, useCallback, useEffect, useId, lazy, Suspense } from 'react';
import { Search, Package, Clock, CheckCircle, AlertTriangle, XCircle, Truck, Factory, TrendingUp, Layers, X, Eye, EyeOff, Upload, FileSpreadsheet, FileText, Settings, User, Bell, Key, Lock, ShieldCheck, Copy, Plus, Snowflake, ClipboardCheck, CornerUpLeft } from 'lucide-react';
import Papa from 'papaparse';

// `xlsx` is ~800 KB and is only reachable from the spreadsheet import and the
// Excel export — both of them user-initiated. Statically imported it sat in the
// main bundle, downloaded before the login screen could paint.
let xlsxPromise = null;
const loadXLSX = () => (xlsxPromise ||= import('xlsx'));

import { authAPI, ordersAPI, usersAPI, suppliersAPI, plantsAPI, backupRequestsAPI, apiKeysAPI, emailAPI, sampleFollowupsAPI, sampleTrialsAPI, plantBudgetsAPI, profilesAPI, pressesAPI, correctorsAPI, extractProfileFromDie, getUser, logout as apiLogout, isLoggedIn as checkLoggedIn } from './api';
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';

import PDFViewer from './components/PDFViewer';
import DialogProvider, { dialogs } from './components/ui/DialogProvider';
import { MissingCustomerPromptModal, RevisionModal, RevisionHistoryModal, ChangeLogModal, SignatureModal } from './components/modals';
import BackupDieRequests from './components/backup/BackupDieRequests';
import EmailCompose from './components/email/EmailCompose';
import EmailInbox from './components/email/EmailInbox';
import EmailSettings from './components/email/EmailSettings';
import { CONTROLLABLE_PAGES, STATUS_CONFIG, APP_NAME, pageTitle } from './utils/constants';
import { parseDateDMY, formatDate } from './utils/helpers';
import { toExcelDate } from './utils/exportExcel';
import usePIImport from './hooks/usePIImport';

import FlowPage from './pages/FlowPage';
import SampleFollowupPage from './pages/SampleFollowupPage';
import SettingsPage from './pages/SettingsPage';
import UsersPage from './pages/UsersPage';
import OrdersPage from './pages/OrdersPage';
import FrozenDesignsPage from './pages/FrozenDesignsPage';
import QDTrackerPage from './pages/QDTrackerPage';
import FrozenDesignBanner from './components/FrozenDesignBanner';
import useQdQueue from './hooks/useQdQueue';
import FreezeDesignModal from './components/FreezeDesignModal';

// Split out of the main bundle. Between them these three pull in pdfjs-dist,
// the PDF text extractor and recharts — roughly a quarter of the download —
// and none of it is needed to show the login screen or the register. They load
// the first time someone actually opens them.
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
// Dashboard is the landing tab, but it is still behind the login screen — and
// it is the only other thing pulling in recharts.
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const PDFImportModal = lazy(() => import('./components/modals/PDFImportModal'));
const PIImportModal = lazy(() => import('./components/modals/PIImportModal'));

// Shown while a split chunk is in flight. Deliberately quiet: on a LAN these
// arrive in well under a second, and a spinner that flashes for 200ms reads as
// a glitch rather than as progress.
const ChunkFallback = ({ theme }) => (
  <div role="status" aria-live="polite" style={{ padding: '2rem', color: theme?.textMuted, fontSize: '0.875rem' }}>
    Loading…
  </div>
);
import { dieDesignSignature, dieDesignSignatureText } from './utils/emailSignature';
import { BRAND, BRAND_ALPHA } from './utils/brand';
import { correctorOptions } from './utils/correctorOptions';



// STATUS_CONFIG now lives in utils/constants (imported above). The copy that
// used to sit here had drifted from it — this one knew 'DIE RECEIVED' and the
// shared one did not, so the same order rendered as a cyan pill in the detail
// modal and as raw grey text in the register.


const ERP_PRESS_CODE_MAP = {
  '2': 'B',
  '3': 'C',
  '4': 'D',
  '5': 'E',
  '6': 'F',
  '7': 'P25',
  '8': 'P35',
  '9': 'I',
};

const getERPPressCode = (press) => {
  const raw = (press || '').toString().trim().toUpperCase();
  if (!raw) return '';
  const normalizedPress = raw.replace(/^PRESS\s*/i, '').replace(/^P\s*/, '').trim();
  return ERP_PRESS_CODE_MAP[normalizedPress] || raw.replace(/\s+/g, '');
};

const isSimulationEnabled = (value) => {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') return /^(true|1|yes|ok|required)$/i.test(value.trim());
  return false;
};

const hasDieReceivedDate = (order) => {
  const d = order?.['Die Received Date'];
  return d != null && String(d).trim() !== '';
};

/** Stored/API values: NORMAL | URGENT | TOP_URGENT */
const normalizeOrderUrgency = (raw) => {
  const s = String(raw ?? 'NORMAL').trim().toUpperCase().replace(/\s+/g, '_');
  if (s === 'TOP_URGENT' || s === 'TOPURGENT') return 'TOP_URGENT';
  if (s === 'URGENT') return 'URGENT';
  return 'NORMAL';
};

const coerceImportedSpecialFollowUp = (raw) => {
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0 || raw == null || raw === '') return false;
  const t = String(raw).trim().toLowerCase();
  return /^(yes|y|true|1)$/i.test(t);
};

/** Show attention strip above die number only for top urgency or flagged follow-up. */
const orderShowsAttentionAboveDieNo = (order) =>
  normalizeOrderUrgency(order?.Urgency) === 'TOP_URGENT' ||
  !!(order?.specialFollowUp === true || order?.specialFollowUp === 1);

const DieAttentionLabels = ({ order, dense }) => {
  if (!orderShowsAttentionAboveDieNo(order)) return null;
  const top = normalizeOrderUrgency(order.Urgency) === 'TOP_URGENT';
  const spec = !!(order.specialFollowUp === true || order.specialFollowUp === 1);
  const chipBase = {
    display: 'inline-block',
    borderRadius: dense ? '4px' : '6px',
    fontWeight: 700,
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
    fontSize: dense ? '0.58rem' : '0.65rem',
    padding: dense ? '2px 5px' : '3px 8px',
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: dense ? 3 : 6, alignItems: 'center', marginBottom: dense ? 2 : 4, lineHeight: 1.2 }}>
      {top && <span style={{ ...chipBase, background: 'rgba(239,68,68,0.22)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.35)' }}>Top urgent</span>}
      {spec && <span style={{ ...chipBase, background: 'rgba(245,158,11,0.18)', color: '#FBBF24', border: '1px solid rgba(245,158,11,0.35)' }}>Special follow-up</span>}
    </div>
  );
};

const URGENCY_FORM_OPTIONS = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'URGENT', label: 'Urgent' },
  { value: 'TOP_URGENT', label: 'Top urgent' },
];

const formatUrgencyForDisplay = (raw) =>
  ({ NORMAL: 'Normal', URGENT: 'Urgent', TOP_URGENT: 'Top urgent' }[normalizeOrderUrgency(raw)] || 'Normal');

/** Spreadsheet imports often set STATUS=DONE while Die Received Date is present; those completes belong in DIE RECEIVED, not the In Manufacturing flow. */
const normalizeManufacturingStatusOnImportRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  const st = String(row.STATUS ?? '').trim().toUpperCase();
  if (st !== 'DONE' || !hasDieReceivedDate(row)) return row;
  return { ...row, STATUS: 'DIE RECEIVED' };
};

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

/** YYYY-MM-DD if value is a real calendar date; ignores placeholders and junk in date columns (common in imports). */
const parseOrderCalendarDate = (raw) => {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const iso = parseExcelDate(raw);
    return iso && !Number.isNaN(Date.parse(iso)) ? iso : null;
  }
  const s0 = String(raw).trim();
  if (!s0) return null;
  const compact = s0.replace(/\s+/g, '');
  if (/^(?:-|—|n\/a|na|none|tbd|\.|\?|_+)$/i.test(compact)) return null;

  if (/^\d+(\.\d+)?$/.test(compact)) {
    const n = Number(compact);
    if (n > 20000 && n < 1000000) {
      const iso = parseExcelDate(n);
      if (iso && !Number.isNaN(Date.parse(iso))) return iso;
    }
  }

  const dmy = parseDateDMY(s0);
  if (dmy) return dmy;

  if (/^\d{4}-\d{2}-\d{2}/.test(s0)) {
    const head = s0.slice(0, 10);
    if (!Number.isNaN(Date.parse(head))) return head;
  }

  const t = Date.parse(s0);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const y = d.getFullYear();
    if (y >= 1990 && y <= 2100) return d.toISOString().slice(0, 10);
  }
  return null;
};

const hasDesignApprovedDate = (order) =>
  parseOrderCalendarDate(order?.['Design Approved Date'] ?? order?.design_approved_date) != null;

const getMonthFromDate = (dateStr) => {
  if (!dateStr) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  try { return months[new Date(dateStr).getMonth()]; } catch { return null; }
};

const getYearFromDate = (dateStr) => {
  if (!dateStr) return null;
  try { const y = new Date(dateStr).getFullYear(); return isNaN(y) ? null : String(y); } catch { return null; }
};

const MONTH_ORDER = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
    'cavity': 'Cavity', 'no of cav': 'Cavity', 'no. of cav': 'Cavity', 'cav': 'Cavity',
    'total mandrels': 'Total Mandrels', 'design received date': 'Design Received Date',
    'design approved date': 'Design Approved Date', 'pr entry': 'PR Entry', 'oracle entry': 'Oracle Entry',
    'overall delay': 'OVERALL DELAY', 'status': 'STATUS', 'plant': 'Plant', 'type': 'TYPE',
    'supplier': 'Supplier', 'eta': 'ETA', 'delay': 'Delay',
    'urgency': 'Urgency',
    'special follow-up': 'specialFollowUp',
    'special follow up': 'specialFollowUp',
    'special_follow_up': 'specialFollowUp',
    'specialfollowup': 'specialFollowUp',
  };
  return mappings[col.toLowerCase().trim()] || col;
};

// Components
// (StatusBadge used to be defined here. It was never rendered in this file —
// the live pill is components/ui/StatusPill, which OrdersPage uses.)

const ProgressPipeline = ({ order }) => {
  // Include 3D Model stage only if simulation is enabled for this order
  const baseStages = ['Ordered date', 'Design Received Date'];
  const simulationStage = isSimulationEnabled(order.simulationEnabled) ? ['3D Model Received Date'] : [];
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
        if (['Delay', 'OVERALL DELAY', 'Mandrels per Cavity', 'Total Mandrels', 'No of Trial', 'Cavity'].includes(normKey)) {
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
      if (normalized.Urgency != null) {
        normalized.Urgency = normalizeOrderUrgency(normalized.Urgency);
      }
      if ('specialFollowUp' in normalized) {
        normalized.specialFollowUp = coerceImportedSpecialFollowUp(normalized.specialFollowUp);
      } else {
        normalized.specialFollowUp = false;
      }
      return normalizeManufacturingStatusOnImportRow(normalized);
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
      reader.onload = async (e) => {
        try {
          const XLSX = await loadXLSX();
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }} onClick={onClose}>
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
          <button onClick={() => { if (preview?.data) { onImport(preview.data); onClose(); } }} disabled={!preview} style={{ padding: '0.75rem 1.5rem', background: preview ? BRAND.navy : '#475569', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: preview ? 'pointer' : 'not-allowed', opacity: preview ? 1 : 0.5 }}>Import {preview?.count || 0} Records</button>
        </div>
      </div>
    </div>
  );
};

// ─── Add Order Modal ───────────────────────────────────────────────────────────
const AddOrderModal = ({ onClose, onAdd, plants = [], suppliers = [], correctors = [], theme = {} }) => {
  const EMPTY_FORM = {
    Plant: '', 'Order No': '', 'DIE NO': '', TYPE: 'N', 'Die Size': '',
    'Die Requested Date': '', 'Ordered date': '', ETA: '',
    Supplier: '', 'Customer Name': '',
    STATUS: 'AWAITING FOR DESIGN', 'Type of shipment': 'AIR',
    Urgency: 'NORMAL', specialFollowUp: false,
    Cavity: '', 'Mandrels per Cavity': '', 'Total Mandrels': '', 'No of Trial': '',
    Press: '', Corrector: '', 'PR Number': '',
    'Ascona Reference': '', 'Sample Status': '', Remark: '',
  };
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [errors, setErrors] = React.useState({});
  const [submitting, setSubmitting] = React.useState(false);
  const [presses, setPresses] = React.useState([]);

  React.useEffect(() => {
    let cancelled = false;
    pressesAPI.getAll()
      .then((rows) => { if (!cancelled) setPresses(rows || []); })
      .catch((err) => console.error('Failed to load presses:', err));
    return () => { cancelled = true; };
  }, []);

  const normalizePlantName = (plant) => (plant || '')
    .toString()
    .trim()
    .toUpperCase()
    .replace(/\b0+(\d+)\b/g, '$1');

  const pressOptions = React.useMemo(() => {
    const selectedPlant = normalizePlantName(form.Plant);
    if (!selectedPlant) return [];
    return presses
      .filter((p) => normalizePlantName(p.plant) === selectedPlant)
      .map((p) => ({ value: p.press_name, label: `${p.press_name} (${p.press_code})` }));
  }, [presses, form.Plant]);

  const set = (field, val) => setForm(prev => {
    const next = { ...prev, [field]: val };
    if (field === 'Plant') {
      const stillValid = presses.some(
        (p) => p.press_name === prev.Press && normalizePlantName(p.plant) === normalizePlantName(val)
      );
      if (!stillValid) next.Press = '';
    }
    return next;
  });

  const validate = () => {
    const e = {};
    if (!form['DIE NO'].trim()) e['DIE NO'] = 'Required';
    if (!form.Plant) e.Plant = 'Required';
    if (!form['Die Requested Date']) e['Die Requested Date'] = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      await onAdd({
        ...form,
        month: getMonthFromDate(form['Die Requested Date']),
        Cavity: Number(form.Cavity) || 0,
        'Mandrels per Cavity': Number(form['Mandrels per Cavity']) || 0,
        'Total Mandrels': Number(form['Total Mandrels']) || 0,
        'No of Trial': Number(form['No of Trial']) || 0,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const bg = theme.cardBg || '#1E293B';
  const border = theme.cardBorder || '#334155';
  const textColor = theme.text || '#F1F5F9';
  const textMuted = theme.textMuted || '#94A3B8';
  const inputBg = theme.inputBg || '#0F172A';

  const inputStyle = (hasError = false) => ({
    width: '100%', padding: '9px 12px',
    background: inputBg, border: `1px solid ${hasError ? '#EF4444' : border}`,
    borderRadius: '8px', color: textColor, fontSize: '0.875rem',
    outline: 'none', boxSizing: 'border-box',
  });

  const labelStyle = {
    display: 'block', fontSize: '0.7rem', fontWeight: 600,
    color: textMuted, textTransform: 'uppercase', letterSpacing: '0.06em',
    marginBottom: '5px',
  };

  const sectionStyle = {
    background: inputBg, borderRadius: '10px', padding: '1rem',
    marginBottom: '0.875rem', border: `1px solid ${border}`,
  };

  const sectionTitle = {
    fontSize: '0.65rem', fontWeight: 700, color: textMuted,
    textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem',
    margin: '0 0 0.75rem 0',
  };

  const gridStyle = (cols) => ({
    display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '10px',
  });

  const renderField = ({ label, field, type = 'text', options, required, span, disabled, placeholder }) => (
    <div key={field} style={span ? { gridColumn: `span ${span}` } : {}}>
      {/* `field` is the form's own unique key, so it doubles as a stable id and
          ties this generated label to whichever control the branch below renders. */}
      <label htmlFor={`addorder-${field}`} style={labelStyle}>{label}{required && <span style={{ color: '#EF4444' }}> *</span>}</label>
      {type === 'select' ? (
        <select
          id={`addorder-${field}`}
          value={form[field]}
          onChange={e => set(field, e.target.value)}
          disabled={disabled}
          style={{ ...inputStyle(!!errors[field]), cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.65 : 1 }}
        >
          <option value="">{placeholder || '— select —'}</option>
          {(options || []).map(o =>
            typeof o === 'string'
              ? <option key={o} value={o}>{o}</option>
              : <option key={o.value} value={o.value}>{o.label}</option>
          )}
        </select>
      ) : (
        <input id={`addorder-${field}`} type={type} value={form[field]} onChange={e => set(field, e.target.value)} style={inputStyle(!!errors[field])} />
      )}
      {errors[field] && <span style={{ fontSize: '0.68rem', color: '#EF4444', marginTop: '3px', display: 'block' }}>{errors[field]}</span>}
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }} onClick={onClose}>
      <div style={{ background: bg, borderRadius: '20px', width: '100%', maxWidth: '720px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', border: `1px solid ${border}`, boxShadow: '0 25px 60px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem 1.5rem', borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: BRAND.navy, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Plus size={22} color="white" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: textColor, margin: 0 }}>New Die Order</h2>
              <p style={{ fontSize: '0.8rem', color: textMuted, margin: 0 }}>Manually create a new order entry</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: textMuted, cursor: 'pointer', padding: '8px', borderRadius: '8px' }}><X size={20} /></button>
        </div>

        {/* Scrollable Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '1.25rem 1.5rem' }}>

          <div style={sectionStyle}>
            <p style={sectionTitle}>Core Information</p>
            <div style={gridStyle(3)}>
              {renderField({ label: 'Plant', field: 'Plant', type: 'select', required: true, options: plants.map(p => p.name) })}
              {renderField({ label: 'Order No', field: 'Order No' })}
              {renderField({ label: 'Die No', field: 'DIE NO', required: true })}
              {renderField({ label: 'Type', field: 'TYPE', type: 'select', options: [{ value: 'N', label: 'N — New' }, { value: 'B', label: 'B — Backup' }, { value: 'T', label: 'T — Tooling' }] })}
              {renderField({ label: 'Die Size', field: 'Die Size', span: 2 })}
            </div>
          </div>

          <div style={sectionStyle}>
            <p style={sectionTitle}>Supplier & Customer</p>
            <div style={gridStyle(2)}>
              {renderField({ label: 'Supplier', field: 'Supplier', type: 'select', options: suppliers.map(s => s.name) })}
              {renderField({ label: 'Customer Name', field: 'Customer Name' })}
            </div>
          </div>

          <div style={sectionStyle}>
            <p style={sectionTitle}>Dates</p>
            <div style={gridStyle(3)}>
              {renderField({ label: 'Die Requested Date', field: 'Die Requested Date', type: 'date', required: true })}
              {renderField({ label: 'Ordered Date', field: 'Ordered date', type: 'date' })}
              {renderField({ label: 'ETA', field: 'ETA', type: 'date' })}
            </div>
          </div>

          <div style={sectionStyle}>
            <p style={sectionTitle}>Status & Shipping</p>
            <div style={gridStyle(2)}>
              {renderField({ label: 'Status', field: 'STATUS', type: 'select', options: Object.entries(STATUS_CONFIG).map(([v, c]) => ({ value: v, label: c.label || v })) })}
              {renderField({ label: 'Shipment Type', field: 'Type of shipment', type: 'select', options: ['AIR', 'LAND'] })}
            </div>
          </div>

          <div style={sectionStyle}>
            <p style={sectionTitle}>Priority</p>
            <div style={gridStyle(2)}>
              {renderField({ label: 'Urgency level', field: 'Urgency', type: 'select', options: URGENCY_FORM_OPTIONS })}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px', cursor: 'pointer', color: textColor, fontSize: '0.875rem', fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={!!form.specialFollowUp}
                onChange={(e) => set('specialFollowUp', e.target.checked)}
                style={{ width: '18px', height: '18px', accentColor: '#F59E0B', cursor: 'pointer' }}
              />
              Special follow-up
            </label>
          </div>

          <div style={sectionStyle}>
            <p style={sectionTitle}>Technical Details</p>
            <div style={gridStyle(3)}>
              {renderField({ label: 'Cavity', field: 'Cavity', type: 'number' })}
              {renderField({ label: 'Mandrels / Cavity', field: 'Mandrels per Cavity', type: 'number' })}
              {renderField({ label: 'Total Mandrels', field: 'Total Mandrels', type: 'number' })}
              {renderField({ label: 'No. of Trials', field: 'No of Trial', type: 'number' })}
              {renderField({ label: 'Press', field: 'Press', type: 'select', options: pressOptions, disabled: !form.Plant, placeholder: form.Plant ? 'Select Press' : 'Select Plant first' })}
              {renderField({ label: 'Corrector', field: 'Corrector', type: 'select', options: correctorOptions({ correctors, plant: form.Plant, value: form.Corrector }), placeholder: '— select corrector —' })}
              {renderField({ label: 'PR Number', field: 'PR Number' })}
            </div>
          </div>

          <div style={sectionStyle}>
            <p style={sectionTitle}>Additional Info</p>
            <div style={{ ...gridStyle(2), marginBottom: '10px' }}>
              {renderField({ label: 'Ascona Reference', field: 'Ascona Reference' })}
              {renderField({ label: 'Sample Status', field: 'Sample Status' })}
            </div>
            <label style={labelStyle} htmlFor="addordermodal-remark">Remark</label>
            <textarea id="addordermodal-remark"
              value={form.Remark}
              onChange={e => set('Remark', e.target.value)}
              rows={3}
              style={{ ...inputStyle(false), resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          <FrozenDesignBanner
            profile={extractProfileFromDie(form['DIE NO'])}
            plant={form.Plant}
            press={form.Press}
            cavity={form.Cavity}
            onRelease={(match) => {
              const today = new Date().toISOString().split('T')[0];
              setForm(prev => ({
                ...prev,
                'Design Received Date': today,
                'Design Approved Date': today,
                STATUS: 'PENDING FOR PR',
                frozenDesignId: match.id,
                frozenDesignAction: 'released',
                frozenDesignOverrideReason: '',
                frozenDesignOverrideNote: '',
              }));
            }}
            onBypass={({ reason, note, match }) => {
              setForm(prev => ({
                ...prev,
                frozenDesignId: match.id,
                frozenDesignAction: 'bypassed',
                frozenDesignOverrideReason: reason,
                frozenDesignOverrideNote: note,
              }));
            }}
          />
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '1rem 1.5rem', borderTop: `1px solid ${border}`, flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '9px 20px', background: 'transparent', color: textColor, border: `1px solid ${border}`, borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '0.875rem' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={submitting} style={{ padding: '9px 24px', background: submitting ? '#475569' : BRAND.navy, color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '8px', opacity: submitting ? 0.7 : 1 }}>
            <Plus size={16} />{submitting ? 'Saving…' : 'Create Order'}
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
// The change-password form renders three of these at once, so the label/input
// pairing has to come from useId rather than a literal — three inputs sharing
// one id would leave two of them nameless to a screen reader.
const PasswordInput = ({ name, label, value, show, onToggle, onChange }) => {
  const fieldId = useId();
  return (
  <div style={{ marginBottom: '1rem' }}>
    <label htmlFor={fieldId} style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: '#94A3B8', marginBottom: '6px' }}>
      {label}
    </label>
    <div style={{ position: 'relative' }}>
      <input
        id={fieldId}
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
};

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
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)',
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
              background: isForced ? 'linear-gradient(135deg, #F59E0B, #EF4444)' : BRAND.navy,
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
              background: loading ? '#475569' : BRAND.navy,
              color: 'white', border: 'none', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
            }}
          >
            {loading ? (
              <>
                <div data-spinner style={{
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
        </form>
      </div>
    </div>
  );
};

// Order Detail Modal with Editing
const OrderDetailModal = ({ order, onClose, onUpdate, theme, suppliers = [], plants = [], correctors = [], currentUser, canEdit = true, onViewRevisions }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedOrder, setEditedOrder] = useState({ ...order });
  const [isSaving, setIsSaving] = useState(false);
  const [viewingFile, setViewingFile] = useState(null); // { file, type, notes, signature }
  const [statusReasonModal, setStatusReasonModal] = useState({ show: false, newStatus: '', oldStatus: '', reason: '' });
  const [pendingStatusLog, setPendingStatusLog] = useState(null);
  const [presses, setPresses] = useState([]);
  const [showFreeze, setShowFreeze] = useState(false);
  const [freezeToast, setFreezeToast] = useState('');

  useEffect(() => {
    let cancelled = false;
    pressesAPI.getAll()
      .then((rows) => { if (!cancelled) setPresses(rows || []); })
      .catch((err) => console.error('Failed to load presses:', err));
    return () => { cancelled = true; };
  }, []);

  const normalizePlantName = (plant) => (plant || '')
    .toString()
    .trim()
    .toUpperCase()
    .replace(/\b0+(\d+)\b/g, '$1');

  const pressOptions = useMemo(() => {
    const selectedPlant = normalizePlantName(editedOrder.Plant);
    if (!selectedPlant) return [];
    return presses
      .filter((p) => normalizePlantName(p.plant) === selectedPlant)
      .map((p) => ({ value: p.press_name, label: `${p.press_name} (${p.press_code})` }));
  }, [presses, editedOrder.Plant]);

  useEffect(() => {
    setEditedOrder({
      ...order,
      Urgency: order.Urgency ?? 'NORMAL',
      specialFollowUp: !!(order.specialFollowUp === true || order.specialFollowUp === 1),
    });
    setIsEditing(false);
    setPendingStatusLog(null);
  }, [order.id]);

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
      if (hasDieReceivedDate(orderData)) return 'DIE RECEIVED';
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
      // Clear the selected press if it no longer belongs to the chosen plant
      if (field === 'Plant') {
        const stillValid = presses.some(
          (p) => p.press_name === prev.Press && normalizePlantName(p.plant) === normalizePlantName(value)
        );
        if (!stillValid) updated.Press = '';
      }
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
      // Date columns stored as DATE in the DB. Only include a date field in the
      // PATCH if the user explicitly changed it. If the edited value is null/empty
      // AND the original was also null/empty, skip it — that way another workflow
      // step that set the date after this modal was opened won't be overwritten.
      const DATE_FIELDS = new Set([
        'Die Requested Date', 'Ordered date', 'Design Received Date',
        '3D Model Received Date', 'Design Approved Date', 'Die Received Date',
        'Submission Date', 'Sample Approval Date', 'Design to EMS Date',
      ]);
      const isEmpty = (v) => v === null || v === undefined || v === '';
      const patch = {};
      for (const [field, value] of Object.entries(editedOrder)) {
        if (DATE_FIELDS.has(field) && isEmpty(value)) {
          // Only include a null/empty date if the user explicitly cleared a previously-set date
          if (!isEmpty(order[field])) patch[field] = value;
        } else {
          patch[field] = value;
        }
      }
      if (pendingStatusLog) patch['Change Log'] = [pendingStatusLog];

      await ordersAPI.patch(order.id, patch);
      const updatedOrder = {
        ...order,
        ...editedOrder,
        'Change Log': pendingStatusLog ? [pendingStatusLog] : [],
        changeCount: (order.changeCount || 0) + (pendingStatusLog ? 1 : 0),
      };
      if (onUpdate) onUpdate(updatedOrder);
      setIsEditing(false);
      setPendingStatusLog(null);
    } catch (error) {
      dialogs.notify('Failed to save: ' + error.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedOrder({
      ...order,
      Urgency: order.Urgency ?? 'NORMAL',
      specialFollowUp: !!(order.specialFollowUp === true || order.specialFollowUp === 1),
    });
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

  const InfoRow = ({ label, field, value, type = 'text', options = null, disabled = false, placeholder = '—' }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${theme?.cardBorder || '#334155'}` }}>
      <span style={{ fontSize: '0.8rem', color: theme?.textDim || '#64748B', minWidth: '80px' }}>{label}</span>
      {isEditing ? (
        type === 'select' && options ? (
          <select
            aria-label={label}
            style={{ ...selectStyle, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.65 : 1 }}
            value={editedOrder[field] || ''}
            onChange={(e) => handleFieldChange(field, e.target.value)}
            disabled={disabled}
          >
            <option value="">{placeholder}</option>
            {options.map(opt =>
              typeof opt === 'string'
                ? <option key={opt} value={opt}>{opt}</option>
                : <option key={opt.value} value={opt.value}>{opt.label}</option>
            )}
          </select>
        ) : type === 'date' ? (
          <input
            aria-label={label}
            type="date"
            style={dateInputStyle}
            value={editedOrder[field] ? String(editedOrder[field]).split('T')[0] : ''}
            onChange={(e) => handleFieldChange(field, e.target.value)}
            onClick={(e) => e.target.showPicker && e.target.showPicker()}
          />
        ) : (
          <input aria-label={label} type="text" style={inputStyle} value={editedOrder[field] || ''} onChange={(e) => handleFieldChange(field, e.target.value)} />
        )
      ) : (
        <span style={{ fontSize: '0.875rem', fontWeight: 500, color: theme?.text || '#F1F5F9' }}>{type === 'date' ? formatDate(value) : (value || '—')}</span>
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
    <div className="drawer-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'flex-end', alignItems: 'stretch', zIndex: 1000, padding: '12px' }} onClick={onClose}>
      <div className="drawer-panel" style={{ background: theme?.cardBg || '#1E293B', borderRadius: '16px', width: '100%', maxWidth: '640px', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: `1px solid ${theme?.cardBorder || '#334155'}`, boxShadow: '-24px 0 64px rgba(0,0,0,0.35)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem 1.5rem', borderBottom: `1px solid ${theme?.cardBorder || '#334155'}`, background: `${config.color}10`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: config.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><StatusIcon size={22} color="white" /></div>
            <div>
              <DieAttentionLabels order={currentOrder} dense={false} />
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: theme?.text || '#F1F5F9', margin: 0 }}>{currentOrder['DIE NO']}</h2>
              <p style={{ color: theme?.textDim || '#64748B', margin: '2px 0 0 0', fontSize: '0.85rem' }}>Order #{currentOrder['Order No']}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: theme?.textDim || '#64748B', cursor: 'pointer', padding: '8px', borderRadius: '8px' }}><X size={22} /></button>
        </div>
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme?.textDim || '#64748B', marginBottom: '12px' }}>Progress</h3>
            <ProgressPipeline order={currentOrder} />
            {isEditing && <p style={{ fontSize: '0.7rem', color: theme?.textDim || '#64748B', marginTop: '8px', fontStyle: 'italic' }}>Fill in date fields below to update progress</p>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            <div style={{ background: theme?.inputBg || '#0F172A', borderRadius: '12px', padding: '1rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme?.textDim || '#64748B', marginBottom: '12px' }}>Order Details</h3>
              {InfoRow({ label: 'Plant', field: 'Plant', value: currentOrder.Plant, type: 'select', options: plants.map(p => p.name) })}
              {InfoRow({ label: 'Type', field: 'TYPE', value: currentOrder.TYPE, type: 'select', options: typeOptions })}
              {InfoRow({ label: 'Die Size', field: 'Die Size', value: currentOrder['Die Size'] })}
              {InfoRow({ label: 'Cavity', field: 'Cavity', value: currentOrder['Cavity'] || 0 })}
              {InfoRow({ label: 'Mandrels/Cav', field: 'Mandrels per Cavity', value: currentOrder['Mandrels per Cavity'] || 0 })}
              {InfoRow({ label: 'Total Mandrels', field: 'Total Mandrels', value: currentOrder['Total Mandrels'] || 0 })}
              {InfoRow({ label: 'Shipment', field: 'Type of shipment', value: currentOrder['Type of shipment'], type: 'select', options: shipmentOptions })}
              {InfoRow({ label: 'Supplier', field: 'Supplier', value: currentOrder.Supplier, type: 'select', options: suppliers.map(s => s.name) })}
              {InfoRow({ label: 'Customer', field: 'Customer Name', value: currentOrder['Customer Name'] })}
              {InfoRow({ label: 'PR Number', field: 'PR Number', value: currentOrder['PR Number'] })}
              {InfoRow({ label: 'Press', field: 'Press', value: currentOrder.Press, type: 'select', options: pressOptions, disabled: !editedOrder.Plant, placeholder: editedOrder.Plant ? 'Select Press' : 'Select Plant first' })}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${theme?.cardBorder || '#334155'}` }}>
                <span style={{ fontSize: '0.8rem', color: theme?.textDim || '#64748B', minWidth: '80px' }}>Simulation</span>
                {isEditing ? (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: theme?.text || '#F1F5F9', fontSize: '0.875rem', fontWeight: 500 }}>
                    <input
                      type="checkbox"
                      checked={isSimulationEnabled(editedOrder.simulationEnabled)}
                      onChange={(e) => handleFieldChange('simulationEnabled', e.target.checked)}
                      style={{ width: '18px', height: '18px', accentColor: '#3B82F6', cursor: 'pointer' }}
                    />
                    Required
                  </label>
                ) : (
                  <span style={{ fontSize: '0.875rem', fontWeight: 500, color: theme?.text || '#F1F5F9' }}>{isSimulationEnabled(currentOrder.simulationEnabled) ? 'Yes' : 'No'}</span>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${theme?.cardBorder || '#334155'}` }}>
                <span style={{ fontSize: '0.8rem', color: theme?.textDim || '#64748B', minWidth: '96px' }}>Urgency</span>
                {isEditing ? (
                  <select
                    aria-label="Urgency"
                    style={selectStyle}
                    value={normalizeOrderUrgency(editedOrder.Urgency)}
                    onChange={(e) => handleFieldChange('Urgency', e.target.value)}
                  >
                    {URGENCY_FORM_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <span style={{ fontSize: '0.875rem', fontWeight: 500, color: theme?.text || '#F1F5F9' }}>{formatUrgencyForDisplay(currentOrder.Urgency)}</span>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${theme?.cardBorder || '#334155'}` }}>
                <span style={{ fontSize: '0.8rem', color: theme?.textDim || '#64748B', minWidth: '96px' }}>Special follow-up</span>
                {isEditing ? (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: theme?.text || '#F1F5F9', fontSize: '0.875rem', fontWeight: 500 }}>
                    <input
                      type="checkbox"
                      checked={!!(editedOrder.specialFollowUp === true || editedOrder.specialFollowUp === 1)}
                      onChange={(e) => handleFieldChange('specialFollowUp', e.target.checked)}
                      style={{ width: '18px', height: '18px', accentColor: '#F59E0B', cursor: 'pointer' }}
                    />
                    Flagged
                  </label>
                ) : (
                  <span style={{ fontSize: '0.875rem', fontWeight: 500, color: theme?.text || '#F1F5F9' }}>
                    {(currentOrder.specialFollowUp === true || currentOrder.specialFollowUp === 1) ? 'Yes' : 'No'}
                  </span>
                )}
              </div>
              {InfoRow({ label: 'Status', field: 'STATUS', value: currentOrder.STATUS, type: 'select', options: statusOptions })}
            </div>
            <div style={{ background: theme?.inputBg || '#0F172A', borderRadius: '12px', padding: '1rem' }}>
              <h3 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme?.textDim || '#64748B', marginBottom: '12px' }}>Timeline</h3>
              {InfoRow({ label: 'Requested', field: 'Die Requested Date', value: currentOrder['Die Requested Date'], type: 'date' })}
              {InfoRow({ label: 'Design Received', field: 'Design Received Date', value: currentOrder['Design Received Date'], type: 'date' })}
              {isSimulationEnabled(currentOrder.simulationEnabled) && InfoRow({ label: '3D Model Received', field: '3D Model Received Date', value: currentOrder['3D Model Received Date'], type: 'date' })}
              {InfoRow({ label: 'Design Approved', field: 'Design Approved Date', value: currentOrder['Design Approved Date'], type: 'date' })}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${theme?.cardBorder || '#334155'}` }}>
                <span style={{ fontSize: '0.8rem', color: theme?.textDim || '#64748B', minWidth: '80px' }}>Revisions</span>
                {currentOrder['Design Revision Count'] > 0 ? (
                  <button
                    onClick={() => onViewRevisions && onViewRevisions(currentOrder)}
                    style={{ padding: '4px 12px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 600, background: 'rgba(245,158,11,0.2)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.4)', cursor: 'pointer' }}
                    title="View revision history"
                  >
                    {currentOrder['Design Revision Count']} — View history
                  </button>
                ) : (
                  <span style={{ fontSize: '0.875rem', fontWeight: 500, color: theme?.text || '#F1F5F9' }}>None</span>
                )}
              </div>
              {InfoRow({ label: 'PR Entry', field: 'PR Entry', value: currentOrder['PR Entry'], type: 'date' })}
              {InfoRow({ label: 'Oracle Entry', field: 'Oracle Entry', value: currentOrder['Oracle Entry'], type: 'date' })}
              {InfoRow({ label: 'Ordered', field: 'Ordered date', value: currentOrder['Ordered date'], type: 'date' })}
              {InfoRow({ label: 'ETA', field: 'ETA', value: currentOrder.ETA, type: 'date' })}
              {InfoRow({ label: 'Die Received', field: 'Die Received Date', value: currentOrder['Die Received Date'], type: 'date' })}
              {InfoRow({ label: 'Submission', field: 'Submission Date', value: currentOrder['Submission Date'], type: 'date' })}
              {InfoRow({ label: 'Sample Approval', field: 'Sample Approval Date', value: currentOrder['Sample Approval Date'], type: 'date' })}
              {InfoRow({ label: 'No of Trial', field: 'No of Trial', value: currentOrder['No of Trial'] || 0 })}
              {InfoRow({ label: 'Corrector', field: 'Corrector', value: currentOrder['Corrector'], type: 'select', options: correctorOptions({ correctors, plant: currentOrder.Plant, value: editedOrder['Corrector'] }), placeholder: '— select corrector —' })}
            </div>
          </div>

          {/* Attachments Section */}
          <div style={{ marginTop: '1rem', background: theme?.inputBg || '#0F172A', borderRadius: '12px', padding: '1rem' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme?.textDim || '#64748B', marginBottom: '12px' }}>Attachments</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
              {FileRow({ label: 'Die Order Form', field: 'dieOrderFile', value: editedOrder.dieOrderFile, notesField: 'dieOrderFileNotes', signatureField: 'dieOrderFileSignature' })}
              {FileRow({ label: 'Die Design PDF', field: 'designFile', value: editedOrder.designFile, notesField: 'designFileNotes', signatureField: 'designFileSignature' })}
            </div>
          </div>

          {(currentOrder.Delay > 0 || currentOrder['OVERALL DELAY'] > 0) && (<div style={{ background: 'rgba(244,63,94,0.1)', borderRadius: '12px', padding: '1rem', marginTop: '1rem' }}><h3 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: '#F43F5E', marginBottom: '12px' }}>Delays</h3><div style={{ display: 'flex', gap: '2rem' }}><div><span style={{ fontSize: '0.8rem', color: '#F43F5E', opacity: 0.8 }}>Design</span><span style={{ display: 'block', fontSize: '1.5rem', fontWeight: 700, color: '#F43F5E' }}>{currentOrder.Delay || 0}d</span></div><div><span style={{ fontSize: '0.8rem', color: '#F43F5E', opacity: 0.8 }}>Overall</span><span style={{ display: 'block', fontSize: '1.5rem', fontWeight: 700, color: '#F43F5E' }}>{currentOrder['OVERALL DELAY'] || 0}d</span></div></div></div>)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '1rem 1.5rem', borderTop: `1px solid ${theme?.cardBorder || '#334155'}`, flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '9px 18px', background: 'transparent', color: theme?.textDim || '#64748B', border: `1px solid ${theme?.cardBorder || '#334155'}`, borderRadius: '8px', fontWeight: 500, fontSize: '0.875rem', cursor: 'pointer' }}>Close</button>
          <div style={{ display: 'flex', gap: '8px' }}>
            {!isEditing ? (
              <>
                <button onClick={() => setShowFreeze(true)} style={{ padding: '9px 18px', background: 'transparent', color: '#38BDF8', border: '1px solid #38BDF8', borderRadius: '8px', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Snowflake size={15} /> Freeze / Final Design
                </button>
                {canEdit && <button onClick={() => setIsEditing(true)} style={{ padding: '9px 22px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }}>Edit</button>}
              </>
            ) : (
              <>
                <button onClick={handleCancel} style={{ padding: '9px 18px', background: theme?.cardBg || '#334155', color: theme?.text || '#F1F5F9', border: `1px solid ${theme?.cardBorder || '#334155'}`, borderRadius: '8px', fontWeight: 500, fontSize: '0.875rem', cursor: 'pointer' }}>Cancel</button>
                <button onClick={handleSave} disabled={isSaving} style={{ padding: '9px 22px', background: isSaving ? '#475569' : '#10B981', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '0.875rem', cursor: isSaving ? 'not-allowed' : 'pointer' }}>{isSaving ? 'Saving...' : 'Save'}</button>
              </>
            )}
          </div>
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

      {showFreeze && (
        <FreezeDesignModal
          order={currentOrder}
          theme={theme}
          onClose={() => setShowFreeze(false)}
          onDone={({ filesUploaded }) => {
            setFreezeToast(`Design frozen for ${currentOrder['DIE NO']}${filesUploaded ? ` · ${filesUploaded} file(s) uploaded` : ''}`);
            setTimeout(() => setFreezeToast(''), 4000);
          }}
        />
      )}

      {freezeToast && (
        <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: '#0891B2', color: 'white', padding: '10px 20px', borderRadius: '10px', fontSize: '0.85rem', fontWeight: 600, zIndex: 2100, boxShadow: '0 6px 20px rgba(8,145,178,0.5)' }}>
          {freezeToast}
        </div>
      )}

      {/* Status Change Reason Modal */}
      {statusReasonModal.show && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '1rem' }} onClick={e => e.stopPropagation()}>
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
  const [filters, setFilters] = useState({ plant: 'all', status: 'all', supplier: 'all', type: 'all', month: 'all', year: 'all', customer: 'all', urgency: 'all', specialFollowUp: 'all', dateFrom: '', dateTo: '' });
  const [sortConfig, setSortConfig] = useState({ key: 'Die Requested Date', direction: 'desc' });
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showPDFImportModal, setShowPDFImportModal] = useState(false);
  const [showPIImportModal, setShowPIImportModal] = useState(false);
  const [showAddOrderModal, setShowAddOrderModal] = useState(false);
  const [revisionOrder, setRevisionOrder] = useState(null); // For revision modal
  const [revisionHistoryOrder, setRevisionHistoryOrder] = useState(null); // For revision history modal
  const [changelogOrder, setChangelogOrder] = useState(null); // For changelog modal
  const [currentPage, setCurrentPage] = useState(1);
  const [showCompletedInChart, setShowCompletedInChart] = useState(false);
  const [showCancelledInChart, setShowCancelledInChart] = useState(false);
  // What the user chose. Persisted; never overwritten by the viewport.
  const [sidebarCollapsedPref, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebarCollapsed') === 'true';
    } catch {
      return false;
    }
  });
  // Below 900px the 260px rail leaves roughly 115px of content on a phone and
  // about half a table on a tablet, so the rail collapses to icons whatever the
  // stored preference says. Expanding again on a wide screen restores the
  // preference rather than whatever the narrow layout forced.
  const [viewportNarrow, setViewportNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const onChange = (e) => setViewportNarrow(e.matches);
    mq.addEventListener('change', onChange);
    setViewportNarrow(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const sidebarCollapsed = sidebarCollapsedPref || viewportNarrow;
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

  // Table density (comfortable default — better for plant-floor / shared monitors)
  const [tableDensity, setTableDensity] = useState(() => {
    try {
      return localStorage.getItem('die-ordering-table-density') === 'compact' ? 'compact' : 'comfortable';
    } catch {
      return 'comfortable';
    }
  });

  // Apply density globally via a root attribute the .dt-table CSS reads, and persist it
  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-table-density', tableDensity);
      localStorage.setItem('die-ordering-table-density', tableDensity);
    } catch {
      console.warn('Unable to save table density preference');
    }
  }, [tableDensity]);

  useEffect(() => {
    try {
      // The preference, not the derived value — otherwise opening the app on a
      // phone would persist "collapsed" and the desktop would inherit it.
      localStorage.setItem('sidebarCollapsed', sidebarCollapsedPref ? 'true' : 'false');
    } catch {
      console.warn('Unable to save sidebar preference');
    }
  }, [sidebarCollapsedPref]);

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

  // Name the browser tab after the page. Users keep several of these open at
  // once and every one of them read "die-ordering-app" before this. Declared
  // here rather than beside the sidebar state because the dependency array is
  // evaluated during render, and `isLoggedIn` is not initialised until above.
  useEffect(() => {
    document.title = isLoggedIn ? pageTitle(activeTab) : APP_NAME;
  }, [activeTab, isLoggedIn]);

  const [user, setUser] = useState(getUser());
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginPasswordVisible, setLoginPasswordVisible] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user', pageAccess: null });
  const [editingUser, setEditingUser] = useState(null);
  const [resettingUser, setResettingUser] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierShipment, setNewSupplierShipment] = useState('LAND');
  const [newSupplierRegion, setNewSupplierRegion] = useState('');
  const [newSupplierEmail, setNewSupplierEmail] = useState('');
  const [plants, setPlants] = useState([]);
  // Master list for every Corrector dropdown. Inactive rows are fetched too so
  // a record that stores a deactivated corrector still renders its name.
  const [correctors, setCorrectors] = useState([]);
  // Tracked separately so a failed fetch can be shown as an error rather than
  // as an empty dropdown, which would be indistinguishable from "nobody set up".
  const [correctorsError, setCorrectorsError] = useState(false);
  const [showAddPlant, setShowAddPlant] = useState(false);
  const [newPlantName, setNewPlantName] = useState('');
  const [profileMeta, setProfileMeta] = useState({ count: 0, last_imported: null });
  const [profileImportStatus, setProfileImportStatus] = useState(null); // { type, message } | null
  const [profileImporting, setProfileImporting] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showPasswordChangeModal, setShowPasswordChangeModal] = useState(false);
  // Opened from the user menu: every user needs to manage their own QD-form
  // signature, and the Settings page is behind page access most of them lack.
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [forcePasswordChange, setForcePasswordChange] = useState(false);
  const [toast, setToast] = useState(null); // { message: string, type: 'success' | 'error' }
  const [backupRequests, setBackupRequests] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [newApiKeyName, setNewApiKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState(null);
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [showEmailCompose, setShowEmailCompose] = useState(null); // null or { to, cc, subject, body, orderId }
  const [emailTemplates, setEmailTemplates] = useState([]);
  const [savingTemplateId, setSavingTemplateId] = useState(null);
  const [showSampleFollowupForm, setShowSampleFollowupForm] = useState(false);
  const [editingSampleFollowup, setEditingSampleFollowup] = useState(null);
  const [sampleFollowupForm, setSampleFollowupForm] = useState({
    die: '', plant: '', press: '', supplier: '', customer: '', die_received_date: '',
    ascona_reference: 'No', submission_date: '', sample_approval_date: '',
    delay_days: 0, status: 'Pending', no_of_trial: 0, remark: '', corrector: ''
  });
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

  // Fetch correctors (master list for the Corrector dropdowns and Settings)
  const fetchCorrectors = useCallback(async () => {
    try {
      const response = await correctorsAPI.getAll({ includeInactive: true });
      setCorrectors(response || []);
      setCorrectorsError(false);
    } catch (error) {
      console.error('Failed to fetch correctors:', error);
      setCorrectorsError(true);
    }
  }, []);

  // Fetch profile master metadata (count + last imported)
  const fetchProfileMeta = useCallback(async () => {
    try {
      const response = await profilesAPI.getMeta();
      setProfileMeta({
        count: response?.count || 0,
        last_imported: response?.last_imported || null,
      });
    } catch (error) {
      console.error('Failed to fetch profile meta:', error);
    }
  }, []);

  const {
    handlePIImport,
    missingCustomerPrompt,
    setMissingCustomerPrompt,
  } = usePIImport({
    fetchOrders,
    fetchProfileMeta,
    setCurrentPage,
    setToast,
  });

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

  const fetchEmailTemplates = useCallback(async () => {
    try {
      const response = await emailAPI.getTemplates();
      setEmailTemplates(response.templates || []);
    } catch (error) {
      console.error('Failed to fetch email templates:', error);
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

  // Individual trials, fetched wholesale and grouped by parent on the SF page.
  // A trial hangs off die_orders or sample_followups depending on where its
  // followup came from, so there is no single parent list to page against.
  const [sampleTrials, setSampleTrials] = useState([]);
  const fetchSampleTrials = useCallback(async () => {
    try {
      const response = await sampleTrialsAPI.getAll();
      setSampleTrials(response.sampleTrials || []);
    } catch (error) {
      console.error('Failed to fetch sample trials:', error);
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
        plant: o['Plant'] || '',
        press: o['Press'] || '',
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
      plant: sf.plant || '',
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
      fetchCorrectors();
      fetchBackupRequests();
      fetchSampleFollowups();
      fetchSampleTrials();
      fetchApiKeys();
      fetchPlantBudgets();
      fetchProfileMeta();
      fetchEmailTemplates();

      // Check if password change is required (persisted in localStorage)
      const currentUser = getUser();
      if (currentUser?.passwordMustChange) {
        setForcePasswordChange(true);
        setShowPasswordChangeModal(true);
      }
    }
  }, [isLoggedIn, fetchOrders, fetchUsers, fetchSuppliers, fetchPlants, fetchCorrectors, fetchBackupRequests, fetchSampleFollowups, fetchSampleTrials, fetchPlantBudgets, fetchProfileMeta, fetchEmailTemplates]);

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
      setLoginPasswordVisible(false);

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
      dialogs.notify(error.message, 'error');
    }
  };

  // Delete user handler (admin)
  const handleDeleteUser = async (id) => {
    const ok = await dialogs.confirm({
      title: 'Delete user',
      message: 'This removes the account and its page access. It cannot be undone.',
      confirmLabel: 'Delete user',
    });
    if (!ok) return;
    try {
      await usersAPI.delete(id);
      dialogs.notify('User deleted', 'success');
      fetchUsers();
    } catch (error) {
      dialogs.notify(error.message, 'error');
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

  // Polled only for users who can actually reach the QD Tracker — the endpoint
  // is gated on that page, so anyone else would just collect 403s.
  const qdQueue = useQdQueue(isLoggedIn && hasPageAccess('qd-tracker'));

  // Which QD a notification asked us to open, handed to the QD Tracker once.
  const [focusQdId, setFocusQdId] = useState(null);

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

      // Record the revision on the backend (stores history + increments the counter atomically)
      const result = await ordersAPI.createRevision(orderId, {
        targetStatus,
        notes,
        revisionDate,
        revisionPdf: pdfFile ? pdfFile.name : null,
      });

      const newRevisionCount = result?.revisionNumber ?? (order['Design Revision Count'] || 0) + 1;

      setData(prev => prev.map(o => o.id === orderId ? {
        ...o,
        STATUS: targetStatus,
        'Design Revision Count': newRevisionCount,
        'Last Revision Date': result?.lastRevisionDate || revisionDate,
        changeCount: (o.changeCount || 0) + 1,
      } : o));

      const targetLabel = targetStatus === 'AWAITING FOR DESIGN' ? 'Design' : 'Simulation';
      setToast({
        message: `Revision #${newRevisionCount} requested - sent back to ${targetLabel}`,
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

      await ordersAPI.patch(order.id, { 'Die Size': newDieSize, 'Change Log': [changeLogEntry] });
      setData(prev => prev.map(o => o.id === order.id ? { ...o, 'Die Size': newDieSize, changeCount: (o.changeCount || 0) + 1 } : o));

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

  // Copy order details to clipboard in ERP format: [Press,]Die Number, Dia DxT; CAV n; SF/PH
  const copyForERP = async (order) => {
    const parsed = parseDieSize(order['Die Size']);
    const diameter = parsed.diameter || '';
    const thickness = parsed.thickness || '';
    // CAV is the actual cavity count from the PDF "No OF CAV" field, persisted in `cavity`.
    // Falls back to `_cavity` (preview-only metadata) and finally to 1 for legacy orders.
    const cavities = order['Cavity'] || order['_cavity'] || 1;
    // SF = Solid (T type), PH = Hollow (others)
    const dieType = order.TYPE === 'T' ? 'SF' : 'PH';

    // ERP expects press code, so press names/numbers are mapped first (2 -> B, 7 -> 25, etc.).
    // When Press is missing, the prefix (and its comma) are omitted so we never produce a leading comma.
    const press = getERPPressCode(order['Press']);
    const pressPrefix = press ? `${press},` : '';

    // Format: [B,]30533_201,Dia 355X200; CAV 1; PH
    const erpString = `${pressPrefix}${order['DIE NO']},Dia ${diameter}X${thickness}; CAV ${cavities}; ${dieType}`;

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
      const changeLogEntry = {
        date: new Date().toISOString().split('T')[0],
        field: 'PR Number',
        oldValue: order['PR Number'] || '',
        newValue: prNumber,
        changedBy: user?.username || 'unknown',
        stage: order.STATUS,
      };
      await ordersAPI.patch(order.id, { 'PR Number': prNumber, 'Change Log': [changeLogEntry] });
      setData(prev => prev.map(o => o.id === order.id ? { ...o, 'PR Number': prNumber, changeCount: (o.changeCount || 0) + 1 } : o));
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
      const changeLogEntry = {
        date: new Date().toISOString().split('T')[0],
        field,
        oldValue: order[field] ?? '',
        newValue: value,
        changedBy: user?.username || 'unknown',
        stage: order.STATUS,
      };
      await ordersAPI.patch(order.id, { [field]: value, 'Change Log': [changeLogEntry] });
      setData(prev => prev.map(o => o.id === order.id ? { ...o, [field]: value, changeCount: (o.changeCount || 0) + 1 } : o));
      setToast({ message: `${field} saved`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      console.error(`${field} update error:`, error);
      setToast({ message: `Failed to save ${field}`, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  };

  // Like handleInlineFieldSave but for several fields written together, so a
  // pair that must agree (a date and the status it implies) can never be half
  // saved. Writes one change-log entry per field, matching what the audit trail
  // already records for single edits. Deliberately silent: the caller shows a
  // toast that describes the whole action.
  const handleOrderFieldsSave = async (order, fields) => {
    const changed = Object.entries(fields).filter(([field, value]) => order[field] !== value);
    if (changed.length === 0) return;

    const changeLog = changed.map(([field, value]) => ({
      date: new Date().toISOString().split('T')[0],
      field,
      oldValue: order[field] ?? '',
      newValue: value,
      changedBy: user?.username || 'unknown',
      stage: order.STATUS,
    }));

    const patch = Object.fromEntries(changed);
    await ordersAPI.patch(order.id, { ...patch, 'Change Log': changeLog });
    setData(prev => prev.map(o => (
      o.id === order.id
        ? { ...o, ...patch, changeCount: (o.changeCount || 0) + changed.length }
        : o
    )));
  };

  // Handle mandrels per cavity change - auto-calculates Total Mandrels
  const handleMandrelsChange = async (order, mandrelsPerCavity) => {
    const mpc = parseInt(mandrelsPerCavity, 10) || 0;
    // Prefer the persisted Cavity column; fall back to preview-only _cavity, then 1.
    const cavities = order['Cavity'] || order._cavity || 1;
    const totalMandrels = mpc * cavities;
    if (order['Mandrels per Cavity'] === mpc && order['Total Mandrels'] === totalMandrels) return;
    try {
      const changeLogEntry = {
        date: new Date().toISOString().split('T')[0],
        field: 'Mandrels per Cavity',
        oldValue: order['Mandrels per Cavity'] ?? '',
        newValue: mpc,
        changedBy: user?.username || 'unknown',
        stage: order.STATUS,
      };
      await ordersAPI.patch(order.id, { 'Mandrels per Cavity': mpc, 'Total Mandrels': totalMandrels, 'Change Log': [changeLogEntry] });
      setData(prev => prev.map(o => o.id === order.id ? { ...o, 'Mandrels per Cavity': mpc, 'Total Mandrels': totalMandrels, changeCount: (o.changeCount || 0) + 1 } : o));
      setToast({ message: `Mandrels updated: ${mpc}/cav, ${totalMandrels} total`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      console.error('Mandrels update error:', error);
      setToast({ message: 'Failed to save mandrels', type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  };

  const handleCavityChange = async (order, newCavity, reason) => {
    const oldValue = order['Cavity'] || 0;
    if (oldValue === newCavity) return;
    const changeLogEntry = {
      date: new Date().toISOString().split('T')[0],
      field: 'Cavity',
      oldValue,
      newValue: newCavity,
      changedBy: user?.username || 'unknown',
      stage: order.STATUS,
      reason,
    };
    const totalMandrels = (order['Mandrels per Cavity'] || 0) * newCavity;
    try {
      await ordersAPI.patch(order.id, { 'Cavity': newCavity, 'Total Mandrels': totalMandrels, 'Change Log': [changeLogEntry] });
      setData(prev => prev.map(o => o.id === order.id ? { ...o, 'Cavity': newCavity, 'Total Mandrels': totalMandrels, changeCount: (o.changeCount || 0) + 1 } : o));
      setToast({ message: `Cavity updated: ${oldValue} → ${newCavity}`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      setToast({ message: 'Failed to update cavity: ' + error.message, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  };

  const handleImport = useCallback(async (newData) => {
    try {
      // Save each imported record to the database
      for (const record of newData) {
        await ordersAPI.create(normalizeManufacturingStatusOnImportRow(record));
      }
      // Refresh orders from database
      await fetchOrders();
      setCurrentPage(1);
      dialogs.notify(`Imported ${newData.length} order(s) to the database.`, 'success');
    } catch (error) {
      console.error('Import error:', error);
      dialogs.notify('Failed to import some records: ' + error.message, 'error');
    }
  }, [fetchOrders]);
  const handleAddRecord = useCallback(async (newRecord) => {
    try {
      await ordersAPI.create(newRecord);
      fetchOrders();
      setToast({ message: `Order created: ${newRecord['DIE NO'] || 'New order'}`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      setToast({ message: 'Failed to create order: ' + error.message, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
    setCurrentPage(1);
  }, [fetchOrders]);

  // Handle PI Import with support for updating existing orders
  // Parse a CSV/TSV file: returns [{ profile, customer }, ...]
  const parseProfileFile = useCallback(async (file) => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return [];

    // Detect delimiter (tab, comma, or 2+ spaces)
    const detectDelim = (line) => {
      if (line.includes('\t')) return '\t';
      if (line.includes(',')) return ',';
      return /\s{2,}/;
    };
    const delim = detectDelim(lines[0]);

    // Header detection
    const first = lines[0].split(delim).map(c => c.trim().toLowerCase());
    const hasHeader = first.some(c => c === 'profile' || c === 'customer' || c === 'profile_number' || c === 'customer_name');
    let profileIdx = 0, customerIdx = 1;
    if (hasHeader) {
      profileIdx = first.findIndex(c => c.startsWith('profile'));
      customerIdx = first.findIndex(c => c.startsWith('customer'));
      if (profileIdx === -1) profileIdx = 0;
      if (customerIdx === -1) customerIdx = 1;
    }

    const dataLines = hasHeader ? lines.slice(1) : lines;
    return dataLines.map(line => {
      const cols = line.split(delim).map(c => c.trim());
      return { profile: cols[profileIdx] || '', customer: cols[customerIdx] || '' };
    }).filter(r => r.profile && r.customer);
  }, []);

  const handleProfileImportFile = useCallback(async (file) => {
    if (!file) return;
    setProfileImporting(true);
    setProfileImportStatus(null);
    try {
      const rows = await parseProfileFile(file);
      if (rows.length === 0) {
        setProfileImportStatus({ type: 'error', message: 'No valid rows found in file' });
        return;
      }
      const result = await profilesAPI.importBulk(rows);
      setProfileImportStatus({
        type: 'success',
        message: `Imported ${result.inserted} new, updated ${result.updated}${result.skipped ? `, skipped ${result.skipped}` : ''}`,
      });
      fetchProfileMeta();
    } catch (error) {
      console.error('Profile import failed:', error);
      setProfileImportStatus({ type: 'error', message: 'Import failed: ' + error.message });
    } finally {
      setProfileImporting(false);
    }
  }, [parseProfileFile, fetchProfileMeta]);

  const filteredData = useMemo(() => {
    return data.filter(order => {
      const matchesSearch = !searchTerm || order['DIE NO']?.toLowerCase().includes(searchTerm.toLowerCase()) || order['Order No']?.toString().toLowerCase().includes(searchTerm.toLowerCase()) || order.Supplier?.toLowerCase().includes(searchTerm.toLowerCase());
      const statusMatch = filters.status === 'all'
        || (filters.status === 'pre-approval'
          ? order.STATUS !== 'CANCELLED' && !hasDesignApprovedDate(order)
          : filters.status === 'active'
            ? order.STATUS !== 'CANCELLED' && hasDesignApprovedDate(order) && !hasDieReceivedDate(order)
            : order.STATUS === filters.status);
      const orderYear = getYearFromDate(order['Die Requested Date']);
      const orderDate = parseOrderCalendarDate(order['Die Requested Date']);
      const dateFromMatch = !filters.dateFrom || (orderDate && orderDate >= filters.dateFrom);
      const dateToMatch = !filters.dateTo || (orderDate && orderDate <= filters.dateTo);
      const customerMatch = filters.customer === 'all' || order['Customer Name'] === filters.customer;
      const urgencyMatch = filters.urgency === 'all' || normalizeOrderUrgency(order.Urgency) === filters.urgency;
      const isFlagged = order.specialFollowUp === true || order.specialFollowUp === 1;
      const specialFollowUpMatch = filters.specialFollowUp === 'all'
        || (filters.specialFollowUp === 'yes' ? isFlagged : !isFlagged);
      return matchesSearch && (filters.plant === 'all' || order.Plant === filters.plant) && statusMatch && (filters.supplier === 'all' || order.Supplier === filters.supplier) && (filters.type === 'all' || order.TYPE === filters.type) && (filters.month === 'all' || order.month === filters.month) && (filters.year === 'all' || orderYear === filters.year) && customerMatch && urgencyMatch && specialFollowUpMatch && dateFromMatch && dateToMatch;
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

  const uniquePlants = [...new Set(data.map(o => o.Plant))].filter(Boolean).sort();
  const uniqueStatuses = [...new Set(data.map(o => o.STATUS))].filter(Boolean);
  const uniqueSuppliers = [...new Set(data.map(o => o.Supplier))].filter(Boolean).sort();
  const uniqueTypes = [...new Set(data.map(o => o.TYPE))].filter(Boolean).sort();
  const uniqueMonths = MONTH_ORDER.filter(m => data.some(o => o.month === m));
  const uniqueYears = [...new Set(data.map(o => getYearFromDate(o['Die Requested Date'])))].filter(Boolean).sort((a, b) => Number(b) - Number(a));
  const uniqueCustomers = [...new Set(data.map(o => o['Customer Name']))].filter(Boolean).sort();

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

  const exportData = async () => {
    const exportRows = data.map(order => {
      const receivedDate = dieReceivedDateMap[order['DIE NO']?.trim()];
      const deliveryDays = calcLeadDays(order['Ordered date'], receivedDate);
      const mfgDays = calcLeadDays(order['Design Approved Date'], receivedDate);
      const row = { ...order };
      // Convert any pure date-string fields into real JS Dates so Excel stores
      // them as native date cells (columns are otherwise left untouched).
      Object.keys(row).forEach(key => {
        const d = toExcelDate(row[key]);
        if (d) row[key] = d;
      });
      return {
        ...row,
        'Delivery Lead Time (days)': deliveryDays !== null ? deliveryDays : '',
        'Manufacturing Lead Time (days)': mfgDays !== null ? mfgDays : '',
      };
    });
    const XLSX = await loadXLSX();
    const ws = XLSX.utils.json_to_sheet(exportRows, { cellDates: true });
    // Render every date cell with a readable, sortable date format.
    Object.keys(ws).forEach(addr => {
      if (addr[0] === '!') return;
      const cell = ws[addr];
      if (cell && cell.t === 'd') cell.z = 'dd mmm yyyy';
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Die Orders');
    XLSX.writeFile(wb, 'die_orders_export.xlsx');
  };

  // Theme colors - Shadcn Zinc Aesthetic
  //
  // Surface hierarchy: `bg` is the page, `cardBg` is one step raised from it,
  // `inputBg`/`tableHeaderBg` one step further. Previously all three were the
  // same value in both themes, which left the entire UI resting on a single 1px
  // border. Dark lifts surfaces *lighter* than the page; light tints the page
  // *down* so white cards read against it.
  //
  // Shadows are tuned per theme rather than shared: the old
  // `rgba(0,0,0,0.02)` was mathematically invisible on a #09090b page.
  const theme = isDarkMode ? {
    // Carried on the theme so components that already receive it can resolve
    // theme-dependent values (status pills) without a second prop threaded
    // through every call site.
    isDark: true,
    bg: '#09090b',
    text: '#fafafa',
    textMuted: '#a1a1aa',
    // Was #71717a — 4.12:1 on the page and 3.84:1 on cardBg, under the AA bar
    // at all 175 call sites this token feeds (timestamps, secondary IDs,
    // helper text). Lifted to clear 4.5:1 while staying a step below textMuted,
    // so the three-tier hierarchy survives.
    textDim: '#8b8b94',
    cardBg: '#131316',
    cardBorder: '#27272a',
    inputBg: '#18181b',
    headerBg: '#131316',
    navBg: 'transparent',
    tableBg: 'transparent',
    tableHeaderBg: '#18181b',
    tableHeaderText: '#e4e4e7',
    tableHeaderBorder: '#3f3f46',
    stripeBg: 'rgba(255,255,255,0.025)',
    rowHover: 'rgba(255,255,255,0.06)',
    tooltipBg: '#27272a',
    sidebarBg: '#09090b',
    // Navy is 48% of the brand ratio, so it carries primary actions and the
    // active/accent state. The zinc greys stay as the surface system underneath.
    primary: BRAND.navy,
    primaryText: '#ffffff',
    primaryLight: BRAND_ALPHA.navySoft,
    accent: BRAND.navy,
    shadowSm: '0 1px 2px rgba(0,0,0,0.28)',
    shadowMd: '0 4px 12px rgba(0,0,0,0.34)',
    shadowLg: '0 16px 40px rgba(0,0,0,0.45)',
    focusRing: BRAND.navy,
    focusRingContrast: 'rgba(255,255,255,0.55)',
    overlayBg: 'rgba(0,0,0,0.62)'
  } : {
    isDark: false,
    bg: '#fafafa',
    text: '#09090b',
    // Both secondary tiers moved. textDim was #a1a1aa — 2.46:1 on the page and
    // 2.56:1 on white cards, barely half the AA bar and the worst contrast in
    // the app after the status pills. It could not simply be darkened: the old
    // textMuted (#71717a, 4.83:1) sat so close to the floor that there was no
    // room left underneath it for a legal third tier. So muted moves down to
    // open the gap, and dim lands just above the floor. Measured on all three
    // light surfaces (page #fafafa, card #ffffff, input #f4f4f5): muted
    // 6.52-7.17, dim 4.53-4.98, and the tiers still read as three distinct
    // weights rather than two.
    textMuted: '#57575e',
    textDim: '#6f6f77',
    cardBg: '#ffffff',
    cardBorder: '#e4e4e7',
    inputBg: '#f4f4f5',
    headerBg: '#ffffff',
    navBg: 'transparent',
    tableBg: 'transparent',
    tableHeaderBg: '#f4f4f5',
    tableHeaderText: '#3f3f46',
    tableHeaderBorder: '#d4d4d8',
    stripeBg: 'rgba(0,0,0,0.025)',
    rowHover: 'rgba(0,0,0,0.045)',
    tooltipBg: '#09090b',
    sidebarBg: '#ffffff',
    primary: BRAND.navy,
    primaryText: '#ffffff',
    primaryLight: BRAND_ALPHA.navySoft,
    accent: BRAND.navy,
    shadowSm: '0 1px 2px rgba(0,0,0,0.06)',
    shadowMd: '0 4px 12px rgba(0,0,0,0.09)',
    shadowLg: '0 16px 40px rgba(0,0,0,0.16)',
    focusRing: BRAND.navy,
    focusRingContrast: 'rgba(255,255,255,0.85)',
    overlayBg: 'rgba(9,9,11,0.42)'
  };

  // Hand the focus-ring tones to CSS, which owns :focus-visible (index.css).
  // Inline `outline: 'none'` appears 43 times and beats any selector, so the
  // ring has to live in a stylesheet with !important — which means it needs
  // the theme's colours pushed to it rather than read from it.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--focus-ring', theme.focusRing);
    root.style.setProperty('--focus-ring-contrast', theme.focusRingContrast);
  }, [theme.focusRing, theme.focusRingContrast]);

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
      minWidth: 0, // lets the table's own overflow container scroll instead of stretching this flex item
      // `margin-left` is deliberately NOT transitioned. Animating it relaid out
      // the entire main column — data table included — on every frame for 200ms,
      // and the collapse toggle is most often used precisely when a long table
      // is on screen. The sidebar still animates its own width; only the offset
      // snaps, which reads as the content getting out of the way immediately.
      transition: 'background 0.15s ease'
    },
    topBar: { background: theme.headerBg, borderBottom: `1px solid ${theme.cardBorder}`, padding: '1rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50, transition: 'background 0.15s ease' },
    
    app: { minHeight: '100vh', background: theme.bg, fontFamily: "'Inter', sans-serif", color: theme.text },
    header: { background: theme.headerBg, borderBottom: `1px solid ${theme.cardBorder}`, position: 'sticky', top: 0, zIndex: 100, transition: 'background 0.15s ease' },
    headerContent: { maxWidth: '1800px', margin: '0 auto', padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'nowrap' },
    logoSection: { display: 'flex', alignItems: 'center', gap: '12px' },
    logoIcon: { width: '40px', height: '40px', background: theme.primary, color: theme.primaryText, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    navTabs: { display: 'flex', gap: '4px', background: theme.navBg, padding: '4px', borderRadius: '8px' },
    navTab: (active) => ({ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '8px', fontWeight: 500, fontSize: '0.875rem', color: active ? theme.text : theme.textMuted, background: active ? theme.primaryLight : 'transparent', border: 'none', cursor: 'pointer', transition: 'all 0.15s' }),
    actionBtn: (primary) => ({ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderRadius: '8px', fontWeight: 500, fontSize: '0.875rem', border: primary ? 'none' : `1px solid ${theme.cardBorder}`, cursor: 'pointer', background: primary ? theme.primary : theme.cardBg, color: primary ? theme.primaryText : theme.text, transition: 'all 0.15s ease', boxShadow: theme.shadowSm }),
    main: { maxWidth: '100%', margin: '0 auto', padding: '2rem 1.5rem' },
    kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '2.5rem' },
    kpiCard: { background: theme.cardBg, borderRadius: '8px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}`, boxShadow: theme.shadowSm },
    chartsGrid: { display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '2.5rem' },
    chartCard: { background: theme.cardBg, borderRadius: '8px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}`, boxShadow: theme.shadowSm },
    filterBar: { background: theme.cardBg, borderRadius: '8px', padding: '1.25rem', border: `1px solid ${theme.cardBorder}`, marginBottom: '1.5rem', boxShadow: theme.shadowSm },
    filterRow: { display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' },
    searchBox: { flex: 1, minWidth: '250px', position: 'relative' },
    searchInput: { width: '100%', padding: '10px 16px 10px 40px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem', transition: 'all 0.15s', outline: 'none' },
    filterSelect: { padding: '10px 16px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem', cursor: 'pointer', minWidth: '130px', transition: 'all 0.15s', outline: 'none' },
    tableContainer: { background: theme.cardBg, borderRadius: '8px', border: `1px solid ${theme.cardBorder}`, overflow: 'hidden', boxShadow: theme.shadowSm },
    table: { width: '100%', borderCollapse: 'collapse' },
    th: { padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 500, color: theme.textMuted, background: theme.tableBg, cursor: 'pointer', borderBottom: `1px solid ${theme.cardBorder}` },
    td: { padding: '1rem', borderBottom: `1px solid ${theme.cardBorder}`, fontSize: '0.875rem', color: theme.text },
    pipelineSection: { background: theme.cardBg, borderRadius: '8px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}`, boxShadow: theme.shadowSm },
    pipelineColumns: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' },
    pipelineColumn: (color) => ({ borderRadius: '8px', padding: '1rem', background: isDarkMode ? `${color}10` : `${color}1A`, border: `1px solid ${color}33` }), 
    pipelineItem: { background: theme.cardBg, borderRadius: '6px', padding: '12px', marginBottom: '8px', cursor: 'pointer', border: `1px solid ${theme.cardBorder}`, boxShadow: theme.shadowSm, width: 'calc(100% - 2px)', overflow: 'hidden', transition: 'all 0.15s ease' },
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
            <div style={{
              margin: '0 auto 1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '64px',
              padding: '0 0.25rem',
            }}>
              <img
                src="/company-logo.png"
                alt="Company logo"
                style={{
                  display: 'block',
                  maxHeight: '72px',
                  maxWidth: 'min(260px, 100%)',
                  width: 'auto',
                  height: 'auto',
                  objectFit: 'contain',
                  objectPosition: 'center',
                }}
              />
            </div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, background: 'linear-gradient(135deg, #60A5FA, #A78BFA)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Die Ordering System</h1>
            <p style={{ fontSize: '0.875rem', color: '#64748B', marginTop: '0.5rem' }}>Sign in to continue</p>
          </div>
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', color: '#94A3B8', marginBottom: '0.5rem' }} htmlFor="dieorderingsystem-username">Username</label>
              <input id="dieorderingsystem-username" type="text" value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })} style={{ width: '100%', padding: '12px 16px', background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', color: '#F1F5F9', fontSize: '0.875rem' }} placeholder="Enter username" required />
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', color: '#94A3B8', marginBottom: '0.5rem' }} htmlFor="dieorderingsystem-password">Password</label>
              <div style={{ position: 'relative' }}>
                <input id="dieorderingsystem-password"
                  type={loginPasswordVisible ? 'text' : 'password'}
                  value={loginForm.password}
                  onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '12px 44px 12px 16px',
                    background: '#0F172A',
                    border: '1px solid #334155',
                    borderRadius: '10px',
                    color: '#F1F5F9',
                    fontSize: '0.875rem',
                    boxSizing: 'border-box',
                  }}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setLoginPasswordVisible((v) => !v)}
                  aria-label={loginPasswordVisible ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    padding: 6,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 8,
                    color: '#64748B',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {loginPasswordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            {loginError && <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(244,63,94,0.1)', color: '#F43F5E', padding: '0.75rem 1rem', borderRadius: '10px', marginBottom: '1rem', fontSize: '0.875rem' }}><AlertTriangle size={16} />{loginError}</div>}
            <button type="submit" disabled={loginLoading} style={{ width: '100%', padding: '12px', background: loginLoading ? '#475569' : BRAND.navy, color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, fontSize: '0.875rem', cursor: loginLoading ? 'not-allowed' : 'pointer' }}>{loginLoading ? 'Signing in...' : 'Sign In'}</button>
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

    const totalNotifications = designOverdueOrders.length + pendingOrderingOrders.length + qdQueue.total;

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
      return `Subject: URGENT: Design Pending for ${orders.length} Die Order(s) - ${supplier}\n\nDear ${supplier} Team,\n\nThis is a reminder that the following die order(s) have been awaiting design for more than 48 hours:\n\n${dieList}\n\nPlease provide the design drawings at the earliest to avoid further delays in production.\n${dieDesignSignatureText()}`;
    };

    const generateOrderingEmail = (plant, orders) => {
      const dieList = orders.map(o => `  - ${o['DIE NO']} | Requested: ${o['Die Requested Date']} | Supplier: ${o.Supplier}`).join('\n');
      return `Subject: URGENT: ${orders.length} Die Order(s) Pending Ordering - ${plant}\n\nDear Purchase Team,\n\nThe following die order(s) for ${plant} have been pending ordering for more than 24 hours:\n\n${dieList}\n\nPlease process these orders at the earliest to avoid production delays.\n${dieDesignSignatureText()}`;
    };

    const copyEmail = (type, key, orders) => {
      const emailText = type === 'design' ? generateDesignEmail(key, orders) : generateOrderingEmail(key, orders);
      copyToClipboard(emailText);
      setToast({ message: 'Email copied to clipboard!', type: 'success' });
      setTimeout(() => setToast(null), 3000);
    };

    const sendEmailDirect = (type, key, orders) => {
      const escapeHtml = (value) => (value === null || value === undefined || value === '' ? 'N/A' : value)
        .toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

      const dateLabel = type === 'design' ? 'Order Date' : 'Requested Date';
      const getDateValue = (o) => formatDate(type === 'design' ? o['Ordered date'] : o['Die Requested Date']);

      const tableRows = orders.map((o, index) => `
          <tr>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;text-align:center;">${index + 1}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;font-weight:600;">${escapeHtml(o['DIE NO'])}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;">${escapeHtml(o['Order No'])}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;">${escapeHtml(getDateValue(o))}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;">${escapeHtml(o.Plant)}</td>
          </tr>`).join('');

      const buildTable = () => `
        <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px;color:#0F172A;">
          <thead>
            <tr style="background:#E2E8F0;color:#0F172A;">
              <th scope="col" style="padding:9px 10px;border:1px solid #CBD5E1;text-align:center;">SL No</th>
              <th scope="col" style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">Die Number</th>
              <th scope="col" style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">Order Number</th>
              <th scope="col" style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">${dateLabel}</th>
              <th scope="col" style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">Plant</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>`;

      let subject, body;
      const templateName = type === 'design' ? 'Design Reminder' : 'Ordering Reminder';
      const templateRecipients = emailTemplates.find(template => template.name === templateName) || {};
      // For design reminders, prefer the supplier's configured contact email as the To address
      const supplierContactEmail = type === 'design'
        ? (suppliers.find(s => s.name === key)?.contact_email || '').trim()
        : '';
      if (type === 'design') {
        subject = `URGENT: Design Pending for ${orders.length} Die Order(s) - ${key}`;
        body = `
        <p>Dear ${escapeHtml(key)} Team,</p>
        <p>This is a reminder that the following die order(s) have been awaiting design for more than 48 hours:</p>
        ${buildTable()}
        <p>Please provide the design drawings at the earliest to avoid further delays in production.</p>
        ${dieDesignSignature()}`;
      } else {
        subject = `URGENT: ${orders.length} Die Order(s) Pending Ordering - ${key}`;
        body = `
        <p>Dear Purchase Team,</p>
        <p>The following die order(s) for ${escapeHtml(key)} have been pending ordering for more than 24 hours:</p>
        ${buildTable()}
        <p>Please process these orders at the earliest to avoid production delays.</p>
        ${dieDesignSignature()}`;
      }
      setShowEmailCompose({
        to: supplierContactEmail || templateRecipients.default_to || '',
        cc: templateRecipients.default_cc || '',
        subject,
        body,
        importance: 'high',
        isHtml: true,
      });
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
              {/* QDs this user is the approver for. Unlike the two sections
                  below, these are fetched from the server rather than derived
                  from loaded order data — approval is per-user. */}
              {qdQueue.awaitingApproval.count > 0 && (
                <>
                  <div style={{
                    background: 'rgba(234,179,8,0.1)', borderRadius: '12px',
                    padding: '12px 16px', margin: '8px', marginBottom: '8px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                      <ClipboardCheck size={16} color="#EAB308" />
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#EAB308' }}>
                        QDs awaiting your approval - {qdQueue.awaitingApproval.count}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.7rem', color: theme.textDim, margin: 0 }}>Click one to open it</p>
                  </div>
                  {qdQueue.awaitingApproval.qds.map((q) => (
                    <div key={`qd-approval-${q.id}`} style={{ margin: '4px 8px' }}>
                      <div onClick={() => { setFocusQdId(q.id); setActiveTab('qd-tracker'); setShowNotifications(false); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '12px',
                          padding: '10px 16px', borderRadius: '10px',
                          background: 'transparent', cursor: 'pointer'
                        }}>
                        <div style={{
                          width: '36px', height: '36px', borderRadius: '50%',
                          background: 'linear-gradient(135deg, #EAB308, #F59E0B)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.75rem', fontWeight: 700, color: 'white'
                        }}>{(q.supplier || '??').substring(0, 2)}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: theme.text }}>{q.qd_no || 'Draft'}</div>
                          <div style={{ fontSize: '0.7rem', color: theme.textDim }}>
                            Die {q.die_no} · {q.supplier}{q.prepared_by ? ` · from ${q.prepared_by}` : ''}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* QDs of this user's own that an approver handed back. Separate
                  from the bucket above because it is the opposite obligation:
                  those are waiting on your judgement, these on your rework. */}
              {qdQueue.sentBack.count > 0 && (
                <>
                  <div style={{
                    background: 'rgba(239,68,68,0.1)', borderRadius: '12px',
                    padding: '12px 16px', margin: '8px', marginBottom: '8px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                      <CornerUpLeft size={16} color="#EF4444" />
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#EF4444' }}>
                        Sent back to you - {qdQueue.sentBack.count}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.7rem', color: theme.textDim, margin: 0 }}>Needs rework before it can go again</p>
                  </div>
                  {qdQueue.sentBack.qds.map((q) => (
                    <div key={`qd-sentback-${q.id}`} style={{ margin: '4px 8px' }}>
                      <div onClick={() => { setFocusQdId(q.id); setActiveTab('qd-tracker'); setShowNotifications(false); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '12px',
                          padding: '10px 16px', borderRadius: '10px',
                          background: 'transparent', cursor: 'pointer'
                        }}>
                        <div style={{
                          width: '36px', height: '36px', borderRadius: '50%',
                          background: 'linear-gradient(135deg, #EF4444, #F97316)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.75rem', fontWeight: 700, color: 'white'
                        }}>{(q.supplier || '??').substring(0, 2)}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: theme.text }}>{q.qd_no || 'Draft'}</div>
                          <div style={{ fontSize: '0.7rem', color: theme.textDim }}>
                            Die {q.die_no}{q.sent_back_reason ? ` · ${q.sent_back_reason}` : ''}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}

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
                          background: BRAND.navy,
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
    <DialogProvider theme={theme}>
    <div style={styles.appLayout}>
      {/* First focusable element on the page. Off-screen until focused, then it
          drops into view — the only way to reach the table without tabbing the
          whole nav rail first. */}
      <a href="#main-content" className="skip-link">Skip to main content</a>
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
          tableDensity={tableDensity}
          setTableDensity={setTableDensity}
          setShowPDFImportModal={setShowPDFImportModal}
          setShowPIImportModal={setShowPIImportModal}
          setShowImportModal={setShowImportModal}
          exportData={exportData}
          data={data}
          showNotifications={showNotifications}
          setShowNotifications={setShowNotifications}
          notificationDropdown={notificationDropdown}
          qdQueueCount={qdQueue.total}
          onLogout={handleLogout}
          onChangePassword={() => setShowPasswordChangeModal(true)}
          onManageSignature={() => setShowSignatureModal(true)}
        />

        <main id="main-content" tabIndex={-1} style={styles.main}>


          {activeTab === 'dashboard' && hasPageAccess('dashboard') && (
            <Suspense fallback={<ChunkFallback theme={theme} />}>
              <DashboardPage
                data={data}
                plantBudgets={plantBudgets}
                backupRequests={backupRequests}
                theme={theme}
                isDarkMode={isDarkMode}
                hasPageAccess={hasPageAccess}
                setActiveTab={setActiveTab}
                setSelectedOrder={setSelectedOrder}
                setFilters={setFilters}
              />
            </Suspense>
          )}

          {activeTab === 'orders' && hasPageAccess('orders') && (
            <OrdersPage
              theme={theme} user={user}
              filters={filters} setFilters={setFilters}
              searchTerm={searchTerm} setSearchTerm={setSearchTerm}
              sortConfig={sortConfig} handleSort={handleSort}
              filteredData={filteredData}
              paginatedData={paginatedData}
              currentPage={currentPage} setCurrentPage={setCurrentPage}
              totalPages={totalPages}
              uniquePlants={uniquePlants} uniqueStatuses={uniqueStatuses}
              uniqueSuppliers={uniqueSuppliers} uniqueTypes={uniqueTypes}
              uniqueMonths={uniqueMonths} uniqueYears={uniqueYears}
              uniqueCustomers={uniqueCustomers}
              dieReceivedDateMap={dieReceivedDateMap}
              setSelectedOrder={setSelectedOrder}
              setChangelogOrder={setChangelogOrder}
              setToast={setToast}
              fetchOrders={fetchOrders}
            />
          )}

          {/* Process Flow Pages */}
          {activeTab.startsWith('flow-') && !activeTab.includes('sample-followup') && hasPageAccess(activeTab) && (
            <FlowPage
              data={data} activeTab={activeTab} searchTerm={searchTerm} setSearchTerm={setSearchTerm}
              sortConfig={sortConfig} handleSort={handleSort} suppliers={suppliers} theme={theme}
              correctors={correctors} correctorsError={correctorsError}
              setSelectedOrder={setSelectedOrder} setShowAddOrderModal={setShowAddOrderModal}
              setRevisionOrder={setRevisionOrder} setChangelogOrder={setChangelogOrder}
              setRevisionHistoryOrder={setRevisionHistoryOrder}
              setData={setData} setToast={setToast} setActiveTab={setActiveTab}
              handleInlineFieldSave={handleInlineFieldSave} handleSizeChange={handleSizeChange}
              handleMandrelsChange={handleMandrelsChange} handlePRNumberChange={handlePRNumberChange}
              handleCavityChange={handleCavityChange}
              copyForERP={copyForERP}
            />
          )}

          {/* Sample Followup Page */}
          {activeTab === 'flow-sample-followup' && hasPageAccess('flow-sample-followup') && (
            <SampleFollowupPage
              sampleFollowups={sampleFollowups}
              sfStatusFilter={sfStatusFilter} setSfStatusFilter={setSfStatusFilter}
              sfPlantFilter={sfPlantFilter} setSfPlantFilter={setSfPlantFilter}
              searchTerm={searchTerm} setSearchTerm={setSearchTerm}
              showSampleFollowupForm={showSampleFollowupForm} setShowSampleFollowupForm={setShowSampleFollowupForm}
              editingSampleFollowup={editingSampleFollowup} setEditingSampleFollowup={setEditingSampleFollowup}
              sampleFollowupForm={sampleFollowupForm} setSampleFollowupForm={setSampleFollowupForm}
              sampleFollowupsStandalone={sampleFollowupsStandalone} setSampleFollowupsStandalone={setSampleFollowupsStandalone}
              correctors={correctors} correctorsError={correctorsError}
              user={user}
              theme={theme}
              setToast={setToast}
              handleInlineFieldSave={handleInlineFieldSave}
              handleOrderFieldsSave={handleOrderFieldsSave}
              fetchOrders={fetchOrders}
              fetchSampleFollowups={fetchSampleFollowups}
              sampleTrials={sampleTrials}
              fetchSampleTrials={fetchSampleTrials}
            />
          )}

          {activeTab === 'backup-requests' && hasPageAccess('backup-requests') && (
            <BackupDieRequests
              theme={theme}
              backupRequests={backupRequests}
              onRefresh={fetchBackupRequests}
              plants={plants}
              user={user}
              onCompose={(prefill) => setShowEmailCompose(prefill || {})}
              emailTemplates={emailTemplates}
            />
          )}

          {activeTab === 'frozen-designs' && hasPageAccess('frozen-designs') && (
            <FrozenDesignsPage user={user} theme={theme} />
          )}

          {activeTab === 'qd-tracker' && hasPageAccess('qd-tracker') && (
            <QDTrackerPage
              user={user}
              theme={theme}
              onCompose={(prefill) => setShowEmailCompose(prefill || {})}
              qdQueue={qdQueue}
              focusQdId={focusQdId}
              onFocusHandled={() => setFocusQdId(null)}
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
            <Suspense fallback={<ChunkFallback theme={theme} />}>
              <AnalyticsPage data={data} suppliers={suppliers} theme={theme} />
            </Suspense>
          )}
          {/* Settings Tab (Admin Only) */}
          {activeTab === 'settings' && user?.role === 'admin' && (
            <SettingsPage
              theme={theme} setToast={setToast}
              plants={plants} fetchPlants={fetchPlants}
              suppliers={suppliers} fetchSuppliers={fetchSuppliers}
              correctors={correctors} fetchCorrectors={fetchCorrectors}
              showAddPlant={showAddPlant} setShowAddPlant={setShowAddPlant}
              newPlantName={newPlantName} setNewPlantName={setNewPlantName}
              showAddSupplier={showAddSupplier} setShowAddSupplier={setShowAddSupplier}
              newSupplierName={newSupplierName} setNewSupplierName={setNewSupplierName}
              newSupplierShipment={newSupplierShipment} setNewSupplierShipment={setNewSupplierShipment}
              newSupplierRegion={newSupplierRegion} setNewSupplierRegion={setNewSupplierRegion}
              newSupplierEmail={newSupplierEmail} setNewSupplierEmail={setNewSupplierEmail}
              emailTemplates={emailTemplates} setEmailTemplates={setEmailTemplates}
              savingTemplateId={savingTemplateId} setSavingTemplateId={setSavingTemplateId}
              profileMeta={profileMeta} profileImportStatus={profileImportStatus} setProfileImportStatus={setProfileImportStatus}
              profileImporting={profileImporting} handleProfileImportFile={handleProfileImportFile}
              fetchProfileMeta={fetchProfileMeta}
              budgetYear={budgetYear} setBudgetYear={setBudgetYear}
              budgetActivePlant={budgetActivePlant} setBudgetActivePlant={setBudgetActivePlant}
              budgetEdits={budgetEdits} setBudgetEdits={setBudgetEdits}
              budgetSaving={budgetSaving} setBudgetSaving={setBudgetSaving}
              plantBudgets={plantBudgets} fetchPlantBudgets={fetchPlantBudgets}
              uniquePlants={uniquePlants}
              apiKeys={apiKeys} fetchApiKeys={fetchApiKeys}
              newApiKeyName={newApiKeyName} setNewApiKeyName={setNewApiKeyName}
              generatedKey={generatedKey} setGeneratedKey={setGeneratedKey}
              apiKeyLoading={apiKeyLoading} setApiKeyLoading={setApiKeyLoading}
              copyToClipboard={copyToClipboard} allChangeLogs={allChangeLogs}
            />
          )}

          {/* Users Management Tab (Admin Only) */}
          {activeTab === 'users' && user?.role === 'admin' && (
            <UsersPage
              theme={theme} user={user}
              users={users} fetchUsers={fetchUsers}
              showAddUser={showAddUser} setShowAddUser={setShowAddUser}
              editingUser={editingUser} setEditingUser={setEditingUser}
              resettingUser={resettingUser} setResettingUser={setResettingUser}
              handleDeleteUser={handleDeleteUser}
            />
          )}
        </main>

        {selectedOrder && <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} theme={theme} suppliers={suppliers} plants={plants} correctors={correctors} currentUser={user} canEdit={activeTab === 'orders'} onViewRevisions={(o) => setRevisionHistoryOrder(o)} onUpdate={(updated) => { setData(prev => prev.map(o => o.id === updated.id ? { ...o, ...updated } : o)); setSelectedOrder(null); fetchBackupRequests(); }} />}
        {showImportModal && <ImportModal onClose={() => setShowImportModal(false)} onImport={handleImport} />}
        {showPDFImportModal && (
          <Suspense fallback={<ChunkFallback theme={theme} />}>
            <PDFImportModal onClose={() => setShowPDFImportModal(false)} onImportRecords={handlePIImport} existingOrders={data} suppliers={suppliers} theme={theme} />
          </Suspense>
        )}
        {showPIImportModal && (
          <Suspense fallback={<ChunkFallback theme={theme} />}>
            <PIImportModal onClose={() => setShowPIImportModal(false)} onImportRecords={handlePIImport} existingOrders={data} theme={theme} />
          </Suspense>
        )}
        <MissingCustomerPromptModal prompt={missingCustomerPrompt} setPrompt={setMissingCustomerPrompt} theme={theme} />
        {showPasswordChangeModal && (
          <PasswordChangeModal
            onClose={() => !forcePasswordChange && setShowPasswordChangeModal(false)}
            onSuccess={handlePasswordChangeSuccess}
            isForced={forcePasswordChange}
          />
        )}
        {showSignatureModal && (
          <SignatureModal theme={theme} onClose={() => setShowSignatureModal(false)} />
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
        {revisionHistoryOrder && (
          <RevisionHistoryModal
            order={revisionHistoryOrder}
            onClose={() => setRevisionHistoryOrder(null)}
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
              showEmailCompose?.onSent?.();
              setToast({ message: 'Email sent successfully!', type: 'success' });
              setTimeout(() => setToast(null), 3000);
            }}
            theme={theme}
            prefill={showEmailCompose}
          />
        )}

        {showAddOrderModal && (
          <AddOrderModal
            onClose={() => setShowAddOrderModal(false)}
            onAdd={handleAddRecord}
            plants={plants}
            suppliers={suppliers}
            correctors={correctors}
            theme={theme}
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
    </DialogProvider>
  );
}