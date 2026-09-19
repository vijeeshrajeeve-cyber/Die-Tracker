import React, { useState } from 'react';
import { X, Upload, FileText, AlertTriangle } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { qualityDiscrepanciesAPI } from '../../api';
import { QD_STATUSES } from '../../utils/constants';
import { qdFormTextFromItems, parseQdFormText, dieNoFromFilename } from '../../utils/qdFormText';
import DatePickerField from '../DatePickerField';
import useDialog from '../../hooks/useDialog';
import { BRAND, BRAND_ALPHA } from '../../utils/brand';

// Loaded lazily by QDTrackerPage, so pdfjs only ships to someone who opens this.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const PLANTS = ['GEX 2', 'GEX 1'];
const SETTLED = ['Closed', 'Rejected'];
const EMPTY = {
  qdNo: '', raisedDate: '', supplier: '', dieNo: '', plant: '', issue: '',
  recommendedAction: '', preparedBy: '', authorizedBy: '',
  status: 'Open', closedDate: '', etaDate: '', receivedDate: '',
};

async function readPdfText(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p += 1) {
    pages.push((await (await pdf.getPage(p)).getTextContent()).items);
  }
  return qdFormTextFromItems(pages);
}

// Brings one old, already-issued QD form into the register. What the form
// states plainly is filled in; the admin checks it and supplies what the form
// never records (plant, where the QD stands today).
export default function ImportQDModal({ theme = {}, suppliers = [], onClose, onImported }) {
  const dialogRef = useDialog({ open: true, onClose });
  const [file, setFile] = useState(null);
  const [f, setF] = useState(EMPTY);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState('');
  const [filenameDieNo, setFilenameDieNo] = useState('');
  const [duplicate, setDuplicate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const bg = theme.cardBg || '#09090b';
  const border = theme.cardBorder || '#27272a';
  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';
  const inputBg = theme.inputBg || '#09090b';
  const label = { fontSize: '0.72rem', fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' };
  const field = { padding: '9px 12px', background: inputBg, border: `1px solid ${border}`, borderRadius: 8, color: text, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box', width: '100%' };
  const group = { display: 'flex', flexDirection: 'column', gap: 6 };
  const req = <span style={{ color: '#FCA5A5' }}>*</span>;

  const set = (key) => (value) => setF((prev) => ({ ...prev, [key]: value }));

  // Advisory only -- the server refuses a duplicate on save regardless.
  const checkDuplicate = async (qdNo) => {
    const n = String(qdNo || '').trim();
    if (!n) return setDuplicate(false);
    try {
      setDuplicate(!!(await qualityDiscrepanciesAPI.qdNoExists(n)).exists);
    } catch {
      setDuplicate(false);
    }
  };

  const onPick = async (e) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    if (!/\.pdf$/i.test(picked.name)) {
      setError('Choose the QD form as a PDF');
      return;
    }
    setError('');
    setFile(picked);
    setReading(true);
    setDuplicate(false);
    const fromName = dieNoFromFilename(picked.name);
    setFilenameDieNo(fromName);
    try {
      const p = parseQdFormText(await readPdfText(picked));
      const formDie = p.profileNo && p.dieSuffix ? `${p.profileNo}-${p.dieSuffix}` : '';
      const supplier = (p.supplierCode
        && suppliers.find((s) => String(s.qd_code || '').toUpperCase() === p.supplierCode)?.name) || '';
      setF({
        ...EMPTY, qdNo: p.qdNo, raisedDate: p.raisedDate, supplier, dieNo: formDie || fromName,
        issue: p.issue, recommendedAction: p.recommendedAction, preparedBy: p.preparedBy, authorizedBy: p.authorizedBy,
      });
      const found = [p.qdNo, p.raisedDate, formDie, p.issue].some(Boolean);
      setReadNote(found
        ? 'Filled in from the form. Check every field before importing.'
        : 'Nothing could be read from this PDF. Type the fields in.');
      if (p.qdNo) checkDuplicate(p.qdNo);
    } catch {
      setF({ ...EMPTY, dieNo: fromName });
      setReadNote('This PDF could not be read. Type the fields in; it can still be imported.');
    } finally {
      setReading(false);
    }
  };

  const needsClosed = SETTLED.includes(f.status);
  const needsEta = f.status === 'FOC Accepted' || f.status === 'FOC Received';
  const needsReceived = f.status === 'FOC Received';
  const missing = [
    ['qdNo', 'QD No'], ['raisedDate', 'date raised'], ['supplier', 'supplier'], ['dieNo', 'die no'],
    ['plant', 'plant'], ['issue', 'quality issue'],
    ...(needsClosed ? [['closedDate', 'closed date']] : []),
    ...(needsEta ? [['etaDate', 'ETA']] : []),
    ...(needsReceived ? [['receivedDate', 'received date']] : []),
  ].filter(([key]) => !String(f[key] || '').trim()).map(([, name]) => name);
  const canSave = !!file && !missing.length && !duplicate && !saving && !reading;
  const dieMismatch = !!filenameDieNo && !!f.dieNo && filenameDieNo !== f.dieNo;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      // Only the dates the chosen status asks for go up.
      const { id } = await qualityDiscrepanciesAPI.importExisting(file, {
        ...f,
        closedDate: needsClosed ? f.closedDate : '',
        etaDate: needsEta ? f.etaDate : '',
        receivedDate: needsReceived ? f.receivedDate : '',
      });
      await onImported(id);
    } catch (err) {
      setError(err.message || 'Import failed');
      setSaving(false);
    }
  };

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Import existing QD" tabIndex={-1}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}>
      <style>{`@keyframes qdImportIn { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } }
        .qd-import-cta:hover { filter: brightness(1.06); }`}</style>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: bg, border: `1px solid ${border}`, borderRadius: 16, width: 720, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', animation: 'qdImportIn 0.2s ease-out', color: text }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '20px 24px', borderBottom: `1px solid ${border}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '1rem', fontWeight: 700 }}>Import existing QD</div>
            <div style={{ fontSize: '0.8rem', color: dim, marginTop: 6 }}>
              Brings an already-issued QD form into the register. It is saved as Approved, with no approval step and no Purchase email, and the PDF you upload stays its document.
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', border: `2px dashed ${border}`, borderRadius: 10, cursor: reading ? 'wait' : 'pointer', color: file ? text : dim, fontSize: '0.85rem' }}>
            {file ? <FileText size={18} style={{ color: '#F87171' }} /> : <Upload size={18} />}
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {reading ? 'Reading the form…' : file ? file.name : 'Choose the QD form (PDF)'}
            </span>
            {file && !reading && <span style={{ fontSize: '0.75rem', color: dim }}>Change</span>}
            <input aria-label="Choose the QD form PDF" type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={onPick} disabled={reading || saving} />
          </label>
          {readNote && <div style={{ fontSize: '0.8rem', color: dim }}>{readNote}</div>}

          {file && !reading && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={group}>
                <label style={label} htmlFor="importqd-qdno">QD No {req}</label>
                <input id="importqd-qdno" value={f.qdNo} style={field}
                  onChange={(e) => { set('qdNo')(e.target.value); setDuplicate(false); }}
                  onBlur={(e) => checkDuplicate(e.target.value)} />
                {duplicate && <span style={{ fontSize: '0.75rem', color: '#FCA5A5' }}>QD {f.qdNo.trim().toUpperCase()} is already in the register.</span>}
              </div>
              <div style={group}>
                <label style={label} htmlFor="importqd-raised">Date raised {req}</label>
                <DatePickerField id="importqd-raised" value={f.raisedDate} theme={theme} onChange={set('raisedDate')} placeholder="Select date" />
              </div>
              <div style={group}>
                <label style={label} htmlFor="importqd-supplier">Supplier {req}</label>
                <select id="importqd-supplier" value={f.supplier} onChange={(e) => set('supplier')(e.target.value)} style={{ ...field, cursor: 'pointer' }}>
                  <option value="">Select supplier</option>
                  {suppliers.map((s) => s.name).filter(Boolean).sort().map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <div style={group}>
                <label style={label} htmlFor="importqd-plant">Plant {req}</label>
                <select id="importqd-plant" value={f.plant} onChange={(e) => set('plant')(e.target.value)} style={{ ...field, cursor: 'pointer' }}>
                  <option value="">Select plant (not on the form)</option>
                  {PLANTS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div style={{ ...group, gridColumn: 'span 2' }}>
                <label style={label} htmlFor="importqd-die">Die No {req}</label>
                <input id="importqd-die" value={f.dieNo} onChange={(e) => set('dieNo')(e.target.value)} style={field} placeholder="e.g. 30601-201" />
                {dieMismatch && (
                  <span style={{ fontSize: '0.75rem', color: '#FBBF24', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <AlertTriangle size={13} /> The filename says {filenameDieNo}.
                    <button type="button" onClick={() => set('dieNo')(filenameDieNo)}
                      style={{ background: 'transparent', border: 'none', color: '#FBBF24', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: '0.75rem' }}>
                      Use {filenameDieNo}
                    </button>
                  </span>
                )}
              </div>
              <div style={{ ...group, gridColumn: 'span 2' }}>
                <label style={label} htmlFor="importqd-issue">Quality issue {req}</label>
                <textarea id="importqd-issue" value={f.issue} onChange={(e) => set('issue')(e.target.value)} rows={5}
                  style={{ ...field, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
                <span style={{ fontSize: '0.72rem', color: dim }}>The first line becomes the summary in the register.</span>
              </div>
              <div style={{ ...group, gridColumn: 'span 2' }}>
                <label style={label} htmlFor="importqd-action">Recommended action</label>
                <textarea id="importqd-action" value={f.recommendedAction} onChange={(e) => set('recommendedAction')(e.target.value)} rows={2}
                  style={{ ...field, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
              </div>
              <div style={group}>
                <label style={label} htmlFor="importqd-prepared">Prepared by</label>
                <input id="importqd-prepared" value={f.preparedBy} onChange={(e) => set('preparedBy')(e.target.value)} style={field} />
              </div>
              <div style={group}>
                <label style={label} htmlFor="importqd-authorized">Authorized by</label>
                <input id="importqd-authorized" value={f.authorizedBy} onChange={(e) => set('authorizedBy')(e.target.value)} style={field} />
              </div>
              <div style={group}>
                <label style={label} htmlFor="importqd-status">Status today {req}</label>
                <select id="importqd-status" value={f.status} onChange={(e) => set('status')(e.target.value)} style={{ ...field, cursor: 'pointer' }}>
                  {QD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {needsClosed && (
                <div style={group}>
                  <label style={label} htmlFor="importqd-closed">Closed date {req}</label>
                  <DatePickerField id="importqd-closed" value={f.closedDate} theme={theme} onChange={set('closedDate')} placeholder="Select date" />
                </div>
              )}
              {needsEta && (
                <div style={group}>
                  <label style={label} htmlFor="importqd-eta">ETA from supplier {req}</label>
                  <DatePickerField id="importqd-eta" value={f.etaDate} theme={theme} onChange={set('etaDate')} placeholder="Select ETA" />
                </div>
              )}
              {needsReceived && (
                <div style={group}>
                  <label style={label} htmlFor="importqd-received">Date received {req}</label>
                  <DatePickerField id="importqd-received" value={f.receivedDate} theme={theme} onChange={set('receivedDate')} placeholder="Select date received" />
                </div>
              )}
            </div>
          )}
          {error && <div style={{ fontSize: '0.8rem', color: '#FCA5A5' }}>{error}</div>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: `1px solid ${border}` }}>
          {file && !reading && missing.length > 0 && (
            <span style={{ fontSize: '0.75rem', color: dim, marginRight: 'auto' }}>Still needed: {missing.join(', ')}</span>
          )}
          <button onClick={onClose} style={{ padding: '9px 16px', background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, fontWeight: 500, fontSize: '0.85rem', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={save} disabled={!canSave} className="qd-import-cta"
            style={{ padding: '9px 18px', background: canSave ? BRAND.navy : border, border: 'none', borderRadius: 8, color: canSave ? '#fff' : muted, fontWeight: 600, fontSize: '0.85rem', cursor: canSave ? 'pointer' : 'not-allowed', boxShadow: canSave ? `0 4px 12px ${BRAND_ALPHA.navyGlow}` : 'none' }}>
            {saving ? 'Importing…' : 'Import QD'}
          </button>
        </div>
      </div>
    </div>
  );
}
