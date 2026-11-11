import React, { useId, useMemo, useRef, useState } from 'react';
import { X, FileSpreadsheet, FolderOpen, Files, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toolingsAPI } from '../../api';
import useDialog from '../../hooks/useDialog';
import { usePalette } from '../../utils/palette';
import { todayLocal } from '../../utils/today.js';
import {
  sheetToRows, chunk, drawingFilesOf, summarisePlan, rowDetail, fileDetail, reportCsv, drawingOutcome,
  ROW_ACTION_LABEL, FILE_STATE_LABEL, FIELD_LABELS, TEMPLATE_CSV, isSent,
} from '../../utils/toolingImport';

let xlsxPromise;
const loadXLSX = () => (xlsxPromise ||= import('xlsx'));

const ROW_BATCH = 200;
const NAME_BATCH = 1000;
const SHOWN = 300; // preview and result lines drawn; the report file always has all of them
const mono = "'JetBrains Mono', ui-monospace, monospace";

function saveText(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Many toolings at once (reviewers only): a spreadsheet of toolings, a pile of drawings, or both.
// Step 1 pick, step 2 preview (nothing is written), step 3 run, step 4 results.
export default function ImportToolingsModal({ theme = {}, onClose, onImported }) {
  const c = usePalette(theme);
  const titleId = useId();
  const [step, setStep] = useState('pick');
  const [sheet, setSheet] = useState(null); // { name, rows, columns, ignored }
  const [sheetError, setSheetError] = useState('');
  const [drawings, setDrawings] = useState([]);
  const [defaultPlant, setDefaultPlant] = useState('GEX 1');
  const [bareNumbers, setBareNumbers] = useState('');
  const [createMissing, setCreateMissing] = useState(false);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' });
  const [results, setResults] = useState({ rows: [], files: [] });
  const stopRef = useRef(false);
  const sheetInput = useRef(null);
  const filesInput = useRef(null);
  const folderInput = useRef(null);
  const running = step === 'run';
  const dialogRef = useDialog({ open: true, onClose, closeOnEscape: !busy && !running });

  const summary = useMemo(() => summarisePlan(plan, { createMissing }), [plan, createMissing]);

  const readSheet = async (file) => {
    setSheetError('');
    setSheet(null);
    if (!file) return;
    try {
      const XLSX = await loadXLSX();
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const parsed = sheetToRows(XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }));
      if (parsed.error) { setSheetError(`${file.name}: ${parsed.error}`); return; }
      setSheet({ name: file.name, sheetName: wb.SheetNames[0], ...parsed });
    } catch (e) {
      setSheetError(`${file.name} could not be read: ${e.message}`);
    }
  };

  const addDrawings = (fileList) => {
    const picked = drawingFilesOf(fileList);
    // The same name twice (two folders picked one after the other) is one file: the later pick wins.
    setDrawings((cur) => [...new Map([...cur, ...picked].map((f) => [f.name, f])).values()]);
  };

  const preview = async () => {
    setBusy(true);
    setError('');
    try {
      const rows = sheet ? sheet.rows : [];
      const opts = { defaultPlant, bareNumbers: bareNumbers || null };
      const planned = { rows: [], files: [] };
      for (const part of chunk(rows, ROW_BATCH)) {
        const r = await toolingsAPI.importPlan({ ...opts, rows: part, files: [] });
        planned.rows.push(...r.rows);
      }
      const sheetNumbers = planned.rows.filter((r) => r.action !== 'error').map((r) => r.number);
      for (const part of chunk(drawings.map((f) => f.name), NAME_BATCH)) {
        const r = await toolingsAPI.importPlan({ ...opts, rows: [], files: part, sheetNumbers });
        planned.files.push(...r.files);
      }
      // A number repeated across batches is only caught here.
      const seen = new Set();
      planned.rows = planned.rows.map((r) => {
        if (r.action === 'error' || !seen.has(r.number)) { if (r.number) seen.add(r.number); return r; }
        return { number: r.number, action: 'error', message: 'listed more than once; only the first row counts' };
      });
      setPlan(planned);
      setStep('preview');
    } catch (e) {
      setError(e.message || 'Could not preview the import');
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    stopRef.current = false;
    setStep('run');
    setError('');
    const out = { rows: [], files: [] };
    const rows = sheet ? sheet.rows : [];
    // Only the rows the preview accepted: a repeat or a bad row is reported, not sent.
    const sendable = rows.filter((_, i) => plan.rows[i] && ['create', 'fill'].includes(plan.rows[i].action));
    const skippedRows = plan.rows.filter((r) => !['create', 'fill'].includes(r.action));
    const byName = new Map(drawings.map((f) => [f.name, f]));
    const toSend = plan.files.filter((f) => isSent(f, { createMissing }));
    const left = plan.files.filter((f) => !toSend.includes(f));
    const total = sendable.length + toSend.length;
    let done = 0;
    setProgress({ done, total, label: 'Starting…' });
    try {
      for (const part of chunk(sendable, ROW_BATCH)) {
        if (stopRef.current) break;
        setProgress({ done, total, label: `Toolings ${done + 1}–${done + part.length} of ${sendable.length}` });
        const r = await toolingsAPI.importRows({ rows: part, defaultPlant });
        out.rows.push(...r.results);
        done += part.length;
      }
      out.rows.push(...skippedRows);
      for (const f of toSend) {
        if (stopRef.current) break;
        setProgress({ done, total, label: `Reading ${f.name}` });
        try {
          const answer = await toolingsAPI.importDrawing(byName.get(f.name), {
            number: f.number, defaultPlant, bareNumbers: bareNumbers || null, createMissing,
          });
          out.files.push(drawingOutcome(f.name, answer));
        } catch (e) {
          out.files.push({ name: f.name, number: f.number, ok: false, result: 'Failed', detail: e.message || 'could not be imported' });
        }
        done += 1;
        setResults({ rows: out.rows, files: [...out.files] });
      }
      for (const f of left) out.files.push({ name: f.name, number: f.number || '', ok: false, left: true, result: 'Left out', detail: fileDetail(f, { createMissing }) });
      if (stopRef.current) {
        const sent = new Set(out.files.map((f) => f.name));
        for (const f of toSend) if (!sent.has(f.name)) out.files.push({ name: f.name, number: f.number, ok: false, left: true, result: 'Not sent', detail: 'the import was stopped' });
      }
    } catch (e) {
      setError(`The import stopped: ${e.message || 'the server did not answer'}. What was done up to then is listed below.`);
    }
    setResults(out);
    setProgress({ done, total, label: '' });
    setStep('done');
    onImported?.();
  };

  const btn = { display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 38, padding: '0 16px', borderRadius: 8, border: `1px solid ${c.border}`, background: 'transparent', color: c.text, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', font: 'inherit' };
  const primary = { ...btn, background: c.primary, color: c.primaryText, border: 'none' };
  const control = { minHeight: 36, padding: '0 10px', background: c.inset, border: `1px solid ${c.border}`, borderRadius: 8, color: c.text, fontSize: 13, font: 'inherit' };
  const card = { border: `1px solid ${c.border}`, borderRadius: 10, padding: 14, background: c.inset };
  const label = { fontSize: 12, color: c.muted };
  const th = { textAlign: 'left', padding: '7px 10px', fontSize: 11, fontWeight: 600, color: c.muted, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${c.border}`, position: 'sticky', top: 0, background: c.bg };
  const td = { padding: '7px 10px', fontSize: 12.5, borderBottom: `1px solid ${c.border}`, verticalAlign: 'top' };
  const tone = (kind) => ({ ok: c.success || c.primary, warn: c.warning || c.muted, no: c.danger, muted: c.muted }[kind]);
  const rowTone = { create: 'ok', fill: 'ok', same: 'muted', error: 'no' };
  const fileTone = (f) => (f.state === 'attach' ? 'ok' : f.state === 'new' ? (createMissing ? 'ok' : 'warn') : f.state === 'lookup' ? 'warn' : 'muted');
  const stat = (n, text, kind = 'muted') => (
    <div style={{ ...card, padding: '10px 12px', minWidth: 104, flex: '1 1 104px' }}>
      <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: n ? tone(kind) : c.dim }}>{n}</div>
      <div style={{ fontSize: 12, color: c.muted }}>{text}</div>
    </div>
  );

  const okFiles = results.files.filter((f) => f.ok);
  const failedFiles = results.files.filter((f) => !f.ok && !f.left);
  const needReview = okFiles.filter((f) => f.extracted === 'uncertain' || f.extracted === 'none');
  const count = (action) => results.rows.filter((r) => r.action === action).length;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: c.overlay, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={() => !busy && !running && onClose()}>
      <style>{'.tl-imp button:disabled { opacity: .5; cursor: not-allowed; } .tl-imp button:focus-visible, .tl-imp input:focus-visible, .tl-imp select:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }'}</style>
      <div ref={dialogRef} className="tl-imp" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}
        style={{ width: 860, maxWidth: '100%', maxHeight: '100%', display: 'flex', flexDirection: 'column', background: c.bg, border: `1px solid ${c.border}`, borderRadius: 12, boxShadow: c.shadowLg, color: c.text }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px 12px' }}>
          <div>
            <h2 id={titleId} style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Import toolings</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: c.muted }}>
              {step === 'pick' && 'A list of toolings, their drawings, or both. Nothing is saved until you have seen the preview.'}
              {step === 'preview' && 'This is what the import will do. Nothing has been saved yet.'}
              {step === 'run' && 'Importing — keep this window open.'}
              {step === 'done' && 'Import finished.'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" disabled={busy || running} style={{ background: 'transparent', border: 'none', color: c.muted, cursor: 'pointer' }}><X size={20} /></button>
        </div>

        <div style={{ padding: '0 22px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {step === 'pick' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={card}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <FileSpreadsheet size={18} style={{ color: c.muted }} aria-hidden="true" />
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>Tooling list</div>
                    <div style={label}>Excel or CSV with a Number column; Plant, Kind, Size class, Cavities, Location and Notes are optional.</div>
                  </div>
                  <button type="button" style={btn} onClick={() => saveText(TEMPLATE_CSV, 'tooling-import-template.csv', 'text/csv')}><Download size={15} aria-hidden="true" />Template</button>
                  <button type="button" style={btn} onClick={() => sheetInput.current?.click()}>{sheet ? 'Change file' : 'Choose file'}</button>
                  <input ref={sheetInput} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { readSheet(e.target.files?.[0]); e.target.value = ''; }} />
                </div>
                {sheet && (
                  <div style={{ marginTop: 10, fontSize: 13 }}>
                    <strong>{sheet.name}</strong> — {sheet.rows.length} tooling{sheet.rows.length === 1 ? '' : 's'}
                    <div style={{ ...label, marginTop: 4 }}>
                      Columns read: {Object.entries(sheet.columns).map(([f, h]) => `${FIELD_LABELS[f]} ← “${h}”`).join(', ')}
                      {sheet.ignored.length > 0 && <> · not used: {sheet.ignored.slice(0, 8).join(', ')}{sheet.ignored.length > 8 ? '…' : ''}</>}
                    </div>
                    <button type="button" onClick={() => setSheet(null)} style={{ ...btn, minHeight: 28, padding: '0 10px', fontSize: 12, marginTop: 8 }}>Remove list</button>
                  </div>
                )}
                {sheetError && <div role="alert" style={{ marginTop: 10, fontSize: 13, color: c.danger }}>{sheetError}</div>}
              </div>

              <div style={card}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Files size={18} style={{ color: c.muted }} aria-hidden="true" />
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>Drawings</div>
                    <div style={label}>DXF or PDF, named after the tooling (21599-Ins.dxf, 14017 Bol(475x220).dxf, 25IC2-090454.pdf). A name with no number is looked up in the drawing itself.</div>
                  </div>
                  <button type="button" style={btn} onClick={() => filesInput.current?.click()}>Choose files</button>
                  <button type="button" style={btn} onClick={() => folderInput.current?.click()}><FolderOpen size={15} aria-hidden="true" />Choose folder</button>
                  <input ref={filesInput} type="file" accept=".dxf,.pdf,.dwg" multiple hidden onChange={(e) => { addDrawings(e.target.files); e.target.value = ''; }} />
                  <input ref={folderInput} type="file" webkitdirectory="" directory="" multiple hidden onChange={(e) => { addDrawings(e.target.files); e.target.value = ''; }} />
                </div>
                {drawings.length > 0 && (
                  <div style={{ marginTop: 10, fontSize: 13 }}>
                    <strong>{drawings.length}</strong> drawing file{drawings.length === 1 ? '' : 's'} picked
                    <button type="button" onClick={() => setDrawings([])} style={{ ...btn, minHeight: 28, padding: '0 10px', fontSize: 12, marginLeft: 10 }}>Clear</button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12, alignItems: 'flex-end' }}>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span style={label}>Plant, when a number does not say</span>
                    <select value={defaultPlant} onChange={(e) => setDefaultPlant(e.target.value)} style={control}>
                      <option value="GEX 1">GEX 1</option><option value="GEX 2">GEX 2</option>
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span style={label}>A file named only with a number (21599.dxf) is</span>
                    <select value={bareNumbers} onChange={(e) => setBareNumbers(e.target.value)} style={control}>
                      <option value="">left out</option><option value="insert">an insert</option><option value="bolster">a bolster</option>
                    </select>
                  </label>
                </div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} style={{ marginTop: 2 }} />
                  <span>Add a tooling for each recognised drawing that is not in the master yet
                    <span style={{ ...label, display: 'block' }}>Off: those drawings are left out and listed.</span></span>
                </label>
              </div>
            </div>
          )}

          {step === 'preview' && plan && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {plan.rows.length > 0 && <>{stat(summary.rowsCreate, 'toolings to add', 'ok')}{stat(summary.rowsFill, 'to fill blanks', 'ok')}{stat(summary.rowsSame, 'no change')}{stat(summary.rowsError, 'rows with a problem', 'no')}</>}
                {plan.files.length > 0 && <>{stat(summary.filesAttach, 'drawings to attach', 'ok')}{summary.filesLookup > 0 && stat(summary.filesLookup, 'named inside the drawing', 'warn')}{stat(summary.filesNew, createMissing ? 'drawings adding a tooling' : 'drawings of unknown toolings', createMissing ? 'ok' : 'warn')}{stat(summary.filesLeft, 'files left out')}</>}
              </div>
              {summary.rowsKept > 0 && (
                <div style={{ fontSize: 13, color: c.muted }}>
                  {summary.rowsKept} tooling{summary.rowsKept === 1 ? ' already has' : 's already have'} a different value for something in the sheet. The value in the master stays.
                </div>
              )}
              {plan.files.length > 0 && summary.filesNew > 0 && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />
                  Add the {summary.filesNew} tooling{summary.filesNew === 1 ? '' : 's'} that {summary.filesNew === 1 ? 'is' : 'are'} not in the master yet
                </label>
              )}
              {plan.rows.length > 0 && (
                <div style={{ border: `1px solid ${c.border}`, borderRadius: 10, maxHeight: 230, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th}>Row</th><th style={th}>Tooling</th><th style={th}>Will</th><th style={th}>Details</th></tr></thead>
                    <tbody>
                      {plan.rows.slice(0, SHOWN).map((r, i) => (
                        <tr key={i}>
                          <td style={{ ...td, color: c.muted, fontVariantNumeric: 'tabular-nums' }}>{sheet?.rows[i]?.line ?? i + 1}</td>
                          <td style={{ ...td, fontFamily: mono, fontWeight: 600 }}>{r.number || sheet?.rows[i]?.number || '—'}</td>
                          <td style={{ ...td, color: tone(rowTone[r.action]), fontWeight: 600, whiteSpace: 'nowrap' }}>{ROW_ACTION_LABEL[r.action]}</td>
                          <td style={{ ...td, color: r.action === 'error' ? c.danger : c.muted }}>{rowDetail(r)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {plan.rows.length > SHOWN && <div style={{ padding: 8, fontSize: 12, color: c.muted }}>First {SHOWN} of {plan.rows.length} rows shown.</div>}
                </div>
              )}
              {plan.files.length > 0 && (
                <div style={{ border: `1px solid ${c.border}`, borderRadius: 10, maxHeight: 230, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th}>Drawing</th><th style={th}>Will</th><th style={th}>Details</th></tr></thead>
                    <tbody>
                      {plan.files.slice(0, SHOWN).map((f, i) => (
                        <tr key={i}>
                          <td style={{ ...td, overflowWrap: 'anywhere' }}>{f.name}</td>
                          <td style={{ ...td, color: tone(fileTone(f)), fontWeight: 600, whiteSpace: 'nowrap' }}>{f.state === 'new' && !createMissing ? 'Left out' : FILE_STATE_LABEL[f.state]}</td>
                          <td style={{ ...td, color: c.muted }}>{fileDetail(f, { createMissing })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {plan.files.length > SHOWN && <div style={{ padding: 8, fontSize: 12, color: c.muted }}>First {SHOWN} of {plan.files.length} files shown.</div>}
                </div>
              )}
            </div>
          )}

          {step === 'run' && (
            <div style={{ padding: '26px 0' }} role="status" aria-live="polite">
              <div style={{ height: 8, borderRadius: 4, background: c.inset, overflow: 'hidden', border: `1px solid ${c.border}` }}>
                <div style={{ height: '100%', width: '100%', transformOrigin: 'left', transform: `scaleX(${progress.total ? progress.done / progress.total : 0})`, background: c.primary, transition: 'transform .2s ease' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 10, fontSize: 13, color: c.muted }}>
                <span style={{ overflowWrap: 'anywhere' }}>{progress.label}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{progress.done} of {progress.total}</span>
              </div>
              {results.files.length > 0 && (
                <div style={{ marginTop: 12, fontSize: 13, color: c.muted }}>
                  {okFiles.length} drawing{okFiles.length === 1 ? '' : 's'} read{failedFiles.length ? `, ${failedFiles.length} failed` : ''}
                </div>
              )}
            </div>
          )}

          {step === 'done' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {results.rows.length > 0 && <>{stat(count('create'), 'toolings added', 'ok')}{stat(count('fill'), 'blanks filled', 'ok')}{stat(count('error'), 'rows not imported', 'no')}</>}
                {results.files.length > 0 && <>{stat(okFiles.length, 'drawings stored', 'ok')}{stat(needReview.length, 'openings to review', 'warn')}{stat(failedFiles.length, 'drawings failed', 'no')}</>}
              </div>
              {needReview.length > 0 && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: c.muted }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
                  <span>{needReview.length} drawing{needReview.length === 1 ? ' was' : 's were'} stored but the opening could not be read with confidence. {needReview.length === 1 ? 'It is' : 'They are'} in the Review queue.</span>
                </div>
              )}
              {results.rows.length + results.files.length === 0 && <div style={{ fontSize: 13, color: c.muted }}>Nothing was imported.</div>}
              {(failedFiles.length > 0 || results.rows.some((r) => r.action === 'error') || results.files.length > 0) && (
                <div style={{ border: `1px solid ${c.border}`, borderRadius: 10, maxHeight: 280, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th}>Item</th><th style={th}>Tooling</th><th style={th}>Result</th><th style={th}>Details</th></tr></thead>
                    <tbody>
                      {results.rows.filter((r) => r.action === 'error').slice(0, SHOWN).map((r, i) => (
                        <tr key={`r${i}`}><td style={td}>Sheet row</td><td style={{ ...td, fontFamily: mono }}>{r.number || '—'}</td><td style={{ ...td, color: c.danger, fontWeight: 600 }}>Problem</td><td style={{ ...td, color: c.muted }}>{rowDetail(r)}</td></tr>
                      ))}
                      {[...failedFiles, ...okFiles, ...results.files.filter((f) => f.left)].slice(0, SHOWN).map((f, i) => (
                        <tr key={`f${i}`}>
                          <td style={{ ...td, overflowWrap: 'anywhere' }}>{f.name}</td>
                          <td style={{ ...td, fontFamily: mono }}>{f.number || '—'}</td>
                          <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap', color: f.ok ? tone('ok') : f.left ? c.muted : c.danger }}>{f.result}</td>
                          <td style={{ ...td, color: c.muted }}>{f.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {error && <div role="alert" style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: c.dangerBg, color: c.danger, fontSize: 13 }}>{error}</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '14px 22px 18px', flexWrap: 'wrap' }}>
          <div>
            {step === 'done' && (results.rows.length + results.files.length > 0) && (
              <button type="button" style={btn} onClick={() => saveText(reportCsv(results), `tooling-import-${todayLocal()}.csv`, 'text/csv')}>
                <Download size={15} aria-hidden="true" />Download report
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {step === 'pick' && <>
              <button type="button" style={btn} onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" style={primary} onClick={preview} disabled={busy || (!sheet && drawings.length === 0)}>{busy ? 'Checking…' : 'Preview'}</button>
            </>}
            {step === 'preview' && <>
              <button type="button" style={btn} onClick={() => { setStep('pick'); setPlan(null); }}>Back</button>
              <button type="button" style={primary} onClick={run} disabled={summary.nothingToDo}>
                {summary.nothingToDo ? 'Nothing to import' : `Import ${[summary.rowsToSend && `${summary.rowsToSend} tooling${summary.rowsToSend === 1 ? '' : 's'}`, summary.filesToSend && `${summary.filesToSend} drawing${summary.filesToSend === 1 ? '' : 's'}`].filter(Boolean).join(' and ')}`}
              </button>
            </>}
            {step === 'run' && <button type="button" style={btn} onClick={() => { stopRef.current = true; }}>Stop after this one</button>}
            {step === 'done' && <button type="button" style={primary} onClick={onClose}><CheckCircle2 size={15} aria-hidden="true" />Done</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
