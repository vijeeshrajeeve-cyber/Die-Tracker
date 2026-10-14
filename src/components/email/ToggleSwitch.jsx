import React from 'react';

// The on/off switch used by the mailbox directions and every automation row.
//
// A real <button role="switch"> so it is reachable by keyboard and announced
// with its state. The off track is a fixed mid grey rather than
// theme.cardBorder, which is near-invisible against the card in both themes
// (1.2:1) — a switch has to read as a control even when it is off.

const ToggleSwitch = ({ theme, enabled, onToggle, label }) => (
    <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        onClick={onToggle}
        style={{
            flex: 'none', width: '52px', height: '32px', borderRadius: '16px',
            border: 'none', padding: '4px', cursor: 'pointer',
            display: 'flex', alignItems: 'center',
            justifyContent: enabled ? 'flex-end' : 'flex-start',
            background: enabled ? theme.primary : '#71717a',
            transition: 'background 0.2s'
        }}
    >
        <span style={{
            width: '24px', height: '24px', borderRadius: '50%',
            background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.35)'
        }} />
    </button>
);

export default ToggleSwitch;
