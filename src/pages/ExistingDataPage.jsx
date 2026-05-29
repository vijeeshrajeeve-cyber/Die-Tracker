import React, { useState, useEffect } from 'react';
import { Upload, Database } from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { existingDataAPI } from '../api';

export default function ExistingDataPage({ plants, theme, setToast }) {
  const [activeTab, setActiveTab] = useState('die-details');
  const [meta, setMeta] = useState(null);
  const [metaLoading, setMetaLoading] = useState(false);

  // Die Details tab
  const [ddPlant, setDdPlant] = useState('');
  const [ddRows, setDdRows] = useState(null);
  const [ddFileName, setDdFileName] = useState('');
  const [ddImporting, setDdImporting] = useState(false);
  const [ddStatus, setDdStatus] = useState(null);

  // Production Data tab
  const [pdPlant, setPdPlant] = useState('');
  const [pdRows, setPdRows] = useState(null);
  const [pdFileName, setPdFileName] = useState('');
  const [pdImporting, setPdImporting] = useState(false);
  const [pdStatus, setPdStatus] = useState(null);

  const loadMeta = async () => {
    setMetaLoading(true);
    try {
      const data = await existingDataAPI.getMeta();
      setMeta(data);
    } catch (_) {
      // meta is informational — silent fail
    } finally {
      setMetaLoading(false);
    }
  };

  useEffect(() => { loadMeta(); }, []);

  const parseFile = async (file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    if (['csv', 'tsv', 'txt'].includes(ext)) {
      return new Promise((resolve, reject) => {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (result) => resolve(result.data),
          error: (err) => reject(new Error(err.message)),
        });
      });
    } else if (['xlsx', 'xls'].includes(ext)) {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json(ws, { defval: '' });
    } else {
      throw new Error('Unsupported file type. Use CSV or Excel (.xlsx, .xls).');
    }
  };

  const handleDdFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setDdStatus(null);
    try {
      const rows = await parseFile(file);
      setDdRows(rows);
      setDdFileName(file.name);
    } catch (err) {
      setDdStatus({ type: 'error', message: `Could not parse file: ${err.message}` });
      setDdRows(null);
      setDdFileName('');
    }
  };

  const handlePdFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPdStatus(null);
    try {
      const rows = await parseFile(file);
      setPdRows(rows);
      setPdFileName(file.name);
    } catch (err) {
      setPdStatus({ type: 'error', message: `Could not parse file: ${err.message}` });
      setPdRows(null);
      setPdFileName('');
    }
  };

  const handleDdImport = async () => {
    if (!ddPlant || !ddRows) return;
    setDdImporting(true);
    setDdStatus(null);
    try {
      const result = await existingDataAPI.importDieDetails({ plant: ddPlant, rows: ddRows, sourceFile: ddFileName });
      setDdStatus({ type: 'success', message: `Imported ${result.imported} rows, skipped ${result.skipped}` });
      setMeta(result.meta);
      setDdRows(null);
      setDdFileName('');
      setTimeout(() => setDdStatus(null), 5000);
    } catch (err) {
      setDdStatus({ type: 'error', message: err.message || 'Import failed — check connection' });
    } finally {
      setDdImporting(false);
    }
  };

  const handlePdImport = async () => {
    if (!pdPlant || !pdRows) return;
    setPdImporting(true);
    setPdStatus(null);
    try {
      const result = await existingDataAPI.importProduction({ plant: pdPlant, rows: pdRows, sourceFile: pdFileName });
      setPdStatus({ type: 'success', message: `Imported ${result.imported} rows, skipped ${result.skipped}` });
      setMeta(result.meta);
      setPdRows(null);
      setPdFileName('');
      setTimeout(() => setPdStatus(null), 5000);
    } catch (err) {
      setPdStatus({ type: 'error', message: err.message || 'Import failed — check connection' });
    } finally {
      setPdImporting(false);
    }
  };

  const getDdMeta = (plantName) => meta?.dieDetails?.find(r => r.plant === plantName);
  const getPdMeta = (plantName) => meta?.productionData?.find(r => r.plant === plantName);

  const inputStyle = {
    width: '100%', padding: '8px 12px', background: theme.inputBg,
    border: `1px solid ${theme.cardBorder}`, borderRadius: '8px',
    color: theme.text, fontSize: '0.875rem', cursor: 'pointer',
  };

  const tabBtnStyle = (active) => ({
    padding: '8px 20px', borderRadius: '8px', border: 'none',
    background: active ? (theme.primary || '#3B82F6') : 'transparent',
    color: active ? (theme.primaryText || '#ffffff') : theme.textDim,
    cursor: 'pointer', fontWeight: active ? 600 : 400, fontSize: '0.875rem',
    transition: 'all 0.15s ease',
  });

  const renderTabContent = (
    plant, setPlant,
    rows, fileName,
    handleFileChange,
    importing, handleImport,
    status,
  ) => (
    <div style={{ padding: '1.25rem 0 0.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', color: theme.textDim, marginBottom: '6px' }}>Plant</label>
          <select value={plant} onChange={(e) => setPlant(e.target.value)} style={inputStyle}>
            <option value="">— Select plant —</option>
            {(plants || []).map(p => (
              <option key={p.id || p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', color: theme.textDim, marginBottom: '6px' }}>File</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '8px 14px', borderRadius: '8px', cursor: 'pointer',
              background: 'linear-gradient(135deg, #0EA5E9, #06B6D4)',
              color: 'white', fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap',
            }}>
              <Upload size={14} />
              Choose CSV / Excel
              <input
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xls"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </label>
            {fileName && (
              <span style={{ fontSize: '0.8rem', color: theme.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                {fileName}
              </span>
            )}
          </div>
        </div>
      </div>

      {rows && plant && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', background: 'rgba(59,130,246,0.08)',
          borderRadius: '8px', border: '1px solid rgba(59,130,246,0.2)',
          marginBottom: '1rem',
        }}>
          <span style={{ fontSize: '0.875rem', color: theme.text }}>
            Ready to import <strong>{rows.length.toLocaleString()} rows</strong> into <strong>{plant}</strong>
          </span>
          <button
            onClick={handleImport}
            disabled={importing}
            style={{
              padding: '7px 18px', borderRadius: '8px', border: 'none',
              background: importing ? theme.cardBorder : 'linear-gradient(135deg, #3B82F6, #8B5CF6)',
              color: 'white', cursor: importing ? 'not-allowed' : 'pointer',
              fontWeight: 600, fontSize: '0.875rem', whiteSpace: 'nowrap',
            }}
          >
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      )}

      {status && (
        <div style={{
          padding: '10px 14px', borderRadius: '8px', fontSize: '0.85rem',
          background: status.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
          color: status.type === 'success' ? '#10B981' : '#EF4444',
          border: `1px solid ${status.type === 'success' ? '#10B981' : '#EF4444'}40`,
        }}>
          {status.message}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ gridColumn: 'span 2', background: theme.cardBg, borderRadius: '16px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}` }}>
      <div style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: theme.text, margin: 0 }}>
          <Database size={20} /> Existing Data Import
        </h3>
        <p style={{ fontSize: '0.8rem', color: theme.textDim, marginTop: '4px', marginBottom: 0 }}>
          Upload historical die master and production data by plant. Each import replaces all existing rows for the selected plant.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', background: theme.inputBg, padding: '4px', borderRadius: '10px', width: 'fit-content' }}>
        <button style={tabBtnStyle(activeTab === 'die-details')} onClick={() => setActiveTab('die-details')}>
          Die Details
        </button>
        <button style={tabBtnStyle(activeTab === 'production')} onClick={() => setActiveTab('production')}>
          Production Data
        </button>
      </div>

      {activeTab === 'die-details' && renderTabContent(
        ddPlant, setDdPlant, ddRows, ddFileName,
        handleDdFileChange, ddImporting, handleDdImport, ddStatus,
      )}
      {activeTab === 'production' && renderTabContent(
        pdPlant, setPdPlant, pdRows, pdFileName,
        handlePdFileChange, pdImporting, handlePdImport, pdStatus,
      )}

      {/* Status Table */}
      <div style={{ marginTop: '1.5rem', borderTop: `1px solid ${theme.cardBorder}`, paddingTop: '1rem' }}>
        <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: theme.text, margin: '0 0 0.75rem' }}>
          Import Status by Plant
        </h4>
        {metaLoading ? (
          <p style={{ fontSize: '0.8rem', color: theme.textDim, margin: 0 }}>Loading…</p>
        ) : (
          <div style={{ background: theme.inputBg, borderRadius: '10px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  {['Plant', 'Die Details', 'Last Imported', 'Production Data', 'Last Imported'].map((h, i) => (
                    <th key={i} style={{
                      padding: '10px 12px', textAlign: i === 1 || i === 3 ? 'right' : 'left',
                      color: theme.textDim, fontWeight: 600, fontSize: '0.75rem',
                      textTransform: 'uppercase', background: theme.tableBg,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(plants || []).map(p => {
                  const dd = getDdMeta(p.name);
                  const pd = getPdMeta(p.name);
                  const cellBorder = { borderTop: `1px solid ${theme.cardBorder}` };
                  return (
                    <tr key={p.id || p.name}>
                      <td style={{ ...cellBorder, padding: '10px 12px', color: theme.text, fontWeight: 500 }}>{p.name}</td>
                      <td style={{ ...cellBorder, padding: '10px 12px', textAlign: 'right', color: dd ? theme.text : theme.textDim }}>
                        {dd ? dd.count.toLocaleString() : '—'}
                      </td>
                      <td style={{ ...cellBorder, padding: '10px 12px', color: theme.textDim, fontSize: '0.8rem' }}>
                        {dd?.last_imported ? new Date(dd.last_imported).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ ...cellBorder, padding: '10px 12px', textAlign: 'right', color: pd ? theme.text : theme.textDim }}>
                        {pd ? pd.count.toLocaleString() : '—'}
                      </td>
                      <td style={{ ...cellBorder, padding: '10px 12px', color: theme.textDim, fontSize: '0.8rem' }}>
                        {pd?.last_imported ? new Date(pd.last_imported).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  );
                })}
                {(!plants || plants.length === 0) && (
                  <tr>
                    <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: theme.textDim }}>
                      No plants configured
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
