import React from 'react';

// The enable/disable header shared by every panel in Settings → Email.
//
// Lifted out of EmailSettings, where it was declared inside the component's
// render: that made it a fresh component type on every render, so React
// unmounted and remounted the whole toggle each time any field in the form
// changed.

const ToggleButton = ({ enabled, onToggle, label, sublabel, icon, color, theme }) => {
    // Assigned rather than destructured as `icon: Icon` so the linter can see
    // it is used — without eslint-plugin-react, a name referenced only from JSX
    // reads as unused, and this is the one form the repo's varsIgnorePattern
    // ('^[A-Z_]') covers.
    const Icon = icon;

    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Icon size={20} color={enabled ? color : theme.textDim} />
                <div>
                    <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text, margin: 0 }}>{label}</h3>
                    <p style={{ fontSize: '0.8rem', color: theme.textDim, margin: '2px 0 0' }}>{sublabel}</p>
                </div>
            </div>
            <button
                onClick={onToggle}
                style={{
                    width: '52px', height: '28px', borderRadius: '14px',
                    background: enabled ? color : theme.cardBorder,
                    border: 'none', cursor: 'pointer', position: 'relative',
                    transition: 'background 0.2s'
                }}
            >
                <div style={{
                    width: '22px', height: '22px', borderRadius: '50%',
                    background: 'white', position: 'absolute', top: '3px',
                    left: enabled ? '27px' : '3px',
                    transition: 'left 0.2s',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }} />
            </button>
        </div>
    );
};

export default ToggleButton;
