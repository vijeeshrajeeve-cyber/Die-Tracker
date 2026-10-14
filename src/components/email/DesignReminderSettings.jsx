import React, { useState, useEffect } from 'react';
import { Save, Send } from 'lucide-react';
import { emailAPI } from '../../api';
import { inputStyle, labelStyle, hintStyle, primaryButton, secondaryButton, fieldGrid } from './settingsStyles';
import AutomationRow from './AutomationRow';

// Settings → Email row for the automatic design reminders: one email per
// supplier listing orders that have sat in "Awaiting Design" too long.
const DEFAULTS = { enabled: false, days: 2, time: '08:00' };

const DesignReminderSettings = ({ theme, showToast, openId, setOpenId }) => {
    const [settings, setSettings] = useState(DEFAULTS);
    const [saved, setSaved] = useState(DEFAULTS);
    const [state, setState] = useState(null);
    const [saving, setSaving] = useState(false);
    const [running, setRunning] = useState(false);

    const load = async () => {
        try {
            const result = await emailAPI.getReminderSettings();
            const s = result.settings || {};
            const next = {
                enabled: s.design_reminder_enabled || false,
                days: s.design_reminder_days || 2,
                time: s.design_reminder_time || '08:00',
            };
            setSettings(next);
            setSaved(next);
            setState({ ...result.state, lastRunDate: s.design_reminder_last_run });
        } catch (err) {
            console.error('Failed to fetch reminder settings:', err);
        }
    };

    useEffect(() => { load(); }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await emailAPI.updateReminderSettings(settings);
            showToast('Reminder settings saved', 'success');
            await load();
        } catch (err) {
            showToast(err.message || 'Failed to save reminder settings', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleRunNow = async () => {
        setRunning(true);
        try {
            const result = await emailAPI.runDesignRemindersNow();
            const s = result.summary || {};
            showToast(
                `Reminders sent: ${s.sent || 0} email(s) for ${s.totalOrders || 0} overdue order(s)` +
                (s.skippedNoEmail?.length ? ` — no email set for: ${s.skippedNoEmail.join(', ')}` : ''),
                'success'
            );
            await load();
        } catch (err) {
            showToast(err.message || 'Failed to run reminders', 'error');
        } finally {
            setRunning(false);
        }
    };

    const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
    const status = dirty
        ? { tone: 'warn', text: 'Unsaved changes' }
        : state?.error
            ? { tone: 'error', text: `Last run failed: ${state.error}` }
            : state?.lastRunDate
                ? {
                    tone: 'ok',
                    text: `Last run ${state.lastRunDate}` +
                        (state.lastResult ? ` · ${state.lastResult.sent} email(s) for ${state.lastResult.totalOrders} order(s)` : '')
                }
                : { tone: 'idle', text: settings.enabled ? 'Waiting for first run' : 'Not running' };

    return (
        <AutomationRow
            theme={theme}
            id="design"
            name="Design reminders"
            audience="To suppliers"
            schedule={saved.enabled
                ? `Daily at ${saved.time} · orders awaiting design over ${saved.days} day(s)`
                : 'Off'}
            status={status}
            enabled={settings.enabled}
            onToggle={() => { setSettings({ ...settings, enabled: !settings.enabled }); setOpenId('design'); }}
            open={openId === 'design'}
            onOpen={() => setOpenId(openId === 'design' ? null : 'design')}
        >
            <div style={fieldGrid(220)}>
                <div>
                    <label style={labelStyle(theme)} htmlFor="emailsettings-days-awaiting-design">Days awaiting design</label>
                    <input id="emailsettings-days-awaiting-design" type="number" min={1} max={60}
                        value={settings.days}
                        onChange={(e) => setSettings({ ...settings, days: Math.max(1, Math.min(60, parseInt(e.target.value) || 1)) })}
                        style={inputStyle(theme)} />
                    <p style={hintStyle(theme)}>Remind for orders in &quot;Awaiting Design&quot; longer than this many days.</p>
                </div>
                <div>
                    <label style={labelStyle(theme)} htmlFor="emailsettings-send-time">Send time</label>
                    <input id="emailsettings-send-time" type="time" value={settings.time}
                        onChange={(e) => setSettings({ ...settings, time: e.target.value || '08:00' })}
                        style={inputStyle(theme)} />
                    <p style={hintStyle(theme)}>Server time, Asia/Dubai.</p>
                </div>
            </div>

            <p style={{ ...hintStyle(theme), margin: 0 }}>
                Emails go to each supplier&apos;s contact email (Settings → Suppliers). Suppliers without an email fall
                back to the &quot;Design Reminder&quot; template&apos;s default recipients. Requires sending to be on.
            </p>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <button onClick={handleSave} disabled={saving} style={primaryButton(theme, saving)}>
                    <Save size={16} /> {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={handleRunNow} disabled={running} style={secondaryButton(theme, running)}>
                    <Send size={16} /> {running ? 'Sending…' : 'Send now'}
                </button>
            </div>
        </AutomationRow>
    );
};

export default DesignReminderSettings;
