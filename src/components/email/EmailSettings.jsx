import React, { useState, useEffect } from 'react';
import { Settings, Mail, Save, TestTube, CheckCircle, XCircle, Eye, EyeOff, Send, Inbox, RefreshCw, Bell, Truck } from 'lucide-react';
import { emailAPI } from '../../api';
import { BRAND } from '../../utils/brand';
import { inputStyle, cardStyle } from './settingsStyles';
import ToggleButton from './ToggleButton';
import DailySummarySettings from './DailySummarySettings';

const EmailSettings = ({ theme }) => {
    const [config, setConfig] = useState({
        smtp_host: '',
        smtp_port: 587,
        imap_host: '',
        imap_port: 993,
        email_user: '',
        email_password: '',
        mailbox_email: '',
        send_enabled: false,
        receive_enabled: false
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testingSmtp, setTestingSmtp] = useState(false);
    const [testingImap, setTestingImap] = useState(false);
    const [toast, setToast] = useState(null);
    const [showPassword, setShowPassword] = useState(false);
    const [imapStatus, setImapStatus] = useState(null);
    const [reminder, setReminder] = useState({ enabled: false, days: 2, time: '08:00' });
    const [reminderState, setReminderState] = useState(null);
    const [savingReminder, setSavingReminder] = useState(false);
    const [runningReminder, setRunningReminder] = useState(false);
    const [foc, setFoc] = useState({
        supplierEnabled: false, supplierTime: '08:00',
        internalEnabled: false, internalTime: '08:00', internalTo: '', idleDays: 3,
    });
    const [focState, setFocState] = useState(null);
    const [savingFoc, setSavingFoc] = useState(false);
    const [runningFoc, setRunningFoc] = useState('');

    useEffect(() => {
        fetchConfig();
        fetchImapStatus();
        fetchReminderSettings();
        fetchFocSettings();
    }, []);

    const fetchConfig = async () => {
        setLoading(true);
        try {
            const result = await emailAPI.getConfig();
            if (result.config) {
                setConfig({
                    smtp_host: result.config.smtp_host || '',
                    smtp_port: result.config.smtp_port || 587,
                    imap_host: result.config.imap_host || '',
                    imap_port: result.config.imap_port || 993,
                    email_user: result.config.email_user || '',
                    email_password: result.config.email_password || '',
                    mailbox_email: result.config.mailbox_email || '',
                    send_enabled: result.config.send_enabled || false,
                    receive_enabled: result.config.receive_enabled || false
                });
            }
        } catch (err) {
            console.error('Failed to fetch email config:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchImapStatus = async () => {
        try {
            const result = await emailAPI.getImapStatus();
            setImapStatus(result.status);
        } catch (_) { /* ignore */ }
    };

    const fetchReminderSettings = async () => {
        try {
            const result = await emailAPI.getReminderSettings();
            if (result.settings) {
                setReminder({
                    enabled: result.settings.design_reminder_enabled || false,
                    days: result.settings.design_reminder_days || 2,
                    time: result.settings.design_reminder_time || '08:00'
                });
            }
            setReminderState({ ...result.state, lastRunDate: result.settings?.design_reminder_last_run });
        } catch (err) {
            console.error('Failed to fetch reminder settings:', err);
        }
    };

    const handleSaveReminder = async () => {
        setSavingReminder(true);
        try {
            await emailAPI.updateReminderSettings(reminder);
            showToast('Reminder settings saved', 'success');
            fetchReminderSettings();
        } catch (err) {
            showToast(err.message || 'Failed to save reminder settings', 'error');
        } finally {
            setSavingReminder(false);
        }
    };

    const handleRunRemindersNow = async () => {
        setRunningReminder(true);
        try {
            const result = await emailAPI.runDesignRemindersNow();
            const s = result.summary || {};
            showToast(
                `Reminders sent: ${s.sent || 0} email(s) for ${s.totalOrders || 0} overdue order(s)` +
                (s.skippedNoEmail?.length ? ` — no email set for: ${s.skippedNoEmail.join(', ')}` : ''),
                'success'
            );
            fetchReminderSettings();
        } catch (err) {
            showToast(err.message || 'Failed to run reminders', 'error');
        } finally {
            setRunningReminder(false);
        }
    };

    const fetchFocSettings = async () => {
        try {
            const result = await emailAPI.getFocReminderSettings();
            const s = result.settings;
            if (s) {
                setFoc({
                    supplierEnabled: s.foc_supplier_enabled || false,
                    supplierTime: s.foc_supplier_time || '08:00',
                    internalEnabled: s.foc_internal_enabled || false,
                    internalTime: s.foc_internal_time || '08:00',
                    internalTo: s.foc_internal_to || '',
                    idleDays: s.foc_idle_days ?? 3,
                });
            }
            setFocState({
                ...result.state,
                supplierLastRun: s?.foc_supplier_last_run,
                internalLastRun: s?.foc_internal_last_run,
            });
        } catch (err) {
            console.error('Failed to fetch FOC reminder settings:', err);
        }
    };

    const handleSaveFoc = async () => {
        setSavingFoc(true);
        try {
            await emailAPI.updateFocReminderSettings(foc);
            showToast('FOC reminder settings saved', 'success');
            fetchFocSettings();
        } catch (err) {
            showToast(err.message || 'Failed to save FOC reminder settings', 'error');
        } finally {
            setSavingFoc(false);
        }
    };

    const handleRunFocNow = async (which) => {
        setRunningFoc(which);
        try {
            const result = await emailAPI.runFocRemindersNow(which);
            const s = result.summary || {};
            showToast(
                which === 'supplier'
                    ? `${s.sent || 0} supplier email(s) sent for ${s.totalOverdue || 0} overdue FOC(s)` +
                      (s.skippedNoEmail?.length ? ` — no email set for: ${s.skippedNoEmail.join(', ')}` : '')
                    : s.quiet
                        ? 'Nothing outstanding — no email sent'
                        : `Sent: ${s.overdue || 0} overdue, ${s.idle || 0} awaiting trial`,
                'success'
            );
            fetchFocSettings();
        } catch (err) {
            showToast(err.message || 'Failed to run FOC reminders', 'error');
        } finally {
            setRunningFoc('');
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const update = { ...config };
            // Don't send masked password back
            if (update.email_password === '••••••••') delete update.email_password;

            await emailAPI.updateConfig(update);
            showToast('Configuration saved successfully', 'success');
            fetchConfig();
            fetchImapStatus();
        } catch (err) {
            showToast(err.message || 'Failed to save', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleTestSmtp = async () => {
        setTestingSmtp(true);
        try {
            const result = await emailAPI.testConnection('smtp');
            showToast(result.message || 'SMTP connection successful!', 'success');
        } catch (err) {
            showToast(err.message || 'SMTP connection test failed', 'error');
        } finally {
            setTestingSmtp(false);
        }
    };

    const handleTestImap = async () => {
        setTestingImap(true);
        try {
            const result = await emailAPI.testConnection('imap');
            showToast(result.message || 'IMAP connection successful!', 'success');
        } catch (err) {
            showToast(err.message || 'IMAP connection test failed', 'error');
        } finally {
            setTestingImap(false);
        }
    };

    const showToast = (message, type) => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4000);
    };

    if (loading) {
        return <div style={{ padding: '40px', textAlign: 'center', color: theme.textDim }}>Loading configuration...</div>;
    }

    return (
        <div>
            {/* Toast */}
            {toast && (
                <div style={{
                    position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
                    padding: '12px 20px', borderRadius: '12px',
                    background: toast.type === 'success' ? 'rgba(16,185,129,0.95)' : 'rgba(239,68,68,0.95)',
                    color: 'white', fontSize: '0.875rem', fontWeight: 500,
                    display: 'flex', alignItems: 'center', gap: '8px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.3)'
                }}>
                    {toast.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
                    {toast.message}
                </div>
            )}

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
                <div style={{
                    width: '48px', height: '48px', borderRadius: '12px',
                    background: 'rgba(139,92,246,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                    <Settings size={24} color="#8B5CF6" />
                </div>
                <div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: theme.text, margin: 0 }}>Email Settings</h2>
                    <p style={{ fontSize: '0.8rem', color: theme.textDim, margin: 0 }}>Configure SMTP sending and IMAP receiving</p>
                </div>
            </div>

            {/* Send Toggle */}
            <div style={cardStyle(theme)}>
                <ToggleButton
                    theme={theme}
                    enabled={config.send_enabled}
                    onToggle={() => setConfig({ ...config, send_enabled: !config.send_enabled })}
                    label="Outgoing Email (SMTP)"
                    sublabel={config.send_enabled ? 'Active — emails can be sent via SMTP' : 'Disabled — outgoing email is off'}
                    icon={Send}
                    color="#3B82F6"
                />
            </div>

            {/* Receive Toggle */}
            <div style={cardStyle(theme)}>
                <ToggleButton
                    theme={theme}
                    enabled={config.receive_enabled}
                    onToggle={() => setConfig({ ...config, receive_enabled: !config.receive_enabled })}
                    label="Incoming Email (IMAP)"
                    sublabel={config.receive_enabled ? 'Active — polling mailbox every 5 minutes' : 'Disabled — incoming email polling is off'}
                    icon={Inbox}
                    color="#10B981"
                />
                {/* IMAP Status */}
                {config.receive_enabled && imapStatus && (
                    <div style={{
                        marginTop: '14px', padding: '10px 14px', borderRadius: '10px',
                        background: imapStatus.error ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
                        fontSize: '0.8rem', color: imapStatus.error ? '#EF4444' : '#10B981',
                        display: 'flex', alignItems: 'center', gap: '8px'
                    }}>
                        {imapStatus.error
                            ? <><XCircle size={14} /> Last poll error: {imapStatus.error}</>
                            : <><CheckCircle size={14} /> Last poll: {imapStatus.lastCheck ? new Date(imapStatus.lastCheck).toLocaleString() : 'Not yet'} — {imapStatus.emailsFetched} email(s) fetched</>
                        }
                    </div>
                )}
            </div>

            {/* Automatic Design Reminders */}
            <div style={cardStyle(theme)}>
                <ToggleButton
                    theme={theme}
                    enabled={reminder.enabled}
                    onToggle={() => setReminder({ ...reminder, enabled: !reminder.enabled })}
                    label="Automatic Design Reminders"
                    sublabel={reminder.enabled
                        ? `Active — daily at ${reminder.time}, one email per supplier for orders awaiting design > ${reminder.days} day(s)`
                        : 'Disabled — no automatic reminder emails will be sent'}
                    icon={Bell}
                    color="#F59E0B"
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '18px' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }} htmlFor="emailsettings-days-awaiting-design">
                            Days Awaiting Design
                        </label>
                        <input id="emailsettings-days-awaiting-design"
                            type="number"
                            min={1}
                            max={60}
                            value={reminder.days}
                            onChange={(e) => setReminder({ ...reminder, days: Math.max(1, Math.min(60, parseInt(e.target.value) || 1)) })}
                            style={inputStyle(theme)}
                        />
                        <p style={{ fontSize: '0.7rem', color: theme.textDim, margin: '4px 0 0' }}>
                            Remind for orders in "Awaiting Design" longer than this many days
                        </p>
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }} htmlFor="emailsettings-send-time">
                            Send Time
                        </label>
                        <input id="emailsettings-send-time"
                            type="time"
                            value={reminder.time}
                            onChange={(e) => setReminder({ ...reminder, time: e.target.value || '08:00' })}
                            style={inputStyle(theme)}
                        />
                        <p style={{ fontSize: '0.7rem', color: theme.textDim, margin: '4px 0 0' }}>
                            Time of day the reminder emails are sent (server time, Asia/Dubai)
                        </p>
                    </div>
                </div>

                <p style={{ fontSize: '0.75rem', color: theme.textDim, margin: '14px 0 0' }}>
                    Emails go to each supplier's contact email (set in Settings → Suppliers).
                    Suppliers without an email fall back to the "Design Reminder" template's default recipients.
                    Requires outgoing email (SMTP) to be enabled.
                </p>

                {reminderState?.lastRunDate && (
                    <div style={{
                        marginTop: '14px', padding: '10px 14px', borderRadius: '10px',
                        background: reminderState.error ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
                        fontSize: '0.8rem', color: reminderState.error ? '#EF4444' : '#10B981',
                        display: 'flex', alignItems: 'center', gap: '8px'
                    }}>
                        {reminderState.error
                            ? <><XCircle size={14} /> Last run error: {reminderState.error}</>
                            : <><CheckCircle size={14} /> Last run: {reminderState.lastRunDate}
                                {reminderState.lastResult ? ` — ${reminderState.lastResult.sent} email(s) sent for ${reminderState.lastResult.totalOrders} overdue order(s)` : ''}</>
                        }
                    </div>
                )}

                <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
                    <button onClick={handleSaveReminder} disabled={savingReminder} style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '10px 20px', borderRadius: '12px', border: 'none',
                        background: savingReminder ? '#475569' : 'linear-gradient(135deg, #F59E0B, #F97316)',
                        color: 'white', cursor: savingReminder ? 'not-allowed' : 'pointer',
                        fontWeight: 600, fontSize: '0.85rem'
                    }}>
                        <Save size={16} />
                        {savingReminder ? 'Saving...' : 'Save Reminder Settings'}
                    </button>
                    <button onClick={handleRunRemindersNow} disabled={runningReminder} style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '10px 20px', borderRadius: '12px',
                        border: `1px solid ${theme.cardBorder}`,
                        background: theme.cardBg, color: theme.text,
                        cursor: runningReminder ? 'not-allowed' : 'pointer',
                        fontWeight: 500, fontSize: '0.85rem'
                    }}>
                        <Send size={16} />
                        {runningReminder ? 'Sending...' : 'Send Reminders Now'}
                    </button>
                </div>
            </div>

            {/* FOC replacement chasers — one out to the supplier, one in to us */}
            <div style={cardStyle(theme)}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Truck size={18} color="#34D399" /> FOC Replacement Reminders
                </h3>
                <p style={{ fontSize: '0.78rem', color: theme.textDim, margin: '0 0 18px' }}>
                    Chases what is still outstanding against QDs where a free-of-charge replacement was accepted.
                </p>

                <ToggleButton
                    theme={theme}
                    enabled={foc.supplierEnabled}
                    onToggle={() => setFoc({ ...foc, supplierEnabled: !foc.supplierEnabled })}
                    label="Chase the supplier"
                    sublabel={foc.supplierEnabled
                        ? `Active — daily at ${foc.supplierTime}, one email per supplier listing replacements past the ETA they gave`
                        : 'Disabled — suppliers are not chased about overdue replacements'}
                    icon={Bell}
                    color="#60A5FA"
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '18px' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }} htmlFor="emailsettings-supplier-send-time">
                            Supplier Send Time
                        </label>
                        <input id="emailsettings-supplier-send-time" type="time" value={foc.supplierTime}
                            onChange={(e) => setFoc({ ...foc, supplierTime: e.target.value || '08:00' })}
                            style={inputStyle(theme)} />
                        <p style={{ fontSize: '0.7rem', color: theme.textDim, margin: '4px 0 0' }}>
                            Emails go to each supplier's contact email (Settings → Suppliers). A supplier with no email is skipped.
                        </p>
                    </div>
                </div>

                <div style={{ height: 1, background: theme.cardBorder, margin: '22px 0' }} />

                <ToggleButton
                    theme={theme}
                    enabled={foc.internalEnabled}
                    onToggle={() => setFoc({ ...foc, internalEnabled: !foc.internalEnabled })}
                    label="Chase our own team"
                    sublabel={foc.internalEnabled
                        ? `Active — daily at ${foc.internalTime}, listing overdue FOCs and dies received but untrialled for over ${foc.idleDays} day(s)`
                        : 'Disabled — nobody is told about replacements sitting untrialled'}
                    icon={Bell}
                    color="#F0ABFC"
                />

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px', marginTop: '18px' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }} htmlFor="emailsettings-send-to">
                            Send To
                        </label>
                        <input id="emailsettings-send-to" type="text" value={foc.internalTo} placeholder="quality@example.com, hod@example.com"
                            onChange={(e) => setFoc({ ...foc, internalTo: e.target.value })}
                            style={inputStyle(theme)} />
                        <p style={{ fontSize: '0.7rem', color: theme.textDim, margin: '4px 0 0' }}>
                            Whoever owns FOC follow-up. Required to enable this reminder.
                        </p>
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }} htmlFor="emailsettings-internal-send-time">
                            Internal Send Time
                        </label>
                        <input id="emailsettings-internal-send-time" type="time" value={foc.internalTime}
                            onChange={(e) => setFoc({ ...foc, internalTime: e.target.value || '08:00' })}
                            style={inputStyle(theme)} />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }} htmlFor="emailsettings-idle-days">
                            Idle Days
                        </label>
                        <input id="emailsettings-idle-days" type="number" min={0} max={60} value={foc.idleDays}
                            onChange={(e) => setFoc({ ...foc, idleDays: Math.max(0, Math.min(60, parseInt(e.target.value) || 0)) })}
                            style={inputStyle(theme)} />
                        <p style={{ fontSize: '0.7rem', color: theme.textDim, margin: '4px 0 0' }}>
                            How long a received die may sit untrialled before it is flagged
                        </p>
                    </div>
                </div>

                <p style={{ fontSize: '0.75rem', color: theme.textDim, margin: '14px 0 0' }}>
                    Both require outgoing email (SMTP) to be enabled. Settled QDs — closed, rejected or reference —
                    are never chased, and a day with nothing outstanding sends no internal email.
                </p>

                {(focState?.supplier?.error || focState?.internal?.error || focState?.supplierLastRun || focState?.internalLastRun) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '14px' }}>
                        {[
                            { key: 'supplier', label: 'Supplier chaser', lastRun: focState.supplierLastRun, st: focState.supplier },
                            { key: 'internal', label: 'Internal chaser', lastRun: focState.internalLastRun, st: focState.internal },
                        ].filter((r) => r.lastRun || r.st?.error).map((r) => (
                            <div key={r.key} style={{
                                padding: '10px 14px', borderRadius: '10px',
                                background: r.st?.error ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
                                fontSize: '0.8rem', color: r.st?.error ? '#EF4444' : '#10B981',
                                display: 'flex', alignItems: 'center', gap: '8px'
                            }}>
                                {r.st?.error
                                    ? <><XCircle size={14} /> {r.label} — last run error: {r.st.error}</>
                                    : <><CheckCircle size={14} /> {r.label} — last run: {r.lastRun}</>}
                            </div>
                        ))}
                    </div>
                )}

                <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
                    <button onClick={handleSaveFoc} disabled={savingFoc} style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '10px 20px', borderRadius: '12px', border: 'none',
                        background: savingFoc ? '#475569' : 'linear-gradient(135deg, #10B981, #34D399)',
                        color: 'white', cursor: savingFoc ? 'not-allowed' : 'pointer',
                        fontWeight: 600, fontSize: '0.85rem'
                    }}>
                        <Save size={16} />
                        {savingFoc ? 'Saving...' : 'Save FOC Settings'}
                    </button>
                    {['supplier', 'internal'].map((which) => (
                        <button key={which} onClick={() => handleRunFocNow(which)} disabled={!!runningFoc} style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '10px 20px', borderRadius: '12px',
                            border: `1px solid ${theme.cardBorder}`,
                            background: theme.cardBg, color: theme.text,
                            cursor: runningFoc ? 'not-allowed' : 'pointer',
                            fontWeight: 500, fontSize: '0.85rem'
                        }}>
                            <Send size={16} />
                            {runningFoc === which ? 'Sending...' : `Run ${which} chaser now`}
                        </button>
                    ))}
                </div>
            </div>

            {/* Daily Summary Report */}
            <DailySummarySettings theme={theme} showToast={showToast} />

            {/* SMTP/IMAP Configuration */}
            <div style={cardStyle(theme)}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Mail size={18} color={theme.primary} /> Connection Settings
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                    {/* SMTP Host & Port */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '12px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }} htmlFor="emailsettings-smtp-host">
                                SMTP Host
                            </label>
                            <input id="emailsettings-smtp-host"
                                type="text"
                                value={config.smtp_host}
                                onChange={(e) => setConfig({ ...config, smtp_host: e.target.value })}
                                placeholder="smtp.office365.com"
                                style={inputStyle(theme)}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }} htmlFor="emailsettings-port">
                                Port
                            </label>
                            <input id="emailsettings-port"
                                type="number"
                                value={config.smtp_port}
                                onChange={(e) => setConfig({ ...config, smtp_port: parseInt(e.target.value) || 587 })}
                                style={inputStyle(theme)}
                            />
                        </div>
                    </div>

                    {/* IMAP Host & Port */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '12px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }} htmlFor="emailsettings-imap-host">
                                IMAP Host
                            </label>
                            <input id="emailsettings-imap-host"
                                type="text"
                                value={config.imap_host}
                                onChange={(e) => setConfig({ ...config, imap_host: e.target.value })}
                                placeholder="outlook.office365.com"
                                style={inputStyle(theme)}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }} htmlFor="emailsettings-port-2">
                                Port
                            </label>
                            <input id="emailsettings-port-2"
                                type="number"
                                value={config.imap_port}
                                onChange={(e) => setConfig({ ...config, imap_port: parseInt(e.target.value) || 993 })}
                                style={inputStyle(theme)}
                            />
                        </div>
                    </div>

                    {/* Email Credentials */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }} htmlFor="emailsettings-email-username">
                            Email / Username
                        </label>
                        <input id="emailsettings-email-username"
                            type="text"
                            value={config.email_user}
                            onChange={(e) => setConfig({ ...config, email_user: e.target.value })}
                            placeholder="dieorders@yourcompany.com"
                            style={inputStyle(theme)}
                        />
                        <p style={{ fontSize: '0.7rem', color: theme.textDim, margin: '4px 0 0' }}>
                            Used for both SMTP and IMAP authentication
                        </p>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }} htmlFor="emailsettings-password-app-password">
                            Password / App Password
                        </label>
                        <div style={{ position: 'relative' }}>
                            <input id="emailsettings-password-app-password"
                                type={showPassword ? 'text' : 'password'}
                                value={config.email_password}
                                onChange={(e) => setConfig({ ...config, email_password: e.target.value })}
                                placeholder="App password or account password"
                                style={{ ...inputStyle(theme), paddingRight: '40px' }}
                            />
                            <button onClick={() => setShowPassword(!showPassword)} style={{
                                position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                                background: 'none', border: 'none', cursor: 'pointer', color: theme.textDim
                            }}>
                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                        <p style={{ fontSize: '0.7rem', color: theme.textDim, margin: '4px 0 0' }}>
                            For Office 365 with MFA, use an App Password from your Microsoft account security settings
                        </p>
                    </div>

                    {/* From / Mailbox Email */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }} htmlFor="emailsettings-from-mailbox-email">
                            From / Mailbox Email
                        </label>
                        <input id="emailsettings-from-mailbox-email"
                            type="email"
                            value={config.mailbox_email}
                            onChange={(e) => setConfig({ ...config, mailbox_email: e.target.value })}
                            placeholder="dieorders@yourcompany.com"
                            style={inputStyle(theme)}
                        />
                        <p style={{ fontSize: '0.7rem', color: theme.textDim, margin: '4px 0 0' }}>
                            The "From" address shown on sent emails (usually same as username)
                        </p>
                    </div>
                </div>
            </div>

            {/* Setup Guide */}
            <div style={{ ...cardStyle(theme), background: 'rgba(59,130,246,0.05)', borderColor: 'rgba(59,130,246,0.2)' }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: theme.primary, margin: '0 0 12px' }}>
                    Quick Setup Guide (Office 365)
                </h3>
                <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '0.8rem', color: theme.textMuted, lineHeight: 2 }}>
                    <li>SMTP Host: <code style={{ background: theme.inputBg, padding: '2px 6px', borderRadius: '4px' }}>smtp.office365.com</code> Port: <code style={{ background: theme.inputBg, padding: '2px 6px', borderRadius: '4px' }}>587</code></li>
                    <li>IMAP Host: <code style={{ background: theme.inputBg, padding: '2px 6px', borderRadius: '4px' }}>outlook.office365.com</code> Port: <code style={{ background: theme.inputBg, padding: '2px 6px', borderRadius: '4px' }}>993</code></li>
                    <li>If MFA is enabled, generate an <strong>App Password</strong> at Microsoft account security settings</li>
                    <li>Enter your shared mailbox email and app password above</li>
                    <li>Enable sending and/or receiving, save, and test the connections</li>
                </ol>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <button onClick={handleSave} disabled={saving} style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '12px 24px', borderRadius: '12px', border: 'none',
                    background: saving ? '#475569' : BRAND.navy,
                    color: 'white', cursor: saving ? 'not-allowed' : 'pointer',
                    fontWeight: 600, fontSize: '0.9rem',
                    boxShadow: '0 4px 12px rgba(59,130,246,0.3)'
                }}>
                    <Save size={18} />
                    {saving ? 'Saving...' : 'Save Configuration'}
                </button>
                <button onClick={handleTestSmtp} disabled={testingSmtp} style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '12px 24px', borderRadius: '12px',
                    border: `1px solid ${theme.cardBorder}`,
                    background: theme.cardBg, color: theme.text,
                    cursor: testingSmtp ? 'not-allowed' : 'pointer',
                    fontWeight: 500, fontSize: '0.9rem'
                }}>
                    <TestTube size={18} />
                    {testingSmtp ? 'Testing...' : 'Test SMTP'}
                </button>
                <button onClick={handleTestImap} disabled={testingImap} style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '12px 24px', borderRadius: '12px',
                    border: `1px solid ${theme.cardBorder}`,
                    background: theme.cardBg, color: theme.text,
                    cursor: testingImap ? 'not-allowed' : 'pointer',
                    fontWeight: 500, fontSize: '0.9rem'
                }}>
                    <RefreshCw size={18} />
                    {testingImap ? 'Testing...' : 'Test IMAP'}
                </button>
            </div>
        </div>
    );
};

export default EmailSettings;
