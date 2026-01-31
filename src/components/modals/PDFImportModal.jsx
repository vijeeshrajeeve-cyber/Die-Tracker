import React, { useState, useCallback } from 'react';
import { FileText, X, AlertTriangle, CheckCircle } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { parseDateDMY } from '../../utils/helpers';
import { MONTHS } from '../../utils/constants';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

function PDFImportModal({ onClose, onAddRecord }) {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);

  const extractDieNoFromFilename = (filename) => {
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

      const dieNo = extractDieNoFromFilename(file.name);
      const datePattern = /\d{1,2}\/\d{1,2}\/\d{4}/g;
      const dates = fullText.match(datePattern) || [];

      const sizePattern = /(?:Dia\s*)?(\d{2,4}[Xx]\d{2,4})/i;
      const sizeMatch = fullText.match(sizePattern);
      const dieSize = sizeMatch ? sizeMatch[1].toUpperCase() : null;

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

      const shipmentType = fullText.toLowerCase().includes('air') ? 'AIR' : 'LAND';
      const simulationEnabled = /3D\s*Module\s*(for\s*)?Simulation\s*[:=]?\s*(ok|yes)/i.test(fullText);

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
        'month': requestDate ? MONTHS[new Date(requestDate).getMonth()] : null,
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
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1E293B', borderRadius: '20px', width: '100%', maxWidth: '580px',
          maxHeight: '90vh', overflow: 'hidden', border: '1px solid #334155'
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem', borderBottom: '1px solid #334155' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #F59E0B, #EF4444)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FileText size={24} color="white" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#F1F5F9' }}>Import from PDF</h2>
              <p style={{ fontSize: '0.875rem', color: '#64748B' }}>Upload die ordering request PDF</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', padding: '8px', borderRadius: '8px' }}>
            <X size={24} />
          </button>
        </div>
        <div style={{ padding: '1.5rem', overflowY: 'auto', maxHeight: '65vh' }}>
          {!preview && (
            <div
              style={{
                border: `2px dashed ${dragActive ? '#F59E0B' : '#334155'}`,
                borderRadius: '16px', padding: '2.5rem', textAlign: 'center',
                background: dragActive ? 'rgba(245,158,11,0.1)' : 'transparent', marginBottom: '1rem'
              }}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => { e.preventDefault(); setDragActive(false); processFile(e.dataTransfer.files[0]); }}
            >
              <FileText size={48} color="#64748B" />
              <p style={{ fontSize: '1rem', color: '#F1F5F9', marginTop: '1rem' }}>Drag & drop your PDF file here</p>
              <p style={{ color: '#64748B', margin: '0.5rem 0' }}>or</p>
              <label style={{ display: 'inline-block', padding: '0.75rem 1.5rem', background: 'linear-gradient(135deg, #F59E0B, #EF4444)', color: 'white', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
                Browse PDF Files
                <input type="file" accept=".pdf" onChange={(e) => processFile(e.target.files[0])} hidden />
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
          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(244,63,94,0.1)', color: '#F43F5E', padding: '0.875rem 1rem', borderRadius: '10px', marginBottom: '1rem' }}>
              <AlertTriangle size={18} />
              <span>{error}</span>
            </div>
          )}
          {preview && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(245,158,11,0.1)', padding: '1rem', borderRadius: '10px', marginBottom: '1rem' }}>
                <CheckCircle size={20} color="#F59E0B" />
                <div>
                  <p style={{ fontWeight: 600, color: '#F59E0B' }}>PDF Parsed Successfully</p>
                  <p style={{ fontSize: '0.8rem', color: '#94A3B8' }}>Review extracted data below</p>
                </div>
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
              <button onClick={() => setPreview(null)} style={{ width: '100%', padding: '0.5rem', background: 'transparent', border: '1px solid #334155', borderRadius: '8px', color: '#94A3B8', cursor: 'pointer', marginBottom: '0.5rem' }}>
                Upload Different PDF
              </button>
            </>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '1.25rem 1.5rem', borderTop: '1px solid #334155' }}>
          <button onClick={onClose} style={{ padding: '0.75rem 1.5rem', background: '#334155', color: '#F1F5F9', border: '1px solid #475569', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={() => { if (preview?.record) { onAddRecord(preview.record); onClose(); } }}
            disabled={!preview}
            style={{
              padding: '0.75rem 1.5rem',
              background: preview ? 'linear-gradient(135deg, #F59E0B, #EF4444)' : '#475569',
              color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600,
              cursor: preview ? 'pointer' : 'not-allowed', opacity: preview ? 1 : 0.5
            }}
          >
            Add Die Order
          </button>
        </div>
      </div>
    </div>
  );
}

export default PDFImportModal;
