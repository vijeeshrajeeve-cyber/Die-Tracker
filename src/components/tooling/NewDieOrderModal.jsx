import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, FolderOpen, Search, FileText, Check, Circle, AlertTriangle, Loader2 } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { newDieOrderFormsAPI, profileShapesAPI } from '../../api';
import { dialogs } from '../ui/DialogProvider';
import useDialog from '../../hooks/useDialog';
import FindToolingPanel from './FindToolingPanel';
import { applyChoice, finderReadiness, finderChecklist } from '../../utils/toolingFinderView';
import {
  fieldsFromDrawing, valuesFromFields, pressOptionName, editToolingField, finderPayload, linesFromTextItems,
} from '../../utils/newDieOrderPrefill';
import { readScales, readTitleBlockNumbers } from '../../utils/pdfImportFields';
import { captureProfileImage, PROFILE_RENDER_DPI } from '../../utils/profileImage';
import { usePalette } from '../../utils/palette';
import { todayLocal } from '../../utils/today.js';
import { downloadBlob } from '../../utils/downloadBlob';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Prepare New Die Order PDF: pick the profile drawing, read page 1 for a prefill and the
// profile's true-size shape, let the person correct the form and Find tooling, then stamp the
// drawing (written back in place when the browser allows) and record the form. No order is created.

const PLANTS = ['GEX 1', 'GEX 2'];
const TRACE_FAILED = 'profile could not be read — finder unavailable';
const TRACE_READING = 'reading the profile…';
const WIDE_QUERY = '(min-width: 1000px)'; // room for the tooling pane beside the form

function useWide() {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return wide;
}

const normalizePlantName = (plant) => (plant || '').toString().trim().toUpperCase().replace(/\b0+(\d+)\b/g, '$1');

