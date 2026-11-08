import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, FolderOpen, Search } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { newDieOrderFormsAPI, profileShapesAPI } from '../../api';
import { dialogs } from '../ui/DialogProvider';
import useDialog from '../../hooks/useDialog';
import FindToolingPanel from './FindToolingPanel';
import { applyChoice, finderReadiness } from '../../utils/toolingFinderView';
import {
  fieldsFromDrawing, valuesFromFields, pressOptionName, editToolingField, finderPayload, linesFromTextItems,
} from '../../utils/newDieOrderPrefill';
import { readScales, readTitleBlockNumbers } from '../../utils/pdfImportFields';
import { captureProfileImage, PROFILE_RENDER_DPI } from '../../utils/profileImage';
import { usePalette } from '../../utils/palette';
import { todayLocal } from '../../utils/today.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Prepare New Die Order PDF: pick the profile drawing, read page 1 for a prefill and the
// profile's true-size shape, let the person correct the form and Find tooling, then stamp the
// drawing (written back in place when the browser allows) and record the form. No order is created.

const PLANTS = ['GEX 1', 'GEX 2'];
const TRACE_FAILED = 'profile could not be read — finder unavailable';

const normalizePlantName = (plant) => (plant || '').toString().trim().toUpperCase().replace(/\b0+(\d+)\b/g, '$1');

