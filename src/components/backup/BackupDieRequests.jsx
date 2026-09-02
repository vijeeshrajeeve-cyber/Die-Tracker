import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Plus, Edit2, Trash2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, X, Mail, FileText, FolderOpen, AlertTriangle } from 'lucide-react';
import { BACKUP_REQUEST_STATUS_CONFIG } from '../../utils/constants';
import { backupRequestsAPI, profilesAPI, pressesAPI, suppliersAPI, ordersAPI, frozenDesignsAPI, existingDataAPI, extractProfileFromDie, getUser } from '../../api';
import { applyPrefill } from '../../utils/dieOrderPrefill';
import { composeDieNo, splitDieNo } from '../../utils/dieNumber';
import { userSignature } from '../../utils/emailSignature';
import { formatDate } from '../../utils/helpers';
import DatePickerField from '../DatePickerField';
import FrozenDesignBanner from '../FrozenDesignBanner';
import { dialogs } from '../ui/DialogProvider';
import { BackupStatusPill } from '../ui/StatusPill';

const COLUMNS = [
  { key: 'slNo', label: 'SL NO', sortable: false },
  { key: 'Plant', label: 'PLANT' },
  { key: 'DIE NO', label: 'DIE NO' },
  { key: 'Customer', label: 'CUSTOMER' },
  { key: 'Requested Date', label: 'REQUESTED DATE' },
  { key: 'Die Available', label: 'DIE AVAILABLE' },
  { key: 'Drawing Requested', label: 'DRAWING REQUESTED' },
  { key: 'Ordered Date', label: 'ORDERED DATE' },
  { key: 'Status', label: 'STATUS' },
  { key: 'Reason', label: 'REASON' },
  { key: 'Order Received Last Year', label: 'ORDER RECEIVED' },
  { key: 'Remarks', label: 'REMARKS' },
];

const EMPTY_FORM = {
  'Plant': '',
  'Profile': '',
  'Die Suffix': '',
  'Customer': '',
  'Press': '',
  'Cavity': '',
  'Requested Date': '',
  'Die Available': '',
  'Drawing Requested': '',
  'Ordered Date': '',
  'Status': 'Pending',
  'Reason': '',
  'Order Received Last Year': '',
  'Remarks': '',
};

const MANUAL_STATUSES = ['HOLD', 'Not required'];

const getTodayDateString = () => new Date().toISOString().split('T')[0];

// Reasons for die ordering — must match the checkbox labels on the J-file template.
const DIE_ORDER_REASONS = [
  'Die Broken',
  'Die Plate Broken',
  'Back up die for Other Press',
  'Poor Die Design',
  'Design Enhancement',
  'High Order Volume Expected',
  'Over Weight',
  'Other',
];

const normalizePlantName = (plant) => (plant || '')
  .toString()
  .trim()
  .toUpperCase()
  .replace(/\b0+(\d+)\b/g, '$1');

const normalizeDieNo = (value) => (value || '')
  .toString()
  .trim()
  .toUpperCase();

