import React, { useState, useCallback } from 'react';
import { Upload, FileSpreadsheet, X, AlertTriangle, CheckCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { parseExcelDate, getMonthFromDate, normalizeColumnName } from '../../utils/helpers';

function ImportModal({ onClose, onImport }) {
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
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            const processed = processData(results.data);
            setPreview({ data: processed, count: processed.length });
          },
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
        } catch (err) {
          setError(`Excel error: ${err.message}`);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      setError('Please upload .xlsx, .xls, or .csv file');
    }
  }, []);

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
          background: '#1E293B', borderRadius: '20px', width: '100%', maxWidth: '520px',
          border: '1px solid #334155'
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem', borderBottom: '1px solid #334155' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: '#3B82F6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Upload size={24} color="white" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#F1F5F9' }}>Import Data</h2>
              <p style={{ fontSize: '0.875rem', color: '#64748B' }}>Upload Excel or CSV file</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', padding: '8px', borderRadius: '8px' }}>
            <X size={24} />
          </button>
        </div>
        <div style={{ padding: '1.5rem' }}>
          <div
            style={{
              border: `2px dashed ${dragActive ? '#3B82F6' : '#334155'}`,
              borderRadius: '16px', padding: '2.5rem', textAlign: 'center',
              background: dragActive ? 'rgba(59,130,246,0.1)' : 'transparent', marginBottom: '1rem'
            }}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => { e.preventDefault(); setDragActive(false); processFile(e.dataTransfer.files[0]); }}
          >
            <FileSpreadsheet size={48} color="#64748B" />
            <p style={{ fontSize: '1rem', color: '#F1F5F9', marginTop: '1rem' }}>Drag & drop your file here</p>
            <p style={{ color: '#64748B', margin: '0.5rem 0' }}>or</p>
            <label style={{ display: 'inline-block', padding: '0.75rem 1.5rem', background: '#3B82F6', color: 'white', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
              Browse Files
              <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => processFile(e.target.files[0])} hidden />
            </label>
            <p style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '1rem' }}>Supports .xlsx, .xls, .csv</p>
          </div>
          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(244,63,94,0.1)', color: '#F43F5E', padding: '0.875rem 1rem', borderRadius: '10px', marginBottom: '1rem' }}>
              <AlertTriangle size={18} />
              <span>{error}</span>
            </div>
          )}
          {preview && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(16,185,129,0.1)', padding: '1rem', borderRadius: '10px', marginBottom: '1rem' }}>
              <CheckCircle size={20} color="#10B981" />
              <div>
                <p style={{ fontWeight: 600, color: '#10B981' }}>Ready to import {preview.count} records</p>
                {preview.sheet && <p style={{ fontSize: '0.8rem', color: '#94A3B8' }}>From sheet: {preview.sheet}</p>}
              </div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '1.25rem 1.5rem', borderTop: '1px solid #334155' }}>
          <button onClick={onClose} style={{ padding: '0.75rem 1.5rem', background: '#334155', color: '#F1F5F9', border: '1px solid #475569', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={() => { if (preview?.data) { onImport(preview.data); onClose(); } }}
            disabled={!preview}
            style={{
              padding: '0.75rem 1.5rem',
              background: preview ? '#3B82F6' : '#475569',
              color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600,
              cursor: preview ? 'pointer' : 'not-allowed', opacity: preview ? 1 : 0.5
            }}
          >
            Import {preview?.count || 0} Records
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImportModal;
