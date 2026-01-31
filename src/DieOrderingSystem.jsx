import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, AreaChart, Area } from 'recharts';
import { Search, ChevronDown, ChevronUp, Package, Clock, CheckCircle, AlertTriangle, XCircle, Truck, Plane, Factory, TrendingUp, Layers, ArrowRight, X, Eye, ChevronLeft, ChevronRight, Upload, FileSpreadsheet, Download, FileText, Sun, Moon, Settings, Trash2, BarChart3, GripVertical, Menu, User, LogOut, Bell, Key, Lock, ShieldCheck } from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Configure PDF.js worker (Vite-compatible approach)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

import { authAPI, ordersAPI, usersAPI, suppliersAPI, plantsAPI, getUser, logout as apiLogout, isLoggedIn as checkLoggedIn } from './api';
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';

import PDFViewer from './components/PDFViewer';
import { PIImportModal } from './components/modals';

// ============================================================================
// SAMPLE DATA - Representative samples covering all statuses, types, plants
// ============================================================================
const INITIAL_SAMPLE_DATA = [
  // DONE - various types (B, N, T, C, H), suppliers, plants, shipment methods
  { "Plant": "EXT 1", "Order No": "7613-25", "DIE NO": "INS-25033", "TYPE": "T", "Die Size": "300X100", "Die Requested Date": "2025-01-03", "Ordered date": "2025-01-03", "Type of shipment": "LAND", "Mandrels per Cavity": 0, "Total Mandrels": 0, "Design Received Date": "2025-01-03", "Design Approved Date": "2025-01-03", "Delay": 0, "PR Entry": "2025-01-04", "Oracle Entry": "2025-01-04", "Supplier": "SUPPLIER-1", "STATUS": "DONE", "OVERALL DELAY": 0, "ETA": "2025-01-12", "month": "Jan" },
  { "Plant": "EXT 2", "Order No": "8001-25", "DIE NO": "27562-502", "TYPE": "B", "Die Size": "320X160", "Die Requested Date": "2025-02-05", "Ordered date": "2025-02-05", "Type of shipment": "AIR", "Mandrels per Cavity": 2, "Total Mandrels": 4, "Design Received Date": "2025-02-06", "Design Approved Date": "2025-02-07", "Delay": 1, "PR Entry": "2025-02-08", "Oracle Entry": "2025-02-09", "Supplier": "SUPPLIER-3", "STATUS": "DONE", "OVERALL DELAY": 2, "ETA": "2025-02-20", "month": "Feb" },
  { "Plant": "EXT 1", "Order No": "7620-25", "DIE NO": "29084-301", "TYPE": "N", "Die Size": "355X200", "Die Requested Date": "2025-03-01", "Ordered date": "2025-03-01", "Type of shipment": "AIR", "Mandrels per Cavity": 2, "Total Mandrels": 4, "Design Received Date": "2025-03-03", "Design Approved Date": "2025-03-04", "Delay": 1, "PR Entry": "2025-03-05", "Oracle Entry": "2025-03-06", "Supplier": "SUPPLIER-6", "STATUS": "DONE", "OVERALL DELAY": 2, "ETA": "2025-03-18", "month": "Mar" },
  { "Plant": "EXT 2", "Order No": "8010-25", "DIE NO": "30123-401", "TYPE": "C", "Die Size": "280X160", "Die Requested Date": "2025-04-05", "Ordered date": "2025-04-05", "Type of shipment": "LAND", "Mandrels per Cavity": 1, "Total Mandrels": 2, "Design Received Date": "2025-04-07", "Design Approved Date": "2025-04-08", "Delay": 1, "PR Entry": "2025-04-10", "Oracle Entry": "2025-04-11", "Supplier": "SUPPLIER-7", "STATUS": "DONE", "OVERALL DELAY": 3, "ETA": "2025-04-28", "month": "Apr" },
  { "Plant": "EXT 1", "Order No": "7625-25", "DIE NO": "INS-25100", "TYPE": "H", "Die Size": "450X250", "Die Requested Date": "2025-05-01", "Ordered date": "2025-05-01", "Type of shipment": "LAND", "Mandrels per Cavity": 0, "Total Mandrels": 0, "Design Received Date": "2025-05-02", "Design Approved Date": "2025-05-03", "Delay": 1, "PR Entry": "2025-05-04", "Oracle Entry": "2025-05-05", "Supplier": "SUPPLIER-1", "STATUS": "DONE", "OVERALL DELAY": 1, "ETA": "2025-05-15", "month": "May" },
  { "Plant": "EXT 2", "Order No": "8020-25", "DIE NO": "31245-501", "TYPE": "N", "Die Size": "450X260", "Die Requested Date": "2025-06-10", "Ordered date": "2025-06-10", "Type of shipment": "AIR", "Mandrels per Cavity": 3, "Total Mandrels": 6, "Design Received Date": "2025-06-12", "Design Approved Date": "2025-06-14", "Delay": 2, "PR Entry": "2025-06-15", "Oracle Entry": "2025-06-17", "Supplier": "SUPPLIER-6", "STATUS": "DONE", "OVERALL DELAY": 4, "ETA": "2025-07-01", "month": "Jun" },
  { "Plant": "EXT 1", "Order No": "7630-25", "DIE NO": "28765-202", "TYPE": "B", "Die Size": "280X160", "Die Requested Date": "2025-07-01", "Ordered date": "2025-07-01", "Type of shipment": "LAND", "Mandrels per Cavity": 0, "Total Mandrels": 0, "Design Received Date": "2025-07-02", "Design Approved Date": "2025-07-03", "Delay": 1, "PR Entry": "2025-07-04", "Oracle Entry": "2025-07-05", "Supplier": "SUPPLIER-2", "STATUS": "DONE", "OVERALL DELAY": 2, "ETA": "2025-07-20", "month": "Jul" },
  { "Plant": "EXT 2", "Order No": "8030-25", "DIE NO": "33200-701", "TYPE": "B", "Die Size": "250X160", "Die Requested Date": "2025-08-10", "Ordered date": "2025-08-10", "Type of shipment": "LAND", "Mandrels per Cavity": 0, "Total Mandrels": 0, "Design Received Date": "2025-08-12", "Design Approved Date": "2025-08-13", "Delay": 1, "PR Entry": "2025-08-14", "Oracle Entry": "2025-08-15", "Supplier": "SUPPLIER-4", "STATUS": "DONE", "OVERALL DELAY": 2, "ETA": "2025-08-30", "month": "Aug" },
  { "Plant": "EXT 1", "Order No": "7640-25", "DIE NO": "INS-25200", "TYPE": "T", "Die Size": "460X150", "Die Requested Date": "2025-09-01", "Ordered date": "2025-09-01", "Type of shipment": "AIR", "Mandrels per Cavity": 0, "Total Mandrels": 0, "Design Received Date": "2025-09-02", "Design Approved Date": "2025-09-03", "Delay": 1, "PR Entry": "2025-09-04", "Oracle Entry": "2025-09-05", "Supplier": "SUPPLIER-5", "STATUS": "DONE", "OVERALL DELAY": 1, "ETA": "2025-09-18", "month": "Sep" },
  { "Plant": "EXT 2", "Order No": "8035-25", "DIE NO": "34500-801", "TYPE": "N", "Die Size": "220X130", "Die Requested Date": "2025-10-15", "Ordered date": "2025-10-15", "Type of shipment": "LAND", "Mandrels per Cavity": 1, "Total Mandrels": 2, "Design Received Date": "2025-10-17", "Design Approved Date": "2025-10-18", "Delay": 1, "PR Entry": "2025-10-19", "Oracle Entry": "2025-10-20", "Supplier": "SUPPLIER-8", "STATUS": "DONE", "OVERALL DELAY": 2, "ETA": "2025-11-05", "month": "Oct" },
  // CANCELLED
  { "Plant": "EXT 2", "Order No": "8025-25", "DIE NO": "32100-601", "TYPE": "C", "Die Size": "320X200", "Die Requested Date": "2025-04-15", "Ordered date": "2025-04-15", "Type of shipment": "AIR", "Mandrels per Cavity": 1, "Total Mandrels": 1, "Design Received Date": "2025-04-17", "Design Approved Date": "2025-04-18", "Delay": 1, "PR Entry": "2025-04-19", "Oracle Entry": "2025-04-21", "Supplier": "SUPPLIER-8", "STATUS": "CANCELLED", "OVERALL DELAY": 0, "ETA": null, "month": "Apr" },
  { "Plant": "EXT 1", "Order No": "7720-25", "DIE NO": "43300-1616", "TYPE": "B", "Die Size": "355X200", "Die Requested Date": "2025-05-10", "Ordered date": "2025-05-10", "Type of shipment": "LAND", "Mandrels per Cavity": 1, "Total Mandrels": 2, "Design Received Date": "2025-05-12", "Design Approved Date": "2025-05-14", "Delay": 2, "PR Entry": "2025-05-15", "Oracle Entry": "2025-05-16", "Supplier": "SUPPLIER-9", "STATUS": "CANCELLED", "OVERALL DELAY": 0, "ETA": null, "month": "May" },
  // PENDING FOR ORACLE ENTRY
  { "Plant": "EXT 2", "Order No": "8060-25", "DIE NO": "40000-1301", "TYPE": "B", "Die Size": "320X160", "Die Requested Date": "2025-11-10", "Ordered date": "2025-11-10", "Type of shipment": "LAND", "Mandrels per Cavity": 0, "Total Mandrels": 0, "Design Received Date": "2025-11-12", "Design Approved Date": "2025-11-13", "Delay": 1, "PR Entry": "2025-11-14", "Oracle Entry": null, "Supplier": "SUPPLIER-7", "STATUS": "PENDING FOR ORACLE ENTRY", "OVERALL DELAY": 0, "ETA": null, "month": "Nov" },
  { "Plant": "EXT 1", "Order No": "7670-25", "DIE NO": "INS-25400", "TYPE": "T", "Die Size": "460X150", "Die Requested Date": "2025-11-15", "Ordered date": "2025-11-15", "Type of shipment": "AIR", "Mandrels per Cavity": 0, "Total Mandrels": 0, "Design Received Date": "2025-11-16", "Design Approved Date": "2025-11-17", "Delay": 1, "PR Entry": "2025-11-18", "Oracle Entry": null, "Supplier": "SUPPLIER-1", "STATUS": "PENDING FOR ORACLE ENTRY", "OVERALL DELAY": 0, "ETA": null, "month": "Nov" },
  // PENDING FOR DESIGN APPROVAL
  { "Plant": "EXT 1", "Order No": "7675-25", "DIE NO": "34500-808", "TYPE": "B", "Die Size": "355X200", "Die Requested Date": "2025-11-20", "Ordered date": null, "Type of shipment": "LAND", "Mandrels per Cavity": 1, "Total Mandrels": 2, "Design Received Date": "2025-11-22", "Design Approved Date": null, "Delay": 0, "PR Entry": null, "Oracle Entry": null, "Supplier": "SUPPLIER-3", "STATUS": "PENDING FOR DESIGN APPROVAL", "OVERALL DELAY": 0, "ETA": null, "month": "Nov" },
  { "Plant": "EXT 2", "Order No": "8070-25", "DIE NO": "42200-1501", "TYPE": "N", "Die Size": "250X160", "Die Requested Date": "2025-11-22", "Ordered date": null, "Type of shipment": "AIR", "Mandrels per Cavity": 0, "Total Mandrels": 0, "Design Received Date": "2025-11-24", "Design Approved Date": null, "Delay": 0, "PR Entry": null, "Oracle Entry": null, "Supplier": "SUPPLIER-2", "STATUS": "PENDING FOR DESIGN APPROVAL", "OVERALL DELAY": 0, "ETA": null, "month": "Nov" },
  // AWAITING FOR DESIGN
  { "Plant": "EXT 2", "Order No": "8075-25", "DIE NO": "43300-1601", "TYPE": "T", "Die Size": "300X100", "Die Requested Date": "2025-11-28", "Ordered date": null, "Type of shipment": "LAND", "Mandrels per Cavity": 0, "Total Mandrels": 0, "Design Received Date": null, "Design Approved Date": null, "Delay": 0, "PR Entry": null, "Oracle Entry": null, "Supplier": "SUPPLIER-1", "STATUS": "AWAITING FOR DESIGN", "OVERALL DELAY": 0, "ETA": null, "month": "Nov" },
  { "Plant": "EXT 1", "Order No": "7685-25", "DIE NO": "36700-1010", "TYPE": "B", "Die Size": "280X160", "Die Requested Date": "2025-12-01", "Ordered date": null, "Type of shipment": "AIR", "Mandrels per Cavity": 1, "Total Mandrels": 2, "Design Received Date": null, "Design Approved Date": null, "Delay": 0, "PR Entry": null, "Oracle Entry": null, "Supplier": "SUPPLIER-6", "STATUS": "AWAITING FOR DESIGN", "OVERALL DELAY": 0, "ETA": null, "month": "Dec" },
  // UNDER SIMULATION
  { "Plant": "EXT 1", "Order No": "7710-25", "DIE NO": "41100-1414", "TYPE": "T", "Die Size": "700X196", "Die Requested Date": "2025-11-05", "Ordered date": "2025-11-05", "Type of shipment": "AIR", "Mandrels per Cavity": 0, "Total Mandrels": 0, "Design Received Date": "2025-11-06", "Design Approved Date": "2025-11-07", "Delay": 1, "PR Entry": "2025-11-08", "Oracle Entry": "2025-11-09", "Supplier": "SUPPLIER-1", "STATUS": "UNDER SIMULATION", "OVERALL DELAY": 0, "ETA": null, "month": "Nov" },
  { "Plant": "EXT 2", "Order No": "8088-25", "DIE NO": "45600-1901", "TYPE": "N", "Die Size": "450X260", "Die Requested Date": "2025-11-08", "Ordered date": "2025-11-08", "Type of shipment": "LAND", "Mandrels per Cavity": 2, "Total Mandrels": 4, "Design Received Date": "2025-11-10", "Design Approved Date": "2025-11-11", "Delay": 1, "PR Entry": "2025-11-12", "Oracle Entry": "2025-11-13", "Supplier": "SUPPLIER-6", "STATUS": "UNDER SIMULATION", "OVERALL DELAY": 0, "ETA": null, "month": "Nov" },
  // PENDING FOR PR
  { "Plant": "EXT 2", "Order No": "8100-25", "DIE NO": "48800-2101", "TYPE": "N", "Die Size": "320X160", "Die Requested Date": "2025-11-12", "Ordered date": null, "Type of shipment": "LAND", "Mandrels per Cavity": 2, "Total Mandrels": 4, "Design Received Date": "2025-11-14", "Design Approved Date": "2025-11-15", "Delay": 1, "PR Entry": null, "Oracle Entry": null, "Supplier": "SUPPLIER-6", "STATUS": "PENDING FOR PR", "OVERALL DELAY": 0, "ETA": null, "month": "Nov" },
  // PENDING FOR DESIGN TO EMS
  { "Plant": "EXT 1", "Order No": "7715-25", "DIE NO": "42200-1515", "TYPE": "B", "Die Size": "250X160", "Die Requested Date": "2025-11-17", "Ordered date": null, "Type of shipment": "LAND", "Mandrels per Cavity": 0, "Total Mandrels": 0, "Design Received Date": "2025-11-19", "Design Approved Date": "2025-11-20", "Delay": 1, "PR Entry": null, "Oracle Entry": null, "Supplier": "SUPPLIER-2", "STATUS": "PENDING FOR DESIGN TO EMS", "OVERALL DELAY": 0, "ETA": null, "month": "Nov" },
  // PENDING FOR ORDERING
  { "Plant": "EXT 1", "Order No": "7665-25", "DIE NO": "33400-707", "TYPE": "N", "Die Size": "450X260", "Die Requested Date": "2025-11-01", "Ordered date": null, "Type of shipment": "LAND", "Mandrels per Cavity": 3, "Total Mandrels": 6, "Design Received Date": "2025-11-03", "Design Approved Date": "2025-11-05", "Delay": 2, "PR Entry": "2025-11-06", "Oracle Entry": "2025-11-07", "Supplier": "SUPPLIER-4", "STATUS": "PENDING FOR ORDERING", "OVERALL DELAY": 0, "ETA": null, "month": "Nov" },
  { "Plant": "EXT 2", "Order No": "8055-25", "DIE NO": "38900-1201", "TYPE": "B", "Die Size": "250X160", "Die Requested Date": "2025-10-15", "Ordered date": null, "Type of shipment": "AIR", "Mandrels per Cavity": 1, "Total Mandrels": 2, "Design Received Date": "2025-10-17", "Design Approved Date": "2025-10-18", "Delay": 1, "PR Entry": "2025-10-19", "Oracle Entry": "2025-10-20", "Supplier": "SUPPLIER-10", "STATUS": "PENDING FOR ORDERING", "OVERALL DELAY": 0, "ETA": null, "month": "Oct" },
  // HOLD
  { "Plant": "EXT 2", "Order No": "8105-25", "DIE NO": "49900-2201", "TYPE": "B", "Die Size": "280X160", "Die Requested Date": "2025-11-19", "Ordered date": null, "Type of shipment": "AIR", "Mandrels per Cavity": 1, "Total Mandrels": 2, "Design Received Date": "2025-11-21", "Design Approved Date": "2025-11-22", "Delay": 1, "PR Entry": null, "Oracle Entry": null, "Supplier": "SUPPLIER-7", "STATUS": "HOLD", "OVERALL DELAY": 0, "ETA": null, "month": "Nov" },
];