const escapeHtml = (value) => (value || 'N/A')
  .toString()
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const BackupDieRequests = ({ theme, backupRequests, onRefresh, plants = [], user, onCompose, emailTemplates = [] }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPlant, setFilterPlant] = useState('all');
  const [filterStatus, setFilterStatus] = useState('Pending');
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [presses, setPresses] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [dieWarning, setDieWarning] = useState('');
  const [selectedRequestIds, setSelectedRequestIds] = useState([]);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderRow, setOrderRow] = useState(null);
  const [orderValues, setOrderValues] = useState(null);
  const [orderSources, setOrderSources] = useState({});
  const [dieNoBasis, setDieNoBasis] = useState(null);
  const [orderFileHandle, setOrderFileHandle] = useState(null);
  // Fallback File (no write-back handle) for browsers without the File System Access API.
  const [orderFile, setOrderFile] = useState(null);
  const [orderFileName, setOrderFileName] = useState('');
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderError, setOrderError] = useState('');
  const orderFileInputRef = useRef(null);
  const itemsPerPage = 10;

  useEffect(() => {
    let cancelled = false;
    pressesAPI.getAll()
      .then((rows) => { if (!cancelled) setPresses(rows || []); })
      .catch((err) => console.error('Failed to load presses:', err));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    suppliersAPI.getAll()
      .then((rows) => { if (!cancelled) setSuppliers(rows || []); })
      .catch((err) => console.error('Failed to load suppliers:', err));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    ordersAPI.getAll()
      .then((res) => { if (!cancelled) setOrders(res?.orders || []); })
      .catch((err) => console.error('Failed to load orders:', err));
    return () => { cancelled = true; };
  }, []);

  // Pulled out of formData so the effect below can depend on the individual
  // values rather than the whole object, which changes on every keystroke.
  const formPlant = formData['Plant'];
  const formProfile = formData['Profile'];
  const formPress = formData['Press'];
  const formDieSuffix = formData['Die Suffix'];

  // Propose the next die number once the key is complete, but only for a new
  // request and only into an empty field — an existing request's number is
  // already issued, and overwriting it would orphan the die's history.
  useEffect(() => {
    if (editingRequest) return;
    const profile = (formProfile || '').trim();
    const press = (formPress || '').trim();
    const plant = (formPlant || '').trim();
    if (!profile || !press || !plant) return;
    if ((formDieSuffix || '').trim()) return;

    let cancelled = false;
    backupRequestsAPI.nextDieNumber({ plant, profile, press })
      .then((result) => {
        if (cancelled || !result?.dieNo) return;
        setFormData((prev) => (
          (prev['Die Suffix'] || '').trim()
            ? prev
            : { ...prev, 'Die Suffix': splitDieNo(result.dieNo).suffix }
        ));
        setDieNoBasis(result.basis);
      })
      .catch((err) => console.error('Next die number lookup failed:', err));
    return () => { cancelled = true; };
  }, [formPlant, formProfile, formPress, formDieSuffix, editingRequest]);

  const pressCodeByName = useMemo(() => {
    const map = {};
    presses.forEach((p) => { map[p.press_name] = p.press_code; });
    return map;
  }, [presses]);

  const pressOptions = useMemo(() => {
    const selectedPlant = normalizePlantName(formData['Plant']);
    if (!selectedPlant) return [];
    return presses.filter((p) => normalizePlantName(p.plant) === selectedPlant);
  }, [presses, formData]);

  // Press options for the Generate Die Order PDF modal, scoped to the order row's plant.
  const orderPressOptions = useMemo(() => {
    const plant = normalizePlantName(orderRow?.['Plant']);
    if (!plant) return presses;
    return presses.filter((p) => normalizePlantName(p.plant) === plant);
  }, [presses, orderRow]);

  const handlePlantChange = (plant) => {
    setFormData((prev) => {
      const selectedPlant = normalizePlantName(plant);
      const selectedPress = presses.find((p) => p.press_name === prev['Press']);
      const pressMatchesPlant = selectedPress && normalizePlantName(selectedPress.plant) === selectedPlant;

      return {
        ...prev,
        Plant: plant,
        Press: pressMatchesPlant ? prev['Press'] : '',
      };
    });
  };

  const filteredData = useMemo(() => {
    let result = [...(backupRequests || [])];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(r =>
        (r['DIE NO'] || '').toLowerCase().includes(term) ||
        (r['Customer'] || '').toLowerCase().includes(term)
      );
    }

    if (filterPlant !== 'all') {
      result = result.filter(r => r['Plant'] === filterPlant);
    }

    if (filterStatus !== 'all') {
      result = result.filter(r => r['Status'] === filterStatus);
    }

    if (sortConfig.key) {
      result.sort((a, b) => {
        const aVal = (a[sortConfig.key] || '').toString().toLowerCase();
        const bVal = (b[sortConfig.key] || '').toString().toLowerCase();
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [backupRequests, searchTerm, filterPlant, filterStatus, sortConfig]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const paginatedData = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  // Requests that already have a Drawing Requested date cannot be selected again.
  const isSelectable = (request) => !request['Drawing Requested'];
  const selectablePageRequestIds = paginatedData.filter(isSelectable).map(request => request.id);
  const allPageRequestsSelected = selectablePageRequestIds.length > 0 && selectablePageRequestIds.every(id => selectedRequestIds.includes(id));
  const selectedRequests = useMemo(() => {
    const selectedIds = new Set(selectedRequestIds);
    return (backupRequests || []).filter(request => selectedIds.has(request.id));
  }, [backupRequests, selectedRequestIds]);

  useEffect(() => {
    const validIds = new Set((backupRequests || []).filter(isSelectable).map(request => request.id));
    setSelectedRequestIds(prev => prev.filter(id => validIds.has(id)));
  }, [backupRequests]);

  const handleSort = (key) => {
    if (key === 'slNo') return;
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const openCreateModal = () => {
    setEditingRequest(null);
    setFormData({ ...EMPTY_FORM, 'Requested Date': getTodayDateString() });
    setDieWarning('');
    setShowModal(true);
  };

  // Returns a warning message if the entered die number already has an open
  // backup request or a die order, otherwise an empty string. Duplicates are
  // not allowed, so this is also used to block saving.
  const getDuplicateDieWarning = (rawDie) => {
    const die = normalizeDieNo(rawDie);
    if (!die) return '';

    const matchingRequests = (backupRequests || []).filter(
      (r) => normalizeDieNo(r['DIE NO']) === die && (!editingRequest || r.id !== editingRequest.id)
    );
    const matchingOrders = (orders || []).filter(
      (o) => normalizeDieNo(o['DIE NO']) === die
    );

    if (matchingRequests.length === 0 && matchingOrders.length === 0) return '';

    const parts = [];
    if (matchingRequests.length > 0) {
      parts.push(`${matchingRequests.length} existing backup die request${matchingRequests.length > 1 ? 's' : ''}`);
    }
    if (matchingOrders.length > 0) {
      parts.push(`${matchingOrders.length} die order${matchingOrders.length > 1 ? 's' : ''}`);
    }
    return `Die "${rawDie.trim()}" already has ${parts.join(' and ')}. Duplicate die numbers are not allowed — please review the die number.`;
  };

  const checkDuplicateDie = (rawDie) => {
    setDieWarning(getDuplicateDieWarning(rawDie));
  };

  const toggleRequestSelection = (requestId) => {
    setSelectedRequestIds(prev =>
      prev.includes(requestId)
        ? prev.filter(id => id !== requestId)
        : [...prev, requestId]
    );
  };

  const togglePageSelection = () => {
    setSelectedRequestIds(prev => {
      const pageIds = new Set(selectablePageRequestIds);
      if (allPageRequestsSelected) {
        return prev.filter(id => !pageIds.has(id));
      }
      return [...new Set([...prev, ...selectablePageRequestIds])];
    });
  };

  const handleRequestPdfDrawings = () => {
    if (selectedRequests.length === 0) {
      dialogs.notify('Select at least one backup request first.', 'info');
      return;
    }
    if (!onCompose) {
      dialogs.notify('Email compose is not available from this page.', 'info');
      return;
    }

    const requestRows = selectedRequests
      .map((request, index) => {
        const press = request['Press']
          ? `${request['Press']}${pressCodeByName[request['Press']] ? ` (${pressCodeByName[request['Press']]})` : ''}`
          : 'N/A';
        return `
          <tr>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;text-align:center;">${index + 1}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;font-weight:600;">${escapeHtml(request['DIE NO'])}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;">${escapeHtml(request['Plant'])}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;">${escapeHtml(press)}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;">${escapeHtml(request['Customer'])}</td>
            <td style="padding:8px 10px;border:1px solid #CBD5E1;">${escapeHtml(formatDate(request['Requested Date']))}</td>
          </tr>`;
      })
      .join('');

    onCompose({
      to: emailTemplates.find(template => template.name === 'PDF Drawing Request')?.default_to || '',
      cc: emailTemplates.find(template => template.name === 'PDF Drawing Request')?.default_cc || '',
      subject: `URGENT: PDF Drawing Request for ${selectedRequests.length} Backup Die Request(s)`,
      body: `
        <p>Dear Design Team,</p>
        <p>Please provide PDF drawings for the following backup die request(s):</p>
        <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px;color:#0F172A;">
          <thead>
            <tr style="background:#E2E8F0;color:#0F172A;">
              <th scope="col" style="padding:9px 10px;border:1px solid #CBD5E1;text-align:center;">SL No</th>
              <th scope="col" style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">Die No</th>
              <th scope="col" style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">Plant</th>
              <th scope="col" style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">Press</th>
              <th scope="col" style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">Customer</th>
              <th scope="col" style="padding:9px 10px;border:1px solid #CBD5E1;text-align:left;">Requested Date</th>
            </tr>
          </thead>
          <tbody>${requestRows}</tbody>
        </table>
        <p>Please share the drawings at the earliest so the requests can proceed without delay.</p>
        ${userSignature(getUser())}`,
      importance: 'high',
      isHtml: true,
      onSent: async () => {
        const today = getTodayDateString();
        try {
          await Promise.all(selectedRequests.map(request =>
            backupRequestsAPI.update(request.id, { ...request, 'Drawing Requested': today })
          ));
        } catch (error) {
          dialogs.notify('Email sent, but the Drawing Requested date could not be updated: ' + error.message, 'error', { title: 'Partially completed' });
        }
        setSelectedRequestIds([]);
        onRefresh();
      },
    });
  };

  const openEditModal = (request) => {
    setEditingRequest(request);
    setDieNoBasis(null);
    setFormData({
      'Plant': request['Plant'] || '',
      'Profile': splitDieNo(request['DIE NO']).profile,
      'Die Suffix': splitDieNo(request['DIE NO']).suffix,
      'Customer': request['Customer'] || '',
      'Press': request['Press'] || '',
      'Cavity': request['Cavity'] ?? '',
      'Requested Date': request['Requested Date'] || '',
      'Die Available': request['Die Available'] || '',
      'Drawing Requested': request['Drawing Requested'] || '',
      'Ordered Date': request['Ordered Date'] || '',
      'Status': request['Status'] || 'Pending',
      'Reason': request['Reason'] || '',
      'Order Received Last Year': request['Order Received Last Year'] || '',
      'Remarks': request['Remarks'] || '',
    });
    setDieWarning('');
    setShowModal(true);
  };

  const handleProfileBlur = async () => {
    const profile = (formData['Profile'] || '').trim();
    const existingCustomer = (formData['Customer'] || '').trim();

    checkDuplicateDie(composeDieNo(profile, formData['Die Suffix']));

    if (!profile || existingCustomer) return;
    try {
      const result = await profilesAPI.lookup(profile);
      if (result?.customer_name) {
        setFormData(prev => ({ ...prev, 'Customer': result.customer_name }));
      }
    } catch (e) {
      console.error('Profile lookup failed:', e);
    }
  };

  const handleSave = async () => {
    const die = composeDieNo(formData['Profile'], formData['Die Suffix']);

    // Block duplicates — a die number with an existing backup request or die order cannot be re-used.
    const duplicateWarning = getDuplicateDieWarning(die);
    if (duplicateWarning) {
      setDieWarning(duplicateWarning);
      dialogs.notify(duplicateWarning, 'error', { title: 'Duplicate die' });
      return;
    }

    setSaving(true);
    try {
      let customer = (formData['Customer'] || '').trim();
      const profile = extractProfileFromDie(die);

      // If die set but no customer, try lookup once
      if (die && !customer && profile) {
        try {
          const result = await profilesAPI.lookup(die);
          if (result?.customer_name) {
            customer = result.customer_name;
            setFormData(prev => ({ ...prev, 'Customer': customer }));
          }
        } catch (e) { console.error('Profile lookup failed:', e); }
      }

      // Still missing → ask the user
      if (die && !customer && profile) {
        const entered = window.prompt(`No customer found for profile ${profile} (die ${die}).\nEnter customer name to save to Profile Master:`);
        if (entered === null) { setSaving(false); return; } // cancelled
        customer = entered.trim();
        if (!customer) { dialogs.notify('Customer name is required.', 'error'); setSaving(false); return; }
        try { await profilesAPI.save(die, customer); } catch (e) { console.error('Save profile failed:', e); }
      }

      // formData now carries Profile and Die Suffix; the API and the database
      // still take one composed die_no.
      const payload = { ...formData, 'Customer': customer, 'DIE NO': die };

      if (editingRequest) {
        await backupRequestsAPI.update(editingRequest.id, payload);
      } else {
        await backupRequestsAPI.create(payload);
      }
      setShowModal(false);
      onRefresh();
    } catch (error) {
      dialogs.notify(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (request) => {
    const ok = await dialogs.confirm({
      title: 'Delete backup request',
      message: `The backup request for ${request['DIE NO']} will be permanently removed. This cannot be undone.`,
      confirmLabel: 'Delete request',
    });
    if (!ok) return;
    try {
      await backupRequestsAPI.delete(request.id);
      dialogs.notify('Backup request deleted', 'success');
      onRefresh();
    } catch (error) {
      dialogs.notify(error.message, 'error');
    }
  };

  const openOrderModal = async (request) => {
    setOrderRow(request);
    setOrderFileHandle(null);
    setOrderFile(null);
    setOrderFileName('');
    setOrderError('');

    // Pull supplier / die size from an active frozen design for this profile (if any).
    let frozen = null;
    try {
      frozen = await frozenDesignsAPI.match({
        profile: extractProfileFromDie(request['DIE NO']),
        plant: request['Plant'],
        press: request['Press'],
        cavity: request['Cavity'],
      });
    } catch { /* no match / lookup failed — proceed without prefill */ }

    const src = frozen?.source_order || {};
    const initialSupplier = frozen?.supplier || src.supplier || '';
    const matchedSupplier = suppliers.find((s) => s.name === initialSupplier);
    const baseValues = {
      SUPPLIER: initialSupplier,
      DATE: getTodayDateString(),
      DIE_SIZE: frozen?.die_size || src.die_size || '',
      NO_OF_CAV: request['Cavity'] ? String(request['Cavity']) : (src.cavity ? String(src.cavity) : ''),
      PRESS: request['Press'] || src.press || '',
      SOLID: false,
      HOLLOW: false,
      BOLSTER_NO: '',
      INSERT_NO: '',
      BOLSTER_SIZE: '',
      INSERT_SIZE: '',
      DELIVERY_DATE: request['Requested Date'] || '',
      THREE_D_MODULE: false,
      REASON: '',
      SHIPMENT: matchedSupplier?.shipment_mode || src.shipment_type || '',
      PROFILE_WEIGHT_PCT: '',
      FINISH_MILL: false,
      FINISH_ANODIZING: false,
      FINISH_POWDER: false,
      PENDING_ORDER_KG: '0',
    };

    // History fills only what the request and the frozen design left blank.
    let match = { order: null, dieList: null };
    try {
      match = await existingDataAPI.matchDie({
        plant: request['Plant'],
        profile: extractProfileFromDie(request['DIE NO']),
        press: baseValues.PRESS,
        cavity: baseValues.NO_OF_CAV,
      });
    } catch { /* lookup failed — open the modal with what we already have */ }

    const { values, sources } = applyPrefill(baseValues, match, {
      supplierNames: suppliers.map((s) => s.name),
    });

    // MODE OF SHIPMENT follows whichever supplier ended up selected.
    if (values.SUPPLIER !== baseValues.SUPPLIER) {
      const filledSupplier = suppliers.find((s) => s.name === values.SUPPLIER);
      values.SHIPMENT = filledSupplier?.shipment_mode || values.SHIPMENT;
    }

    setOrderValues(values);
    setOrderSources(sources);
    setShowOrderModal(true);
  };

  const handlePickProfileDrawing = async () => {
    // Preferred path: File System Access API (Chromium) lets us overwrite the PDF in place.
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const [handle] = await window.showOpenFilePicker({
          mode: 'readwrite',
          multiple: false,
          types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
        });
        setOrderFileHandle(handle);
        setOrderFile(null);
        setOrderFileName(handle.name);
        setOrderError('');
      } catch (err) {
        if (err.name !== 'AbortError') {
          setOrderError(err.message || String(err));
        }
      }
      return;
    }

    // Fallback (Firefox, insecure context, embedded frames): use a plain file input.
    // We can't write back in place, so the stamped PDF is downloaded instead.
    setOrderError('');
    orderFileInputRef.current?.click();
  };

  const handleProfileDrawingInput = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setOrderFile(file);
    setOrderFileHandle(null);
    setOrderFileName(file.name);
    setOrderError('');
  };

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

  const handleGenerateOrderPdf = async () => {
    if ((!orderFileHandle && !orderFile) || !orderRow) return;

    setOrderBusy(true);
    setOrderError('');
    try {
      let file;
      if (orderFileHandle) {
        const permOpts = { mode: 'readwrite' };
        if (orderFileHandle.queryPermission) {
          let permission = await orderFileHandle.queryPermission(permOpts);
          if (permission !== 'granted' && orderFileHandle.requestPermission) {
            permission = await orderFileHandle.requestPermission(permOpts);
          }
          if (permission !== 'granted') {
            throw new Error('Permission to overwrite the file was denied.');
          }
        }
        file = await orderFileHandle.getFile();
      } else {
        file = orderFile;
      }

      const { orderPdfBlob, jFilePdfBlob, jFileName, jFileError, frozenMerged } =
        await backupRequestsAPI.generateOrderPdf(orderRow.id, file, orderValues);

      let orderSavedNote;
      if (orderFileHandle) {
        // Write the die-order stamp back to the chosen file in place.
        const writable = await orderFileHandle.createWritable();
        await writable.write(orderPdfBlob);
        await writable.close();
        orderSavedNote = `Die order saved to "${orderFileHandle.name}"`;
      } else {
        // Fallback: no write-back handle, so download the stamped order PDF.
        const orderDownloadName = orderFileName?.replace(/\.pdf$/i, '') + '-die-order.pdf';
        downloadBlob(orderPdfBlob, orderDownloadName);
        orderSavedNote = `Die order PDF downloaded as "${orderDownloadName}"`;
      }

      // Trigger J-file browser download
      if (jFilePdfBlob) {
        downloadBlob(jFilePdfBlob, jFileName);
      }

      setShowOrderModal(false);

      const mergedNote = frozenMerged ? `\n\nFrozen design merged: ${frozenMerged} PDF page-set(s) appended.` : '';
      if (jFileError) {
        dialogs.notify(`${orderSavedNote}.${mergedNote}\n\nThe J-file could not be generated: ${jFileError}`, 'error', { title: 'Saved, with a warning' });
      } else {
        dialogs.notify(`${orderSavedNote} and J-file downloaded as "${jFileName}".${mergedNote}`, 'success');
      }
    } catch (error) {
      setOrderError(error.message || String(error));
    } finally {
      setOrderBusy(false);
    }
  };

  const uniquePlants = useMemo(() => {
    const set = new Set((backupRequests || []).map(r => r['Plant']).filter(Boolean));
    return [...set].sort();
  }, [backupRequests]);

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    background: theme.inputBg,
    border: `1px solid ${theme.cardBorder}`,
    borderRadius: '10px',
    color: theme.text,
    fontSize: '0.875rem',
  };

  // Color tokens consumed by the shared .dt-table CSS (see index.css)
  const scrollVars = {
    '--dt-border': theme.cardBorder,
    '--dt-header-bg': theme.tableHeaderBg,
    '--dt-header-text': theme.tableHeaderText,
    '--dt-header-border': theme.tableHeaderBorder,
    '--dt-stripe': theme.stripeBg,
    '--dt-hover': theme.rowHover,
    '--dt-body-text': theme.text,
  };
  const tdMuted = { color: theme.textMuted };

  const labelStyle = {
    display: 'block',
    fontSize: '0.8rem',
    fontWeight: 600,
    color: theme.textMuted,
    marginBottom: '6px',
  };

  // Bordered checkbox container that matches the height/style of inputStyle.
  const checkboxBoxStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 14px',
    background: theme.inputBg,
    border: `1px solid ${theme.cardBorder}`,
    borderRadius: '10px',
    color: theme.text,
    fontSize: '0.875rem',
    cursor: 'pointer',
  };

  // Names where an auto-filled value came from, so the person generating a
  // supplier-facing PDF can see which numbers are history rather than input.
  const renderSourceHint = (field) => (
    orderSources[field]
      ? <span style={{ fontSize: '0.7rem', color: theme.textMuted, marginLeft: '8px' }}>from {orderSources[field]}</span>
      : null
  );

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: theme.text }}>Backup Die Requests</h2>
          <p style={{ fontSize: '0.875rem', color: theme.textMuted, marginTop: '4px' }}>Track backup die requirements before formal ordering</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            onClick={handleRequestPdfDrawings}
            disabled={selectedRequests.length === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '10px 18px', borderRadius: '12px',
              background: selectedRequests.length > 0 ? 'rgba(59,130,246,0.16)' : theme.inputBg,
              color: selectedRequests.length > 0 ? theme.primary : theme.textDim,
              border: `1px solid ${selectedRequests.length > 0 ? theme.primary : theme.cardBorder}`,
              cursor: selectedRequests.length > 0 ? 'pointer' : 'not-allowed',
              fontWeight: 600, fontSize: '0.875rem',
            }}
          >
            <Mail size={18} /> Request PDF Drawings{selectedRequests.length > 0 ? ` (${selectedRequests.length})` : ''}
          </button>
          <button
            onClick={openCreateModal}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '10px 20px', borderRadius: '12px',
              background: theme.primary, color: theme.primaryText,
              border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem',
            }}
          >
            <Plus size={18} /> New Request
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{
        background: theme.cardBg, borderRadius: '20px', padding: '1.25rem',
        border: `1px solid ${theme.cardBorder}`, marginBottom: '1.5rem',
        boxShadow: theme.shadowMd,
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: '250px', position: 'relative' }}>
            <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: theme.textDim }} />
            <input
              type="text"
              placeholder="Search by DIE NO or CUSTOMER..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              style={{
                width: '100%', padding: '12px 16px 12px 44px',
                background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
                borderRadius: '12px', color: theme.text, fontSize: '0.875rem',
              }}
            />
          </div>
          <select
            value={filterPlant}
            onChange={(e) => { setFilterPlant(e.target.value); setCurrentPage(1); }}
            style={{
              padding: '12px 16px', background: theme.inputBg,
              border: `1px solid ${theme.cardBorder}`, borderRadius: '12px',
              color: theme.text, fontSize: '0.875rem', cursor: 'pointer', minWidth: '130px',
            }}
          >
            <option value="all">All Plants</option>
            {uniquePlants.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setCurrentPage(1); }}
            style={{
              padding: '12px 16px', background: theme.inputBg,
              border: `1px solid ${theme.cardBorder}`, borderRadius: '12px',
              color: theme.text, fontSize: '0.875rem', cursor: 'pointer', minWidth: '150px',
            }}
          >
            <option value="all">All Statuses</option>
            {Object.keys(BACKUP_REQUEST_STATUS_CONFIG).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${theme.cardBorder}`,
        }}>
          <span style={{ fontSize: '0.875rem', color: theme.textMuted }}>
            Showing <strong style={{ color: theme.text }}>{filteredData.length}</strong> requests
          </span>
          <button
            onClick={() => { setSearchTerm(''); setFilterPlant('all'); setFilterStatus('all'); setCurrentPage(1); }}
            style={{ fontSize: '0.875rem', color: theme.primary, background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Clear filters
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{
        background: theme.cardBg, borderRadius: '20px',
        border: `1px solid ${theme.cardBorder}`, overflow: 'hidden',
        boxShadow: theme.shadowMd,
      }}>
        <div className="dt-scroll" style={scrollVars}>
          <table className="dt-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th scope="col" className="dt-center" style={{ width: '48px' }}>
                  <input
                    type="checkbox"
                    checked={allPageRequestsSelected}
                    onChange={togglePageSelection}
                    disabled={selectablePageRequestIds.length === 0}
                    aria-label="Select all visible backup requests without a drawing requested date"
                    style={{ width: '16px', height: '16px', accentColor: theme.primary, cursor: selectablePageRequestIds.length === 0 ? 'not-allowed' : 'pointer' }}
                  />
                </th>
                {COLUMNS.map(col => (
                  <th scope="col"
                    key={col.key}
                    onClick={() => col.sortable !== false && handleSort(col.key)}
                    style={{ cursor: col.sortable !== false ? 'pointer' : 'default' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {col.label}
                      {col.sortable !== false && (
                        sortConfig.key === col.key
                          ? (sortConfig.direction === 'asc' ? <ChevronUp size={14} color="#3B82F6" /> : <ChevronDown size={14} color="#3B82F6" />)
                          : <ChevronDown size={14} color="#64748B" />
                      )}
                    </div>
                  </th>
                ))}
                <th scope="col" className="dt-center">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedData.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + 2} className="dt-center" style={{ padding: '3rem', color: theme.textMuted, fontSize: '0.95rem' }}>
                    No backup requests found
                  </td>
                </tr>
              ) : (
                paginatedData.map((request, idx) => (
                  <tr
                    key={request.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => openEditModal(request)}
                  >
                    <td className="dt-center">
                      <input
                        type="checkbox"
                        checked={selectedRequestIds.includes(request.id)}
                        onChange={(e) => { e.stopPropagation(); toggleRequestSelection(request.id); }}
                        onClick={(e) => e.stopPropagation()}
                        disabled={!isSelectable(request)}
                        title={!isSelectable(request) ? `Drawing already requested on ${formatDate(request['Drawing Requested'])}` : undefined}
                        aria-label={`Select backup request ${request['DIE NO'] || request.id}`}
                        style={{ width: '16px', height: '16px', accentColor: theme.primary, cursor: isSelectable(request) ? 'pointer' : 'not-allowed' }}
                      />
                    </td>
                    <td className="dt-num" style={tdMuted}>
                      {(currentPage - 1) * itemsPerPage + idx + 1}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {request['Plant'] && (
                        <span style={{
                          padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600,
                          background: request['Plant'] === 'EXT 1' ? 'rgba(59,130,246,0.2)' : 'rgba(139,92,246,0.2)',
                          color: request['Plant'] === 'EXT 1' ? '#60A5FA' : '#A78BFA',
                        }}>
                          {request['Plant']}
                        </span>
                      )}
                    </td>
                    <td style={{ fontWeight: 600, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      {request['DIE NO'] || '—'}
                    </td>
                    <td>
                      {request['Customer'] || '—'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {formatDate(request['Requested Date'])}
                    </td>
                    <td>
                      {request['Die Available'] || '—'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {formatDate(request['Drawing Requested'])}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {formatDate(request['Ordered Date'])}
                    </td>
                    <td>
                      <BackupStatusPill status={request['Status']} theme={theme} />
                    </td>
                    <td>
                      {request['Reason'] || '—'}
                    </td>
                    <td>
                      {request['Order Received Last Year'] || '—'}
                    </td>
                    <td className="dt-truncate">
                      {request['Remarks'] || '—'}
                    </td>
                    <td className="dt-center">
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); openOrderModal(request); }}
                          style={{ padding: '6px', background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.4)', borderRadius: '6px', cursor: 'pointer', color: '#10B981' }}
                          title="Generate die order PDF"
                        >
                          <FileText size={14} />
                        </button>
                        {user?.role === 'admin' && (
                          <>
                          <button
                            onClick={(e) => { e.stopPropagation(); openEditModal(request); }}
                            style={{ padding: '6px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: '6px', cursor: 'pointer', color: '#3B82F6' }}
                            title="Edit"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(request); }}
                            style={{ padding: '6px', background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '6px', cursor: 'pointer', color: '#EF4444' }}
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '1rem 1.5rem', borderTop: `1px solid ${theme.cardBorder}`,
          }}>
            <span style={{ fontSize: '0.85rem', color: theme.textMuted }}>
              Page {currentPage} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                style={{
                  padding: '8px 12px', borderRadius: '8px',
                  background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
                  color: currentPage === 1 ? theme.textDim : theme.text,
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center',
                }}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                style={{
                  padding: '8px 12px', borderRadius: '8px',
                  background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
                  color: currentPage === totalPages ? theme.textDim : theme.text,
                  cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center',
                }}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: theme.cardBg, borderRadius: '20px', padding: '2rem',
            width: '100%', maxWidth: '700px', maxHeight: '90vh', overflowY: 'auto',
            border: `1px solid ${theme.cardBorder}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: theme.text }}>
                {editingRequest ? 'Edit Backup Request' : 'New Backup Request'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                style={{ padding: '8px', background: 'transparent', border: 'none', cursor: 'pointer', color: theme.textMuted, borderRadius: '8px' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {/* Plant */}
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-plant">Plant</label>
                <select id="backupdierequests-plant"
                  value={formData['Plant']}
                  onChange={(e) => handlePlantChange(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">Select Plant</option>
                  {plants.map(p => (
                    <option key={p.id || p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* PROFILE */}
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-profile">PROFILE</label>
                <input id="backupdierequests-profile"
                  type="text"
                  value={formData['Profile']}
                  onChange={(e) => { setFormData({ ...formData, 'Profile': e.target.value }); if (dieWarning) setDieWarning(''); }}
                  onBlur={handleProfileBlur}
                  style={inputStyle}
                  placeholder="e.g. 29663"
                />
              </div>

              {/* DIE NO */}
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-die-no">
                  DIE NO
                  {dieNoBasis === null && (formData['Die Suffix'] || '').trim() && (
                    <span style={{ fontSize: '0.7rem', color: theme.textMuted, marginLeft: '8px' }}>
                      first die on this press
                    </span>
                  )}
                  {dieNoBasis && (
                    <span style={{ fontSize: '0.7rem', color: theme.textMuted, marginLeft: '8px' }}>
                      next after {dieNoBasis.die_no}
                    </span>
                  )}
                </label>
                <input id="backupdierequests-die-no"
                  type="text"
                  value={formData['Die Suffix']}
                  onChange={(e) => { setFormData({ ...formData, 'Die Suffix': e.target.value }); if (dieWarning) setDieWarning(''); }}
                  onBlur={() => checkDuplicateDie(composeDieNo(formData['Profile'], formData['Die Suffix']))}
                  style={{
                    ...inputStyle,
                    border: dieWarning ? '1px solid #F59E0B' : inputStyle.border,
                  }}
                  placeholder="e.g. 253"
                />
                {dieWarning && (
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: '8px',
                    marginTop: '8px', padding: '8px 12px', borderRadius: '8px',
                    background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)',
                    color: '#F59E0B', fontSize: '0.78rem', lineHeight: 1.35,
                  }}>
                    <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                    <span>{dieWarning}</span>
                  </div>
                )}
              </div>

              {/* Customer */}
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-customer">Customer</label>
                <input id="backupdierequests-customer"
                  type="text"
                  value={formData['Customer']}
                  onChange={(e) => setFormData({ ...formData, 'Customer': e.target.value })}
                  style={inputStyle}
                  placeholder="Enter customer name"
                />
              </div>

              {/* Press */}
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-press">Press</label>
                <select id="backupdierequests-press"
                  value={formData['Press']}
                  onChange={(e) => setFormData({ ...formData, 'Press': e.target.value })}
                  disabled={!formData['Plant']}
                  style={{
                    ...inputStyle,
                    cursor: formData['Plant'] ? 'pointer' : 'not-allowed',
                    opacity: formData['Plant'] ? 1 : 0.65,
                  }}
                >
                  <option value="">{formData['Plant'] ? 'Select Press' : 'Select Plant first'}</option>
                  {pressOptions.map((p) => (
                    <option key={p.id} value={p.press_name}>
                      {p.press_name} ({p.press_code})
                    </option>
                  ))}
                </select>
              </div>

              {/* Cavity */}
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-cavity">Cavity</label>
                <input id="backupdierequests-cavity"
                  type="number"
                  min="0"
                  value={formData['Cavity']}
                  onChange={(e) => setFormData({ ...formData, 'Cavity': e.target.value })}
                  style={inputStyle}
                  placeholder="No. of cavities"
                />
              </div>

              {/* Requested Date */}
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-requested-date">Requested Date</label>
                <DatePickerField id="backupdierequests-requested-date"
                  value={formData['Requested Date']}
                  onChange={(v) => setFormData({ ...formData, 'Requested Date': v })}
                  theme={theme}
                  placeholder="Select requested date"
                />
              </div>

              {/* Die Available */}
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-die-available">Die Available</label>
                <input id="backupdierequests-die-available"
                  type="text"
                  value={formData['Die Available']}
                  onChange={(e) => setFormData({ ...formData, 'Die Available': e.target.value })}
                  style={inputStyle}
                  placeholder="e.g. Yes / No"
                />
              </div>

              {/* Drawing Requested */}
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-drawing-requested">Drawing Requested</label>
                <DatePickerField id="backupdierequests-drawing-requested"
                  value={formData['Drawing Requested']}
                  onChange={(v) => setFormData({ ...formData, 'Drawing Requested': v })}
                  theme={theme}
                  placeholder="Select drawing requested date"
                />
              </div>

              {/* Ordered Date */}
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-ordered-date">Ordered Date</label>
                <DatePickerField id="backupdierequests-ordered-date"
                  value={formData['Ordered Date']}
                  onChange={(v) => setFormData({ ...formData, 'Ordered Date': v })}
                  theme={theme}
                  disabled={!editingRequest}
                  title={!editingRequest ? 'Auto-populated when a matching die order is created' : ''}
                  placeholder="Select ordered date"
                />
              </div>

              {/* Status */}
              {editingRequest && (
                <div>
                  <label style={labelStyle} htmlFor="backupdierequests-status">Status</label>
                  <select id="backupdierequests-status"
                    value={formData['Status']}
                    onChange={(e) => setFormData({ ...formData, 'Status': e.target.value })}
                    style={inputStyle}
                  >
                    <option value="Pending">Pending</option>
                    {MANUAL_STATUSES.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                    {formData['Status'] === 'Completed' && (
                      <option value="Completed">Completed</option>
                    )}
                  </select>
                </div>
              )}

              {/* Reason */}
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-reason">Reason</label>
                <input id="backupdierequests-reason"
                  type="text"
                  value={formData['Reason']}
                  onChange={(e) => setFormData({ ...formData, 'Reason': e.target.value })}
                  style={inputStyle}
                  placeholder="Enter reason"
                />
              </div>

              {/* Order Received Last Year */}
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-order-received-last-year">Order Received Last Year</label>
                <input id="backupdierequests-order-received-last-year"
                  type="text"
                  value={formData['Order Received Last Year']}
                  onChange={(e) => setFormData({ ...formData, 'Order Received Last Year': e.target.value })}
                  style={inputStyle}
                  placeholder="e.g. Yes / No / quantity"
                />
              </div>

              {/* Remarks */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle} htmlFor="backupdierequests-remarks">Remarks</label>
                <input id="backupdierequests-remarks"
                  type="text"
                  value={formData['Remarks']}
                  onChange={(e) => setFormData({ ...formData, 'Remarks': e.target.value })}
                  style={inputStyle}
                  placeholder="Enter remarks"
                />
              </div>
            </div>

            <FrozenDesignBanner
              infoOnly
              profile={extractProfileFromDie(formData['Profile'])}
              plant={formData['Plant']}
              press={formData['Press']}
              cavity={formData['Cavity']}
            />

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: `1px solid ${theme.cardBorder}` }}>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  padding: '10px 20px', borderRadius: '10px',
                  background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
                  color: theme.text, cursor: 'pointer', fontWeight: 500, fontSize: '0.875rem',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: '10px 24px', borderRadius: '10px',
                  background: saving ? '#475569' : theme.primary, border: 'none',
                  color: theme.primaryText, cursor: saving ? 'not-allowed' : 'pointer',
                  fontWeight: 600, fontSize: '0.875rem',
                }}
              >
                {saving ? 'Saving...' : (editingRequest ? 'Update' : 'Create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generate Die Order PDF Modal */}
      {showOrderModal && orderValues && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: theme.cardBg, borderRadius: '20px', padding: '2rem',
            width: '100%', maxWidth: '780px', maxHeight: '92vh', overflowY: 'auto',
            border: `1px solid ${theme.cardBorder}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: theme.text }}>
                  Generate Die Order PDF
                </h3>
                <p style={{ fontSize: '0.8rem', color: theme.textMuted, marginTop: '4px' }}>
                  Die {orderRow?.['DIE NO'] || '-'} · {orderRow?.['Customer'] || '-'} · {orderRow?.['Plant'] || '-'}
                </p>
              </div>
              <button
                onClick={() => !orderBusy && setShowOrderModal(false)}
                disabled={orderBusy}
                style={{ padding: '8px', background: 'transparent', border: 'none', cursor: orderBusy ? 'not-allowed' : 'pointer', color: theme.textMuted, borderRadius: '8px' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: '12px 14px', borderRadius: '12px',
              background: theme.inputBg, border: `1px dashed ${theme.cardBorder}`,
              marginBottom: '1rem',
            }}>
              <button
                onClick={handlePickProfileDrawing}
                disabled={orderBusy}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px 14px', borderRadius: '8px',
                  background: theme.primary, color: theme.primaryText,
                  border: 'none', cursor: orderBusy ? 'not-allowed' : 'pointer',
                  fontWeight: 600, fontSize: '0.85rem',
                }}
              >
                <FolderOpen size={16} /> {(orderFileHandle || orderFile) ? 'Choose different PDF' : 'Select Profile Drawing PDF'}
              </button>
              <input aria-label="Attach a file to this backup request"
                ref={orderFileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleProfileDrawingInput}
                style={{ display: 'none' }}
              />
              <span style={{ fontSize: '0.85rem', color: (orderFileHandle || orderFile) ? theme.text : theme.textMuted, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {orderFileHandle
                  ? orderFileName
                  : orderFile
                    ? `${orderFileName} (will download the stamped PDF)`
                    : 'No file selected. The output will overwrite the chosen PDF, or download it if your browser does not support in-place save.'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-supplier">SUPPLIER{renderSourceHint('SUPPLIER')}</label>
                <select id="backupdierequests-supplier"
                  value={orderValues.SUPPLIER}
                  onChange={(e) => {
                    const supplierName = e.target.value;
                    const matched = suppliers.find((s) => s.name === supplierName);
                    setOrderValues((prev) => ({
                      ...prev,
                      SUPPLIER: supplierName,
                      SHIPMENT: matched?.shipment_mode || '',
                    }));
                  }}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  <option value="">Select Supplier</option>
                  {suppliers.map((s) => (
                    <option key={s.id ?? s.name} value={s.name}>{s.name}</option>
                  ))}
                  {orderValues.SUPPLIER && !suppliers.some((s) => s.name === orderValues.SUPPLIER) && (
                    <option value={orderValues.SUPPLIER}>{orderValues.SUPPLIER}</option>
                  )}
                </select>
              </div>
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-requested-date-2">REQUESTED DATE</label>
                <input id="backupdierequests-requested-date-2" type="date" value={orderValues.DATE} onChange={(e) => setOrderValues({ ...orderValues, DATE: e.target.value })} style={inputStyle} />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle} htmlFor="backupdierequests-die-size">DIE SIZE{renderSourceHint('DIE_SIZE')}</label>
                <input id="backupdierequests-die-size" type="text" value={orderValues.DIE_SIZE} onChange={(e) => setOrderValues({ ...orderValues, DIE_SIZE: e.target.value })} style={inputStyle} />
              </div>

              <div>
                <label style={labelStyle} htmlFor="backupdierequests-no-of-cav">No OF CAV</label>
                <input id="backupdierequests-no-of-cav" type="text" value={orderValues.NO_OF_CAV} onChange={(e) => setOrderValues({ ...orderValues, NO_OF_CAV: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-press-2">PRESS</label>
                <select id="backupdierequests-press-2"
                  value={orderValues.PRESS}
                  onChange={(e) => setOrderValues({ ...orderValues, PRESS: e.target.value })}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  <option value="">Select Press</option>
                  {orderPressOptions.map((p) => (
                    <option key={p.id ?? p.press_name} value={p.press_name}>
                      {p.press_name}{p.press_code ? ` (${p.press_code})` : ''}
                    </option>
                  ))}
                  {orderValues.PRESS && !orderPressOptions.some((p) => p.press_name === orderValues.PRESS) && (
                    <option value={orderValues.PRESS}>{orderValues.PRESS}</option>
                  )}
                </select>
              </div>

              <div>
                <label style={labelStyle}>SOLID{renderSourceHint('SOLID')}</label>
                <label style={checkboxBoxStyle}>
                  <input type="checkbox" checked={!!orderValues.SOLID} onChange={(e) => setOrderValues({ ...orderValues, SOLID: e.target.checked })} style={{ width: '16px', height: '16px', accentColor: theme.primary }} />
                  Solid
                </label>
              </div>
              <div>
                <label style={labelStyle}>HOLLOW{renderSourceHint('HOLLOW')}</label>
                <label style={checkboxBoxStyle}>
                  <input type="checkbox" checked={!!orderValues.HOLLOW} onChange={(e) => setOrderValues({ ...orderValues, HOLLOW: e.target.checked })} style={{ width: '16px', height: '16px', accentColor: theme.primary }} />
                  Hollow
                </label>
              </div>

              <div>
                <label style={labelStyle} htmlFor="backupdierequests-bolster-no">BOLSTER No{renderSourceHint('BOLSTER_NO')}</label>
                <input id="backupdierequests-bolster-no" type="text" value={orderValues.BOLSTER_NO} onChange={(e) => setOrderValues({ ...orderValues, BOLSTER_NO: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-insert-no">INSERT No</label>
                <input id="backupdierequests-insert-no" type="text" value={orderValues.INSERT_NO} onChange={(e) => setOrderValues({ ...orderValues, INSERT_NO: e.target.value })} style={inputStyle} />
              </div>

              <div>
                <label style={labelStyle} htmlFor="backupdierequests-bolster-size">BOLSTER SIZE</label>
                <input id="backupdierequests-bolster-size" type="text" value={orderValues.BOLSTER_SIZE} onChange={(e) => setOrderValues({ ...orderValues, BOLSTER_SIZE: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-insert-size">INSERT SIZE</label>
                <input id="backupdierequests-insert-size" type="text" value={orderValues.INSERT_SIZE} onChange={(e) => setOrderValues({ ...orderValues, INSERT_SIZE: e.target.value })} style={inputStyle} />
              </div>

              <div>
                <label style={labelStyle} htmlFor="backupdierequests-requested-delivery-date">REQUESTED DELIVERY DATE</label>
                <input id="backupdierequests-requested-delivery-date" type="text" value={orderValues.DELIVERY_DATE} onChange={(e) => setOrderValues({ ...orderValues, DELIVERY_DATE: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>3D MODULE FOR SIMULATION</label>
                <label style={checkboxBoxStyle}>
                  <input type="checkbox" checked={!!orderValues.THREE_D_MODULE} onChange={(e) => setOrderValues({ ...orderValues, THREE_D_MODULE: e.target.checked })} style={{ width: '16px', height: '16px', accentColor: theme.primary }} />
                  Required
                </label>
              </div>

              <div>
                <label style={labelStyle} htmlFor="backupdierequests-mode-of-shipment">MODE OF SHIPMENT</label>
                <input id="backupdierequests-mode-of-shipment" type="text" value={orderValues.SHIPMENT} readOnly style={{ ...inputStyle, opacity: 0.8, cursor: 'not-allowed' }} placeholder="Auto-filled from supplier" />
              </div>
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-profile-weight-start">PROFILE WEIGHT START %</label>
                <input id="backupdierequests-profile-weight-start" type="text" value={orderValues.PROFILE_WEIGHT_PCT} onChange={(e) => setOrderValues({ ...orderValues, PROFILE_WEIGHT_PCT: e.target.value })} style={inputStyle} placeholder="e.g. 85" />
              </div>
              <div>
                <label style={labelStyle} htmlFor="backupdierequests-pending-order-kg">PENDING ORDER (KG)</label>
                <input id="backupdierequests-pending-order-kg" type="text" value={orderValues.PENDING_ORDER_KG} onChange={(e) => setOrderValues({ ...orderValues, PENDING_ORDER_KG: e.target.value })} style={inputStyle} placeholder="e.g. 16280" />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle} htmlFor="backupdierequests-reason-for-die-ordering">REASON FOR DIE ORDERING</label>
                <select id="backupdierequests-reason-for-die-ordering"
                  value={orderValues.REASON}
                  onChange={(e) => setOrderValues({ ...orderValues, REASON: e.target.value })}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  <option value="">Select a reason</option>
                  {DIE_ORDER_REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>FINISH</label>
                <div style={{ display: 'flex', gap: '1.25rem', padding: '10px 14px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: theme.text, fontSize: '0.875rem' }}>
                    <input type="checkbox" checked={orderValues.FINISH_MILL} onChange={(e) => setOrderValues({ ...orderValues, FINISH_MILL: e.target.checked })} style={{ width: '16px', height: '16px', accentColor: theme.primary }} />
                    Mill
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: theme.text, fontSize: '0.875rem' }}>
                    <input type="checkbox" checked={orderValues.FINISH_ANODIZING} onChange={(e) => setOrderValues({ ...orderValues, FINISH_ANODIZING: e.target.checked })} style={{ width: '16px', height: '16px', accentColor: theme.primary }} />
                    Anodizing
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: theme.text, fontSize: '0.875rem' }}>
                    <input type="checkbox" checked={orderValues.FINISH_POWDER} onChange={(e) => setOrderValues({ ...orderValues, FINISH_POWDER: e.target.checked })} style={{ width: '16px', height: '16px', accentColor: theme.primary }} />
                    Powder coating
                  </label>
                </div>
              </div>
            </div>

            {orderError && (
              <div style={{
                marginTop: '1rem', padding: '10px 14px', borderRadius: '10px',
                background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)',
                color: '#FCA5A5', fontSize: '0.85rem',
              }}>
                {orderError}
              </div>
            )}

            <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: theme.textMuted }}>
              The die-order template will be stamped onto the first page of the selected PDF (overwritten in place). The J-file (BACK UP DIE ORDERING FORM) will be auto-generated and downloaded as a separate file.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: `1px solid ${theme.cardBorder}` }}>
              <button
                onClick={() => setShowOrderModal(false)}
                disabled={orderBusy}
                style={{
                  padding: '10px 20px', borderRadius: '10px',
                  background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
                  color: theme.text, cursor: orderBusy ? 'not-allowed' : 'pointer',
                  fontWeight: 500, fontSize: '0.875rem',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateOrderPdf}
                disabled={orderBusy || (!orderFileHandle && !orderFile)}
                style={{
                  padding: '10px 24px', borderRadius: '10px',
                  background: (orderBusy || (!orderFileHandle && !orderFile)) ? '#475569' : theme.primary,
                  border: 'none', color: theme.primaryText,
                  cursor: (orderBusy || (!orderFileHandle && !orderFile)) ? 'not-allowed' : 'pointer',
                  fontWeight: 600, fontSize: '0.875rem',
                }}
              >
                {orderBusy ? 'Generating...' : 'Generate & Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BackupDieRequests;
