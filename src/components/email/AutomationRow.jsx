import React from 'react';
import { CheckCircle, XCircle, AlertCircle, Circle, ChevronDown } from 'lucide-react';
import ToggleSwitch from './ToggleSwitch';
import { tones } from './settingsStyles';

// One automated email in Settings → Email: who it goes to, when, how the last
// run went, an on/off switch, and an expandable panel for its settings.
//
// `status` is { tone: 'ok' | 'error' | 'warn' | 'idle', text }. Tone is never
// the only cue — each carries its own icon.

const ICONS = { ok: CheckCircle, error: XCircle, warn: AlertCircle, idle: Circle };

const AutomationRow = ({ theme, id, name, audience, schedule, status, enabled, onToggle, open, onOpen, children }) => {
    const t = tones(theme);
    const color = { ok: t.success, error: t.danger, warn: t.warn, idle: theme.textDim }[status.tone] || theme.textDim;
    const StatusIcon = ICONS[status.tone] || Circle;

    return (
        <div style={{ background: theme.cardBg }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 24px', padding: '16px 24px' }}>
                <button
                    type="button"
                    onClick={onOpen}
                    aria-expanded={open}
                    aria-controls={`automation-${id}`}
                    style={{
                        flex: '1 1 240px', minWidth: 0, minHeight: '44px',
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        textAlign: 'left', color: theme.text,
                        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px'
                    }}
                >
                    <span style={{ fontSize: '1rem', fontWeight: 700 }}>{name}</span>
                    <span style={{ fontSize: '0.8rem', color: theme.textDim }}>{audience}</span>
                </button>

                <div style={{ flex: '1 1 220px', minWidth: 0, fontSize: '0.875rem', color: theme.textMuted }}>
                    {schedule}
                </div>

                <div style={{
                    flex: '1 1 200px', minWidth: 0, fontSize: '0.8rem', fontWeight: 600, color,
                    display: 'flex', alignItems: 'flex-start', gap: '6px', overflowWrap: 'anywhere'
                }}>
                    <StatusIcon size={14} style={{ flex: 'none', marginTop: '2px' }} aria-hidden="true" />
                    <span>{status.text}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <ToggleSwitch theme={theme} enabled={enabled} onToggle={onToggle} label={`${name} enabled`} />
                    <button
                        type="button"
                        onClick={onOpen}
                        aria-expanded={open}
                        aria-controls={`automation-${id}`}
                        style={{
                            minHeight: '44px', padding: '0 14px', borderRadius: '10px',
                            border: `1px solid ${theme.cardBorder}`, background: 'transparent',
                            color: theme.text, fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '6px'
                        }}
                    >
                        {open ? 'Close' : 'Edit'}
                        <ChevronDown size={16} aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                    </button>
                </div>
            </div>

            {open && (
                <div id={`automation-${id}`} style={{
                    padding: '20px 24px 24px', background: theme.stripeBg,
                    borderTop: `1px solid ${theme.cardBorder}`,
                    display: 'flex', flexDirection: 'column', gap: '16px'
                }}>
                    {children}
                </div>
            )}
        </div>
    );
};

export default AutomationRow;