// Status configuration
const STATUS_CONFIG = {
  'AWAITING FOR DESIGN': { color: '#DC2626', bgColor: '#FEF2F2', icon: Clock, label: 'Awaiting Design' },
  'PENDING FOR DESIGN APPROVAL': { color: '#EA580C', bgColor: '#FFF7ED', icon: AlertTriangle, label: 'Design Approval' },
  'UNDER SIMULATION': { color: '#7C3AED', bgColor: '#F5F3FF', icon: Layers, label: 'Simulation' },
  'PENDING FOR DESIGN TO EMS': { color: '#2563EB', bgColor: '#EFF6FF', icon: Package, label: 'Design to EMS' },
  'PENDING FOR PR': { color: '#D97706', bgColor: '#FFFBEB', icon: TrendingUp, label: 'Pending PR' },
  'PENDING FOR ORACLE ENTRY': { color: '#C2410C', bgColor: '#FFF7ED', icon: Factory, label: 'Oracle Entry' },
  'PENDING FOR ORDERING': { color: '#0D9488', bgColor: '#F0FDFA', icon: Truck, label: 'Pending Order' },
  'DONE': { color: '#16A34A', bgColor: '#F0FDF4', icon: CheckCircle, label: 'Completed' },
  'CANCELLED': { color: '#6B7280', bgColor: '#F3F4F6', icon: XCircle, label: 'Cancelled' },
  'HOLD': { color: '#4B5563', bgColor: '#F9FAFB', icon: AlertTriangle, label: 'On Hold' },
};

