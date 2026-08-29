// Shared chrome for the panels in Settings → Email, extracted from
// EmailSettings so the daily-summary panel can use them rather than carry a
// second, drifting copy.
//
// Plain .js, exporting no components: react-refresh only works when a file
// exports components exclusively, so ToggleButton lives next door in
// ToggleButton.jsx rather than here.

export const inputStyle = (theme) => ({
    width: '100%',
    padding: '12px 14px',
    background: theme.inputBg,
    border: `1px solid ${theme.cardBorder}`,
    borderRadius: '10px',
    color: theme.text,
    fontSize: '0.875rem',
    outline: 'none',
    boxSizing: 'border-box'
});

export const cardStyle = (theme) => ({
    background: theme.cardBg, borderRadius: '20px',
    padding: '24px', border: `1px solid ${theme.cardBorder}`,
    boxShadow: theme.shadowMd,
    marginBottom: '1.5rem'
});