const downloadBlob = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export default function NewDieOrderModal({ user, theme, presses = [], suppliers = [], onClose }) {
  const c = usePalette(theme);
  const [fileHandle, setFileHandle] = useState(null);
  const [pickedFile, setPickedFile] = useState(null); // the fallback input's File (no write-back)
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [values, setValues] = useState(null);
  const [sources, setSources] = useState({});
  const [profileBlob, setProfileBlob] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileNote, setProfileNote] = useState('');
  const [chosen, setChosen] = useState(null);
  const [showFinder, setShowFinder] = useState(false);
  const [minClearance, setMinClearance] = useState(5);
  const [lastResult, setLastResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);
  const readToken = useRef(0); // a newer pick makes an older read's answers stale
  const dialogRef = useDialog({ open: true, onClose, closeOnEscape: !busy && !reading });

  // The trace reads the die-list CCD and die size at the time it runs; it waits for a plant.
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const plant = values?.PLANT || '';
  useEffect(() => {
    if (!profileBlob) return undefined;
    if (!plant) { setProfileNote('choose the plant to read the profile'); return undefined; }
    let active = true;
    const v = valuesRef.current || {};
    const { meta } = profileBlob;
    setProfile(null);
    setProfileNote('reading the profile…');
    profileShapesAPI.trace(profileBlob.blob, {
      ...meta, cavities: v.NO_OF_CAV, dieSize: v.DIE_SIZE, plant, dieNo: v.DIE_NO,
      dieType: v.SOLID ? 'SOLID' : v.HOLLOW ? 'HOLLOW' : '',
    })
      .then((shape) => { if (active) { setProfile(shape); setProfileNote(''); } })
      .catch(() => { if (active) setProfileNote(TRACE_FAILED); });
    return () => { active = false; };
  }, [profileBlob, plant]);

  const readDrawing = async (file) => {
    const token = ++readToken.current;
    setReading(true);
    setError('');
    setProfile(null);
    setProfileBlob(null);
    setProfileNote('');
    setChosen(null);
    setShowFinder(false);
    setLastResult(null);
    try {
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const page1 = await pdf.getPage(1);
      const lines = linesFromTextItems((await page1.getTextContent()).items);
      const fields = fieldsFromDrawing(lines, lines.map((l) => l.text).join(' '), { fileName: file.name });
      const prefill = valuesFromFields(fields, { today: todayLocal() });
      prefill.values.PRESS = pressOptionName(prefill.values.PRESS, presses);
      if (token !== readToken.current) return;
      setValues(prefill.values);
      setSources(prefill.sources);

      const blob = await captureProfileImage(page1);
      if (token !== readToken.current) return;
      if (!blob) { setProfileNote(TRACE_FAILED); return; }
      const titleBlock = readTitleBlockNumbers(lines);
      setProfileBlob({
        blob,
        meta: {
          renderDpi: PROFILE_RENDER_DPI, scales: readScales(lines), ccdStated: titleBlock.ccd,
          externalPerimeter: titleBlock.externalPerimeter, internalPerimeter: titleBlock.internalPerimeter,
        },
      });
    } catch (err) {
      if (token !== readToken.current) return;
      setError(`The drawing could not be read: ${err.message || err}`);
      // Still usable by hand: a blank form dated today.
      setValues((prev) => prev || valuesFromFields({}, { today: todayLocal() }).values);
      setProfileNote(TRACE_FAILED);
    } finally {
      if (token === readToken.current) setReading(false);
    }
  };

  const handlePick = async () => {
    // File System Access API (Chromium): the stamped PDF overwrites the picked file in place.
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const [handle] = await window.showOpenFilePicker({
          mode: 'readwrite',
          multiple: false,
          types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
        });
        setFileHandle(handle);
        setPickedFile(null);
        setFileName(handle.name);
        await readDrawing(await handle.getFile());
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message || String(err));
      }
      return;
    }
    // Fallback: a plain input; the stamped PDF is downloaded instead.
    setError('');
    fileInputRef.current?.click();
  };

  const handleInput = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setPickedFile(file);
    setFileHandle(null);
    setFileName(file.name);
    readDrawing(file);
  };

  // Presses can land after the drawing was read; map a drawing code ("P7") onto the master then.
  useEffect(() => {
    setValues((prev) => (prev && prev.PRESS ? { ...prev, PRESS: pressOptionName(prev.PRESS, presses) } : prev));
  }, [presses]);

  const pressOptions = useMemo(() => {
    const p = normalizePlantName(plant);
    return p ? presses.filter((row) => normalizePlantName(row.plant) === p) : presses;
  }, [presses, plant]);

  const set = (key, value) => setValues((prev) => ({ ...prev, [key]: value }));
  const setTooling = (key, value) => {
    const next = editToolingField(values, chosen, key, value);
    setValues(next.values);
    setChosen(next.chosen);
  };
  const handleUse = (candidate) => {
    const next = applyChoice(values, candidate);
    setValues(next.values);
    if (next.chosen) setChosen(next.chosen);
  };

  const gate = finderReadiness({
    profile, press: values?.PRESS, dieSize: values?.DIE_SIZE, cavities: values?.NO_OF_CAV, plant,
  });
  const finderQuery = gate.ready ? {
    plant, press: values.PRESS, dieSize: values.DIE_SIZE, cavities: values.NO_OF_CAV,
    profile: { outer: profile.outer_mm, holes: profile.holes_mm || [] },
  } : null;

  const hasFile = !!(fileHandle || pickedFile);
  const generateBlocker = !hasFile ? 'Select the drawing first'
    : !values?.PLANT ? 'Choose the plant'
      : !String(values?.DIE_NO || '').trim() ? 'Enter the die number' : '';

  const handleGenerate = async () => {
    if (generateBlocker || busy) return;
    setBusy(true);
    setError('');
    try {
      let file = pickedFile;
      if (fileHandle) {
        const permOpts = { mode: 'readwrite' };
        if (fileHandle.queryPermission) {
          let permission = await fileHandle.queryPermission(permOpts);
          if (permission !== 'granted' && fileHandle.requestPermission) permission = await fileHandle.requestPermission(permOpts);
          if (permission !== 'granted') throw new Error('Permission to overwrite the file was denied.');
        }
        file = await fileHandle.getFile();
      }
      const { blob, formId } = await newDieOrderFormsAPI.generate(
        file, values, finderPayload({ chosen, result: lastResult, profile }),
      );
      let savedNote;
      if (fileHandle) {
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        savedNote = `saved to "${fileHandle.name}"`;
      } else {
        const name = `${fileName.replace(/\.pdf$/i, '')}-die-order.pdf`;
        downloadBlob(blob, name);
        savedNote = `downloaded as "${name}"`;
      }
      dialogs.notify(`${formId ? `Form #${formId} saved` : 'Form saved'} — die order PDF ${savedNote}.`, 'success');
      onClose();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '10px 14px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
    borderRadius: '10px', color: theme.text, fontSize: '0.875rem',
  };
  const labelStyle = { display: 'block', fontSize: '0.8rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px' };
  const checkboxBoxStyle = {
    display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: theme.inputBg,
    border: `1px solid ${theme.cardBorder}`, borderRadius: '10px', color: theme.text, fontSize: '0.875rem', cursor: 'pointer',
  };
  const checkStyle = { width: '16px', height: '16px', accentColor: theme.primary };
  const hint = (key) => (sources[key]
    ? <span style={{ fontSize: '0.7rem', color: theme.textMuted, marginLeft: '8px' }}>from {sources[key]}</span>
    : null);
  const textField = (key, label, id, extra = {}) => (
    <div style={extra.wide ? { gridColumn: '1 / -1' } : undefined}>
      <label style={labelStyle} htmlFor={id}>{label}{hint(key)}</label>
      <input id={id} type="text" value={values[key]} onChange={(e) => set(key, e.target.value)} style={inputStyle} placeholder={extra.placeholder} />
    </div>
  );
  const toolingField = (key, label, id) => (
    <input id={id} aria-label={label} type="text" value={values[key]} onChange={(e) => setTooling(key, e.target.value)} style={inputStyle} />
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="new-die-order-title" style={{
        background: theme.cardBg, borderRadius: '20px', padding: '2rem', width: '100%', maxWidth: '780px',
        maxHeight: '92vh', overflowY: 'auto', border: `1px solid ${theme.cardBorder}`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h3 id="new-die-order-title" style={{ fontSize: '1.25rem', fontWeight: 700, color: theme.text }}>Prepare New Die Order PDF</h3>
            <p style={{ fontSize: '0.8rem', color: theme.textMuted, marginTop: '4px' }}>
              Stamps the order form onto the drawing and records it{user?.username ? ` as ${user.username}` : ''}. No order is created.
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={() => !busy && onClose()} disabled={busy}
            style={{ padding: '8px', background: 'transparent', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', color: theme.textMuted, borderRadius: '8px' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderRadius: '12px', background: theme.inputBg, border: `1px dashed ${theme.cardBorder}`, marginBottom: '1rem' }}>
          <button type="button" onClick={handlePick} disabled={busy || reading}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', borderRadius: '8px', background: theme.primary, color: theme.primaryText, border: 'none', cursor: (busy || reading) ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
            <FolderOpen size={16} /> {hasFile ? 'Choose different PDF' : 'Select Profile Drawing PDF'}
          </button>
          <input aria-label="Select the profile drawing PDF" ref={fileInputRef} type="file" accept="application/pdf,.pdf" onChange={handleInput} style={{ display: 'none' }} />
          <span style={{ fontSize: '0.85rem', color: hasFile ? theme.text : theme.textMuted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {reading ? 'Reading the drawing…'
              : fileHandle ? fileName
                : pickedFile ? `${fileName} (will download the stamped PDF)`
                  : 'No file selected. The output will overwrite the chosen PDF, or download it if your browser does not support in-place save.'}
          </span>
        </div>

        {values && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
            <div>
              <label style={labelStyle} htmlFor="new-die-order-plant">PLANT{hint('PLANT')}</label>
              <select id="new-die-order-plant" value={values.PLANT} onChange={(e) => set('PLANT', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">Select Plant</option>
                {PLANTS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            {textField('DIE_NO', 'DIE NO', 'new-die-order-die-no', { placeholder: 'e.g. 030724-701' })}
            {textField('PROFILE_NO', 'PROFILE NO', 'new-die-order-profile-no')}
            {textField('CUSTOMER', 'CUSTOMER', 'new-die-order-customer')}

            <div>
              <label style={labelStyle} htmlFor="new-die-order-supplier">SUPPLIER</label>
              <select id="new-die-order-supplier" value={values.SUPPLIER}
                onChange={(e) => {
                  const matched = suppliers.find((s) => s.name === e.target.value);
                  setValues((prev) => ({ ...prev, SUPPLIER: e.target.value, SHIPMENT: matched?.shipment_mode || '' }));
                }}
                style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">Select Supplier</option>
                {suppliers.map((s) => <option key={s.id ?? s.name} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle} htmlFor="new-die-order-date">REQUESTED DATE</label>
              <input id="new-die-order-date" type="date" value={values.DATE} onChange={(e) => set('DATE', e.target.value)} style={inputStyle} />
            </div>

            {textField('DIE_SIZE', 'DIE SIZE', 'new-die-order-die-size', { wide: true })}
            {textField('NO_OF_CAV', 'No OF CAV', 'new-die-order-no-of-cav')}
            <div>
              <label style={labelStyle} htmlFor="new-die-order-press">PRESS{hint('PRESS')}</label>
              <select id="new-die-order-press" value={values.PRESS} onChange={(e) => set('PRESS', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">Select Press</option>
                {pressOptions.map((p) => (
                  <option key={p.id ?? p.press_name} value={p.press_name}>{p.press_name}{p.press_code ? ` (${p.press_code})` : ''}</option>
                ))}
                {values.PRESS && !pressOptions.some((p) => p.press_name === values.PRESS) && (
                  <option value={values.PRESS}>{values.PRESS}</option>
                )}
              </select>
            </div>

            <div>
              <label style={labelStyle}>SOLID{hint('SOLID')}</label>
              <label style={checkboxBoxStyle}>
                <input type="checkbox" checked={!!values.SOLID} onChange={(e) => set('SOLID', e.target.checked)} style={checkStyle} /> Solid
              </label>
            </div>
            <div>
              <label style={labelStyle}>HOLLOW{hint('HOLLOW')}</label>
              <label style={checkboxBoxStyle}>
                <input type="checkbox" checked={!!values.HOLLOW} onChange={(e) => set('HOLLOW', e.target.checked)} style={checkStyle} /> Hollow
              </label>
            </div>

            <div>
              <label style={labelStyle} htmlFor="new-die-order-bolster-no">BOLSTER No{hint('BOLSTER_NO')}</label>
              {toolingField('BOLSTER_NO', 'BOLSTER No', 'new-die-order-bolster-no')}
            </div>
            <div>
              <label style={labelStyle} htmlFor="new-die-order-insert-no">INSERT No{hint('INSERT_NO')}</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {toolingField('INSERT_NO', 'INSERT No', 'new-die-order-insert-no')}
                <button type="button" onClick={() => setShowFinder((v) => !v)} disabled={!gate.ready}
                  title={gate.ready ? 'Find a tooling that fits this profile' : gate.reason} aria-expanded={showFinder}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, padding: '0 12px', borderRadius: '10px', background: 'transparent', border: `1px solid ${gate.ready ? theme.primary : theme.cardBorder}`, color: gate.ready ? theme.primary : theme.textMuted, cursor: gate.ready ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                  <Search size={14} /> Find tooling
                </button>
              </div>
            </div>
            <div>
              <label style={labelStyle} htmlFor="new-die-order-bolster-size">BOLSTER SIZE</label>
              {toolingField('BOLSTER_SIZE', 'BOLSTER SIZE', 'new-die-order-bolster-size')}
            </div>
            <div>
              <label style={labelStyle} htmlFor="new-die-order-insert-size">INSERT SIZE</label>
              {toolingField('INSERT_SIZE', 'INSERT SIZE', 'new-die-order-insert-size')}
            </div>

            <div style={{ gridColumn: '1 / -1', fontSize: '0.75rem', color: theme.textMuted }}>
              {[
                profileNote || (gate.ready ? '' : `Find tooling: ${gate.reason}`),
                chosen ? `Chosen: ${chosen.tooling} ${chosen.fromFinder ? '(from the finder)' : '(edited by hand)'}` : '',
              ].filter(Boolean).join(' · ')}
            </div>

            {showFinder && finderQuery && (
              <div style={{ gridColumn: '1 / -1' }}>
                <FindToolingPanel query={finderQuery} onUse={handleUse} onClose={() => setShowFinder(false)} c={c}
                  minClearance={minClearance} onMinClearanceChange={setMinClearance} onResult={setLastResult} />
              </div>
            )}

            {textField('DELIVERY_DATE', 'REQUESTED DELIVERY DATE', 'new-die-order-delivery-date')}
            <div>
              <label style={labelStyle}>3D MODULE FOR SIMULATION</label>
              <label style={checkboxBoxStyle}>
                <input type="checkbox" checked={!!values.THREE_D_MODULE} onChange={(e) => set('THREE_D_MODULE', e.target.checked)} style={checkStyle} /> Required
              </label>
            </div>
            <div>
              <label style={labelStyle} htmlFor="new-die-order-shipment">MODE OF SHIPMENT</label>
              <input id="new-die-order-shipment" type="text" value={values.SHIPMENT} readOnly style={{ ...inputStyle, opacity: 0.8, cursor: 'not-allowed' }} placeholder="Auto-filled from supplier" />
            </div>
            {textField('PROFILE_WEIGHT_PCT', 'PROFILE WEIGHT START %', 'new-die-order-profile-weight', { placeholder: 'e.g. 85' })}

            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>FINISH</label>
              <div style={{ display: 'flex', gap: '1.25rem', padding: '10px 14px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '10px' }}>
                {[['FINISH_MILL', 'Mill'], ['FINISH_ANODIZING', 'Anodizing'], ['FINISH_POWDER', 'Powder coating']].map(([key, label]) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: theme.text, fontSize: '0.875rem' }}>
                    <input type="checkbox" checked={!!values[key]} onChange={(e) => set(key, e.target.checked)} style={checkStyle} /> {label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div role="alert" style={{ marginTop: '1rem', padding: '10px 14px', borderRadius: '10px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: '#FCA5A5', fontSize: '0.85rem' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px', marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: `1px solid ${theme.cardBorder}` }}>
          {generateBlocker && hasFile && <span style={{ fontSize: '0.75rem', color: theme.textMuted, marginRight: 'auto' }}>{generateBlocker}</span>}
          <button type="button" onClick={onClose} disabled={busy}
            style={{ padding: '10px 20px', borderRadius: '10px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, color: theme.text, cursor: busy ? 'not-allowed' : 'pointer', fontWeight: 500, fontSize: '0.875rem' }}>
            Cancel
          </button>
          <button type="button" onClick={handleGenerate} disabled={busy || reading || !!generateBlocker} title={generateBlocker || undefined}
            style={{ padding: '10px 24px', borderRadius: '10px', background: (busy || reading || generateBlocker) ? '#475569' : theme.primary, border: 'none', color: theme.primaryText, cursor: (busy || reading || generateBlocker) ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.875rem' }}>
            {busy ? 'Generating...' : 'Generate & Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
