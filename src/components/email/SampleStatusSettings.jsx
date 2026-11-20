import React, { useState, useEffect } from 'react';
import { Save, Send } from 'lucide-react';
import { emailAPI } from '../../api';
import { inputStyle, labelStyle as labelStyleFor, hintStyle as hintStyleFor, primaryButton, secondaryButton as secondaryButtonFor, fieldGrid } from './settingsStyles';
import AutomationRow from './AutomationRow';

const DEFAULTS = { enabled: false, time: '18:00' };

const SampleStatusSettings = ({ theme, showToast, openId, setOpenId }) => {
    const [settings, setSettings] = useState(DEFAULTS);
    const [saved, setSaved] = useState(DEFAULTS);
    const [state, setState] = useState(null);
    const [lastRunDate, setLastRunDate] = useState(null);
    const [saving, setSaving] = useState(false);
    const [sending, setSending] = useState(false);

    const load = async () => {
        try {
            const result = await emailAPI.getSampleStatusSettings();
            const s = result.settings || {};
            const next = {
                enabled: s.sample_status_enabled || false,
                time: s.sample_status_time || '18:00',
            };
            setSettings(next);
            setSaved(next);
            setState(result.state);
            setLastRunDate(s.sample_status_last_run);
        } catch (err) {
            console.error('Failed to fetch sample status settings:', err);
        }
    };

    useEffect(() => { load(); }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await emailAPI.updateSampleStatusSettings({ enabled: settings.enabled, time: settings.time });
            showToast('Sample status settings saved', 'success');
            await load();
        } catch (err) {
            showToast(err.message || 'Failed to save sample status settings', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleSendNow = async () => {
        setSending(true);
        try {
            const result = await emailAPI.runSampleStatusNow();
            const summary = result.summary || {};
            if (summary.status === 'skipped') {
                showToast(`Not sent - ${summary.message || 'skipped'}`, 'warning');
            } else {
                showToast(summary.message || 'Sample status report sent', 'success');
            }
            await load();
        } catch (err) {
            showToast(err.message || 'Failed to send the sample status report', 'error');
        } finally {
            setSending(false);
        }
    };

    const labelStyle = labelStyleFor(theme);
    const hintStyle = hintStyleFor(theme);
    const secondaryButton = (busy) => secondaryButtonFor(theme, busy);

    const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
    const lastResult = state?.lastResult;
    const status = dirty
        ? { tone: 'warn', text: 'Unsaved changes' }
        : state?.error
            ? { tone: 'error', text: `Last run failed: ${state.error}` }
            : lastResult?.status === 'skipped'
                ? { tone: 'warn', text: `Last run skipped: ${lastResult.message}` }
                : lastRunDate
                    ? { tone: 'ok', text: `Last run ${lastRunDate}${lastResult?.message ? ` · ${lastResult.message}` : ''}` }
                    : { tone: 'idle', text: settings.enabled ? 'Waiting for first run' : 'Not running' };

    return (
        <AutomationRow
            theme={theme}
            id="samplestatus"
            name="Sample status report"
            audience="To the Sample Status template recipients"
            schedule={saved.enabled ? `Mon-Sat at ${saved.time}` : 'Off'}
            status={status}
            enabled={settings.enabled}
            onToggle={() => { setSettings({ ...settings, enabled: !settings.enabled }); setOpenId('samplestatus'); }}
            open={openId === 'samplestatus'}
            onOpen={() => setOpenId(openId === 'samplestatus' ? null : 'samplestatus')}
        >
            <div style={fieldGrid(220)}>
                <div>
                    <label style={labelStyle} htmlFor="samplestatus-time">Send time</label>
                    <input id="samplestatus-time"
                        type="time"
                        value={settings.time}
                        onChange={(e) => setSettings({ ...settings, time: e.target.value || '18:00' })}
                        style={inputStyle(theme)}
                    />
                    <p style={hintStyle}>Server time, Asia/Dubai.</p>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <button onClick={handleSave} disabled={saving} style={primaryButton(theme, saving)}>
                    <Save size={15} /> {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={handleSendNow} disabled={sending} style={secondaryButton(sending)}>
                    <Send size={15} /> {sending ? 'Sending…' : 'Send now'}
                </button>
            </div>

            <p style={{ ...hintStyle, margin: 0 }}>
                Recipients are set on the "Sample Status" email template. Sent Monday to Saturday.
            </p>
        </AutomationRow>
    );
};

export default SampleStatusSettings;
