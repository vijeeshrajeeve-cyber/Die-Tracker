import React, { useState, useRef } from 'react';
import { X, AlertTriangle, Upload, ChevronDown, ChevronRight } from 'lucide-react';
import { qualityDiscrepanciesAPI, ordersAPI, extractProfileFromDie } from '../../api';
import { QD_OUTCOMES } from '../../utils/constants';
import DatePickerField from '../DatePickerField';

const GRADIENT = 'linear-gradient(135deg,#3B82F6,#8B5CF6)';

// qd_billet_parameters columns — order here drives the Production parameters grid.
const BILLET_FIELDS = [
  { key: 'die_soaking_hours', label: 'Die Soaking (hrs)' },
  { key: 'die_temperature', label: 'Die Temperature' },
  { key: 'billet_temp', label: 'Billet Temp' },
  { key: 'breakthrough_pressure', label: 'Breakthrough Pressure' },
  { key: 'running_pressure', label: 'Running Pressure' },
  { key: 'billet_length', label: 'Billet Length' },
  { key: 'alloy', label: 'Alloy' },
  { key: 'ram_speed', label: 'Ram Speed' },
  { key: 'any_delay_observed', label: 'Any Delay Observed' },
];

const FILE_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'profile_image', label: 'Profile image' },
  { value: 'approved_design', label: 'Approved design' },
  { value: 'trial_photo', label: 'Trial photo' },
];

