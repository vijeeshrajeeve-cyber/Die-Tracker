import React, { useState, useEffect } from 'react';
import { Save, Send } from 'lucide-react';
import { emailAPI } from '../../api';
import { inputStyle, labelStyle, hintStyle, primaryButton, secondaryButton, fieldGrid } from './settingsStyles';
import AutomationRow from './AutomationRow';

// Settings → Email row for the pending-for-ordering reminder: one email per plant to the
// Purchasing team listing orders that have sat in "Pending for Ordering" too long.
const DEFAULTS = { enabled: false, days: 2, time: '08:00' };

const OrderingReminderSettings = ({ theme, showToast, openId, setOpenId }) => {
    const [settings, setSettings] = useState(DEFAULTS);
    const [saved, setSaved] = useState(DEFAULTS);
    const [state, setState] = useState(null);
    const [saving, setSaving] = useState(false);
    const [running, setRunning] = useState(false);

    const load = async () => {
        try {
            const result = await emailAPI.getOrderingReminderSettings();
            const s = result.settings || {};
            const next = {
                enabled: s.ordering_reminder_enabled || false,
                days: s.ordering_reminder_days || 2,
                time: s.ordering_reminder_time || '08:00',
            };
            setSettings(next);
            setSaved(next);
            setState({ ...result.state, lastRunDate: s.ordering_reminder_last_run });
        } catch (err) {
            console.error('Failed to fetch reminder settings:', err);
        }
    };

    useEffect(() => { load(); }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await emailAPI.updateOrderingReminderSettings(settings);
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
            const result = await emailAPI.runOrderingRemindersNow();
            const s = result.summary || {};
            showToast(
                `Reminders sent: ${s.sent || 0} email(s) for ${s.totalOrders || 0} overdue order(s)` +
                (s.undated ? ` — ${s.undated} order(s) skipped, no usable requested date` : ''),
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
            id="ordering"
            name="Pending for ordering reminders"
            audience="To the Purchasing team"
            schedule={saved.enabled
                ? `Daily at ${saved.time} · orders pending ordering over ${saved.days} day(s)`
                : 'Off'}
            status={status}
            enabled={settings.enabled}
            onToggle={() => { setSettings({ ...settings, enabled: !settings.enabled }); setOpenId('ordering'); }}
            open={openId === 'ordering'}
            onOpen={() => setOpenId(openId === 'ordering' ? null : 'ordering')}
        >
            <div style={fieldGrid(220)}>
                <div>
                    <label style={labelStyle(theme)} htmlFor="emailsettings-ordering-days">Days since requested</label>
                    <input id="emailsettings-ordering-days" type="number" min={1} max={60}
                        value={settings.days}
                        onChange={(e) => setSettings({ ...settings, days: Math.max(1, Math.min(60, parseInt(e.target.value) || 1)) })}
                        style={inputStyle(theme)} />
                    <p style={hintStyle(theme)}>Remind for orders pending ordering longer than this many days, counted from the Die Requested Date.</p>
                </div>
                <div>
                    <label style={labelStyle(theme)} htmlFor="emailsettings-ordering-send-time">Send time</label>
                    <input id="emailsettings-ordering-send-time" type="time" value={settings.time}
                        onChange={(e) => setSettings({ ...settings, time: e.target.value || '08:00' })}
                        style={inputStyle(theme)} />
                    <p style={hintStyle(theme)}>Server time, Asia/Dubai.</p>
                </div>
            </div>

            <p style={{ ...hintStyle(theme), margin: 0 }}>
                One email per plant, to the default To / CC set on the &quot;Ordering Reminder&quot; email template.
                Orders with no usable Die Requested Date are left out. Requires sending to be on.
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

export default OrderingReminderSettings;
