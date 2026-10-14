import React, { useState, useEffect } from 'react';
import { Save, Send, Eye, X } from 'lucide-react';
import { emailAPI } from '../../api';
import { inputStyle, labelStyle as labelStyleFor, hintStyle as hintStyleFor, primaryButton, secondaryButton as secondaryButtonFor, fieldGrid } from './settingsStyles';
import AutomationRow from './AutomationRow';

// Settings → Email panel for the die delivery chaser: dies past the supplier's
// ETA, or with none, mailed to each supplier at most once every N days.
const DEFAULTS = { enabled: false, time: '08:00', intervalDays: 3, noEtaDays: 7, cc: '' };

const DeliveryChaserSettings = ({ theme, showToast, openId, setOpenId }) => {
    const [settings, setSettings] = useState(DEFAULTS);
    const [saved, setSaved] = useState(DEFAULTS);
    const [state, setState] = useState(null);
    const [lastRunDate, setLastRunDate] = useState(null);
    const [saving, setSaving] = useState(false);
    const [sending, setSending] = useState(false);
    const [preview, setPreview] = useState(null);
    const [previewing, setPreviewing] = useState(false);
    const [shown, setShown] = useState(0);

    const load = async () => {
        try {
            const result = await emailAPI.getDeliveryChaserSettings();
            const s = result.settings || {};
            const next = {
                enabled: s.delivery_chaser_enabled || false,
                time: s.delivery_chaser_time || '08:00',
                intervalDays: s.delivery_chaser_interval_days ?? 3,
                noEtaDays: s.delivery_chaser_no_eta_days ?? 7,
                cc: s.delivery_chaser_cc || '',
            };
            setSettings(next);
            setSaved(next);
            setState(result.state);
            setLastRunDate(s.delivery_chaser_last_run);
        } catch (err) {
            console.error('Failed to fetch delivery chaser settings:', err);
        }
    };

    useEffect(() => { load(); }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await emailAPI.updateDeliveryChaserSettings({
                ...settings,
                intervalDays: Number(settings.intervalDays),
                noEtaDays: Number(settings.noEtaDays),
            });
            showToast('Delivery chaser settings saved', 'success');
            await load();
        } catch (err) {
            showToast(err.message || 'Failed to save delivery chaser settings', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleSendNow = async () => {
        setSending(true);
        try {
            const { summary } = await emailAPI.runDeliveryChaserNow();
            if (summary?.skipped) showToast(`Not run — ${summary.reason}`, 'error');
            else {
                const parts = [`${summary.sent} sent`];
                if (summary.notDue) parts.push(`${summary.notDue} not due yet`);
                if (summary.skippedNoEmail?.length) parts.push(`no email for ${summary.skippedNoEmail.join(', ')}`);
                if (summary.failed) parts.push(`${summary.failed} failed`);
                showToast(`Delivery chaser: ${parts.join(' · ')}`, summary.failed ? 'error' : 'success');
            }
            await load();
        } catch (err) {
            showToast(err.message || 'Failed to run the delivery chaser', 'error');
        } finally {
            setSending(false);
        }
    };

    const handlePreview = async () => {
        setPreviewing(true);
        try {
            setPreview(await emailAPI.previewDeliveryChaser());
            setShown(0);
        } catch (err) {
            showToast(err.message || 'Failed to build the preview', 'error');
        } finally {
            setPreviewing(false);
        }
    };

    const labelStyle = labelStyleFor(theme);
    const hintStyle = hintStyleFor(theme);
    const secondaryButton = (busy) => secondaryButtonFor(theme, busy);
    const current = preview?.suppliers?.[shown];

    const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
    const status = dirty
        ? { tone: 'warn', text: 'Unsaved changes' }
        : state?.error
            ? { tone: 'error', text: `Last run failed: ${state.error}` }
            : lastRunDate
                ? { tone: 'ok', text: `Last run ${lastRunDate}${state?.lastResult ? ` · ${state.lastResult.sent} sent` : ''}` }
                : { tone: 'idle', text: settings.enabled ? 'Waiting for first run' : 'Not running' };

    return (
        <AutomationRow
            theme={theme}
            id="delivery"
            name="Die delivery chaser"
            audience="To suppliers"
            schedule={saved.enabled
                ? `Checked daily at ${saved.time} · each supplier at most every ${saved.intervalDays} day(s)`
                : 'Off'}
            status={status}
            enabled={settings.enabled}
            onToggle={() => { setSettings({ ...settings, enabled: !settings.enabled }); setOpenId('delivery'); }}
            open={openId === 'delivery'}
            onOpen={() => setOpenId(openId === 'delivery' ? null : 'delivery')}
        >
            <div style={fieldGrid(180)}>
                <div>
                    <label style={labelStyle} htmlFor="deliverychaser-time">Check time</label>
                    <input id="deliverychaser-time" type="time" value={settings.time} onChange={(e) => setSettings({ ...settings, time: e.target.value || '08:00' })} style={inputStyle(theme)} />
                    <p style={hintStyle}>Server time, Asia/Dubai.</p>
                </div>
                <div>
                    <label style={labelStyle} htmlFor="deliverychaser-interval">Chase every (days)</label>
                    <input id="deliverychaser-interval" type="number" min="1" max="60" value={settings.intervalDays} onChange={(e) => setSettings({ ...settings, intervalDays: e.target.value })} style={inputStyle(theme)} />
                    <p style={hintStyle}>Per supplier. 1 = daily, 7 = weekly.</p>
                </div>
                <div>
                    <label style={labelStyle} htmlFor="deliverychaser-noeta">Ask for ETA after (days)</label>
                    <input id="deliverychaser-noeta" type="number" min="1" max="365" value={settings.noEtaDays} onChange={(e) => setSettings({ ...settings, noEtaDays: e.target.value })} style={inputStyle(theme)} />
                    <p style={hintStyle}>Days in manufacturing with no ETA.</p>
                </div>
            </div>

            <div>
                <label style={labelStyle} htmlFor="deliverychaser-cc">CC (optional)</label>
                <input id="deliverychaser-cc" type="text" value={settings.cc} onChange={(e) => setSettings({ ...settings, cc: e.target.value })} placeholder="buyer@company.com" style={inputStyle(theme)} />
                <p style={hintStyle}>Comma-separated. Each email goes to the supplier&apos;s contact email set in Settings → Suppliers; suppliers without one are skipped.</p>
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <button onClick={handleSave} disabled={saving} style={primaryButton(theme, saving)}>
                    <Save size={15} /> {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={handleSendNow} disabled={sending} style={secondaryButton(sending)}>
                    <Send size={15} /> {sending ? 'Sending…' : 'Send now'}
                </button>
                <button onClick={handlePreview} disabled={previewing} style={secondaryButton(previewing)}>
                    <Eye size={15} /> {previewing ? 'Building…' : 'Preview'}
                </button>
            </div>

            <p style={{ ...hintStyle, margin: 0 }}>
                <strong>Send now</strong> mails every supplier that is due right now — a supplier chased within the last {settings.intervalDays} day(s) is skipped.
                <strong> Preview</strong> only shows the emails; it sends nothing and changes nothing.
            </p>

            {preview && (
                <div style={{ marginTop: '16px', border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: theme.tableBg }}>
                        <strong style={{ color: theme.text, fontSize: '0.85rem' }}>
                            {preview.suppliers.length ? `Preview for ${preview.today}` : `Nothing to chase on ${preview.today}`}
                        </strong>
                        <button onClick={() => setPreview(null)} aria-label="Close preview" style={{ background: 'transparent', border: 'none', color: theme.textMuted, cursor: 'pointer' }}><X size={16} /></button>
                    </div>
                    {current && (
                        <>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '10px 14px' }}>
                                {preview.suppliers.map((s, i) => (
                                    <button key={s.supplier} onClick={() => setShown(i)} aria-pressed={i === shown}
                                        style={{ padding: '5px 10px', borderRadius: '999px', fontSize: '0.75rem', cursor: 'pointer', border: `1px solid ${i === shown ? theme.primary : theme.cardBorder}`, background: i === shown ? theme.primaryLight : 'transparent', color: theme.text }}>
                                        {s.supplier} · {s.overdueCount + s.noEtaCount}
                                    </button>
                                ))}
                            </div>
                            <div style={{ padding: '0 14px 10px', fontSize: '0.78rem', color: theme.textMuted }}>
                                To: {current.to || 'no contact email — will be skipped'}{preview.cc ? ` · CC: ${preview.cc}` : ''} ·{' '}
                                {current.due ? 'due now' : `next chase ${current.nextDay}`}
                                <div style={{ marginTop: '2px' }}>Subject: {current.subject}</div>
                            </div>
                            <iframe title="Chaser email preview" sandbox="" srcDoc={current.html} style={{ width: '100%', height: '420px', border: 'none', background: '#fff' }} />
                        </>
                    )}
                </div>
            )}
        </AutomationRow>
    );
};

export default DeliveryChaserSettings;
