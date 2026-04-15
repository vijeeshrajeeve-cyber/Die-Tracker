import React, { useState, useEffect } from 'react';
import { Settings, Mail, Save, TestTube, CheckCircle, XCircle, Eye, EyeOff, Send, Inbox, RefreshCw } from 'lucide-react';
import { emailAPI } from '../../api';

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
        } catch (_) { /* ignore */ }
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

    const inputStyle = {
        width: '100%',
        padding: '12px 14px',
        background: theme.inputBg,
        border: `1px solid ${theme.cardBorder}`,
        borderRadius: '10px',
        color: theme.text,
        fontSize: '0.875rem',
        outline: 'none',
        boxSizing: 'border-box'
    };

    const cardStyle = {
        background: theme.cardBg, borderRadius: '20px',
        padding: '24px', border: `1px solid ${theme.cardBorder}`,
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        marginBottom: '1.5rem'
    };

    const ToggleButton = ({ enabled, onToggle, label, sublabel, icon: Icon, color }) => (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Icon size={20} color={enabled ? color : theme.textDim} />
                <div>
                    <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text, margin: 0 }}>{label}</h3>
                    <p style={{ fontSize: '0.8rem', color: theme.textDim, margin: '2px 0 0' }}>{sublabel}</p>
                </div>
            </div>
            <button
                onClick={onToggle}
                style={{
                    width: '52px', height: '28px', borderRadius: '14px',
                    background: enabled ? color : theme.cardBorder,
                    border: 'none', cursor: 'pointer', position: 'relative',
                    transition: 'background 0.2s'
                }}
            >
                <div style={{
                    width: '22px', height: '22px', borderRadius: '50%',
                    background: 'white', position: 'absolute', top: '3px',
                    left: enabled ? '27px' : '3px',
                    transition: 'left 0.2s',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }} />
            </button>
        </div>
    );

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
            <div style={cardStyle}>
                <ToggleButton
                    enabled={config.send_enabled}
                    onToggle={() => setConfig({ ...config, send_enabled: !config.send_enabled })}
                    label="Outgoing Email (SMTP)"
                    sublabel={config.send_enabled ? 'Active — emails can be sent via SMTP' : 'Disabled — outgoing email is off'}
                    icon={Send}
                    color="#3B82F6"
                />
            </div>

            {/* Receive Toggle */}
            <div style={cardStyle}>
                <ToggleButton
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

            {/* SMTP/IMAP Configuration */}
            <div style={cardStyle}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Mail size={18} color={theme.primary} /> Connection Settings
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                    {/* SMTP Host & Port */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '12px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }}>
                                SMTP Host
                            </label>
                            <input
                                type="text"
                                value={config.smtp_host}
                                onChange={(e) => setConfig({ ...config, smtp_host: e.target.value })}
                                placeholder="smtp.office365.com"
                                style={inputStyle}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }}>
                                Port
                            </label>
                            <input
                                type="number"
                                value={config.smtp_port}
                                onChange={(e) => setConfig({ ...config, smtp_port: parseInt(e.target.value) || 587 })}
                                style={inputStyle}
                            />
                        </div>
                    </div>

                    {/* IMAP Host & Port */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '12px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }}>
                                IMAP Host
                            </label>
                            <input
                                type="text"
                                value={config.imap_host}
                                onChange={(e) => setConfig({ ...config, imap_host: e.target.value })}
                                placeholder="outlook.office365.com"
                                style={inputStyle}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }}>
                                Port
                            </label>
                            <input
                                type="number"
                                value={config.imap_port}
                                onChange={(e) => setConfig({ ...config, imap_port: parseInt(e.target.value) || 993 })}
                                style={inputStyle}
                            />
                        </div>
                    </div>

                    {/* Email Credentials */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }}>
                            Email / Username
                        </label>
                        <input
                            type="text"
                            value={config.email_user}
                            onChange={(e) => setConfig({ ...config, email_user: e.target.value })}
                            placeholder="dieorders@yourcompany.com"
                            style={inputStyle}
                        />
                        <p style={{ fontSize: '0.7rem', color: theme.textDim, margin: '4px 0 0' }}>
                            Used for both SMTP and IMAP authentication
                        </p>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }}>
                            Password / App Password
                        </label>
                        <div style={{ position: 'relative' }}>
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={config.email_password}
                                onChange={(e) => setConfig({ ...config, email_password: e.target.value })}
                                placeholder="App password or account password"
                                style={{ ...inputStyle, paddingRight: '40px' }}
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
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase' }}>
                            From / Mailbox Email
                        </label>
                        <input
                            type="email"
                            value={config.mailbox_email}
                            onChange={(e) => setConfig({ ...config, mailbox_email: e.target.value })}
                            placeholder="dieorders@yourcompany.com"
                            style={inputStyle}
                        />
                        <p style={{ fontSize: '0.7rem', color: theme.textDim, margin: '4px 0 0' }}>
                            The "From" address shown on sent emails (usually same as username)
                        </p>
                    </div>
                </div>
            </div>

            {/* Setup Guide */}
            <div style={{ ...cardStyle, background: 'rgba(59,130,246,0.05)', borderColor: 'rgba(59,130,246,0.2)' }}>
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
                    background: saving ? '#475569' : 'linear-gradient(135deg, #3B82F6, #6366F1)',
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
