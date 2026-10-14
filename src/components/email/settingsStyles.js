// Shared chrome for the panels in Settings → Email, extracted from
// EmailSettings so every panel uses these rather than carry its own,
// drifting copy.
//
// Plain .js, exporting no components: react-refresh only works when a file
// exports components exclusively, so ToggleSwitch and AutomationRow live next
// door in their own .jsx files rather than here.
//
// Everything is derived from the app `theme`, so both themes are covered by
// the same code. The two status hues are the only values that differ by
// `theme.isDark`: the dark-mode tints are too pale to read on white, and the
// light-mode ones too dark to read on #131316, so each theme gets its own pair.

export const inputStyle = (theme) => ({
    width: '100%',
    minHeight: '44px',
    padding: '10px 14px',
    background: theme.inputBg,
    border: `1px solid ${theme.cardBorder}`,
    borderRadius: '10px',
    color: theme.text,
    fontSize: '0.875rem',
    boxSizing: 'border-box'
});

export const cardStyle = (theme) => ({
    background: theme.cardBg, borderRadius: '16px',
    padding: '24px', border: `1px solid ${theme.cardBorder}`,
    boxShadow: theme.shadowMd,
    marginBottom: '1.5rem'
});

// Status hues — text-safe on cardBg in each theme (>= 4.5:1).
export const tones = (theme) => (theme.isDark
    ? { success: '#34D399', danger: '#F87171', warn: '#FBBF24' }
    : { success: '#0F7A4D', danger: '#B3261E', warn: '#8A5A00' });

export const labelStyle = (theme) => ({
    display: 'block', fontSize: '0.75rem', fontWeight: 600,
    color: theme.textMuted, marginBottom: '6px',
    textTransform: 'uppercase', letterSpacing: '0.02em'
});

export const hintStyle = (theme) => ({
    fontSize: '0.75rem', color: theme.textDim, margin: '6px 0 0', lineHeight: 1.45
});

export const primaryButton = (theme, busy) => ({
    display: 'flex', alignItems: 'center', gap: '8px',
    minHeight: '44px', padding: '0 20px', borderRadius: '10px', border: 'none',
    background: theme.primary, color: theme.primaryText,
    fontWeight: 600, fontSize: '0.875rem',
    cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1,
    whiteSpace: 'nowrap'
});

export const secondaryButton = (theme, busy) => ({
    display: 'flex', alignItems: 'center', gap: '8px',
    minHeight: '44px', padding: '0 20px', borderRadius: '10px',
    border: `1px solid ${theme.cardBorder}`, background: 'transparent',
    color: theme.text, fontWeight: 600, fontSize: '0.875rem',
    cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1,
    whiteSpace: 'nowrap'
});

// Field grid shared by the expanded automation panels.
export const fieldGrid = (min = 200) => ({
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
    gap: '16px'
});

// A `<code>` chip for host names in the setup guide.
export const chipStyle = (theme) => ({
    background: theme.inputBg, padding: '2px 6px', borderRadius: '4px',
    border: `1px solid ${theme.cardBorder}`, color: theme.text
});
