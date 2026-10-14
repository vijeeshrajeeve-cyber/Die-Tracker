import React, { useState, useEffect } from 'react';
import { Save, TestTube, CheckCircle, XCircle, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { emailAPI } from '../../api';
import {
    inputStyle, cardStyle, labelStyle, hintStyle, tones, chipStyle,
    primaryButton, secondaryButton, fieldGrid
} from './settingsStyles';
import ToggleSwitch from './ToggleSwitch';
import DesignReminderSettings from './DesignReminderSettings';
import FocReminderSettings from './FocReminderSettings';
import DailySummarySettings from './DailySummarySettings';
import DeliveryChaserSettings from './DeliveryChaserSettings';

// Settings → Email.
//
// Two halves: the mailbox (one account that sends and receives for the whole
// tracker) and the automated emails that use it. Each automation owns its own
// state, save and run-now; only the mailbox lives here.

const MASKED = '••••••••';

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
    const [openId, setOpenId] = useState(null);
    const t = tones(theme);

    useEffect(() => {
        fetchConfig();
        fetchImapStatus();
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
        } catch { /* ignore */ }
    };

    const showToast = (message, type) => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4000);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const update = { ...config };
            // Don't send masked password back
            if (update.email_password === MASKED) delete update.email_password;

            await emailAPI.updateConfig(update);
            showToast('Mailbox settings saved', 'success');
            fetchConfig();
            fetchImapStatus();
        } catch (err) {
            showToast(err.message || 'Failed to save', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async (kind) => {
        const [setBusy, label] = kind === 'smtp' ? [setTestingSmtp, 'SMTP'] : [setTestingImap, 'IMAP'];
        setBusy(true);
        try {
            const result = await emailAPI.testConnection(kind);
            showToast(result.message || `${label} connection successful!`, 'success');
        } catch (err) {
            showToast(err.message || `${label} connection test failed`, 'error');
        } finally {
            setBusy(false);
        }
    };

    if (loading) {
        return <div style={{ padding: '40px', textAlign: 'center', color: theme.textDim }}>Loading configuration...</div>;
    }

    const label = labelStyle(theme);
    const hint = hintStyle(theme);
    const direction = {
        border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', padding: '20px',
        display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0
    };
    const directionHead = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' };

    return (
        <div>
            {/* Toast — solid fills with white text clear 4.5:1 in either theme */}
            {toast && (
                <div role="status" style={{
                    position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
                    padding: '12px 20px', borderRadius: '12px',
                    background: toast.type === 'success' ? '#0F7A4D' : '#B3261E',
                    color: '#ffffff', fontSize: '0.875rem', fontWeight: 500,
                    display: 'flex', alignItems: 'center', gap: '8px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.3)'
                }}>
                    {toast.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
                    {toast.message}
                </div>
            )}

            {/* Header */}
            <div style={{ marginBottom: '1.5rem' }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: theme.text, margin: 0 }}>Email settings</h2>
                <p style={{ fontSize: '0.9rem', color: theme.textMuted, margin: '6px 0 0', maxWidth: '60ch' }}>
                    One mailbox sends and receives for the whole tracker. Turn on the automated emails you want it to run.
                </p>
            </div>

            {/* Mailbox */}
            <section style={{ ...cardStyle(theme), display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                    <div>
                        <p style={{ ...label, margin: 0 }}>Mailbox</p>
                        <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: theme.text, margin: '4px 0 0', overflowWrap: 'anywhere' }}>
                            {config.mailbox_email || 'No mailbox set'}
                        </h3>
                    </div>
                    <details style={{ fontSize: '0.8rem', color: theme.textMuted, maxWidth: '360px' }}>
                        <summary style={{ cursor: 'pointer', fontWeight: 600, color: theme.primary, minHeight: '44px', display: 'flex', alignItems: 'center' }}>
                            Office 365 setup guide
                        </summary>
                        <div style={{ lineHeight: 2, paddingBottom: '8px' }}>
                            SMTP <code style={chipStyle(theme)}>smtp.office365.com</code> port <code style={chipStyle(theme)}>587</code><br />
                            IMAP <code style={chipStyle(theme)}>outlook.office365.com</code> port <code style={chipStyle(theme)}>993</code><br />
                            With MFA, use an <strong>App Password</strong> from your Microsoft account security settings.
                        </div>
                    </details>
                </div>

                <div style={fieldGrid(320)}>
                    {/* Sending */}
                    <div style={direction}>
                        <div style={directionHead}>
                            <div>
                                <div style={{ fontSize: '1rem', fontWeight: 700, color: theme.text }}>Sending (SMTP)</div>
                                <div style={{ fontSize: '0.8rem', color: theme.textDim, marginTop: '2px' }}>
                                    {config.send_enabled ? 'On · outgoing emails are delivered' : 'Off · nothing is sent, automations pause'}
                                </div>
                            </div>
                            <ToggleSwitch theme={theme} enabled={config.send_enabled} label="Sending enabled"
                                onToggle={() => setConfig({ ...config, send_enabled: !config.send_enabled })} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 96px', gap: '12px' }}>
                            <div>
                                <label style={label} htmlFor="emailsettings-smtp-host">SMTP host</label>
                                <input id="emailsettings-smtp-host" type="text" value={config.smtp_host}
                                    onChange={(e) => setConfig({ ...config, smtp_host: e.target.value })}
                                    placeholder="smtp.office365.com" style={inputStyle(theme)} />
                            </div>
                            <div>
                                <label style={label} htmlFor="emailsettings-port">Port</label>
                                <input id="emailsettings-port" type="number" value={config.smtp_port}
                                    onChange={(e) => setConfig({ ...config, smtp_port: parseInt(e.target.value) || 587 })}
                                    style={inputStyle(theme)} />
                            </div>
                        </div>
                        <div>
                            <button onClick={() => handleTest('smtp')} disabled={testingSmtp} style={secondaryButton(theme, testingSmtp)}>
                                <TestTube size={16} /> {testingSmtp ? 'Testing…' : 'Test sending'}
                            </button>
                        </div>
                    </div>

                    {/* Receiving */}
                    <div style={direction}>
                        <div style={directionHead}>
                            <div>
                                <div style={{ fontSize: '1rem', fontWeight: 700, color: theme.text }}>Receiving (IMAP)</div>
                                <div style={{ fontSize: '0.8rem', color: theme.textDim, marginTop: '2px' }}>
                                    {config.receive_enabled ? 'On · mailbox polled every 5 minutes' : 'Off · replies are not picked up'}
                                </div>
                            </div>
                            <ToggleSwitch theme={theme} enabled={config.receive_enabled} label="Receiving enabled"
                                onToggle={() => setConfig({ ...config, receive_enabled: !config.receive_enabled })} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 96px', gap: '12px' }}>
                            <div>
                                <label style={label} htmlFor="emailsettings-imap-host">IMAP host</label>
                                <input id="emailsettings-imap-host" type="text" value={config.imap_host}
                                    onChange={(e) => setConfig({ ...config, imap_host: e.target.value })}
                                    placeholder="outlook.office365.com" style={inputStyle(theme)} />
                            </div>
                            <div>
                                <label style={label} htmlFor="emailsettings-port-2">Port</label>
                                <input id="emailsettings-port-2" type="number" value={config.imap_port}
                                    onChange={(e) => setConfig({ ...config, imap_port: parseInt(e.target.value) || 993 })}
                                    style={inputStyle(theme)} />
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                            <button onClick={() => handleTest('imap')} disabled={testingImap} style={secondaryButton(theme, testingImap)}>
                                <RefreshCw size={16} /> {testingImap ? 'Testing…' : 'Test receiving'}
                            </button>
                            {config.receive_enabled && imapStatus && (
                                <span style={{
                                    display: 'flex', alignItems: 'flex-start', gap: '6px',
                                    fontSize: '0.8rem', fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere',
                                    color: imapStatus.error ? t.danger : t.success
                                }}>
                                    {imapStatus.error
                                        ? <><XCircle size={14} style={{ flex: 'none', marginTop: '2px' }} /> Last poll failed: {imapStatus.error}</>
                                        : <><CheckCircle size={14} style={{ flex: 'none', marginTop: '2px' }} /> Last poll {imapStatus.lastCheck ? new Date(imapStatus.lastCheck).toLocaleString() : 'not yet'} · {imapStatus.emailsFetched} fetched</>}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Credentials */}
                <div style={fieldGrid(240)}>
                    <div>
                        <label style={label} htmlFor="emailsettings-email-username">Email / username</label>
                        <input id="emailsettings-email-username" type="text" value={config.email_user}
                            onChange={(e) => setConfig({ ...config, email_user: e.target.value })}
                            placeholder="dieorders@yourcompany.com" style={inputStyle(theme)} />
                        <p style={hint}>Used for both sending and receiving.</p>
                    </div>
                    <div>
                        <label style={label} htmlFor="emailsettings-password-app-password">Password / app password</label>
                        <div style={{ position: 'relative' }}>
                            <input id="emailsettings-password-app-password"
                                type={showPassword ? 'text' : 'password'}
                                value={config.email_password}
                                onChange={(e) => setConfig({ ...config, email_password: e.target.value })}
                                placeholder="App password or account password"
                                style={{ ...inputStyle(theme), paddingRight: '48px' }} />
                            <button type="button" onClick={() => setShowPassword(!showPassword)}
                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                                style={{
                                    position: 'absolute', right: '2px', top: '50%', transform: 'translateY(-50%)',
                                    width: '44px', height: '44px', background: 'none', border: 'none',
                                    cursor: 'pointer', color: theme.textMuted,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                                }}>
                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                        <p style={hint}>Leave as is to keep the saved password.</p>
                    </div>
                    <div>
                        <label style={label} htmlFor="emailsettings-from-mailbox-email">From / mailbox email</label>
                        <input id="emailsettings-from-mailbox-email" type="email" value={config.mailbox_email}
                            onChange={(e) => setConfig({ ...config, mailbox_email: e.target.value })}
                            placeholder="dieorders@yourcompany.com" style={inputStyle(theme)} />
                        <p style={hint}>The &quot;From&quot; address on sent emails.</p>
                    </div>
                </div>

                <div style={{
                    display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
                    gap: '12px', borderTop: `1px solid ${theme.cardBorder}`, paddingTop: '20px'
                }}>
                    <p style={{ ...hint, margin: 0 }}>
                        Switches and fields apply when you save. The test buttons use what was last saved.
                    </p>
                    <button onClick={handleSave} disabled={saving} style={primaryButton(theme, saving)}>
                        <Save size={16} /> {saving ? 'Saving…' : 'Save mailbox'}
                    </button>
                </div>
            </section>

            {/* Automated emails */}
            <section>
                <div style={{ margin: '0 0 12px' }}>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: theme.text, margin: 0 }}>Automated emails</h3>
                    <p style={{ fontSize: '0.85rem', color: theme.textMuted, margin: '4px 0 0' }}>
                        What the tracker sends on its own. All of these need sending to be on.
                    </p>
                </div>
                <div style={{
                    display: 'flex', flexDirection: 'column', gap: '1px',
                    background: theme.cardBorder, border: `1px solid ${theme.cardBorder}`,
                    borderRadius: '16px', overflow: 'hidden', boxShadow: theme.shadowMd
                }}>
                    <DesignReminderSettings theme={theme} showToast={showToast} openId={openId} setOpenId={setOpenId} />
                    <FocReminderSettings theme={theme} showToast={showToast} openId={openId} setOpenId={setOpenId} />
                    <DeliveryChaserSettings theme={theme} showToast={showToast} openId={openId} setOpenId={setOpenId} />
                    <DailySummarySettings theme={theme} showToast={showToast} openId={openId} setOpenId={setOpenId} />
                </div>
            </section>
        </div>
    );
};

export default EmailSettings;
