import React, { useState, useEffect } from 'react';
import { Save, Send, Download } from 'lucide-react';
import { emailAPI } from '../../api';
import { inputStyle, labelStyle as labelStyleFor, hintStyle as hintStyleFor, primaryButton, secondaryButton as secondaryButtonFor, fieldGrid } from './settingsStyles';
import AutomationRow from './AutomationRow';

const yesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const DEFAULTS = { enabled: false, time: '06:00', to: '', cc: '' };

const DailySummarySettings = ({ theme, showToast, openId, setOpenId }) => {
    const [settings, setSettings] = useState(DEFAULTS);
    const [saved, setSaved] = useState(DEFAULTS);
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
            const next = {
                enabled: s.daily_summary_enabled || false,
                time: s.daily_summary_time || '06:00',
                to: s.daily_summary_to || '',
                cc: s.daily_summary_cc || '',
            };
            setSettings(next);
            setSaved(next);
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

    const labelStyle = labelStyleFor(theme);
    const hintStyle = hintStyleFor(theme);
    const secondaryButton = (busy) => secondaryButtonFor(theme, busy);

    const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
    const status = dirty
        ? { tone: 'warn', text: 'Unsaved changes' }
        : state?.error
            ? { tone: 'error', text: `Last run failed: ${state.error}` }
            : lastRunDate
                ? {
                    tone: 'ok',
                    text: `Last run ${lastRunDate}` +
                        (state?.lastResult?.reportDate
                            ? ` · ${state.lastResult.movements} movement(s) for ${state.lastResult.reportDate}`
                            : '')
                }
                : settings.to || !settings.enabled
                    ? { tone: 'idle', text: settings.enabled ? 'Waiting for first run' : 'Not running' }
                    : { tone: 'idle', text: 'Add recipients to turn on' };

    return (
        <AutomationRow
            theme={theme}
            id="summary"
            name="Daily summary report"
            audience={saved.to ? 'To your team' : 'To your team · needs recipients'}
            schedule={saved.enabled ? `Daily at ${saved.time} · covers the previous day` : 'Off'}
            status={status}
            enabled={settings.enabled}
            onToggle={() => { setSettings({ ...settings, enabled: !settings.enabled }); setOpenId('summary'); }}
            open={openId === 'summary'}
            onOpen={() => setOpenId(openId === 'summary' ? null : 'summary')}
        >
            <div style={fieldGrid(220)}>
                <div>
                    <label style={labelStyle} htmlFor="dailysummary-time">Send time</label>
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

            <div>
                <label style={labelStyle} htmlFor="dailysummary-to">Recipients</label>
                <input id="dailysummary-to"
                    type="text"
                    value={settings.to}
                    onChange={(e) => setSettings({ ...settings, to: e.target.value })}
                    placeholder="name@company.com, other@company.com"
                    style={inputStyle(theme)}
                />
                <p style={hintStyle}>
                    Comma-separated. Required to enable. Needs sending to be on.
                </p>
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <button onClick={handleSave} disabled={saving} style={primaryButton(theme, saving)}>
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
            <p style={{ ...hintStyle, margin: 0 }}>
                <strong>Send now</strong> emails the report for yesterday to the recipients above straight away.
                <strong> Download</strong> only builds a copy for you — it sends nothing and changes nothing.
            </p>
        </AutomationRow>
    );
};

export default DailySummarySettings;
