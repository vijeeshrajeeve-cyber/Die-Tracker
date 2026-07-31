import React, { useState, useEffect } from 'react';
import { Factory, Truck, Download, FileText, History, TrendingUp, Copy, CheckCircle, ClipboardList, Upload, HardDrive, RefreshCw, ShieldCheck } from 'lucide-react';
import { plantsAPI, suppliersAPI, apiKeysAPI, emailAPI, plantBudgetsAPI, profilesAPI, ordersAPI, autoBackupsAPI, usersAPI, qualityDiscrepanciesAPI, getUser } from '../api';
import Papa from 'papaparse';
import { dialogs } from '../components/ui/DialogProvider';
import ExistingDataPage from './ExistingDataPage';
import { BRAND, BRAND_ALPHA } from '../utils/brand';

export default function SettingsPage({
  theme, setToast,
  plants, fetchPlants,
  suppliers, fetchSuppliers,
  showAddPlant, setShowAddPlant, newPlantName, setNewPlantName,
  showAddSupplier, setShowAddSupplier, newSupplierName, setNewSupplierName,
  newSupplierShipment, setNewSupplierShipment, newSupplierRegion, setNewSupplierRegion,
  newSupplierEmail, setNewSupplierEmail,
  emailTemplates, setEmailTemplates, savingTemplateId, setSavingTemplateId,
  profileMeta, profileImportStatus, setProfileImportStatus, profileImporting, handleProfileImportFile, fetchProfileMeta,
  budgetYear, setBudgetYear, budgetActivePlant, setBudgetActivePlant,
  budgetEdits, setBudgetEdits, budgetSaving, setBudgetSaving,
  plantBudgets, fetchPlantBudgets, uniquePlants,
  apiKeys, fetchApiKeys,
  newApiKeyName, setNewApiKeyName, generatedKey, setGeneratedKey,
  apiKeyLoading, setApiKeyLoading,
  copyToClipboard, allChangeLogs,
}) {
  const [changeLogs, setChangeLogs] = useState([]);
  const [backups, setBackups] = useState([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupRunning, setBackupRunning] = useState(false);

  // QD Approvers & Purchase settings
  const me = getUser();
  const isAdmin = me?.role === 'admin';
  const [qdUsers, setQdUsers] = useState([]);
  const [qdApproverIds, setQdApproverIds] = useState([]);
  const [qdPurchaseTo, setQdPurchaseTo] = useState('');
  const [qdPurchaseCc, setQdPurchaseCc] = useState('');
  // Dropdown option lists for the raise/edit form — edited as comma-separated text.
  const [qdPressOptions, setQdPressOptions] = useState('');
  const [qdDieTypeOptions, setQdDieTypeOptions] = useState('');
  const [qdAlloyOptions, setQdAlloyOptions] = useState('');
  const [qdSettingsLoading, setQdSettingsLoading] = useState(false);
  const [qdSettingsSaving, setQdSettingsSaving] = useState(false);

  const tabs = [
    { id: 'general', label: 'Plants & Suppliers', icon: Factory },
    { id: 'email', label: 'Email Templates', icon: FileText },
    { id: 'data', label: 'Data Import', icon: ClipboardList },
    { id: 'budgets', label: 'Budget Targets', icon: TrendingUp },
    { id: 'integration', label: 'Excel Integration', icon: Download },
    { id: 'changelog', label: 'Change Log', icon: History },
    { id: 'backups', label: 'Data Backups', icon: HardDrive },
    ...(isAdmin ? [{ id: 'qd', label: 'QD Approvers & Purchase', icon: ShieldCheck }] : []),
  ];

  const [activeTab, setActiveTab] = useState(() => {
    try {
      const saved = localStorage.getItem('settingsActiveTab');
      if (saved && tabs.some(t => t.id === saved)) return saved;
    } catch { /* ignore */ }
    return 'general';
  });

  useEffect(() => {
    try { localStorage.setItem('settingsActiveTab', activeTab); } catch { /* ignore */ }
  }, [activeTab]);

  const fetchBackups = () => {
    setBackupsLoading(true);
    autoBackupsAPI.getAll()
      .then(res => setBackups(res.backups || []))
      .catch(() => setBackups([]))
      .finally(() => setBackupsLoading(false));
  };

  useEffect(() => {
    if (activeTab === 'backups') fetchBackups();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'qd' || !isAdmin) return;
    let cancelled = false;
    setQdSettingsLoading(true);
    Promise.all([usersAPI.getAll(), qualityDiscrepanciesAPI.getSettings()])
      .then(([users, settings]) => {
        if (cancelled) return;
        setQdUsers(users?.users || []);
        setQdApproverIds(settings.approverUserIds || []);
        setQdPurchaseTo(settings.purchaseEmailTo || '');
        setQdPurchaseCc(settings.purchaseEmailCc || '');
        setQdPressOptions((settings.pressOptions || []).join(', '));
        setQdDieTypeOptions((settings.dieTypeOptions || []).join(', '));
        setQdAlloyOptions((settings.alloyOptions || []).join(', '));
      })
      .catch(() => { if (!cancelled) setToast?.({ message: 'Failed to load QD settings', type: 'error' }); })
      .finally(() => { if (!cancelled) setQdSettingsLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, isAdmin, setToast]);

  const toggleQdApprover = (id) => {
    setQdApproverIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const saveQdSettings = async () => {
    setQdSettingsSaving(true);
    try {
      const toList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
      await qualityDiscrepanciesAPI.saveSettings({
        approverUserIds: qdApproverIds,
        purchaseEmailTo: qdPurchaseTo,
        purchaseEmailCc: qdPurchaseCc,
        pressOptions: toList(qdPressOptions),
        dieTypeOptions: toList(qdDieTypeOptions),
        alloyOptions: toList(qdAlloyOptions),
      });
      setToast?.({ message: 'QD approver & Purchase settings saved', type: 'success' });
      setTimeout(() => setToast?.(null), 3000);
    } catch (err) {
      setToast?.({ message: 'Failed to save: ' + err.message, type: 'error' });
      setTimeout(() => setToast?.(null), 4000);
    } finally {
      setQdSettingsSaving(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    ordersAPI.getAllChangeLogs()
      .then(res => {
        if (cancelled) return;
        const mapped = (res.changes || []).map(c => {
          const dt = c.changed_at ? new Date(c.changed_at) : null;
          const valid = dt && !isNaN(dt);
          return {
            date: valid ? dt.toLocaleDateString() : '—',
            time: valid ? dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—',
            dieNo: c.die_no,
            orderNo: c.order_no,
            changedBy: c.changed_by,
            field: c.field_name,
            oldValue: c.old_value,
            newValue: c.new_value,
            reason: c.reason,
          };
        });
        setChangeLogs(mapped);
      })
      .catch(() => { if (!cancelled) setChangeLogs([]); });
    return () => { cancelled = true; };
  }, []);

  return (
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.25rem', color: theme.text }}>Settings</h2>

              {/* Tab bar */}
              <div style={{ display: 'flex', gap: '6px', marginBottom: '1.5rem', overflowX: 'auto', borderBottom: `1px solid ${theme.cardBorder}`, paddingBottom: '2px', WebkitOverflowScrolling: 'touch' }}>
                {tabs.map(tab => {
                  const Icon = tab.icon;
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '7px',
                        padding: '10px 16px', border: 'none', cursor: 'pointer',
                        fontSize: '0.875rem', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
                        background: 'transparent',
                        color: active ? theme.text : theme.textDim,
                        borderBottom: active ? '2px solid #3B82F6' : '2px solid transparent',
                        marginBottom: '-3px', transition: 'color 0.15s',
                      }}
                    >
                      <Icon size={16} /> {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Plants & Suppliers tab */}
              <div style={{ display: activeTab === 'general' ? 'grid' : 'none', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1.5rem' }}>
                {/* Plants Section */}
                <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: theme.text }}><Factory size={20} /> Plants</h3>
                    <button onClick={() => setShowAddPlant(true)} style={{ padding: '8px 16px', background: BRAND.navy, color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>+ Add Plant</button>
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
                              <button onClick={async () => { if (await dialogs.confirm({ title: 'Delete plant', message: `Plant "${plant.name}" will be removed from the master list.`, confirmLabel: 'Delete plant' })) { try { await plantsAPI.delete(plant.id); fetchPlants(); } catch (error) { dialogs.notify('Failed to delete: ' + error.message, 'error'); } } }} style={{ padding: '4px 10px', background: '#EF4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>Delete</button>
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
                    <button onClick={() => setShowAddSupplier(true)} style={{ padding: '8px 16px', background: BRAND.navy, color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>+ Add Supplier</button>
                  </div>
                  <div style={{ background: theme.inputBg, borderRadius: '12px', overflow: 'hidden', maxHeight: '400px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={{ padding: '12px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg, position: 'sticky', top: 0 }}>Name</th>
                          <th style={{ padding: '12px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg, position: 'sticky', top: 0 }} title="Two letters used to build QD numbers, e.g. 2026PD-01">QD Code</th>
                          <th style={{ padding: '12px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg, position: 'sticky', top: 0 }}>Region</th>
                          <th style={{ padding: '12px', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg, position: 'sticky', top: 0 }}>Shipment</th>
                          <th style={{ padding: '12px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg, position: 'sticky', top: 0 }}>Contact Email</th>
                          <th style={{ padding: '12px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg, position: 'sticky', top: 0 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {suppliers.map(supplier => (
                          <tr key={supplier.id}>
                            <td style={{ padding: '12px', borderTop: `1px solid ${theme.cardBorder}`, fontWeight: 500, color: theme.text }}>{supplier.name}</td>
                            <td style={{ padding: '12px', borderTop: `1px solid ${theme.cardBorder}`, textAlign: 'center' }}>
                              <input
                                type="text"
                                maxLength={2}
                                defaultValue={supplier.qd_code || ''}
                                placeholder="—"
                                title="Two letters used to build QD numbers for this supplier, e.g. PD gives 2026PD-01. Must be unique."
                                onBlur={async (e) => {
                                  const value = e.target.value.trim().toUpperCase();
                                  if (value === (supplier.qd_code || '')) return;
                                  try { await suppliersAPI.update(supplier.id, { qd_code: value }); fetchSuppliers(); }
                                  catch (error) { dialogs.notify('Failed to update: ' + error.message, 'error'); e.target.value = supplier.qd_code || ''; }
                                }}
                                style={{ width: '52px', padding: '6px 8px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', textAlign: 'center', textTransform: 'uppercase', fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
                              />
                            </td>
                            <td style={{ padding: '12px', borderTop: `1px solid ${theme.cardBorder}`, textAlign: 'center' }}>
                              <select
                                value={supplier.region || ''}
                                onChange={async (e) => { try { await suppliersAPI.update(supplier.id, { region: e.target.value }); fetchSuppliers(); } catch (error) { dialogs.notify('Failed to update: ' + error.message, 'error'); } }}
                                style={{ padding: '4px 8px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', cursor: 'pointer' }}
                              >
                                <option value="">—</option>
                                <option value="Europe">Europe</option>
                                <option value="Turkiye">Turkiye</option>
                                <option value="China">China</option>
                                <option value="UAE">UAE</option>
                                <option value="India">India</option>
                                <option value="Other">Other</option>
                              </select>
                            </td>
                            <td style={{ padding: '12px', borderTop: `1px solid ${theme.cardBorder}`, textAlign: 'center' }}>
                              <select
                                value={supplier.shipment_mode || 'LAND'}
                                onChange={async (e) => { try { await suppliersAPI.update(supplier.id, { shipment_mode: e.target.value }); fetchSuppliers(); } catch (error) { dialogs.notify('Failed to update: ' + error.message, 'error'); } }}
                                style={{ padding: '4px 8px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', cursor: 'pointer' }}
                              >
                                <option value="AIR">AIR</option>
                                <option value="LAND">LAND</option>
                              </select>
                            </td>
                            <td style={{ padding: '12px', borderTop: `1px solid ${theme.cardBorder}` }}>
                              <input
                                type="text"
                                defaultValue={supplier.contact_email || ''}
                                placeholder="email@example.com"
                                title="Used as the To address for Design reminder emails. Separate multiple with commas."
                                onBlur={async (e) => {
                                  const value = e.target.value.trim();
                                  if (value === (supplier.contact_email || '')) return;
                                  try { await suppliersAPI.update(supplier.id, { contact_email: value }); fetchSuppliers(); } catch (error) { dialogs.notify('Failed to update: ' + error.message, 'error'); }
                                }}
                                style={{ width: '100%', minWidth: '180px', padding: '6px 8px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem' }}
                              />
                            </td>
                            <td style={{ padding: '12px', borderTop: `1px solid ${theme.cardBorder}`, textAlign: 'right' }}>
                              <button onClick={async () => { if (await dialogs.confirm({ title: 'Delete supplier', message: `Supplier "${supplier.name}" will be removed from the master list.`, confirmLabel: 'Delete supplier' })) { try { await suppliersAPI.delete(supplier.id); fetchSuppliers(); } catch (error) { dialogs.notify('Failed to delete: ' + error.message, 'error'); } } }} style={{ padding: '4px 10px', background: '#EF4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>Delete</button>
                            </td>
                          </tr>
                        ))}
                        {suppliers.length === 0 && <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: theme.textDim }}>No suppliers configured</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Email Templates tab */}
              <div style={{ display: activeTab === 'email' ? 'block' : 'none' }}>
              {/* Email Template Recipients Section - full width */}
              <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}` }}>
                <div style={{ marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: theme.text, margin: 0 }}><FileText size={20} /> Email Template Recipients</h3>
                  <p style={{ fontSize: '0.8rem', color: theme.textDim, marginTop: '4px', marginBottom: 0 }}>
                    Set default To and CC recipients used when each email template opens in Compose.
                  </p>
                </div>
                <div style={{ background: theme.inputBg, borderRadius: '12px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '12px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg }}>Template</th>
                        <th style={{ padding: '12px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg }}>Default To</th>
                        <th style={{ padding: '12px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg }}>Default CC</th>
                        <th style={{ padding: '12px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {emailTemplates.map(template => (
                        <tr key={template.id}>
                          <td style={{ padding: '12px', borderTop: `1px solid ${theme.cardBorder}`, color: theme.text }}>
                            <div style={{ fontWeight: 600 }}>{template.name}</div>
                            <div style={{ fontSize: '0.75rem', color: theme.textDim, marginTop: '2px' }}>{template.category || 'general'}</div>
                          </td>
                          <td style={{ padding: '12px', borderTop: `1px solid ${theme.cardBorder}` }}>
                            <input
                              type="text"
                              value={template.default_to || ''}
                              onChange={(e) => setEmailTemplates(prev => prev.map(item => item.id === template.id ? { ...item, default_to: e.target.value } : item))}
                              placeholder="design.team@company.com"
                              style={{ width: '100%', padding: '8px 10px', background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.85rem', boxSizing: 'border-box' }}
                            />
                          </td>
                          <td style={{ padding: '12px', borderTop: `1px solid ${theme.cardBorder}` }}>
                            <input
                              type="text"
                              value={template.default_cc || ''}
                              onChange={(e) => setEmailTemplates(prev => prev.map(item => item.id === template.id ? { ...item, default_cc: e.target.value } : item))}
                              placeholder="optional cc recipients"
                              style={{ width: '100%', padding: '8px 10px', background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.85rem', boxSizing: 'border-box' }}
                            />
                          </td>
                          <td style={{ padding: '12px', borderTop: `1px solid ${theme.cardBorder}`, textAlign: 'right' }}>
                            <button
                              onClick={async () => {
                                setSavingTemplateId(template.id);
                                try {
                                  const response = await emailAPI.updateTemplateRecipients(template.id, {
                                    default_to: template.default_to || '',
                                    default_cc: template.default_cc || '',
                                  });
                                  setEmailTemplates(prev => prev.map(item => item.id === template.id ? response.template : item));
                                  setToast({ message: `${template.name} recipients saved`, type: 'success' });
                                  setTimeout(() => setToast(null), 3000);
                                } catch (error) {
                                  setToast({ message: 'Failed to save recipients: ' + error.message, type: 'error' });
                                  setTimeout(() => setToast(null), 4000);
                                } finally {
                                  setSavingTemplateId(null);
                                }
                              }}
                              disabled={savingTemplateId === template.id}
                              style={{ padding: '8px 14px', background: savingTemplateId === template.id ? theme.cardBorder : theme.primary, color: theme.primaryText, border: 'none', borderRadius: '8px', cursor: savingTemplateId === template.id ? 'wait' : 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                            >
                              {savingTemplateId === template.id ? 'Saving...' : 'Save'}
                            </button>
                          </td>
                        </tr>
                      ))}
                      {emailTemplates.length === 0 && <tr><td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: theme.textDim }}>No email templates configured</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              </div>

              {/* Data Import tab */}
              <div style={{ display: activeTab === 'data' ? 'block' : 'none' }}>
              {/* Profile Master Section - full width */}
              <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: theme.text, margin: 0 }}><ClipboardList size={20} /> Profile Master</h3>
                    <p style={{ fontSize: '0.8rem', color: theme.textDim, marginTop: '4px', marginBottom: 0 }}>
                      Profile-number → Customer mapping. Used to auto-fill customer name on order/backup-request creation.
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '0.85rem', color: theme.textMuted }}>
                      <strong style={{ color: theme.text }}>{profileMeta.count.toLocaleString()}</strong> profiles
                      {profileMeta.last_imported && (
                        <span style={{ color: theme.textDim, marginLeft: '8px' }}>
                          · Last updated {new Date(profileMeta.last_imported).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <label style={{ padding: '8px 16px', background: profileImporting ? theme.cardBorder : 'linear-gradient(135deg, #0EA5E9, #06B6D4)', color: 'white', border: 'none', borderRadius: '8px', cursor: profileImporting ? 'wait' : 'pointer', fontSize: '0.85rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <Upload size={14} />
                      {profileImporting ? 'Importing…' : 'Import Profiles'}
                      <input
                        type="file"
                        accept=".csv,.tsv,.txt"
                        style={{ display: 'none' }}
                        disabled={profileImporting}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleProfileImportFile(f); e.target.value = ''; }}
                      />
                    </label>
                    {profileMeta.count > 0 && (
                      <button
                        onClick={async () => {
                          if (!await dialogs.confirm({ title: 'Clear profile master', message: `All ${profileMeta.count} profiles will be deleted. This cannot be undone.`, confirmLabel: 'Clear profiles' })) return;
                          try { await profilesAPI.clearAll(); fetchProfileMeta(); setProfileImportStatus({ type: 'success', message: 'All profiles cleared' }); }
                          catch (error) { dialogs.notify('Failed to clear: ' + error.message, 'error'); }
                        }}
                        style={{ padding: '8px 14px', background: 'transparent', color: '#EF4444', border: '1px solid #EF4444', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: '0.75rem', color: theme.textDim, marginTop: '8px' }}>
                  Accepted file: CSV/TSV with columns <code>Profile</code> and <code>Customer</code> (header optional). Existing profiles are updated.
                </div>
                {profileImportStatus && (
                  <div style={{
                    marginTop: '12px',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: profileImportStatus.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                    color: profileImportStatus.type === 'success' ? '#10B981' : '#EF4444',
                    fontSize: '0.85rem',
                    border: `1px solid ${profileImportStatus.type === 'success' ? '#10B981' : '#EF4444'}40`,
                  }}>
                    {profileImportStatus.message}
                  </div>
                )}
              </div>

              {/* Existing Data Import Section - full width */}
              <div style={{ marginTop: '1.5rem' }}>
                <ExistingDataPage plants={plants} theme={theme} setToast={setToast} />
              </div>
              </div>

              {/* Budget Targets tab */}
              <div style={{ display: activeTab === 'budgets' ? 'block' : 'none' }}>
              {/* Budget Targets Section - full width */}
              <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '10px' }}>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: theme.text }}><TrendingUp size={20} /> Budget Targets</h3>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '0.8rem', color: theme.textDim }}>Year:</span>
                      <input
                        type="number"
                        value={budgetYear}
                        onChange={(e) => { setBudgetYear(e.target.value); setBudgetActivePlant(null); }}
                        style={{ width: '80px', padding: '6px 10px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem' }}
                      />
                    </div>
                    <label style={{ padding: '7px 14px', background: 'linear-gradient(135deg, #0EA5E9, #06B6D4)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                      Import CSV
                      <input
                        type="file"
                        accept=".csv"
                        style={{ display: 'none' }}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const text = await file.text();
                          const result = Papa.parse(text, { header: true, skipEmptyLines: true });
                          const rows = (result.data || []).map(row => ({
                            plant_name: (row.Plant || row.plant || '').trim(),
                            year: parseInt(row.Year || row.year, 10),
                            type: (row.Type || row.type || '').toLowerCase().trim(),
                            values: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map(m => parseInt(row[m] || row[m.toLowerCase()]) || 0),
                          })).filter(r => r.plant_name && r.year && ['backup','new'].includes(r.type));
                          if (rows.length === 0) { dialogs.notify('No valid rows found. Check the CSV format.', 'error'); e.target.value = ''; return; }
                          try {
                            await plantBudgetsAPI.import(rows);
                            await fetchPlantBudgets();
                            setToast({ message: `Imported ${rows.length} budget rows`, type: 'success' });
                            setTimeout(() => setToast(null), 3000);
                          } catch (err) {
                            setToast({ message: 'Import failed: ' + err.message, type: 'error' });
                            setTimeout(() => setToast(null), 4000);
                          }
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <button
                      onClick={() => {
                        const header = 'Year,Plant,Type,Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec';
                        const sample = [
                          `${budgetYear},GEX 1,backup,55,56,56,58,58,58,58,54,59,59,58,50`,
                          `${budgetYear},GEX 1,new,35,35,35,36,36,36,37,34,37,37,37,31`,
                          `${budgetYear},GEX 2,backup,31,31,31,33,32,32,33,30,33,33,33,28`,
                          `${budgetYear},GEX 2,new,13,13,13,14,14,14,14,13,14,14,14,12`,
                        ].join('\n');
                        const blob = new Blob([header + '\n' + sample], { type: 'text/csv' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a'); a.href = url; a.download = `budget_template_${budgetYear}.csv`; a.click(); URL.revokeObjectURL(url);
                      }}
                      style={{ padding: '7px 14px', background: 'transparent', border: `1px solid ${theme.cardBorder}`, color: theme.textMuted, borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem' }}
                    >
                      Download Template
                    </button>
                  </div>
                </div>

                {/* Plant tabs */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                  {uniquePlants.map(plant => {
                    const hasData = !!(plantBudgets[budgetYear]?.[plant]);
                    return (
                      <button
                        key={plant}
                        onClick={() => setBudgetActivePlant(budgetActivePlant === plant ? null : plant)}
                        style={{
                          padding: '8px 18px', borderRadius: '10px', border: 'none', cursor: 'pointer',
                          fontWeight: 600, fontSize: '0.875rem', transition: 'all 0.15s',
                          background: budgetActivePlant === plant ? BRAND.navy : theme.inputBg,
                          color: budgetActivePlant === plant ? 'white' : theme.textMuted,
                          outline: hasData ? '2px solid #10B981' : 'none',
                          outlineOffset: '2px',
                        }}
                      >
                        {plant} {hasData && <span style={{ fontSize: '0.65rem', marginLeft: '4px' }}>✓</span>}
                      </button>
                    );
                  })}
                  {uniquePlants.length === 0 && <span style={{ fontSize: '0.8rem', color: theme.textDim }}>No plants configured. Add plants above first.</span>}
                </div>

                {/* Editable budget table */}
                {budgetActivePlant && (() => {
                  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                  const backupVals = budgetEdits.backup || Array(12).fill(0);
                  const newVals = budgetEdits.new || Array(12).fill(0);
                  return (
                    <div>
                      <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                          <thead>
                            <tr>
                              <th style={{ padding: '10px 12px', textAlign: 'left', color: theme.textDim, background: theme.tableBg, borderRadius: '8px 0 0 0', minWidth: '110px', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase' }}>Type</th>
                              {months.map(m => (
                                <th key={m} style={{ padding: '10px 6px', textAlign: 'center', color: theme.textDim, background: theme.tableBg, fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', minWidth: '54px' }}>{m}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {[{ key: 'backup', label: 'Backup Dies', color: '#F59E0B', vals: backupVals }, { key: 'new', label: 'New Dies', color: '#3B82F6', vals: newVals }].map(({ key, label, color, vals }) => (
                              <tr key={key}>
                                <td style={{ padding: '10px 12px', fontWeight: 600, color, borderTop: `1px solid ${theme.cardBorder}` }}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '2px', background: color, display: 'inline-block' }} />
                                    {label}
                                  </span>
                                </td>
                                {vals.map((v, mi) => (
                                  <td key={mi} style={{ padding: '6px 4px', borderTop: `1px solid ${theme.cardBorder}`, textAlign: 'center' }}>
                                    <input
                                      type="number"
                                      min="0"
                                      value={v}
                                      onChange={(e) => {
                                        const arr = [...vals];
                                        arr[mi] = parseInt(e.target.value) || 0;
                                        setBudgetEdits(prev => ({ ...prev, [key]: arr }));
                                      }}
                                      style={{
                                        width: '48px', padding: '5px 4px', textAlign: 'center',
                                        background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
                                        borderRadius: '6px', color: theme.text, fontSize: '0.8rem',
                                      }}
                                    />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <button
                          disabled={budgetSaving}
                          onClick={async () => {
                            setBudgetSaving(true);
                            try {
                              await plantBudgetsAPI.save(budgetActivePlant, budgetYear, 'backup', backupVals);
                              await plantBudgetsAPI.save(budgetActivePlant, budgetYear, 'new', newVals);
                              await fetchPlantBudgets();
                              setToast({ message: `Budget saved for ${budgetActivePlant} (${budgetYear})`, type: 'success' });
                              setTimeout(() => setToast(null), 3000);
                            } catch (err) {
                              setToast({ message: 'Save failed: ' + err.message, type: 'error' });
                              setTimeout(() => setToast(null), 4000);
                            } finally {
                              setBudgetSaving(false);
                            }
                          }}
                          style={{ padding: '9px 22px', background: budgetSaving ? theme.cardBorder : 'linear-gradient(135deg, #10B981, #059669)', color: 'white', border: 'none', borderRadius: '8px', cursor: budgetSaving ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.875rem' }}
                        >
                          {budgetSaving ? 'Saving…' : `Save ${budgetActivePlant} Budget`}
                        </button>
                        <span style={{ fontSize: '0.75rem', color: theme.textDim }}>
                          {budgetActivePlant} · {budgetYear}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {!budgetActivePlant && uniquePlants.length > 0 && (
                  <div style={{ padding: '2rem', textAlign: 'center', color: theme.textDim, fontSize: '0.875rem', background: theme.inputBg, borderRadius: '10px' }}>
                    Select a plant above to edit its monthly budget targets
                  </div>
                )}

                <div style={{ marginTop: '1rem', padding: '10px 14px', background: theme.inputBg, borderRadius: '8px', fontSize: '0.75rem', color: theme.textDim, lineHeight: 1.6 }}>
                  <strong style={{ color: theme.textMuted }}>CSV Format:</strong> Year, Plant, Type (backup/new), Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec — one row per plant/type combination.
                </div>
              </div>

              </div>

              {/* Excel Integration tab */}
              <div style={{ display: activeTab === 'integration' ? 'block' : 'none' }}>
              {/* Excel Integration Section - full width */}
              <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: theme.text }}><Download size={20} /> Excel Integration</h3>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                  {/* API Keys Management */}
                  <div>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: theme.textMuted, marginBottom: '0.75rem' }}>API Keys</h4>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem' }}>
                      <input
                        type="text"
                        value={newApiKeyName}
                        onChange={(e) => setNewApiKeyName(e.target.value)}
                        placeholder="Key name (e.g. My Excel)"
                        style={{ flex: 1, padding: '10px 14px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem' }}
                      />
                      <button
                        disabled={apiKeyLoading || !newApiKeyName.trim()}
                        onClick={async () => {
                          setApiKeyLoading(true);
                          try {
                            const response = await apiKeysAPI.create(newApiKeyName.trim());
                            setGeneratedKey(response.rawKey);
                            setNewApiKeyName('');
                            fetchApiKeys();
                            setToast({ message: 'API key created! Copy it now.', type: 'success' });
                            setTimeout(() => setToast(null), 5000);
                          } catch (error) {
                            setToast({ message: 'Failed to create key: ' + error.message, type: 'error' });
                            setTimeout(() => setToast(null), 5000);
                          } finally {
                            setApiKeyLoading(false);
                          }
                        }}
                        style={{ padding: '10px 16px', background: !newApiKeyName.trim() ? theme.cardBorder : BRAND.navy, color: 'white', border: 'none', borderRadius: '8px', cursor: !newApiKeyName.trim() ? 'not-allowed' : 'pointer', fontSize: '0.875rem', fontWeight: 600, opacity: !newApiKeyName.trim() ? 0.5 : 1 }}
                      >
                        + Generate
                      </button>
                    </div>

                    {/* Show generated key */}
                    {generatedKey && (
                      <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                          <CheckCircle size={16} color="#10B981" />
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#10B981' }}>New API Key — copy now, it won't be shown again!</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <code style={{ flex: 1, padding: '8px 12px', background: theme.inputBg, borderRadius: '6px', fontSize: '0.75rem', color: theme.text, wordBreak: 'break-all', fontFamily: 'monospace' }}>{generatedKey}</code>
                          <button
                            onClick={() => { copyToClipboard(generatedKey); setToast({ message: 'Key copied to clipboard!', type: 'success' }); setTimeout(() => setToast(null), 3000); }}
                            style={{ padding: '8px', background: '#10B981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', display: 'flex' }}
                          ><Copy size={16} /></button>
                        </div>
                        <button onClick={() => setGeneratedKey(null)} style={{ marginTop: '8px', padding: '4px 10px', background: 'transparent', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '6px', color: '#10B981', cursor: 'pointer', fontSize: '0.75rem' }}>Dismiss</button>
                      </div>
                    )}

                    {/* List existing keys */}
                    <div style={{ background: theme.inputBg, borderRadius: '12px', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg }}>Name</th>
                            <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg }}>Created</th>
                            <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg }}>Last Used</th>
                            <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {apiKeys.map(k => (
                            <tr key={k.id}>
                              <td style={{ padding: '10px 12px', borderTop: `1px solid ${theme.cardBorder}`, fontWeight: 500, color: theme.text, fontSize: '0.875rem' }}>{k.name}</td>
                              <td style={{ padding: '10px 12px', borderTop: `1px solid ${theme.cardBorder}`, color: theme.textDim, fontSize: '0.8rem' }}>{k.created_at ? new Date(k.created_at).toLocaleDateString() : '—'}</td>
                              <td style={{ padding: '10px 12px', borderTop: `1px solid ${theme.cardBorder}`, color: theme.textDim, fontSize: '0.8rem' }}>{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}</td>
                              <td style={{ padding: '10px 12px', borderTop: `1px solid ${theme.cardBorder}`, textAlign: 'right' }}>
                                <button onClick={async () => { if (await dialogs.confirm({ title: 'Revoke API key', message: `"${k.name}" stops working immediately. Any integration using it will start failing.`, confirmLabel: 'Revoke key' })) { try { await apiKeysAPI.delete(k.id); fetchApiKeys(); setToast({ message: 'API key revoked', type: 'success' }); setTimeout(() => setToast(null), 3000); } catch (error) { dialogs.notify('Failed to revoke: ' + error.message, 'error'); } } }} style={{ padding: '4px 10px', background: '#EF4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>Revoke</button>
                              </td>
                            </tr>
                          ))}
                          {apiKeys.length === 0 && <tr><td colSpan={4} style={{ padding: '20px', textAlign: 'center', color: theme.textDim, fontSize: '0.875rem' }}>No API keys generated yet</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Instructions */}
                  <div>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: theme.textMuted, marginBottom: '0.75rem' }}>Connect Excel to Live Data</h4>
                    <div style={{ background: theme.inputBg, borderRadius: '12px', padding: '1.25rem' }}>
                      <ol style={{ margin: 0, paddingLeft: '1.25rem', color: theme.textMuted, fontSize: '0.85rem', lineHeight: 1.8 }}>
                        <li>Generate an API key using the form on the left</li>
                        <li>Open Excel → <b style={{ color: theme.text }}>Data</b> tab → <b style={{ color: theme.text }}>Get Data</b> → <b style={{ color: theme.text }}>From Web</b></li>
                        <li>Paste the URL below (with your API key):</li>
                      </ol>
                      <div style={{ marginTop: '12px', padding: '10px 14px', background: theme.cardBg, borderRadius: '8px', border: `1px solid ${theme.cardBorder}` }}>
                        <code style={{ fontSize: '0.75rem', color: '#3B82F6', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                          {`${window.location.origin}/api/export/orders?key=YOUR_API_KEY&format=csv`}
                        </code>
                      </div>
                      <div style={{ marginTop: '1rem' }}>
                        <h5 style={{ fontSize: '0.8rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px' }}>Optional Parameters</h5>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {[
                            { label: 'format=json', desc: 'JSON output' },
                            { label: 'fields=die_no,status,...', desc: 'Select columns' },
                            { label: 'status=DONE', desc: 'Filter by status' },
                            { label: 'plant=EXT 1', desc: 'Filter by plant' },
                            { label: 'supplier=COMPES', desc: 'Filter by supplier' },
                          ].map(p => (
                            <span key={p.label} title={p.desc} style={{ fontSize: '0.7rem', padding: '4px 8px', background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, color: '#3B82F6', borderRadius: '4px', fontFamily: 'monospace', cursor: 'help' }}>{p.label}</span>
                          ))}
                        </div>
                      </div>
                      <div style={{ marginTop: '1rem' }}>
                        <h5 style={{ fontSize: '0.8rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px' }}>Available Fields</h5>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {['plant', 'order_no', 'die_no', 'type', 'die_size', 'die_requested_date', 'ordered_date', 'shipment_type', 'mandrels_per_cavity', 'total_mandrels', 'design_received_date', 'three_d_model_received_date', 'simulation_enabled', 'design_approved_date', 'delay', 'pr_entry', 'pr_number', 'customer_name', 'oracle_entry', 'supplier', 'status', 'overall_delay', 'eta', 'month', 'die_received_date', 'submission_date', 'sample_approval_date', 'no_of_trial', 'corrector', 'urgency', 'special_follow_up'].map(f => (
                            <span key={f} style={{ fontSize: '0.65rem', padding: '2px 6px', background: theme.cardBg, color: theme.textDim, borderRadius: '3px', fontFamily: 'monospace' }}>{f}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              </div>

              {/* Change Log tab */}
              <div style={{ display: activeTab === 'changelog' ? 'block' : 'none' }}>
              {/* Change Log Section */}
              <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: theme.text, margin: 0 }}>
                    <History size={20} /> Change Log
                  </h3>
                  <span style={{ fontSize: '0.8rem', color: theme.textDim, background: theme.inputBg, padding: '4px 10px', borderRadius: '20px' }}>
                    {changeLogs.length} {changeLogs.length === 1 ? 'entry' : 'entries'}
                  </span>
                </div>
                <div style={{ background: theme.inputBg, borderRadius: '12px', overflow: 'hidden', maxHeight: '520px', overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['Date', 'Time', 'Die No', 'Order No', 'Changed By', 'Field', 'Change', 'Reason'].map(h => (
                          <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg, position: 'sticky', top: 0, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {changeLogs.length === 0 ? (
                        <tr><td colSpan={8} style={{ padding: '2.5rem', textAlign: 'center', color: theme.textDim, fontSize: '0.875rem' }}>No changes recorded yet</td></tr>
                      ) : changeLogs.map((entry, idx) => (
                        <tr key={idx} style={{ background: idx % 2 === 0 ? 'transparent' : `${theme.tableBg}55` }}>
                          <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.8rem', color: theme.textDim, whiteSpace: 'nowrap' }}>{entry.date || '—'}</td>
                          <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.8rem', color: theme.textDim, whiteSpace: 'nowrap' }}>{entry.time || '—'}</td>
                          <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.8rem', fontWeight: 600, color: theme.text, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{entry.dieNo || '—'}</td>
                          <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.8rem', color: theme.textDim, whiteSpace: 'nowrap' }}>{entry.orderNo || '—'}</td>
                          <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.8rem', color: '#3B82F6', fontWeight: 500, whiteSpace: 'nowrap' }}>{entry.changedBy || '—'}</td>
                          <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.8rem', color: theme.textDim, whiteSpace: 'nowrap' }}>
                            <span style={{ padding: '2px 8px', borderRadius: '4px', background: entry.field === 'STATUS' ? 'rgba(139,92,246,0.15)' : 'rgba(59,130,246,0.1)', color: entry.field === 'STATUS' ? '#8B5CF6' : '#3B82F6', fontSize: '0.75rem', fontWeight: 600 }}>{entry.field}</span>
                          </td>
                          <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                            <span style={{ color: '#EF4444', textDecoration: 'line-through', fontFamily: 'monospace' }}>{entry.oldValue ?? '—'}</span>
                            <span style={{ color: theme.textDim, margin: '0 6px' }}>→</span>
                            <span style={{ color: '#10B981', fontWeight: 600, fontFamily: 'monospace' }}>{entry.newValue ?? '—'}</span>
                          </td>
                          <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.8rem', color: theme.textDim, maxWidth: '220px' }}>
                            {entry.reason ? (
                              <span title={entry.reason} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.reason}</span>
                            ) : <span style={{ color: theme.cardBorder }}>—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              </div>

              {/* Data Backups tab */}
              <div style={{ display: activeTab === 'backups' ? 'block' : 'none' }}>
                <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: theme.text, margin: 0 }}>
                      <HardDrive size={20} /> Data Backups
                    </h3>
                    <button
                      onClick={async () => {
                        setBackupRunning(true);
                        try {
                          await autoBackupsAPI.runNow();
                          setToast?.({ message: 'Backup created successfully', type: 'success' });
                          fetchBackups();
                        } catch (err) {
                          setToast?.({ message: 'Backup failed: ' + err.message, type: 'error' });
                        } finally {
                          setBackupRunning(false);
                        }
                      }}
                      disabled={backupRunning}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: backupRunning ? theme.inputBg : BRAND.navy, color: backupRunning ? theme.textDim : 'white', border: 'none', borderRadius: '8px', cursor: backupRunning ? 'not-allowed' : 'pointer', fontSize: '0.875rem', fontWeight: 600 }}
                    >
                      <RefreshCw size={14} style={{ animation: backupRunning ? 'spin 1s linear infinite' : 'none' }} />
                      {backupRunning ? 'Running…' : 'Backup Now'}
                    </button>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: theme.textDim, marginBottom: '1.25rem' }}>
                    Auto-backups run every 5 hours and save all die orders to Excel. The last 30 backups are kept.
                  </p>
                  <div style={{ background: theme.inputBg, borderRadius: '12px', overflow: 'hidden' }}>
                    {backupsLoading ? (
                      <div style={{ padding: '2.5rem', textAlign: 'center', color: theme.textDim, fontSize: '0.875rem' }}>Loading…</div>
                    ) : backups.length === 0 ? (
                      <div style={{ padding: '2.5rem', textAlign: 'center', color: theme.textDim, fontSize: '0.875rem' }}>No backups yet — the first one runs 1 minute after server start, or click "Backup Now".</div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            {['File', 'Date & Time', 'Size', ''].map(h => (
                              <th key={h} style={{ padding: '10px 14px', textAlign: h === '' ? 'right' : 'left', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg, whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {backups.map((b, idx) => {
                            const dt = new Date(b.createdAt);
                            const dateStr = dt.toLocaleDateString();
                            const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            const sizeKb = (b.sizeBytes / 1024).toFixed(1);
                            return (
                              <tr key={b.filename} style={{ background: idx % 2 === 0 ? 'transparent' : `${theme.tableBg}55` }}>
                                <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.8rem', fontFamily: 'monospace', color: theme.text }}>{b.filename}</td>
                                <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.8rem', color: theme.textDim, whiteSpace: 'nowrap' }}>{dateStr} {timeStr}</td>
                                <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, fontSize: '0.8rem', color: theme.textDim, whiteSpace: 'nowrap' }}>{sizeKb} KB</td>
                                <td style={{ padding: '10px 14px', borderTop: `1px solid ${theme.cardBorder}`, textAlign: 'right' }}>
                                  <button
                                    onClick={() => autoBackupsAPI.download(b.filename).catch(err => setToast?.({ message: 'Download failed: ' + err.message, type: 'error' }))}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '5px 12px', background: 'rgba(59,130,246,0.1)', color: '#3B82F6', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                                  >
                                    <Download size={12} /> Download
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>

              {/* QD Approvers & Purchase tab (admin only) */}
              {isAdmin && (
                <div style={{ display: activeTab === 'qd' ? 'block' : 'none' }}>
                  <div style={{ background: theme.cardBg, borderRadius: '16px', padding: '1.5rem', border: `1px solid ${theme.cardBorder}` }}>
                    <div style={{ marginBottom: '1.25rem' }}>
                      <h3 style={{ fontSize: '1.125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: theme.text, margin: 0 }}><ShieldCheck size={20} /> QD Approvers &amp; Purchase</h3>
                      <p style={{ fontSize: '0.8rem', color: theme.textDim, marginTop: '4px', marginBottom: 0 }}>
                        Choose who can approve or send back a Quality Discrepancy, and where the Purchase notification email goes once one is approved.
                      </p>
                    </div>

                    {qdSettingsLoading ? (
                      <div style={{ padding: '2rem', textAlign: 'center', color: theme.textDim, fontSize: '0.875rem' }}>Loading…</div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '1.5rem' }}>
                        {/* Approvers multi-select */}
                        <div>
                          <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: theme.textMuted, marginBottom: '0.75rem' }}>Approvers</h4>
                          <div style={{ background: theme.inputBg, borderRadius: '12px', overflow: 'hidden', maxHeight: '360px', overflowY: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr>
                                  <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg, position: 'sticky', top: 0 }}>User</th>
                                  <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg, position: 'sticky', top: 0 }}>Role</th>
                                  <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: theme.textDim, background: theme.tableBg, position: 'sticky', top: 0 }}>Approver</th>
                                </tr>
                              </thead>
                              <tbody>
                                {qdUsers.map(u => (
                                  <tr key={u.id}>
                                    <td style={{ padding: '10px 12px', borderTop: `1px solid ${theme.cardBorder}`, fontWeight: 500, color: theme.text, fontSize: '0.85rem' }}>{u.username}</td>
                                    <td style={{ padding: '10px 12px', borderTop: `1px solid ${theme.cardBorder}`, color: theme.textDim, fontSize: '0.8rem' }}>{u.role}</td>
                                    <td style={{ padding: '10px 12px', borderTop: `1px solid ${theme.cardBorder}`, textAlign: 'center' }}>
                                      {u.role === 'admin' ? (
                                        <span title="Admins can always approve" style={{ fontSize: '0.7rem', color: theme.textDim }}>Always</span>
                                      ) : (
                                        <input type="checkbox" checked={qdApproverIds.includes(u.id)} onChange={() => toggleQdApprover(u.id)}
                                          style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                                      )}
                                    </td>
                                  </tr>
                                ))}
                                {qdUsers.length === 0 && <tr><td colSpan={3} style={{ padding: '20px', textAlign: 'center', color: theme.textDim, fontSize: '0.85rem' }}>No users found</td></tr>}
                              </tbody>
                            </table>
                          </div>
                          <p style={{ fontSize: '0.72rem', color: theme.textDim, marginTop: '8px' }}>
                            Admins can always approve, send back, and resend to Purchase — they do not need to be listed here.
                          </p>
                        </div>

                        {/* Purchase recipients */}
                        <div>
                          <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: theme.textMuted, marginBottom: '0.75rem' }}>Purchase Notification Email</h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                            <div>
                              <label style={{ display: 'block', fontSize: '0.8rem', color: theme.textMuted, marginBottom: '0.4rem' }}>To</label>
                              <input type="text" value={qdPurchaseTo} onChange={(e) => setQdPurchaseTo(e.target.value)}
                                placeholder="purchase.team@company.com"
                                style={{ width: '100%', padding: '10px 12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.85rem', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                              <label style={{ display: 'block', fontSize: '0.8rem', color: theme.textMuted, marginBottom: '0.4rem' }}>CC</label>
                              <input type="text" value={qdPurchaseCc} onChange={(e) => setQdPurchaseCc(e.target.value)}
                                placeholder="optional cc recipients, comma-separated"
                                style={{ width: '100%', padding: '10px 12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.85rem', boxSizing: 'border-box' }} />
                            </div>
                            <div style={{ fontSize: '0.72rem', color: theme.textDim }}>
                              Sent automatically when a QD is approved, and again with "Resend to Purchase" from the QD detail drawer.
                            </div>

                            <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: theme.textMuted, margin: '0.5rem 0 0.25rem' }}>Form dropdown options</h4>
                            <div style={{ fontSize: '0.72rem', color: theme.textDim, marginBottom: '0.25rem' }}>
                              Comma-separated. These populate the Press, Die Type and Alloy dropdowns on the raise/edit form. Leave a list blank to use the built-in defaults.
                            </div>
                            {[
                              { label: 'Press', value: qdPressOptions, set: setQdPressOptions, ph: 'e.g. P1, P2, 1200T, 1650T' },
                              { label: 'Die Type', value: qdDieTypeOptions, set: setQdDieTypeOptions, ph: 'e.g. Solid, Hollow, Semi-hollow' },
                              { label: 'Alloy', value: qdAlloyOptions, set: setQdAlloyOptions, ph: 'e.g. 6060, 6063, 6061, 6082' },
                            ].map((f) => (
                              <div key={f.label}>
                                <label style={{ display: 'block', fontSize: '0.8rem', color: theme.textMuted, marginBottom: '0.4rem' }}>{f.label}</label>
                                <input type="text" value={f.value} onChange={(e) => f.set(e.target.value)} placeholder={f.ph}
                                  style={{ width: '100%', padding: '10px 12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.85rem', boxSizing: 'border-box' }} />
                              </div>
                            ))}

                            <div>
                              <button
                                disabled={qdSettingsSaving}
                                onClick={saveQdSettings}
                                style={{ padding: '9px 20px', background: qdSettingsSaving ? theme.cardBorder : BRAND.navy, color: 'white', border: 'none', borderRadius: '8px', cursor: qdSettingsSaving ? 'wait' : 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
                              >
                                {qdSettingsSaving ? 'Saving…' : 'Save QD Settings'}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

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
                      <button onClick={async () => { if (!newPlantName.trim()) { dialogs.notify('Plant name is required.', 'error'); return; } try { await plantsAPI.create(newPlantName); fetchPlants(); setShowAddPlant(false); setNewPlantName(''); } catch (error) { dialogs.notify('Failed to create: ' + error.message, 'error'); } }} style={{ padding: '10px 20px', background: BRAND.navy, color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Add Plant</button>
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
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.875rem', color: theme.textMuted, marginBottom: '0.5rem' }}>Region</label>
                      <select value={newSupplierRegion} onChange={(e) => setNewSupplierRegion(e.target.value)} style={{ width: '100%', padding: '12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, cursor: 'pointer' }}>
                        <option value="">— Select Region —</option>
                        <option value="Europe">Europe</option>
                        <option value="Turkiye">Turkiye</option>
                        <option value="China">China</option>
                        <option value="UAE">UAE</option>
                        <option value="India">India</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.875rem', color: theme.textMuted, marginBottom: '0.5rem' }}>Mode of Shipment</label>
                      <select value={newSupplierShipment} onChange={(e) => setNewSupplierShipment(e.target.value)} style={{ width: '100%', padding: '12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, cursor: 'pointer' }}>
                        <option value="LAND">LAND</option>
                        <option value="AIR">AIR</option>
                      </select>
                    </div>
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.875rem', color: theme.textMuted, marginBottom: '0.5rem' }}>Contact Email</label>
                      <input type="text" value={newSupplierEmail} onChange={(e) => setNewSupplierEmail(e.target.value)} style={{ width: '100%', padding: '12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text }} placeholder="email@example.com (used for Design reminders)" />
                    </div>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                      <button onClick={() => { setShowAddSupplier(false); setNewSupplierName(''); setNewSupplierShipment('LAND'); setNewSupplierRegion(''); setNewSupplierEmail(''); }} style={{ padding: '10px 20px', background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, cursor: 'pointer' }}>Cancel</button>
                      <button onClick={async () => { if (!newSupplierName.trim()) { dialogs.notify('Supplier name is required.', 'error'); return; } try { await suppliersAPI.create(newSupplierName, newSupplierShipment, newSupplierRegion || null, newSupplierEmail || null); fetchSuppliers(); setShowAddSupplier(false); setNewSupplierName(''); setNewSupplierShipment('LAND'); setNewSupplierRegion(''); setNewSupplierEmail(''); } catch (error) { dialogs.notify('Failed to create: ' + error.message, 'error'); } }} style={{ padding: '10px 20px', background: BRAND.navy, color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Add Supplier</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
  );
}