export default function NewDieOrderModal({ user, theme, presses = [], suppliers = [], onClose }) {
  const c = usePalette(theme);
  const [fileHandle, setFileHandle] = useState(null);
  const noDirectAccess = useRef(false); // the browser refused direct file access once
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
  // The finder ran for an earlier press / die size / cavities / plant / profile than the form now shows.
  const [finderStale, setFinderStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const wide = useWide();
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
    setProfileNote(TRACE_READING);
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
    setFinderStale(false);
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
    if (typeof window.showOpenFilePicker === 'function' && !noDirectAccess.current) {
      let handle = null;
      let file = null;
      try {
        [handle] = await window.showOpenFilePicker({
          mode: 'readwrite',
          multiple: false,
          types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
        });
        file = await handle.getFile();
      } catch (err) {
        if (err.name === 'AbortError') return;
        // Some browsers (embedded ones, or after "don't allow") hand out a picker but refuse
        // the file itself. Use the plain input from here on; the stamped PDF is downloaded.
        noDirectAccess.current = true;
        setError('This browser would not open the file for saving in place. Choose the PDF again — the stamped copy will be downloaded instead.');
        fileInputRef.current?.click();
        return;
      }
      setFileHandle(handle);
      setPickedFile(null);
      setFileName(handle.name);
      await readDrawing(file);
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

  // A dropped PDF: with a file handle (Chromium) it is saved over like a picked one.
  const handleDrop = async (e) => {
    e.preventDefault();
    setDragging(false);
    if (busy || reading) return;
    const item = Array.from(e.dataTransfer?.items || []).find((i) => i.kind === 'file');
    const file = item?.getAsFile() || e.dataTransfer?.files?.[0];
    // Must be asked for before the first await; the items die with the event.
    const handlePromise = item && typeof item.getAsFileSystemHandle === 'function' ? item.getAsFileSystemHandle() : null;
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { setError('Drop a PDF drawing.'); return; }
    let handle = null;
    try { handle = handlePromise ? await handlePromise : null; } catch { handle = null; }
    // The dropped File is kept either way: if saving over the file is refused, it is downloaded.
    setPickedFile(file);
    setFileHandle(handle?.kind === 'file' ? handle : null);
    setFileName(file.name);
    readDrawing(file);
  };

  // The profile picture cut from page 1, shown beside the tooling fields.
  useEffect(() => {
    if (!profileBlob) { setPreviewUrl(null); return undefined; }
    const url = URL.createObjectURL(profileBlob.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [profileBlob]);

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
    if (next.chosen !== chosen) setFinderStale(false); // edited by hand now
  };
  const handleUse = (candidate) => {
    const next = applyChoice(values, candidate);
    setValues(next.values);
    if (next.chosen) { setChosen(next.chosen); setFinderStale(false); }
  };

  const gate = finderReadiness({
    profile, press: values?.PRESS, dieSize: values?.DIE_SIZE, cavities: values?.NO_OF_CAV, plant,
  });
  // An unscaled profile cannot be fitted; its unit outline still finds similar dies by shape.
  const finderMode = gate.ready ? 'fit' : gate.similarityOnly ? 'similarity' : null;
  const finderQuery = finderMode === 'fit' ? {
    plant, press: values.PRESS, dieSize: values.DIE_SIZE, cavities: values.NO_OF_CAV,
    profile: { outer: profile.outer_mm, holes: profile.holes_mm || [] },
  } : finderMode === 'similarity' ? {
    plant, outer: profile.outer_unit, holes: profile.holes_unit || [], cavities: values.NO_OF_CAV,
  } : null;
  const finderEnabled = finderMode != null;

  // A finder answer belongs to the query it was asked with. When press, die size, cavities,
  // plant or the profile change, the kept answer (lastResult, the form record's candidates) is
  // dropped, a tooling chosen from it is no longer "from the finder" (the typed numbers stay),
  // and the panel closes: Find tooling must be run again for the new query.
  const finderKey = JSON.stringify({ mode: finderMode, query: finderQuery });
  const lastFinderKey = useRef(finderKey);
  const lastResultRef = useRef(lastResult);
  lastResultRef.current = lastResult;
  const chosenRef = useRef(chosen);
  chosenRef.current = chosen;
  useEffect(() => {
    if (lastFinderKey.current === finderKey) return;
    lastFinderKey.current = finderKey;
    const fromFinder = !!chosenRef.current?.fromFinder;
    setShowFinder(false);
    setLastResult(null);
    if (fromFinder) setChosen({ ...chosenRef.current, fromFinder: false });
    if (fromFinder || lastResultRef.current) setFinderStale(true);
  }, [finderKey]);

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
      let saveHandle = fileHandle;
      if (fileHandle) {
        try {
          const permOpts = { mode: 'readwrite' };
          if (fileHandle.queryPermission) {
            let permission = await fileHandle.queryPermission(permOpts);
            if (permission !== 'granted' && fileHandle.requestPermission) permission = await fileHandle.requestPermission(permOpts);
            if (permission !== 'granted') throw new Error('Permission to overwrite the file was denied.');
          }
          file = await fileHandle.getFile();
        } catch (err) {
          // A dropped file is still in hand: stamp that and download the result.
          if (!pickedFile) throw err;
          file = pickedFile;
          saveHandle = null;
        }
      }
      const { blob, formId } = await newDieOrderFormsAPI.generate(
        file, values, finderPayload({ chosen, result: lastResult, profile }),
      );
      let savedNote = '';
      if (saveHandle) {
        try {
          const writable = await saveHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          savedNote = `saved to "${saveHandle.name}"`;
        } catch {
          savedNote = ''; // the form is already recorded; do not lose the PDF
        }
      }
      if (!savedNote) {
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

  // ── Presentation ────────────────────────────────────────────────────────────
  const locked = busy || reading;
  const inputStyle = {
    width: '100%', minWidth: 0, padding: '9px 12px', background: c.inset, border: `1px solid ${c.border}`,
    borderRadius: 8, color: c.text, fontSize: '0.875rem', boxSizing: 'border-box',
  };
  const labelStyle = { display: 'flex', alignItems: 'baseline', gap: 6, fontSize: '0.75rem', fontWeight: 600, color: c.muted, marginBottom: 5 };
  const sectionTitle = { fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: c.dim, margin: 0 };
  const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px 14px' };

  const hint = (key) => (sources[key]
    ? <span style={{ fontSize: '0.68rem', fontWeight: 500, color: c.link, marginLeft: 'auto', whiteSpace: 'nowrap' }}>from {sources[key]}</span>
    : null);
  const required = <span aria-hidden="true" style={{ color: c.danger }}>*</span>;
  const label = (text, id, { hintKey, isRequired } = {}) => (
    <label style={labelStyle} htmlFor={id}>{text}{isRequired && required}{hintKey && hint(hintKey)}</label>
  );
  const textField = (key, text, id, extra = {}) => (
    <div style={extra.wide ? { gridColumn: '1 / -1' } : undefined}>
      {label(text, id, { hintKey: key, isRequired: extra.required })}
      <input id={id} type="text" value={values[key]} onChange={(e) => set(key, e.target.value)} style={inputStyle}
        placeholder={extra.placeholder} aria-required={extra.required || undefined} inputMode={extra.inputMode} />
    </div>
  );
  const toolingField = (key, text, id, hintKey) => (
    <div>
      {label(text, id, { hintKey })}
      <input id={id} type="text" value={values[key]} onChange={(e) => setTooling(key, e.target.value)} style={inputStyle} />
    </div>
  );
  // A ticked option drawn as a chip; still a real checkbox underneath.
  const chip = (key, text) => {
    const on = !!values[key];
    return (
      <label key={key} style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: '0.85rem',
        fontWeight: on ? 600 : 500, color: on ? c.primary : c.text, background: on ? c.primarySoft : c.inset,
        border: `1px solid ${on ? c.primary : c.border}`,
      }}>
        <input type="checkbox" checked={on} onChange={(e) => set(key, e.target.checked)} style={{ width: 15, height: 15, margin: 0, accentColor: c.primary }} />
        {text}
      </label>
    );
  };
  const chipGroup = (text, keys, hintKeys = []) => (
    <div role="group" aria-label={text}>
      <div style={labelStyle}>{text}{hintKeys.map((k) => <React.Fragment key={k}>{hint(k)}</React.Fragment>)}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{keys.map(([key, t]) => chip(key, t))}</div>
    </div>
  );
  const section = (title, children, note) => (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h4 style={sectionTitle}>{title}</h4>
        {note && <span style={{ fontSize: '0.72rem', color: c.dim }}>{note}</span>}
      </div>
      {children}
    </section>
  );

  const checklist = values ? finderChecklist({
    profile, profileNote, profileBusy: profileNote === TRACE_READING,
    press: values.PRESS, dieSize: values.DIE_SIZE, cavities: values.NO_OF_CAV, plant,
  }) : [];
  const checkIcon = (state) => (state === 'ok' ? <Check size={14} style={{ color: c.ok }} aria-hidden="true" />
    : state === 'warn' ? <AlertTriangle size={14} style={{ color: c.warn }} aria-hidden="true" />
      : state === 'busy' ? <Loader2 size={14} style={{ color: c.muted }} aria-hidden="true" />
        : <Circle size={14} style={{ color: c.dim }} aria-hidden="true" />);

  const chosenLine = chosen
    ? chosen.fromFinder ? { tone: 'ok', text: `${chosen.tooling} taken from the finder` }
      : finderStale ? { tone: 'warn', text: `${chosen.tooling} was found for an earlier press, size or profile` }
        : { tone: 'muted', text: `${chosen.tooling} edited by hand` }
    : null;
  const toneColor = { ok: c.ok, warn: c.warn, muted: c.muted };

  const dieSections = values && (
    <>
      {section('Die', (
        <div style={grid2}>
          <div>
            {label('Plant', 'new-die-order-plant', { hintKey: 'PLANT', isRequired: true })}
            <select id="new-die-order-plant" value={values.PLANT} onChange={(e) => set('PLANT', e.target.value)} aria-required="true" style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="">Select plant</option>
              {PLANTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {textField('DIE_NO', 'Die no.', 'new-die-order-die-no', { placeholder: 'e.g. 030724-701', required: true })}
          {textField('PROFILE_NO', 'Profile no.', 'new-die-order-profile-no')}
          {textField('CUSTOMER', 'Customer', 'new-die-order-customer')}
        </div>
      ))}

      {section('Press and size', (
        <>
          <div style={grid2}>
            <div>
              {label('Press', 'new-die-order-press', { hintKey: 'PRESS' })}
              <select id="new-die-order-press" value={values.PRESS} onChange={(e) => set('PRESS', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">Select press</option>
                {pressOptions.map((p) => (
                  <option key={p.id ?? p.press_name} value={p.press_name}>{p.press_name}{p.press_code ? ` (${p.press_code})` : ''}</option>
                ))}
                {values.PRESS && !pressOptions.some((p) => p.press_name === values.PRESS) && (
                  <option value={values.PRESS}>{values.PRESS}</option>
                )}
              </select>
            </div>
            {textField('NO_OF_CAV', 'Cavities', 'new-die-order-no-of-cav', { inputMode: 'numeric' })}
            {textField('DIE_SIZE', 'Die size', 'new-die-order-die-size', { wide: true })}
          </div>
          {chipGroup('Die type', [['SOLID', 'Solid'], ['HOLLOW', 'Hollow']], ['SOLID', 'HOLLOW'])}
        </>
      ), 'Find tooling uses these')}
    </>
  );

  const orderSection = values && section('Order details', (
    <>
      <div style={grid2}>
        <div>
          {label('Supplier', 'new-die-order-supplier')}
          <select id="new-die-order-supplier" value={values.SUPPLIER}
            onChange={(e) => {
              const matched = suppliers.find((s) => s.name === e.target.value);
              setValues((prev) => ({ ...prev, SUPPLIER: e.target.value, SHIPMENT: matched?.shipment_mode || '' }));
            }}
            style={{ ...inputStyle, cursor: 'pointer' }}>
            <option value="">Select supplier</option>
            {suppliers.map((s) => <option key={s.id ?? s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div>
          {label('Mode of shipment', 'new-die-order-shipment')}
          <input id="new-die-order-shipment" type="text" value={values.SHIPMENT} readOnly aria-readonly="true"
            style={{ ...inputStyle, background: 'transparent', border: `1px dashed ${c.border}`, color: c.muted, cursor: 'default' }} placeholder="Follows the supplier" />
        </div>
        <div>
          {label('Requested date', 'new-die-order-date')}
          <input id="new-die-order-date" type="date" value={values.DATE} onChange={(e) => set('DATE', e.target.value)} style={inputStyle} />
        </div>
        {textField('DELIVERY_DATE', 'Requested delivery date', 'new-die-order-delivery-date')}
        {textField('PROFILE_WEIGHT_PCT', 'Profile weight start %', 'new-die-order-profile-weight', { placeholder: 'e.g. 85', inputMode: 'decimal' })}
        {chipGroup('3D module for simulation', [['THREE_D_MODULE', 'Required']])}
      </div>
      {chipGroup('Finish', [['FINISH_MILL', 'Mill'], ['FINISH_ANODIZING', 'Anodizing'], ['FINISH_POWDER', 'Powder coating']])}
    </>
  ));

  const finderButtonLabel = finderMode === 'similarity' ? 'Find similar (fit not run)'
    : showFinder ? 'Hide results' : finderStale ? 'Run Find tooling again' : 'Find tooling';
  const toolingPane = values && (
    <>
      {section('Profile', (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 150, borderRadius: 10, border: `1px solid ${c.border}`, background: previewUrl ? '#fff' : c.bg, overflow: 'hidden' }}>
          {previewUrl
            ? <img src={previewUrl} alt="Profile cut from the drawing" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            : <span style={{ fontSize: '0.8rem', color: c.muted, padding: 12, textAlign: 'center' }}>{reading ? 'Reading the drawing…' : 'No profile picture from this drawing'}</span>}
        </div>
      ))}

      {section('Tooling', (
        <>
          <div style={grid2}>
            {toolingField('INSERT_NO', 'Insert no.', 'new-die-order-insert-no', 'INSERT_NO')}
            {toolingField('INSERT_SIZE', 'Insert size', 'new-die-order-insert-size')}
            {toolingField('BOLSTER_NO', 'Bolster no.', 'new-die-order-bolster-no', 'BOLSTER_NO')}
            {toolingField('BOLSTER_SIZE', 'Bolster size', 'new-die-order-bolster-size')}
          </div>
          {chosenLine && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: toneColor[chosenLine.tone] }}>
              {chosenLine.tone === 'ok' && <Check size={13} aria-hidden="true" />}
              {chosenLine.tone === 'warn' && <AlertTriangle size={13} aria-hidden="true" />}
              {chosenLine.text}
            </div>
          )}
        </>
      ), 'Type them, or take one from the finder')}

      {section('Find tooling', (
        <>
          <ul aria-label="What Find tooling needs" style={{ listStyle: 'none', margin: 0, padding: '4px 12px', borderRadius: 10, border: `1px solid ${c.border}`, background: c.bg }}>
            {checklist.map((item, i) => (
              <li key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', fontSize: '0.8rem', borderTop: i ? `1px solid ${c.border}` : 'none' }}>
                {checkIcon(item.state)}
                <span style={{ color: c.text, fontWeight: 500 }}>{item.label}</span>
                <span style={{ marginLeft: 'auto', textAlign: 'right', color: item.state === 'warn' ? c.warn : item.state === 'todo' ? c.dim : c.muted, overflowWrap: 'anywhere' }}>{item.note}</span>
              </li>
            ))}
          </ul>
          {finderStale && !showFinder && (
            <div role="status" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.75rem', padding: '8px 10px', borderRadius: 8, color: c.warn, background: c.warnBg }}>
              <AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
              Press, die size, cavities, plant or the profile changed since the finder ran.
            </div>
          )}
          <button type="button" onClick={() => { setShowFinder((v) => !v); setFinderStale(false); }} disabled={!finderEnabled}
            title={gate.ready ? 'Find a tooling that fits this profile'
              : gate.similarityOnly ? `${gate.reason} — finds similar dies by shape only` : gate.reason}
            aria-expanded={showFinder}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '10px 14px', borderRadius: 8, fontWeight: 600, fontSize: '0.875rem',
              cursor: finderEnabled ? 'pointer' : 'not-allowed',
              background: !finderEnabled ? c.inset : showFinder ? 'transparent' : c.primary,
              color: !finderEnabled ? c.dim : showFinder ? c.primary : c.primaryText,
              border: `1px solid ${finderEnabled ? c.primary : c.border}`,
            }}>
            <Search size={15} aria-hidden="true" /> {finderButtonLabel}
          </button>
          {!finderEnabled && (
            <div style={{ fontSize: '0.75rem', color: c.muted }}>
              {profileNote && !profile ? `Waiting: ${profileNote}.` : `Waiting: ${gate.reason}.`}
            </div>
          )}
          {showFinder && finderQuery && (
            <FindToolingPanel query={finderQuery} mode={finderMode} onUse={handleUse} onClose={() => setShowFinder(false)} c={c}
              minClearance={minClearance} onMinClearanceChange={finderMode === 'fit' ? setMinClearance : undefined}
              onResult={setLastResult} chosenNumber={chosen?.fromFinder ? chosen.tooling : null} />
          )}
        </>
      ))}
    </>
  );

  const saveNote = generateBlocker && hasFile ? { text: generateBlocker, color: c.warn }
    : fileHandle ? { text: `Saves the stamped PDF over “${fileName}”`, color: c.muted }
      : pickedFile ? { text: 'Downloads the stamped PDF — this browser cannot save over the drawing', color: c.muted }
        : null;
  const dropHandlers = {
    onDragOver: (e) => { e.preventDefault(); if (!locked) setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop: handleDrop,
  };
  const column = { display: 'flex', flexDirection: 'column', gap: 22 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: c.overlay, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="new-die-order-title" style={{
        display: 'flex', flexDirection: 'column', background: c.bg, borderRadius: 16, width: '100%', maxWidth: values ? 1120 : 640,
        maxHeight: '94vh', border: `1px solid ${c.border}`, boxShadow: c.shadowLg, overflow: 'hidden', color: c.text,
      }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: '18px 24px', borderBottom: `1px solid ${c.border}` }}>
          <div>
            <h3 id="new-die-order-title" style={{ fontSize: '1.15rem', fontWeight: 700, color: c.text, margin: 0 }}>Prepare New Die Order PDF</h3>
            <p style={{ fontSize: '0.8rem', color: c.muted, margin: '4px 0 0' }}>
              Stamps the order form onto the drawing and records it{user?.username ? ` as ${user.username}` : ''}. No order is created.
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={() => !busy && onClose()} disabled={busy}
            style={{ padding: 8, background: 'transparent', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', color: c.muted, borderRadius: 8, display: 'flex' }}>
            <X size={20} />
          </button>
        </header>

        <input aria-label="Select the profile drawing PDF" ref={fileInputRef} type="file" accept="application/pdf,.pdf" onChange={handleInput} style={{ display: 'none' }} />

        {!hasFile ? (
          <div style={{ padding: 24 }}>
            <div {...dropHandlers} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '36px 24px', borderRadius: 12, textAlign: 'center',
              background: dragging ? c.primarySoft : c.inset, border: `1.5px dashed ${dragging ? c.primary : c.border}`,
            }}>
              <FileText size={32} aria-hidden="true" style={{ color: c.muted }} />
              <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>Start with the profile drawing</div>
              <div style={{ fontSize: '0.8rem', color: c.muted, maxWidth: 420 }}>
                Page 1 fills in the form and gives the profile shape for Find tooling. Drop the PDF here, or choose it.
              </div>
              <button type="button" onClick={handlePick} disabled={locked}
                style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, padding: '10px 18px', borderRadius: 8, background: c.primary, color: c.primaryText, border: 'none', cursor: locked ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.875rem' }}>
                <FolderOpen size={16} aria-hidden="true" /> Select Profile Drawing PDF
              </button>
              <div style={{ fontSize: '0.72rem', color: c.dim, maxWidth: 420 }}>
                The stamped PDF is saved over the chosen file, or downloaded if this browser cannot save in place.
              </div>
            </div>
          </div>
        ) : (
          <div {...dropHandlers} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 24px', borderBottom: `1px solid ${c.border}`,
            background: dragging ? c.primarySoft : c.inset,
          }}>
            <FileText size={18} aria-hidden="true" style={{ color: c.muted, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</div>
              <div role="status" style={{ fontSize: '0.72rem', color: c.muted }}>
                {reading ? 'Reading the drawing…' : fileHandle ? 'Will be saved over with the stamped order form' : 'The stamped PDF will be downloaded as a new file'}
              </div>
            </div>
            <button type="button" onClick={handlePick} disabled={locked}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, background: 'transparent', color: c.text, border: `1px solid ${c.border}`, cursor: locked ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.8rem', flexShrink: 0 }}>
              <FolderOpen size={14} aria-hidden="true" /> Choose different PDF
            </button>
          </div>
        )}

        {values && (wide ? (
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <div style={{ ...column, flex: 1, minWidth: 0, overflowY: 'auto', padding: '20px 24px' }}>
              {dieSections}
              {orderSection}
            </div>
            <aside aria-label="Profile and tooling" style={{ ...column, width: 420, flexShrink: 0, overflowY: 'auto', padding: '20px 20px', borderLeft: `1px solid ${c.border}`, background: c.inset }}>
              {toolingPane}
            </aside>
          </div>
        ) : (
          <div style={{ ...column, flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' }}>
            {dieSections}
            {toolingPane}
            {orderSection}
          </div>
        ))}

        {error && (
          <div role="alert" style={{ margin: values ? '0' : '0 24px 16px', padding: '10px 24px', borderTop: values ? `1px solid ${c.border}` : 'none', borderRadius: values ? 0 : 8, background: c.dangerBg, color: c.danger, fontSize: '0.85rem' }}>
            {error}
          </div>
        )}

        <footer style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, padding: '14px 24px', borderTop: `1px solid ${c.border}` }}>
          {saveNote && <span style={{ fontSize: '0.75rem', color: saveNote.color, marginRight: 'auto', minWidth: 0 }}>{saveNote.text}</span>}
          <button type="button" onClick={onClose} disabled={busy}
            style={{ padding: '10px 18px', borderRadius: 8, background: 'transparent', border: `1px solid ${c.border}`, color: c.text, cursor: busy ? 'not-allowed' : 'pointer', fontWeight: 500, fontSize: '0.875rem' }}>
            Cancel
          </button>
          <button type="button" onClick={handleGenerate} disabled={locked || !!generateBlocker} title={generateBlocker || undefined}
            style={{ padding: '10px 22px', borderRadius: 8, background: (locked || generateBlocker) ? c.inset : c.primary, border: `1px solid ${(locked || generateBlocker) ? c.border : c.primary}`, color: (locked || generateBlocker) ? c.dim : c.primaryText, cursor: (locked || generateBlocker) ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.875rem', flexShrink: 0 }}>
            {busy ? 'Generating…' : 'Generate & Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}

