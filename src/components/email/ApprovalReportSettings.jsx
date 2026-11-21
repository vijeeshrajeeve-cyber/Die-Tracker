import React, { useState, useEffect } from 'react';
import { Save, Send } from 'lucide-react';
import { emailAPI } from '../../api';
import { inputStyle, labelStyle as labelStyleFor, hintStyle as hintStyleFor, primaryButton, secondaryButton as secondaryButtonFor, fieldGrid } from './settingsStyles';
import AutomationRow from './AutomationRow';

const DEFAULTS = { enabled: false, day: 1, time: '08:00', targetDays: 14 };

const ApprovalReportSettings = ({ theme, showToast, openId, setOpenId }) => {
    const [settings, setSettings] = useState(DEFAULTS);
    const [saved, setSaved] = useState(DEFAULTS);
    const [state, setState] = useState(null);
    const [lastMonth, setLastMonth] = useState(null);
    const [saving, setSaving] = useState(false);
    const [sending, setSending] = useState(false);

    const load = async () => {
        try {
            const result = await emailAPI.getApprovalReportSettings();
            const s = result.settings || {};
            const next = {
                enabled: s.approval_report_enabled || false,
                day: s.approval_report_day ?? 1,
                time: s.approval_report_time || '08:00',
                targetDays: s.approval_target_days ?? 14,
            };
            setSettings(next);
            setSaved(next);
            setState(result.state);
            setLastMonth(s.approval_report_last_month);
        } catch (err) {
            console.error('Failed to fetch approval report settings:', err);
        }
    };

    useEffect(() => { load(); }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await emailAPI.updateApprovalReportSettings({
                enabled: settings.enabled,
                day: Number(settings.day),
                time: settings.time,
                targetDays: Number(settings.targetDays),
            });
            showToast('Approval report settings saved', 'success');
            await load();
        } catch (err) {
            showToast(err.message || 'Failed to save approval report settings', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleSendNow = async () => {
        setSending(true);
        try {
            const result = await emailAPI.runApprovalReportNow();
            const summary = result.summary || {};
            if (summary.status === 'skipped') {
                showToast(`Not sent - ${summary.message || 'skipped'}`, 'warning');
            } else {
                showToast(summary.message || 'Approval report sent', 'success');
            }
            await load();
        } catch (err) {
            showToast(err.message || 'Failed to send the approval report', 'error');
        } finally {
            setSending(false);
        }
    };

    const labelStyle = labelStyleFor(theme);
    const hintStyle = hintStyleFor(theme);
    const secondaryButton = (busy) => secondaryButtonFor(theme, busy);

    // The inputs hold strings and the saved values are numbers, so compare them as numbers.
    const comparable = (v) => ({ ...v, day: Number(v.day), targetDays: Number(v.targetDays) });
    const dirty = JSON.stringify(comparable(settings)) !== JSON.stringify(comparable(saved));
    const lastResult = state?.lastResult;
    const status = dirty
        ? { tone: 'warn', text: 'Unsaved changes' }
        : state?.error
            ? { tone: 'error', text: `Last run failed: ${state.error}` }
            : lastResult?.status === 'skipped'
                ? { tone: 'warn', text: `Last run skipped: ${lastResult.message}` }
                : lastMonth
                    ? { tone: 'ok', text: `Last sent for ${lastMonth}${lastResult?.message ? ` · ${lastResult.message}` : ''}` }
                    : { tone: 'idle', text: settings.enabled ? 'Waiting for first run' : 'Not running' };

    return (
        <AutomationRow
            theme={theme}
            id="approvalreport"
            name="Approval report"
            audience="To the Approval Report template recipients"
            schedule={saved.enabled ? `Monthly, day ${saved.day} at ${saved.time}` : 'Off'}
            status={status}
            enabled={settings.enabled}
            onToggle={() => { setSettings({ ...settings, enabled: !settings.enabled }); setOpenId('approvalreport'); }}
            open={openId === 'approvalreport'}
            onOpen={() => setOpenId(openId === 'approvalreport' ? null : 'approvalreport')}
        >
            <div style={fieldGrid(220)}>
                <div>
                    <label style={labelStyle} htmlFor="approvalreport-day">Day of month</label>
                    <input id="approvalreport-day"
                        type="number" min={1} max={28} step={1}
                        value={settings.day}
                        onChange={(e) => setSettings({ ...settings, day: e.target.value })}
                        style={inputStyle(theme)}
                    />
                    <p style={hintStyle}>1 to 28.</p>
                </div>
                <div>
                    <label style={labelStyle} htmlFor="approvalreport-time">Send time</label>
                    <input id="approvalreport-time"
                        type="time"
                        value={settings.time}
                        onChange={(e) => setSettings({ ...settings, time: e.target.value || '08:00' })}
                        style={inputStyle(theme)}
                    />
                    <p style={hintStyle}>Server time, Asia/Dubai.</p>
                </div>
                <div>
                    <label style={labelStyle} htmlFor="approvalreport-target">Target days</label>
                    <input id="approvalreport-target"
                        type="number" min={1} max={90} step={1}
                        value={settings.targetDays}
                        onChange={(e) => setSettings({ ...settings, targetDays: e.target.value })}
                        style={inputStyle(theme)}
                    />
                    <p style={hintStyle}>Waiting longer than this is overdue (1 to 90).</p>
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
                Recipients are set on the "Approval Report" email template. Sent once a month; a Sunday moves to Monday.
            </p>
        </AutomationRow>
    );
};

export default ApprovalReportSettings;