// Declared outside the modal (not created during render) so its state — none,
// it's controlled entirely by `open`/`onToggle` — never resets on a parent re-render.
function Section({ id, title, hint, open, onToggle, colors, children }) {
  const { border, text, dim, muted } = colors;
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
      <button type="button" onClick={() => onToggle(id)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', color: text }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: dim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</span>
          {hint && <span style={{ fontSize: 11.5, color: dim, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{hint}</span>}
        </span>
        {open ? <ChevronDown size={15} style={{ color: muted }} /> : <ChevronRight size={15} style={{ color: muted }} />}
      </button>
      {open && <div style={{ padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>}
    </div>
  );
}

export default function RaiseQDModal({ theme = {}, suppliers = [], onClose, onCreated, editQd = null }) {
  // Edit mode: the same form, pre-filled from an existing QD. The server only
  // permits this while the QD is a Draft or has been sent back.
  const isEdit = !!editQd;
  const isSentBack = isEdit && editQd.approval_state === 'SentBack';
  const [dieNo, setDieNo] = useState(editQd?.die_no || '');
  const [plant, setPlant] = useState(editQd?.plant || 'GEX 2');
  const [supplier, setSupplier] = useState(editQd?.supplier || suppliers[0] || '');
  const [corrector, setCorrector] = useState(editQd?.corrector || '');
  const [inputAtFailure, setInputAtFailure] = useState(editQd?.input_at_failure || '');
  const [issue, setIssue] = useState(editQd?.issue_detail || '');
  const [outcome, setOutcome] = useState(editQd?.outcome || 'Supplier rework');
  const [staged, setStaged] = useState([]); // [{ file, category }] — newly added images, each with its own category
  const [fileCategory, setFileCategory] = useState('general'); // default category applied to newly added files
  const [existingFiles] = useState(editQd?.files || []); // already-attached images (edit mode)
  const [removedFileIds, setRemovedFileIds] = useState([]); // existing images marked for deletion; applied on save
  const [submitting, setSubmitting] = useState(false);
  const [submitKind, setSubmitKind] = useState(null); // 'draft' | 'submit' — which footer button is busy
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  // Set only once create() itself succeeds. Lets a retry re-use the already
  // created draft instead of creating a second, orphaned one.
  const createdIdRef = useRef(isEdit ? editQd.id : null);
  // Tracks which category groups have already uploaded. Files are sent one
  // request per category (the server takes one category per request), so a
  // retry re-attempts only the groups that haven't succeeded yet — an upload
  // failure no longer causes the whole create+upload block to be skipped.
  const uploadedCatsRef = useRef(new Set());
  const appliedDeletesRef = useRef(new Set()); // image removals already applied, so a retry doesn't repeat them

  // Part-A header fields + the two billet readings. Every field stays editable
  // even after an auto-fill match — this is a best-effort prefill, not a lock.
  const [partA, setPartA] = useState({
    profileNumber: editQd?.profile_number || '', dieReceivedDate: editQd?.die_received_date || '',
    press: editQd?.press || '', dieType: editQd?.die_type || '', dieSize: editQd?.die_size || '',
    noOfCavity: editQd?.no_of_cavity || '', tooling: editQd?.tooling || '', noOfTrials: editQd?.no_of_trials || '',
    noOfCorrections: editQd?.no_of_corrections || '', productionDate: editQd?.production_date || '',
    manufacturingDefect: editQd?.manufacturing_defect || '', diePerformance: editQd?.die_performance || '',
    recommendedAction: editQd?.recommended_action || '',
  });
  const [billets, setBillets] = useState(() => {
    const rows = editQd?.billets || [];
    const pick = (which) => rows.find((b) => b.billet === which) || {};
    return { first: pick('first'), last: pick('last') };
  });
  const [dieOrderId, setDieOrderId] = useState(editQd?.die_order_id || null);
  const [lookupNote, setLookupNote] = useState('');
  const ordersCacheRef = useRef(null);

  const [open, setOpen] = useState({ die: true, partA: false, production: false, discrepancy: true, images: false });
  const toggle = (id) => setOpen((prev) => ({ ...prev, [id]: !prev[id] }));

  const bg = theme.cardBg || '#09090b';
  const border = theme.cardBorder || '#27272a';
  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';
  const inputBg = theme.inputBg || '#09090b';
  const mono = "'JetBrains Mono', ui-monospace, monospace";

  const label = { fontSize: '0.72rem', fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' };
  const field = { padding: '9px 12px', background: inputBg, border: `1px solid ${border}`, borderRadius: 8, color: text, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' };
  const group = { display: 'flex', flexDirection: 'column', gap: 6 };

  const canSubmit = !!dieNo.trim() && !!supplier.trim() && !submitting;

  const setPA = (f) => (e) => setPartA((prev) => ({ ...prev, [f]: e.target.value }));
  const setPADate = (f) => (iso) => setPartA((prev) => ({ ...prev, [f]: iso }));
  const setBilletField = (which, f) => (e) =>
    setBillets((prev) => ({ ...prev, [which]: { ...prev[which], [f]: e.target.value } }));

  // Best-effort auto-fill: match the typed Die No against orders already on
  // file. `ordersAPI.getAll` doesn't expose a by-die-no lookup, so this loads
  // the full list once (cached for the life of the modal) and filters client
  // side. A miss is silent — the form stays fully manual either way.
  const lookupDie = async () => {
    const q = dieNo.trim();
    if (!q) return;
    setPartA((prev) => ({ ...prev, profileNumber: extractProfileFromDie(q) || prev.profileNumber }));
    try {
      if (!ordersCacheRef.current) {
        const res = await ordersAPI.getAll();
        ordersCacheRef.current = res.orders || [];
      }
      const match = ordersCacheRef.current.find(
        (o) => String(o['DIE NO'] || '').trim().toLowerCase() === q.toLowerCase()
      );
      if (!match) { setLookupNote(''); return; }
      setDieOrderId(match.id);
      if (match.Supplier) setSupplier(match.Supplier);
      if (match.Plant) setPlant(match.Plant);
      setPartA((prev) => ({
        ...prev,
        dieReceivedDate: match['Die Received Date'] || prev.dieReceivedDate,
        press: match.Press || prev.press,
        dieType: match.TYPE || prev.dieType,
        dieSize: match['Die Size'] || prev.dieSize,
        noOfCavity: match.Cavity != null && match.Cavity !== '' ? String(match.Cavity) : prev.noOfCavity,
        noOfTrials: match['No of Trial'] != null && match['No of Trial'] !== '' ? String(match['No of Trial']) : prev.noOfTrials,
      }));
      setOpen((prev) => ({ ...prev, partA: true }));
      setLookupNote(`Matched order${match['Order No'] ? ` ${match['Order No']}` : ''} — Die details prefilled below, still editable`);
    } catch {
      // Lookup is a convenience only — a failure here must not block manual entry.
    }
  };

  // Camel-case payload for the Edit (PUT) endpoint — mirrors the raise form.
  const buildEditPayload = () => ({
    profileNumber: partA.profileNumber, supplier: supplier.trim(), plant, corrector: corrector.trim(),
    dieReceivedDate: partA.dieReceivedDate, press: partA.press, dieType: partA.dieType, dieSize: partA.dieSize,
    noOfCavity: partA.noOfCavity, tooling: partA.tooling, noOfTrials: partA.noOfTrials, noOfCorrections: partA.noOfCorrections,
    productionDate: partA.productionDate, manufacturingDefect: partA.manufacturingDefect, diePerformance: partA.diePerformance,
    issue: issue.trim(), recommendedAction: partA.recommendedAction, inputAtFailure: inputAtFailure.trim(), outcome,
    billets,
  });

  const save = async (doSubmit) => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitKind(doSubmit ? 'submit' : 'draft');
    setError('');
    let phase = isEdit ? 'saving your changes' : 'creating the QD';
    try {
      let id;
      if (isEdit) {
        id = editQd.id;
        await qualityDiscrepanciesAPI.updateDetails(id, buildEditPayload());
        // Apply pending image removals. Idempotent on retry (skip applied ones;
        // a file already gone answers 404, which we treat as done).
        for (const fid of removedFileIds) {
          if (appliedDeletesRef.current.has(fid)) continue;
          phase = 'removing images';
          try { await qualityDiscrepanciesAPI.deleteFile(id, fid); }
          catch (err) { if (!/404/.test(String(err.message))) throw err; }
          appliedDeletesRef.current.add(fid);
        }
      } else {
        if (!createdIdRef.current) {
          const created = await qualityDiscrepanciesAPI.create({
            dieNo: dieNo.trim(), plant, supplier: supplier.trim(),
            corrector: corrector.trim(), issue: issue.trim(), outcome,
            inputAtFailure: inputAtFailure.trim(),
            dieReceivedDate: partA.dieReceivedDate, press: partA.press, dieType: partA.dieType,
            dieSize: partA.dieSize, noOfCavity: partA.noOfCavity, tooling: partA.tooling,
            noOfTrials: partA.noOfTrials, noOfCorrections: partA.noOfCorrections,
            productionDate: partA.productionDate, manufacturingDefect: partA.manufacturingDefect,
            diePerformance: partA.diePerformance, recommendedAction: partA.recommendedAction,
            dieOrderId, billets,
          });
          createdIdRef.current = created.id;
        }
        id = createdIdRef.current;
      }
      // Attach any newly staged images (both modes), one request per category.
      const pending = staged.filter((s) => !uploadedCatsRef.current.has(s.category));
      if (pending.length) {
        phase = 'attaching files';
        const byCat = new Map();
        for (const s of pending) {
          if (!byCat.has(s.category)) byCat.set(s.category, []);
          byCat.get(s.category).push(s.file);
        }
        for (const [cat, group] of byCat) {
          await qualityDiscrepanciesAPI.uploadFiles(id, group, cat);
          uploadedCatsRef.current.add(cat);
        }
      }
      if (doSubmit) {
        phase = isSentBack ? 'resubmitting it for approval' : 'submitting it for approval';
        await qualityDiscrepanciesAPI.submit(id);
      }
      onCreated(id, { submitted: doSubmit, isEdit, wasDraft: isEdit ? editQd.approval_state === 'Draft' : true });
    } catch (e) {
      const savedSomething = isEdit || createdIdRef.current;
      const message = savedSomething
        ? `${isEdit ? 'Some changes were saved' : 'Draft was saved'}, but ${phase} failed: ${e.message || 'unknown error'}. Retrying resumes from that step.`
        : (e.message || 'Failed to raise QD');
      setError(message);
      setSubmitting(false);
      setSubmitKind(null);
    }
  };

  // Shared Yes/No toggle — matches the outcome pill look used further down.
  const yesNo = (value, onPick) => (
    <div style={{ display: 'flex', gap: 8 }}>
      {['Yes', 'No'].map((v) => {
        const on = value === v;
        return (
          <button key={v} type="button" onClick={() => onPick(v)}
            style={{ padding: '7px 16px', borderRadius: 20, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s ease', border: `1px solid ${on ? 'rgba(139,92,246,0.4)' : border}`, background: on ? 'rgba(139,92,246,0.15)' : bg, color: on ? '#A78BFA' : muted }}>
            {v}
          </button>
        );
      })}
    </div>
  );

  const sectionColors = { border, text, dim, muted };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <style>{`@keyframes qdModalIn { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } }
        .qd-cta:hover { filter: brightness(1.06); }`}</style>

      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 16, width: 720, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', animation: 'qdModalIn 0.2s ease-out', color: text }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '24px 28px', borderBottom: `1px solid ${border}` }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, background: GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <AlertTriangle size={18} style={{ color: '#fff' }} />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{isEdit ? 'Edit Quality Discrepancy' : 'Raise Quality Discrepancy'}</div>
            {/* The server assigns the QD number on submit — no client-side guess. */}
            <div style={{ fontSize: 12.5, color: dim, marginTop: 2 }}>
              {isEdit
                ? `${editQd.qd_no || 'Draft'}${isSentBack ? ' · sent back — fix and resubmit to the approver' : ' · changes save on this QD'}`
                : 'Against a received die · QD no assigned on submit · Save Draft needs only Die No + Supplier'}
            </div>
          </div>
          <button onClick={onClose} style={{ width: 34, height: 34, background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* 1. Die selection */}
          <Section id="die" title="Die selection" open={open.die} onToggle={toggle} colors={sectionColors}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={group}>
                <label style={label}>Die No</label>
                <input value={dieNo} onChange={(e) => setDieNo(e.target.value)} onBlur={lookupDie}
                  placeholder="e.g. 029780-2502" style={{ ...field, fontFamily: mono }} />
                {partA.profileNumber && <span style={{ fontSize: 11.5, color: dim }}>Profile {partA.profileNumber}</span>}
              </div>
              <div style={group}>
                <label style={label}>Plant</label>
                <select value={plant} onChange={(e) => setPlant(e.target.value)} style={{ ...field, cursor: 'pointer' }}>
                  <option>GEX 2</option><option>GEX 1</option>
                </select>
              </div>
              <div style={group}>
                <label style={label}>Supplier</label>
                {/* Fall back to free text so the very first QD can still be raised. */}
                {suppliers.length ? (
                  <select value={supplier} onChange={(e) => setSupplier(e.target.value)} style={{ ...field, cursor: 'pointer' }}>
                    {suppliers.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. PDTMC" style={field} />
                )}
              </div>
              <div style={group}>
                <label style={label}>Corrector</label>
                <input value={corrector} onChange={(e) => setCorrector(e.target.value)} placeholder="e.g. Sijith" style={field} />
              </div>
            </div>
            {lookupNote && <div style={{ fontSize: 11.5, color: '#60A5FA' }}>{lookupNote}</div>}
          </Section>

          {/* 2. Part-A die details */}
          <Section id="partA" title="Part A — Die details" hint="auto-filled when the die matches an order" open={open.partA} onToggle={toggle} colors={sectionColors}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={group}>
                <label style={label}>Die Received Date</label>
                <DatePickerField value={partA.dieReceivedDate} onChange={setPADate('dieReceivedDate')} theme={theme} />
              </div>
              <div style={group}>
                <label style={label}>Press</label>
                <input value={partA.press} onChange={setPA('press')} placeholder="e.g. 1200T" style={field} />
              </div>
              <div style={group}>
                <label style={label}>Die Type</label>
                <input value={partA.dieType} onChange={setPA('dieType')} style={field} />
              </div>
              <div style={group}>
                <label style={label}>Die Size</label>
                <input value={partA.dieSize} onChange={setPA('dieSize')} style={field} />
              </div>
              <div style={group}>
                <label style={label}>No of Cavity</label>
                <input value={partA.noOfCavity} onChange={setPA('noOfCavity')} style={field} />
              </div>
              <div style={group}>
                <label style={label}>Tooling</label>
                <input value={partA.tooling} onChange={setPA('tooling')} style={field} />
              </div>
              <div style={group}>
                <label style={label}>No of Trials</label>
                <input value={partA.noOfTrials} onChange={setPA('noOfTrials')} style={field} />
              </div>
              <div style={group}>
                <label style={label}>No of Corrections</label>
                <input value={partA.noOfCorrections} onChange={setPA('noOfCorrections')} style={field} />
              </div>
              <div style={group}>
                <label style={label}>Production Date</label>
                <DatePickerField value={partA.productionDate} onChange={setPADate('productionDate')} theme={theme} />
              </div>
            </div>
          </Section>

          {/* 3. Production parameters — first/last billet readings */}
          <Section id="production" title="Production parameters" open={open.production} onToggle={toggle} colors={sectionColors}>
            {['first', 'last'].map((which) => (
              <div key={which} style={{ border: `1px solid ${border}`, borderRadius: 8, padding: 12 }}>
                <div style={{ ...label, marginBottom: 10 }}>{which === 'first' ? '1st Billet' : 'Last Billet'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
                  {BILLET_FIELDS.map((bf) => (
                    <div key={bf.key} style={group}>
                      <label style={{ ...label, fontSize: '0.65rem' }}>{bf.label}</label>
                      <input value={billets[which]?.[bf.key] || ''} onChange={setBilletField(which, bf.key)} style={field} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </Section>

          {/* 4. Discrepancy */}
          <Section id="discrepancy" title="Discrepancy" open={open.discrepancy} onToggle={toggle} colors={sectionColors}>
            <div style={group}>
              <label style={label}>Quality issue</label>
              <textarea value={issue} onChange={(e) => setIssue(e.target.value)} rows={4}
                placeholder="Describe the discrepancy — what differs from the approved design or expected performance"
                style={{ ...field, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={group}>
                <label style={label}>Manufacturing Defect</label>
                {yesNo(partA.manufacturingDefect, (v) => setPartA((prev) => ({ ...prev, manufacturingDefect: v })))}
              </div>
              <div style={group}>
                <label style={label}>Die Performance</label>
                {yesNo(partA.diePerformance, (v) => setPartA((prev) => ({ ...prev, diePerformance: v })))}
              </div>
            </div>

            <div style={group}>
              <label style={label}>Recommended Action</label>
              <textarea value={partA.recommendedAction} onChange={setPA('recommendedAction')} rows={2}
                placeholder="e.g. Rework die profile, re-check heat treatment"
                style={{ ...field, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
            </div>

            <div style={group}>
              <label style={label}>Outcome sought</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {QD_OUTCOMES.map(o => {
                  const on = outcome === o;
                  return (
                    <button key={o} type="button" onClick={() => setOutcome(o)}
                      style={{ padding: '7px 14px', borderRadius: 20, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s ease', border: `1px solid ${on ? 'rgba(139,92,246,0.4)' : border}`, background: on ? 'rgba(139,92,246,0.15)' : bg, color: on ? '#A78BFA' : muted }}>
                      {o}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={group}>
              <label style={label}>Input at failure</label>
              <input value={inputAtFailure} onChange={(e) => setInputAtFailure(e.target.value)} placeholder="e.g. 3,417 kg — optional, can be added later" style={field} />
            </div>
          </Section>

          {/* 5. Images / files */}
          <Section id="images" title="Images" open={open.images} onToggle={toggle} colors={sectionColors}>
            {isEdit && existingFiles.filter((f) => !removedFileIds.includes(f.id)).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={label}>Existing images</label>
                {existingFiles.filter((f) => !removedFileIds.includes(f.id)).map((f) => (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: inputBg, border: `1px solid ${border}`, borderRadius: 8 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.original_name}>{f.original_name}</span>
                    <button type="button" aria-label="Remove image"
                      onClick={() => setRemovedFileIds((prev) => [...prev, f.id])}
                      style={{ background: 'transparent', border: 'none', color: dim, cursor: 'pointer', display: 'flex', padding: 2 }}>
                      <X size={15} />
                    </button>
                  </div>
                ))}
                <span style={{ fontSize: 11, color: dim }}>Removals apply when you save.</span>
              </div>
            )}
            <div style={group}>
              <label style={label}>Category for files added next</label>
              <select value={fileCategory} onChange={(e) => setFileCategory(e.target.value)} style={{ ...field, cursor: 'pointer' }}>
                {FILE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>

            <input ref={fileRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp" style={{ display: 'none' }}
              onChange={(e) => {
                const picked = Array.from(e.target.files || []);
                if (picked.length) setStaged((prev) => [...prev, ...picked.map((file) => ({ file, category: fileCategory }))]);
                e.target.value = ''; // reset so the same file can be re-added (e.g. under a different category)
              }} />
            <div onClick={() => fileRef.current && fileRef.current.click()}
              style={{ border: `2px dashed ${border}`, borderRadius: 8, padding: 20, textAlign: 'center', color: dim, fontSize: 13, cursor: 'pointer' }}>
              <Upload size={18} style={{ marginBottom: 6 }} />
              <div>Add images or PDF reports — pick a category above, then <span style={{ color: '#60A5FA', fontWeight: 600 }}>Browse Files</span>. Repeat to add more under other categories.</div>
            </div>

            {staged.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {staged.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: inputBg, border: `1px solid ${border}`, borderRadius: 8 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.file.name}>{s.file.name}</span>
                    <select value={s.category}
                      onChange={(e) => setStaged((prev) => prev.map((it, j) => (j === i ? { ...it, category: e.target.value } : it)))}
                      style={{ ...field, padding: '5px 8px', fontSize: '0.78rem', cursor: 'pointer', flex: 'none' }}>
                      {FILE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                    <button type="button" aria-label="Remove file"
                      onClick={() => setStaged((prev) => prev.filter((_, j) => j !== i))}
                      style={{ background: 'transparent', border: 'none', color: dim, cursor: 'pointer', display: 'flex', padding: 2 }}>
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {error && <div style={{ fontSize: 12.5, color: '#FCA5A5' }}>{error}</div>}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '18px 28px', borderTop: `1px solid ${border}` }}>
          <button onClick={onClose} style={{ padding: '10px 18px', background: bg, border: `1px solid ${border}`, borderRadius: 10, color: muted, fontWeight: 500, fontSize: 14, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => save(false)} disabled={!canSubmit}
            style={{ padding: '10px 20px', background: bg, color: text, border: `1px solid ${border}`, borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.55 }}>
            {submitting && submitKind === 'draft' ? 'Saving…' : (isSentBack ? 'Save changes' : 'Save Draft')}
          </button>
          <button onClick={() => save(true)} disabled={!canSubmit} className="qd-cta"
            style={{ padding: '10px 20px', background: GRADIENT, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.55, boxShadow: '0 4px 12px rgba(59,130,246,0.3)' }}>
            {submitting && submitKind === 'submit' ? (isSentBack ? 'Resubmitting…' : 'Submitting…') : (isSentBack ? 'Resubmit for approval' : 'Submit for approval')}
          </button>
        </div>
      </div>
    </div>
  );
}
