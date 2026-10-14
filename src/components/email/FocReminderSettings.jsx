import React, { useState, useEffect } from 'react';
import { Save, Send } from 'lucide-react';
import { emailAPI } from '../../api';
import { inputStyle, labelStyle, hintStyle, primaryButton, secondaryButton, fieldGrid } from './settingsStyles';
import AutomationRow from './AutomationRow';

// Settings → Email rows for the FOC replacement chasers. Two rows — one out to
// the supplier, one in to our own team — over a single settings record, so
// either row's Save writes both.
const DEFAULTS = {
    supplierEnabled: false, supplierTime: '08:00',
    internalEnabled: false, internalTime: '08:00', internalTo: '', idleDays: 3,
};

const FocReminderSettings = ({ theme, showToast, openId, setOpenId }) => {
    const [foc, setFoc] = useState(DEFAULTS);
    const [saved, setSaved] = useState(DEFAULTS);
    const [state, setState] = useState(null);
    const [saving, setSaving] = useState(false);
    const [running, setRunning] = useState('');

    const load = async () => {
        try {
            const result = await emailAPI.getFocReminderSettings();
            const s = result.settings || {};
            const next = {
                supplierEnabled: s.foc_supplier_enabled || false,
                supplierTime: s.foc_supplier_time || '08:00',
                internalEnabled: s.foc_internal_enabled || false,
                internalTime: s.foc_internal_time || '08:00',
                internalTo: s.foc_internal_to || '',
                idleDays: s.foc_idle_days ?? 3,
            };
            setFoc(next);
            setSaved(next);
            setState({
                ...result.state,
                supplierLastRun: s.foc_supplier_last_run,
                internalLastRun: s.foc_internal_last_run,
            });
        } catch (err) {
            console.error('Failed to fetch FOC reminder settings:', err);
        }
    };

    useEffect(() => { load(); }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await emailAPI.updateFocReminderSettings(foc);
            showToast('FOC reminder settings saved', 'success');
            await load();
        } catch (err) {
            showToast(err.message || 'Failed to save FOC reminder settings', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleRunNow = async (which) => {
        setRunning(which);
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
            await load();
        } catch (err) {
            showToast(err.message || 'Failed to run FOC reminders', 'error');
        } finally {
            setRunning('');
        }
    };

    const dirty = (keys) => keys.some((k) => foc[k] !== saved[k]);

    const statusFor = (keys, error, lastRun, enabled, noRecipients) => {
        if (dirty(keys)) return { tone: 'warn', text: 'Unsaved changes' };
        if (error) return { tone: 'error', text: `Last run failed: ${error}` };
        if (lastRun) return { tone: 'ok', text: `Last run ${lastRun}` };
        if (noRecipients) return { tone: 'idle', text: 'Add recipients to turn on' };
        return { tone: 'idle', text: enabled ? 'Waiting for first run' : 'Not running' };
    };

    const supplierKeys = ['supplierEnabled', 'supplierTime'];
    const internalKeys = ['internalEnabled', 'internalTime', 'internalTo', 'idleDays'];

    const actions = (which) => (
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button onClick={handleSave} disabled={saving} style={primaryButton(theme, saving)}>
                <Save size={16} /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => handleRunNow(which)} disabled={!!running} style={secondaryButton(theme, !!running)}>
                <Send size={16} /> {running === which ? 'Sending…' : 'Send now'}
            </button>
        </div>
    );

    return (
        <>
            <AutomationRow
                theme={theme}
                id="foc-supplier"
                name="FOC replacements: chase supplier"
                audience="To suppliers"
                schedule={saved.supplierEnabled
                    ? `Daily at ${saved.supplierTime} · replacements past the ETA the supplier gave`
                    : 'Off'}
                status={statusFor(supplierKeys, state?.supplier?.error, state?.supplierLastRun, foc.supplierEnabled)}
                enabled={foc.supplierEnabled}
                onToggle={() => { setFoc({ ...foc, supplierEnabled: !foc.supplierEnabled }); setOpenId('foc-supplier'); }}
                open={openId === 'foc-supplier'}
                onOpen={() => setOpenId(openId === 'foc-supplier' ? null : 'foc-supplier')}
            >
                <div style={fieldGrid(220)}>
                    <div>
                        <label style={labelStyle(theme)} htmlFor="emailsettings-supplier-send-time">Send time</label>
                        <input id="emailsettings-supplier-send-time" type="time" value={foc.supplierTime}
                            onChange={(e) => setFoc({ ...foc, supplierTime: e.target.value || '08:00' })}
                            style={inputStyle(theme)} />
                        <p style={hintStyle(theme)}>Server time, Asia/Dubai.</p>
                    </div>
                </div>
                <p style={{ ...hintStyle(theme), margin: 0 }}>
                    One email per supplier, to the contact email in Settings → Suppliers; a supplier with no email is
                    skipped. Settled QDs — closed, rejected or reference — are never chased. Requires sending to be on.
                </p>
                {actions('supplier')}
            </AutomationRow>

            <AutomationRow
                theme={theme}
                id="foc-internal"
                name="FOC replacements: chase our team"
                audience={foc.internalTo ? 'To your team' : 'To your team · needs recipients'}
                schedule={saved.internalEnabled
                    ? `Daily at ${saved.internalTime} · overdue, and received but untrialled over ${saved.idleDays} day(s)`
                    : 'Off'}
                status={statusFor(internalKeys, state?.internal?.error, state?.internalLastRun, foc.internalEnabled, !foc.internalTo)}
                enabled={foc.internalEnabled}
                onToggle={() => { setFoc({ ...foc, internalEnabled: !foc.internalEnabled }); setOpenId('foc-internal'); }}
                open={openId === 'foc-internal'}
                onOpen={() => setOpenId(openId === 'foc-internal' ? null : 'foc-internal')}
            >
                <div style={fieldGrid(200)}>
                    <div style={{ gridColumn: '1 / -1' }}>
                        <label style={labelStyle(theme)} htmlFor="emailsettings-send-to">Send to</label>
                        <input id="emailsettings-send-to" type="text" value={foc.internalTo}
                            placeholder="quality@example.com, hod@example.com"
                            onChange={(e) => setFoc({ ...foc, internalTo: e.target.value })}
                            style={inputStyle(theme)} />
                        <p style={hintStyle(theme)}>Whoever owns FOC follow-up. Required before this can be turned on.</p>
                    </div>
                    <div>
                        <label style={labelStyle(theme)} htmlFor="emailsettings-internal-send-time">Send time</label>
                        <input id="emailsettings-internal-send-time" type="time" value={foc.internalTime}
                            onChange={(e) => setFoc({ ...foc, internalTime: e.target.value || '08:00' })}
                            style={inputStyle(theme)} />
                    </div>
                    <div>
                        <label style={labelStyle(theme)} htmlFor="emailsettings-idle-days">Idle days</label>
                        <input id="emailsettings-idle-days" type="number" min={0} max={60} value={foc.idleDays}
                            onChange={(e) => setFoc({ ...foc, idleDays: Math.max(0, Math.min(60, parseInt(e.target.value) || 0)) })}
                            style={inputStyle(theme)} />
                        <p style={hintStyle(theme)}>How long a received die may sit untrialled before it is flagged.</p>
                    </div>
                </div>
                <p style={{ ...hintStyle(theme), margin: 0 }}>
                    A day with nothing outstanding sends no email. Requires sending to be on.
                </p>
                {actions('internal')}
            </AutomationRow>
        </>
    );
};

export default FocReminderSettings;
