import React, { useState, useEffect } from 'react';
import { FileText, Save, Send, Download, CheckCircle, XCircle } from 'lucide-react';
import { emailAPI } from '../../api';
import { inputStyle, cardStyle } from './settingsStyles';
import ToggleButton from './ToggleButton';

const yesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const DailySummarySettings = ({ theme, showToast }) => {
    const [settings, setSettings] = useState({ enabled: false, time: '06:00', to: '', cc: '' });
    const [state, setState] = useState(null);
    const [lastRunDate, setLastRunDate] = useState(null);
    const [saving, setSaving] = useState(false);
    const [sending, setSending] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [previewDate, setPreviewDate] = useState(yesterday);

    const load = async () => {
        try {
            const result = await emailAPI.getDailySummarySettings();
            const s = result.settings || {};
            setSettings({
                enabled: s.daily_summary_enabled || false,
                time: s.daily_summary_time || '06:00',
                to: s.daily_summary_to || '',
                cc: s.daily_summary_cc || '',
            });
            setState(result.state);
            setLastRunDate(s.daily_summary_last_run);
        } catch (err) {
            console.error('Failed to fetch daily summary settings:', err);
        }
    };

    useEffect(() => { load(); }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await emailAPI.updateDailySummarySettings(settings);
            showToast('Daily summary settings saved', 'success');
            await load();
        } catch (err) {
            showToast(err.message || 'Failed to save daily summary settings', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleSendNow = async () => {
        setSending(true);
        try {
            const result = await emailAPI.runDailySummaryNow();
            showToast(
                result.summary?.skipped
                    ? `Not sent — ${result.summary.skipped}`
                    : `Daily summary sent to ${result.summary?.recipients || 'the configured recipients'}`,
                result.summary?.skipped ? 'error' : 'success'
            );
            await load();
        } catch (err) {
            showToast(err.message || 'Failed to send the daily summary', 'error');
        } finally {
            setSending(false);
        }
    };

    const handleDownload = async () => {
        setDownloading(true);
        try {
            const blob = await emailAPI.downloadDailySummaryPdf(previewDate);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Daily-Die-Summary-${previewDate}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            showToast(err.message || 'Failed to download the report', 'error');
        } finally {
            setDownloading(false);
        }
    };

    const labelStyle = {
        display: 'block', fontSize: '0.75rem', fontWeight: 600,
        color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase'
    };
    const hintStyle = { fontSize: '0.7rem', color: theme.textDim, margin: '4px 0 0' };
    const secondaryButton = (busy) => ({
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '10px 20px', borderRadius: '12px',
        border: `1px solid ${theme.cardBorder}`, background: 'transparent',
        color: theme.text, fontWeight: 600, cursor: busy ? 'wait' : 'pointer',
        whiteSpace: 'nowrap'
    });

    return (
        <div style={cardStyle(theme)}>
            <ToggleButton
                theme={theme}
                enabled={settings.enabled}
                onToggle={() => setSettings({ ...settings, enabled: !settings.enabled })}
                label="Daily Summary Report"
                sublabel={settings.enabled
                    ? `Active — every day at ${settings.time}, covering the previous day`
                    : 'Disabled — no daily summary will be sent'}
                icon={FileText}
                color="#0EA5E9"
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '18px' }}>
                <div>
                    <label style={labelStyle} htmlFor="dailysummary-time">Send Time</label>
                    <input id="dailysummary-time"
                        type="time"
                        value={settings.time}
                        onChange={(e) => setSettings({ ...settings, time: e.target.value || '06:00' })}
                        style={inputStyle(theme)}
                    />
                    <p style={hintStyle}>Server time, Asia/Dubai. The report covers the previous day.</p>
                </div>
                <div>
                    <label style={labelStyle} htmlFor="dailysummary-cc">CC (optional)</label>
                    <input id="dailysummary-cc"
                        type="text"
                        value={settings.cc}
                        onChange={(e) => setSettings({ ...settings, cc: e.target.value })}
                        placeholder="name@company.com, other@company.com"
                        style={inputStyle(theme)}
                    />
                    <p style={hintStyle}>Comma-separated.</p>
                </div>
            </div>

            <div style={{ marginTop: '12px' }}>
                <label style={labelStyle} htmlFor="dailysummary-to">Recipients</label>
                <input id="dailysummary-to"
                    type="text"
                    value={settings.to}
                    onChange={(e) => setSettings({ ...settings, to: e.target.value })}
                    placeholder="name@company.com, other@company.com"
                    style={inputStyle(theme)}
                />
                <p style={hintStyle}>
                    Comma-separated. Required to enable. Needs outgoing email (SMTP) to be enabled.
                </p>
            </div>

            {(state?.error || lastRunDate) && (
                <div style={{
                    marginTop: '14px', padding: '10px 14px', borderRadius: '10px',
                    background: state?.error ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
                    fontSize: '0.8rem', color: state?.error ? '#EF4444' : '#10B981',
                    display: 'flex', alignItems: 'center', gap: '8px'
                }}>
                    {state?.error
                        ? <><XCircle size={14} /> Last run error: {state.error}</>
                        : <><CheckCircle size={14} /> Last run: {lastRunDate}
                            {state?.lastResult?.reportDate
                                ? ` — ${state.lastResult.movements} movement(s) for ${state.lastResult.reportDate}`
                                : ''}</>
                    }
                </div>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <button onClick={handleSave} disabled={saving} style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '10px 20px', borderRadius: '12px', border: 'none',
                    background: '#0EA5E9', color: '#fff', fontWeight: 600,
                    cursor: saving ? 'wait' : 'pointer'
                }}>
                    <Save size={15} /> {saving ? 'Saving…' : 'Save'}
                </button>

                <button onClick={handleSendNow} disabled={sending} style={secondaryButton(sending)}>
                    <Send size={15} /> {sending ? 'Sending…' : 'Send now'}
                </button>

                <div>
                    <label style={labelStyle} htmlFor="dailysummary-preview-date">Preview a day</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <input id="dailysummary-preview-date"
                            type="date"
                            value={previewDate}
                            onChange={(e) => setPreviewDate(e.target.value)}
                            style={inputStyle(theme)}
                        />
                        <button onClick={handleDownload} disabled={downloading || !previewDate}
                            style={secondaryButton(downloading)}>
                            <Download size={15} /> {downloading ? '…' : 'Download'}
                        </button>
                    </div>
                </div>
            </div>

            {/* The distinction matters: one mails people, the other does not. */}
            <p style={{ ...hintStyle, marginTop: '12px' }}>
                <strong>Send now</strong> emails the report for yesterday to the recipients above straight away.
                <strong> Download</strong> only builds a copy for you — it sends nothing and changes nothing.
            </p>
        </div>
    );
};

export default DailySummarySettings;