const CHART_COLORS = ['#0EA5E9', '#8B5CF6', '#F59E0B', '#10B981', '#EF4444', '#EC4899', '#6366F1', '#14B8A6', '#F97316', '#84CC16'];

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
    'pr no.:': 'PR No.', 'pr no': 'PR No.', 'die no': 'DIE NO', 'order no': 'Order No',
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
        if (['Delay', 'OVERALL DELAY', 'Mandrels per Cavity', 'Total Mandrels'].includes(normKey)) {
          value = parseFloat(value) || 0;
        }
        normalized[normKey] = value === '' || value === undefined ? null : value;
      });
      if (!normalized.month && normalized['Die Requested Date']) {
        normalized.month = getMonthFromDate(normalized['Die Requested Date']);
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

// PDF Import Modal Component
const PDFImportModal = ({ onClose, onAddRecord }) => {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);

  const parseDateDMY = (dateStr) => {
    if (!dateStr) return null;
    const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (match) {
      const [, day, month, year] = match;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return null;
  };

  const extractDieNoFromFilename = (filename) => {
    // Remove .pdf extension and return the filename as die number
    return filename.replace(/\.pdf$/i, '');
  };

  const parsePDFContent = async (file) => {
    setError(null);
    setLoading(true);
    setPreview(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n';
      }

      // Extract die number from filename
      const dieNo = extractDieNoFromFilename(file.name);

      // Parse extracted text to find relevant fields
      const lines = fullText.split(/\s+/).filter(Boolean);

      // Find dates (DD/MM/YYYY format)
      const datePattern = /\d{1,2}\/\d{1,2}\/\d{4}/g;
      const dates = fullText.match(datePattern) || [];

      // Find die size (e.g., 355X200, Dia 355X200)
      const sizePattern = /(?:Dia\s*)?(\d{2,4}[Xx]\d{2,4})/i;
      const sizeMatch = fullText.match(sizePattern);
      const dieSize = sizeMatch ? sizeMatch[1].toUpperCase() : null;

      // Find supplier - look for first alphabetic word (at least 4 chars) that's not a common keyword
      const skipWords = ['DIA', 'HOLLOW', 'SOLID', 'LAND', 'ROAD', 'URGENT', 'NEED', 'WEEK', 'TOP'];
      const words = fullText.match(/[A-Za-z]{4,}/g) || [];
      let supplier = 'UNKNOWN';
      for (const word of words) {
        const upperWord = word.toUpperCase();
        if (!skipWords.includes(upperWord) && !upperWord.match(/^(OLD|NEW|P\d+)$/i)) {
          supplier = upperWord;
          break;
        }
      }

      // Determine shipment type
      const shipmentType = fullText.toLowerCase().includes('air') ? 'AIR' : 'LAND';

      // Check for 3D Module for Simulation - just set flag, don't auto-update dates/status
      const simulationEnabled = /3D\s*Module\s*(for\s*)?Simulation\s*[:=]?\s*(ok|yes)/i.test(fullText);

      // Build the new record
      const today = new Date().toISOString().split('T')[0];
      const requestDate = dates[0] ? parseDateDMY(dates[0]) : today;

      const newRecord = {
        'Plant': 'EXT 1',
        'Order No': `PDF-${Date.now().toString().slice(-6)}`,
        'DIE NO': dieNo,
        'TYPE': null,
        'Die Size': dieSize || 'N/A',
        'Die Requested Date': requestDate,
        'Ordered date': null,
        'Type of shipment': shipmentType,
        'Mandrels per Cavity': 0,
        'Total Mandrels': 0,
        'Design Received Date': null,
        '3D Model Received Date': null,
        'simulationEnabled': simulationEnabled,
        'Design Approved Date': null,
        'Delay': 0,
        'PR Entry': null,
        'Oracle Entry': null,
        'Supplier': supplier,
        'STATUS': 'PENDING FOR ORDERING',
        'OVERALL DELAY': 0,
        'ETA': null,
        'month': requestDate ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][new Date(requestDate).getMonth()] : null,
      };

      setPreview({ record: newRecord, rawText: fullText.substring(0, 500) });
    } catch (err) {
      setError(`PDF parsing error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const processFile = useCallback((file) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please upload a PDF file');
      return;
    }
    parsePDFContent(file);
  }, []);

  const InfoRow = ({ label, value }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #334155' }}>
      <span style={{ fontSize: '0.8rem', color: '#64748B' }}>{label}</span>
      <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#F1F5F9', fontFamily: 'monospace' }}>{value || '—'}</span>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }} onClick={onClose}>
      <div style={{ background: '#1E293B', borderRadius: '20px', width: '100%', maxWidth: '580px', maxHeight: '90vh', overflow: 'hidden', border: '1px solid #334155' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem', borderBottom: '1px solid #334155' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #F59E0B, #EF4444)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FileText size={24} color="white" /></div>
            <div><h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#F1F5F9' }}>Import from PDF</h2><p style={{ fontSize: '0.875rem', color: '#64748B' }}>Upload die ordering request PDF</p></div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', padding: '8px', borderRadius: '8px' }}><X size={24} /></button>
        </div>
        <div style={{ padding: '1.5rem', overflowY: 'auto', maxHeight: '65vh' }}>
          {!preview && (
            <div style={{ border: `2px dashed ${dragActive ? '#F59E0B' : '#334155'}`, borderRadius: '16px', padding: '2.5rem', textAlign: 'center', background: dragActive ? 'rgba(245,158,11,0.1)' : 'transparent', marginBottom: '1rem' }}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => { e.preventDefault(); setDragActive(false); processFile(e.dataTransfer.files[0]); }}>
              <FileText size={48} color="#64748B" />
              <p style={{ fontSize: '1rem', color: '#F1F5F9', marginTop: '1rem' }}>Drag & drop your PDF file here</p>
              <p style={{ color: '#64748B', margin: '0.5rem 0' }}>or</p>
              <label style={{ display: 'inline-block', padding: '0.75rem 1.5rem', background: 'linear-gradient(135deg, #F59E0B, #EF4444)', color: 'white', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
                Browse PDF Files<input type="file" accept=".pdf" onChange={(e) => processFile(e.target.files[0])} hidden />
              </label>
              <p style={{ fontSize: '0.8rem', color: '#64748B', marginTop: '1rem' }}>Die number will be extracted from filename</p>
            </div>
          )}
          {loading && (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <div style={{ width: '40px', height: '40px', border: '3px solid #334155', borderTopColor: '#F59E0B', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
              <p style={{ color: '#94A3B8', marginTop: '1rem' }}>Extracting data from PDF...</p>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}
          {error && <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(244,63,94,0.1)', color: '#F43F5E', padding: '0.875rem 1rem', borderRadius: '10px', marginBottom: '1rem' }}><AlertTriangle size={18} /><span>{error}</span></div>}
          {preview && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(245,158,11,0.1)', padding: '1rem', borderRadius: '10px', marginBottom: '1rem' }}>
                <CheckCircle size={20} color="#F59E0B" />
                <div><p style={{ fontWeight: 600, color: '#F59E0B' }}>PDF Parsed Successfully</p><p style={{ fontSize: '0.8rem', color: '#94A3B8' }}>Review extracted data below</p></div>
              </div>
              <div style={{ background: '#0F172A', borderRadius: '12px', padding: '1rem', marginBottom: '1rem' }}>
                <h4 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: '#64748B', marginBottom: '0.75rem' }}>Extracted Die Order</h4>
                <InfoRow label="Die No" value={preview.record['DIE NO']} />
                <InfoRow label="Die Size" value={preview.record['Die Size']} />
                <InfoRow label="Supplier" value={preview.record.Supplier} />
                <InfoRow label="Requested Date" value={preview.record['Die Requested Date']} />
                <InfoRow label="Shipment" value={preview.record['Type of shipment']} />
                <InfoRow label="Status" value={preview.record.STATUS} />
              </div>
              <button onClick={() => setPreview(null)} style={{ width: '100%', padding: '0.5rem', background: 'transparent', border: '1px solid #334155', borderRadius: '8px', color: '#94A3B8', cursor: 'pointer', marginBottom: '0.5rem' }}>Upload Different PDF</button>
            </>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '1.25rem 1.5rem', borderTop: '1px solid #334155' }}>
          <button onClick={onClose} style={{ padding: '0.75rem 1.5rem', background: '#334155', color: '#F1F5F9', border: '1px solid #475569', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => { if (preview?.record) { onAddRecord(preview.record); onClose(); } }} disabled={!preview} style={{ padding: '0.75rem 1.5rem', background: preview ? 'linear-gradient(135deg, #F59E0B, #EF4444)' : '#475569', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: preview ? 'pointer' : 'not-allowed', opacity: preview ? 1 : 0.5 }}>Add Die Order</button>
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
const OrderDetailModal = ({ order, onClose, onUpdate, theme, suppliers = [], plants = [] }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedOrder, setEditedOrder] = useState({ ...order });
  const [isSaving, setIsSaving] = useState(false);
  const [viewingFile, setViewingFile] = useState(null); // { file, type, notes, signature }

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
    setEditedOrder(prev => {
      const updated = { ...prev, [field]: value };
      // Auto-update status when date fields change (except if manually setting STATUS)
      if (field !== 'STATUS') {
        updated.STATUS = determineStatus(updated);
      }
      return updated;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await ordersAPI.update(order.id, editedOrder);
      if (onUpdate) onUpdate(editedOrder);
      setIsEditing(false);
    } catch (error) {
      alert('Failed to save: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedOrder({ ...order });
    setIsEditing(false);
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
              <InfoRow label="Shipment" field="Type of shipment" value={currentOrder['Type of shipment']} type="select" options={shipmentOptions} />
              <InfoRow label="Supplier" field="Supplier" value={currentOrder.Supplier} type="select" options={suppliers.map(s => s.name)} />
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
  const [currentPage, setCurrentPage] = useState(1);
  const [showCompletedInChart, setShowCompletedInChart] = useState(false);
  const [showCancelledInChart, setShowCancelledInChart] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [analyticsFilter, setAnalyticsFilter] = useState({ period: 'all', quarter: 'all' });
  const itemsPerPage = 10;

  // Auth state
  const [isLoggedIn, setIsLoggedIn] = useState(checkLoggedIn());
  const [user, setUser] = useState(getUser());
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' });
  const [suppliers, setSuppliers] = useState([]);
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [plants, setPlants] = useState([]);
  const [showAddPlant, setShowAddPlant] = useState(false);
  const [newPlantName, setNewPlantName] = useState('');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showPasswordChangeModal, setShowPasswordChangeModal] = useState(false);
  const [forcePasswordChange, setForcePasswordChange] = useState(false);
  const [toast, setToast] = useState(null); // { message: string, type: 'success' | 'error' }

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

  // Check auth on mount and fetch data
  useEffect(() => {
    if (isLoggedIn) {
      fetchOrders();
      fetchUsers();
      fetchSuppliers();
      fetchPlants();
    }
  }, [isLoggedIn, fetchOrders, fetchUsers, fetchSuppliers, fetchPlants]);

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
      await usersAPI.create(newUser.username, newUser.password, newUser.role);
      setNewUser({ username: '', password: '', role: 'user' });
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
    console.log('handlePIImport called with', importData.length, 'records');
    try {
      let created = 0;
      let updated = 0;

      for (const record of importData) {
        // Remove the isExisting flag before sending to API
        const { isExisting, ...orderData } = record;
        console.log(`Processing ${orderData['DIE NO']}: isExisting=${isExisting}, id=${orderData.id}`);

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

      console.log(`PI Import complete: ${created} created, ${updated} updated`);

      // Refresh orders from database
      await fetchOrders();
      setCurrentPage(1);

      // Show appropriate message
      const messages = [];
      if (created > 0) messages.push(`${created} new order(s) created`);
      if (updated > 0) messages.push(`${updated} order(s) updated`);
      const msg = `PI Import successful: ${messages.join(', ')}`;
      console.log(msg);
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

  const monthlyTrendData = useMemo(() => {
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(month => {
      const monthOrders = data.filter(o => o.month === month);
      return { month, new: monthOrders.filter(o => o.TYPE === 'N').length, backup: monthOrders.filter(o => o.TYPE === 'B').length };
    });
  }, [data]);

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
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
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

  const handleSort = (key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  const exportData = () => { const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Die Orders'); XLSX.writeFile(wb, 'die_orders_export.xlsx'); };

  // Theme colors - InsightHub Style
  const theme = isDarkMode ? {
    bg: '#0F172A',
    text: '#F1F5F9',
    textMuted: '#94A3B8',
    textDim: '#64748B',
    cardBg: '#1E293B',
    cardBorder: '#334155',
    inputBg: '#0F172A',
    headerBg: '#1E293B',
    navBg: '#0F172A',
    tableBg: '#0F172A',
    tooltipBg: '#0F172A',
    sidebarBg: '#1E293B',
    primary: '#3B82F6',
    primaryLight: 'rgba(59, 130, 246, 0.15)',
  } : {
    bg: '#F0F4F8',
    text: '#1E293B',
    textMuted: '#475569',
    textDim: '#64748B',
    cardBg: '#FFFFFF',
    cardBorder: '#E5E9EF',
    inputBg: '#F8FAFC',
    headerBg: '#FFFFFF',
    navBg: '#E8ECF0',
    tableBg: '#FAFBFC',
    tooltipBg: '#1E293B',
    sidebarBg: '#FFFFFF',
    primary: '#3B82F6',
    primaryLight: 'rgba(59, 130, 246, 0.08)',
  };

  // Inline styles - InsightHub Style
  const styles = {
    // New sidebar layout styles
    appLayout: { display: 'flex', minHeight: '100vh', background: theme.bg },
    sidebar: { width: '260px', background: theme.sidebarBg, borderRight: `1px solid ${theme.cardBorder}`, padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', position: 'fixed', height: '100vh', zIndex: 100 },
    sidebarNav: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '1.5rem' },
    sidebarNavItem: (active) => ({ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderRadius: '12px', fontWeight: 500, fontSize: '0.9rem', color: active ? theme.primary : theme.textMuted, background: active ? theme.primaryLight : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'all 0.2s' }),
    mainContent: { flex: 1, marginLeft: '260px', background: theme.bg },
    topBar: { background: theme.headerBg, borderBottom: `1px solid ${theme.cardBorder}`, padding: '1rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 },
    // Original styles with InsightHub enhancements
    app: { minHeight: '100vh', background: theme.bg, fontFamily: "'DM Sans', sans-serif", color: theme.text },
    header: { background: theme.headerBg, backdropFilter: 'blur(20px)', borderBottom: `1px solid ${theme.cardBorder}`, position: 'sticky', top: 0, zIndex: 100 },
    headerContent: { maxWidth: '1800px', margin: '0 auto', padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'nowrap' },
    logoSection: { display: 'flex', alignItems: 'center', gap: '12px' },
    logoIcon: { width: '44px', height: '44px', background: 'linear-gradient(135deg, #3B82F6, #6366F1)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    navTabs: { display: 'flex', gap: '4px', background: theme.navBg, padding: '4px', borderRadius: '12px' },
    navTab: (active) => ({ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '10px', fontWeight: 500, fontSize: '0.875rem', color: active ? 'white' : theme.textMuted, background: active ? theme.primary : 'transparent', border: 'none', cursor: 'pointer' }),
    actionBtn: (primary) => ({ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '10px', fontWeight: 500, fontSize: '0.875rem', border: primary ? 'none' : `1px solid ${theme.cardBorder}`, cursor: 'pointer', background: primary ? theme.primary : theme.cardBg, color: primary ? 'white' : theme.text, transition: 'all 0.2s' }),
    main: { maxWidth: '1600px', margin: '0 auto', padding: '2rem 1.5rem' },
    kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem', marginBottom: '2rem' },
    kpiCard: { background: theme.cardBg, borderRadius: '20px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}`, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' },
    chartsGrid: { display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1.25rem', marginBottom: '2rem' },
    chartCard: { background: theme.cardBg, borderRadius: '20px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}`, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' },
    filterBar: { background: theme.cardBg, borderRadius: '20px', padding: '1.25rem', border: `1px solid ${theme.cardBorder}`, marginBottom: '1.5rem', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' },
    filterRow: { display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' },
    searchBox: { flex: 1, minWidth: '250px', position: 'relative' },
    searchInput: { width: '100%', padding: '12px 16px 12px 44px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', color: theme.text, fontSize: '0.875rem' },
    filterSelect: { padding: '12px 16px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', color: theme.text, fontSize: '0.875rem', cursor: 'pointer', minWidth: '130px' },
    tableContainer: { background: theme.cardBg, borderRadius: '20px', border: `1px solid ${theme.cardBorder}`, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' },
    table: { width: '100%', borderCollapse: 'collapse' },
    th: { padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: theme.textDim, background: theme.tableBg, cursor: 'pointer' },
    td: { padding: '1rem', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.875rem', color: theme.textMuted },
    pipelineSection: { background: theme.cardBg, borderRadius: '20px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}`, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' },
    pipelineColumns: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' },
    pipelineColumn: (color) => ({ borderRadius: '16px', padding: '1rem', background: color }),
    pipelineItem: { background: theme.cardBg, borderRadius: '12px', padding: '10px 12px', marginBottom: '8px', cursor: 'pointer', border: '1px solid transparent', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', width: 'calc(100% - 4px)', overflow: 'hidden' },
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
          <p style={{ fontSize: '0.75rem', color: '#64748B', textAlign: 'center', marginTop: '1.5rem' }}>Default: admin / admin123</p>
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
      navigator.clipboard.writeText(emailText);
      alert(`Email copied to clipboard!`);
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
                    <div
                      key={`design-${supplier}`}
                      onClick={() => copyEmail('design', supplier, orders)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '10px 16px', margin: '4px 8px', borderRadius: '10px',
                        background: 'transparent', cursor: 'pointer',
                        transition: 'background 0.2s', border: `1px solid transparent`
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
                    >
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
                      <FileText size={14} color={theme.textDim} />
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
                    <div
                      key={`ordering-${plant}`}
                      onClick={() => copyEmail('ordering', plant, orders)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '10px 16px', margin: '4px 8px', borderRadius: '10px',
                        background: 'transparent', cursor: 'pointer',
                        transition: 'background 0.2s', border: `1px solid transparent`
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(139,92,246,0.1)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,0.3)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
                    >
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
                      <FileText size={14} color={theme.textDim} />
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
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} user={user} theme={theme} />

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


          {activeTab === 'dashboard' && (
            <>
              <div style={styles.kpiGrid}>
                {[
                  { title: 'Total Orders', value: stats.total, color: '#3B82F6', icon: Package, sub: 'Year to date', filter: 'all' },
                  { title: 'Completed', value: stats.completed, color: '#10B981', icon: CheckCircle, sub: `${stats.total > 0 ? ((stats.completed / stats.total) * 100).toFixed(0) : 0}% rate`, filter: 'DONE' },
                  { title: 'In Progress', value: stats.pending, color: '#F59E0B', icon: Clock, sub: 'Active orders', filter: 'active' },
                  { title: 'Cancelled', value: stats.cancelled, color: '#EF4444', icon: XCircle, sub: `${stats.total > 0 ? ((stats.cancelled / stats.total) * 100).toFixed(1) : 0}%`, filter: 'CANCELLED' },
                  { title: 'Avg Delay', value: `${stats.avgDelay}d`, color: '#8B5CF6', icon: AlertTriangle, sub: 'Design approval' },
                ].map((kpi, index) => (
                  <div
                    key={kpi.title}
                    style={{
                      ...styles.kpiCard,
                      cursor: kpi.filter ? 'pointer' : 'default',
                      transition: 'transform 0.2s, box-shadow 0.2s'
                    }}
                    onClick={() => {
                      if (kpi.filter) {
                        setFilters(prev => ({ ...prev, status: kpi.filter }));
                        setActiveTab('orders');
                      }
                    }}
                    onMouseEnter={(e) => {
                      if (kpi.filter) {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.3)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (kpi.filter) {
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
                ))}
              </div>
              <div style={styles.chartsGrid}>
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
                            'DONE': '#10B981', 'CANCELLED': '#6B7280', 'AWAITING DESIGN': '#EF4444',
                            'DESIGN APPROVAL': '#F59E0B', 'PENDING ORDER': '#8B5CF6', 'ORACLE ENTRY': '#3B82F6',
                            'ON HOLD': '#64748B', 'DESIGN TO EMS': '#14B8A6', 'SIMULATION': '#EC4899'
                          };
                          return Object.entries(statusCounts)
                            .sort((a, b) => b[1] - a[1])
                            .map(([status, count]) => (
                              <tr key={status} style={{ borderBottom: `1px solid ${theme.border}` }}>
                                <td style={{ padding: '10px 12px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: statusColors[status] || '#94A3B8' }} />
                                    <span style={{ fontSize: '0.85rem', color: theme.text, fontWeight: 500 }}>{status}</span>
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
                <div style={styles.chartCard}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.25rem', color: theme.text }}>Monthly Orders Trend</h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={monthlyTrendData}>
                      <defs><linearGradient id="gradNew" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3B82F6" stopOpacity={0.4} /><stop offset="95%" stopColor="#3B82F6" stopOpacity={0} /></linearGradient><linearGradient id="gradBackup" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#F59E0B" stopOpacity={0.4} /><stop offset="95%" stopColor="#F59E0B" stopOpacity={0} /></linearGradient></defs>
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} />
                      <Tooltip contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', padding: '10px 14px' }} itemStyle={{ color: '#FFFFFF', fontWeight: 500 }} labelStyle={{ color: '#94A3B8', marginBottom: '4px' }} />
                      <Area type="monotone" dataKey="new" stroke="#3B82F6" fill="url(#gradNew)" strokeWidth={2} name="New Dies" />
                      <Area type="monotone" dataKey="backup" stroke="#F59E0B" fill="url(#gradBackup)" strokeWidth={2} name="Backup Dies" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div style={styles.pipelineSection}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text }}>Active Pipeline</h3>
                  <button onClick={() => setActiveTab('pipeline')} style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#3B82F6', fontSize: '0.875rem', fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer' }}>View all <ArrowRight size={16} /></button>
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

          {activeTab === 'orders' && (
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
                        {[{ key: 'DIE NO', label: 'Die No' }, { key: 'Order No', label: 'Order' }, { key: 'Plant', label: 'Plant' }, { key: 'TYPE', label: 'Type' }, { key: 'Die Size', label: 'Size' }, { key: 'Supplier', label: 'Supplier' }, { key: 'Die Requested Date', label: 'Requested' }, { key: 'Type of shipment', label: 'Ship' }, { key: 'STATUS', label: 'Status' }].map(col => (
                          <th key={col.key} style={styles.th} onClick={() => handleSort(col.key)}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>{col.label}{sortConfig.key === col.key ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} color="#3B82F6" /> : <ChevronDown size={14} color="#3B82F6" />) : <ChevronDown size={14} color="#64748B" />}</div>
                          </th>
                        ))}
                        <th style={{ ...styles.th, textAlign: 'center' }}>Progress</th>
                        <th style={{ ...styles.th, textAlign: 'center' }}>View</th>
                        {user?.role === 'admin' && <th style={{ ...styles.th, textAlign: 'center' }}>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedData.map((order, idx) => (
                        <tr key={`${order['DIE NO']}-${idx}`} style={{ cursor: 'pointer' }} onClick={() => setSelectedOrder(order)}>
                          <td style={styles.td}><span style={{ fontWeight: 600, color: theme.text, fontFamily: 'monospace' }}>{order['DIE NO']}</span></td>
                          <td style={styles.td}>{order['Order No']}</td>
                          <td style={styles.td}><span style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, background: order.Plant === 'EXT 1' ? 'rgba(59,130,246,0.2)' : 'rgba(139,92,246,0.2)', color: order.Plant === 'EXT 1' ? '#60A5FA' : '#A78BFA' }}>{order.Plant}</span></td>
                          <td style={styles.td}>{order.TYPE}</td>
                          <td style={styles.td}>{order['Die Size']}</td>
                          <td style={styles.td}>{order.Supplier}</td>
                          <td style={styles.td}>{order['Die Requested Date']}</td>
                          <td style={styles.td}><div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>{order['Type of shipment'] === 'AIR' ? <Plane size={14} color="#0EA5E9" /> : <Truck size={14} color="#10B981" />}{order['Type of shipment']}</div></td>
                          <td style={styles.td}><StatusBadge status={order.STATUS} /></td>
                          <td style={styles.td}><ProgressPipeline order={order} /></td>
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

          {activeTab === 'pipeline' && (
            <>
              <div style={{ marginBottom: '1.5rem' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem', color: theme.text }}>Pipeline Kanban Board</h2>
                <p style={{ fontSize: '0.85rem', color: theme.textMuted }}>Drag and drop orders between stages to update their status</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem', overflowX: 'auto', paddingBottom: '8px' }}>
                {[
                  { status: 'PENDING FOR ORDERING', label: 'Pending Order', color: '#8B5CF6', bgColor: 'rgba(139,92,246,0.1)', dateField: 'Ordered date' },
                  { status: 'AWAITING FOR DESIGN', label: 'Awaiting Design', color: '#EF4444', bgColor: 'rgba(239,68,68,0.1)', dateField: 'Die Requested Date' },
                  { status: 'UNDER SIMULATION', label: 'Simulation', color: '#EC4899', bgColor: 'rgba(236,72,153,0.1)', dateField: null },
                  { status: 'PENDING FOR DESIGN APPROVAL', label: 'Design Approval', color: '#F59E0B', bgColor: 'rgba(245,158,11,0.1)', dateField: 'Design Received Date' },
                  { status: 'PENDING FOR PR', label: 'PR Entry', color: '#06B6D4', bgColor: 'rgba(6,182,212,0.1)', dateField: 'PR Entry' },
                  { status: 'PENDING FOR ORACLE ENTRY', label: 'Oracle Entry', color: '#3B82F6', bgColor: 'rgba(59,130,246,0.1)', dateField: 'Oracle Entry' },
                  { status: 'PENDING FOR DESIGN TO EMS', label: 'Design to EMS', color: '#14B8A6', bgColor: 'rgba(20,184,166,0.1)', dateField: 'Design Approved Date' },
                  { status: 'DONE', label: 'Completed', color: '#10B981', bgColor: 'rgba(16,185,129,0.1)', dateField: 'Ordered date' },
                ].map(column => {
                  const columnOrders = data.filter(o => o.STATUS === column.status);
                  return (
                    <div
                      key={column.status}
                      style={{
                        background: column.bgColor,
                        borderRadius: '16px',
                        padding: '1rem',
                        minHeight: '400px',
                        border: `2px dashed transparent`,
                        transition: 'border-color 0.2s'
                      }}
                      onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = column.color; }}
                      onDragLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; }}
                      onDrop={async (e) => {
                        e.preventDefault();
                        e.currentTarget.style.borderColor = 'transparent';
                        const orderId = e.dataTransfer.getData('orderId');
                        const order = data.find(o => o.id === parseInt(orderId));
                        if (order && order.STATUS !== column.status) {
                          // Check if trying to move to Simulation without simulation flag
                          if (column.status === 'UNDER SIMULATION' && !order.simulationEnabled) {
                            alert('This order does not have Simulation enabled. Please enable simulation in the order details first.');
                            return;
                          }
                          const today = new Date().toISOString().split('T')[0];
                          const updatedOrder = { ...order, STATUS: column.status };
                          if (column.dateField && !order[column.dateField]) {
                            updatedOrder[column.dateField] = today;
                          }
                          try {
                            await ordersAPI.update(order.id, updatedOrder);
                            setData(prev => prev.map(o => o.id === order.id ? updatedOrder : o));
                          } catch (error) {
                            alert('Failed to update order: ' + error.message);
                          }
                        }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: `2px solid ${column.color}30` }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: column.color }}>{column.label}</span>
                        <span style={{ marginLeft: 'auto', background: column.color, padding: '2px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, color: 'white' }}>{columnOrders.length}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '500px', overflowY: 'auto' }}>
                        {columnOrders.map(order => (
                          <div
                            key={order.id}
                            draggable
                            onDragStart={(e) => { e.dataTransfer.setData('orderId', order.id.toString()); e.currentTarget.style.opacity = '0.5'; }}
                            onDragEnd={(e) => { e.currentTarget.style.opacity = '1'; }}
                            onClick={() => setSelectedOrder(order)}
                            style={{
                              background: theme.cardBg,
                              borderRadius: '12px',
                              padding: '0.875rem',
                              cursor: 'grab',
                              border: `1px solid ${theme.border}`,
                              transition: 'transform 0.15s, box-shadow 0.15s'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                              <GripVertical size={14} color={theme.textDim} />
                              <span style={{ fontWeight: 700, fontSize: '0.9rem', color: theme.text, fontFamily: 'monospace' }}>{order['DIE NO']}</span>
                            </div>
                            <div style={{ fontSize: '0.75rem', color: theme.textDim, marginBottom: '4px' }}>{order.Supplier}</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.7rem', color: theme.textMuted }}>{order.Plant}</span>
                              <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '6px', background: order.TYPE === 'N' ? '#3B82F620' : order.TYPE === 'B' ? '#F59E0B20' : '#64748B20', color: order.TYPE === 'N' ? '#3B82F6' : order.TYPE === 'B' ? '#F59E0B' : '#64748B', fontWeight: 600 }}>
                                {order.TYPE === 'N' ? 'New' : order.TYPE === 'B' ? 'Backup' : order.TYPE}
                              </span>
                            </div>
                          </div>
                        ))}
                        {columnOrders.length === 0 && (
                          <div style={{ textAlign: 'center', padding: '2rem 1rem', color: theme.textDim, fontSize: '0.8rem', fontStyle: 'italic' }}>
                            Drop orders here
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {activeTab === 'analytics' && (
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
                  <BarChart data={supplierData} layout="vertical">
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} />
                    <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={90} />
                    <Tooltip contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', padding: '10px 14px' }} itemStyle={{ color: '#FFFFFF', fontWeight: 500 }} labelStyle={{ color: '#94A3B8', marginBottom: '4px' }} />
                    <Bar dataKey="value" fill="#3B82F6" radius={[0, 6, 6, 0]} />
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
                  })()} layout="vertical">
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit=" days" />
                    <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={90} />
                    <Tooltip
                      contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', padding: '10px 14px' }}
                      itemStyle={{ color: '#FFFFFF', fontWeight: 500 }}
                      labelStyle={{ color: '#94A3B8', marginBottom: '4px' }}
                      formatter={(value, name, props) => [`${value} days (${props.payload.count} orders)`, 'Avg Lead Time']}
                    />
                    <Bar dataKey="avgDays" fill="#10B981" radius={[0, 6, 6, 0]} name="Avg Days" />
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
                  })()} layout="vertical">
                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit=" days" />
                    <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={90} />
                    <Tooltip
                      contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', padding: '10px 14px' }}
                      formatter={(value, name, props) => [`${value} days (${props.payload.count} orders)`, 'Avg Approval Time']}
                    />
                    <Bar dataKey="avgDays" fill="#8B5CF6" radius={[0, 6, 6, 0]} name="Avg Days" />
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
                  })()}>
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit="d" />
                    <Tooltip
                      contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', padding: '10px 14px' }}
                      formatter={(value, name, props) => [`${value} days (${props.payload.count} orders)`, 'Avg Days']}
                    />
                    <Bar dataKey="avgDays" fill="#F59E0B" radius={[6, 6, 0, 0]} />
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
                  })()}>
                    <XAxis dataKey="plant" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 12 }} unit="d" />
                    <Tooltip
                      contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '10px', padding: '10px 14px' }}
                      formatter={(value, name, props) => [`${value} days (${props.payload.count} orders)`, 'Avg Days']}
                    />
                    <Bar dataKey="avgDays" fill="#EC4899" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', gridColumn: 'span 2' }}>
                {[
                  { title: 'Die Types', value: [...new Set(analyticsData.map(o => o.TYPE))].filter(Boolean).length, desc: 'In selection', gradient: 'linear-gradient(135deg, #3B82F6, #8B5CF6)' },
                  { title: 'Suppliers', value: [...new Set(analyticsData.map(o => o.Supplier))].filter(Boolean).length, desc: 'Active vendors', gradient: 'linear-gradient(135deg, #10B981, #14B8A6)' },
                  { title: 'Die Sizes', value: [...new Set(analyticsData.filter(o => o.TYPE === 'N' || o.TYPE === 'B').map(o => o['Die Size']))].filter(Boolean).length, desc: 'New & Backup only', gradient: 'linear-gradient(135deg, #F59E0B, #F97316)' },
                  { title: 'Total Mandrels', value: analyticsData.reduce((sum, o) => sum + (o['Total Mandrels'] || 0), 0), desc: 'Across selection', gradient: 'linear-gradient(135deg, #EC4899, #F43F5E)' },
                ].map(card => (
                  <div key={card.title} style={{ padding: '1.25rem', borderRadius: '16px', color: 'white', background: card.gradient }}>
                    <h4 style={{ fontSize: '0.8rem', opacity: 0.85, marginBottom: '8px' }}>{card.title}</h4>
                    <div style={{ fontSize: '2rem', fontWeight: 700, fontFamily: 'monospace' }}>{card.value}</div>
                    <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '4px' }}>{card.desc}</div>
                  </div>
                ))}
              </div>
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
                          <th style={{ padding: '12px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg, position: 'sticky', top: 0 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {suppliers.map(supplier => (
                          <tr key={supplier.id}>
                            <td style={{ padding: '12px', borderTop: `1px solid ${theme.cardBorder}`, fontWeight: 500, color: theme.text }}>{supplier.name}</td>
                            <td style={{ padding: '12px', borderTop: `1px solid ${theme.cardBorder}`, textAlign: 'right' }}>
                              <button onClick={async () => { if (window.confirm(`Delete supplier "${supplier.name}"?`)) { try { await suppliersAPI.delete(supplier.id); fetchSuppliers(); } catch (error) { alert('Failed to delete: ' + error.message); } } }} style={{ padding: '4px 10px', background: '#EF4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>Delete</button>
                            </td>
                          </tr>
                        ))}
                        {suppliers.length === 0 && <tr><td colSpan={2} style={{ padding: '24px', textAlign: 'center', color: theme.textDim }}>No suppliers configured</td></tr>}
                      </tbody>
                    </table>
                  </div>
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
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                      <button onClick={() => { setShowAddSupplier(false); setNewSupplierName(''); }} style={{ padding: '10px 20px', background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, cursor: 'pointer' }}>Cancel</button>
                      <button onClick={async () => { if (!newSupplierName.trim()) { alert('Supplier name is required'); return; } try { await suppliersAPI.create(newSupplierName); fetchSuppliers(); setShowAddSupplier(false); setNewSupplierName(''); } catch (error) { alert('Failed to create: ' + error.message); } }} style={{ padding: '10px 20px', background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Add Supplier</button>
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
                        <td style={styles.td}>{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
                        <td style={styles.td}>{u.id !== user.id && <button onClick={() => handleDeleteUser(u.id)} style={{ padding: '6px 12px', background: '#EF4444', color: 'white', border: 'none', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer' }}>Delete</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Add User Modal */}
              {showAddUser && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowAddUser(false)}>
                  <div style={{ background: '#1E293B', borderRadius: '16px', padding: '2rem', width: '100%', maxWidth: '400px', border: '1px solid #334155' }} onClick={e => e.stopPropagation()}>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem', color: theme.text }}>Add New User</h3>
                    <form onSubmit={handleAddUser}>
                      <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', fontSize: '0.875rem', color: '#94A3B8', marginBottom: '0.5rem' }}>Username</label>
                        <input type="text" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} style={{ width: '100%', padding: '10px 14px', background: '#0F172A', border: '1px solid #334155', borderRadius: '8px', color: '#F1F5F9' }} required />
                      </div>
                      <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', fontSize: '0.875rem', color: '#94A3B8', marginBottom: '0.5rem' }}>Password</label>
                        <input type="password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} style={{ width: '100%', padding: '10px 14px', background: '#0F172A', border: '1px solid #334155', borderRadius: '8px', color: '#F1F5F9' }} required minLength={6} />
                      </div>
                      <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ display: 'block', fontSize: '0.875rem', color: '#94A3B8', marginBottom: '0.5rem' }}>Role</label>
                        <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })} style={{ width: '100%', padding: '10px 14px', background: '#0F172A', border: '1px solid #334155', borderRadius: '8px', color: '#F1F5F9' }}>
                          <option value="user">User</option>
                          <option value="die_designer">Die Designer</option>
                          <option value="simulation_engineer">Simulation Engineer</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                        <button type="button" onClick={() => setShowAddUser(false)} style={{ padding: '10px 20px', background: '#334155', color: '#F1F5F9', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                        <button type="submit" style={{ padding: '10px 20px', background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>Create User</button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>

        {selectedOrder && <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} theme={theme} suppliers={suppliers} plants={plants} onUpdate={(updated) => { setData(prev => prev.map(o => o.id === updated.id ? { ...o, ...updated } : o)); setSelectedOrder(null); }} />}
        {showImportModal && <ImportModal onClose={() => setShowImportModal(false)} onImport={handleImport} />}
        {showPDFImportModal && <PDFImportModal onClose={() => setShowPDFImportModal(false)} onAddRecord={handleAddRecord} />}
        {showPIImportModal && <PIImportModal onClose={() => setShowPIImportModal(false)} onImportRecords={handlePIImport} existingOrders={data} />}
        {showPasswordChangeModal && (
          <PasswordChangeModal
            onClose={() => !forcePasswordChange && setShowPasswordChangeModal(false)}
            onSuccess={handlePasswordChangeSuccess}
            isForced={forcePasswordChange}
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
