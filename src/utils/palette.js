// The colour set the registry pages and the tooling finder panel draw with, from the app theme.
// Not a React hook despite the name (no state); kept as `usePalette` for its first callers.
export function usePalette(theme) {
  const isDark = theme.isDark !== false;
  return {
    isDark,
    bg: theme.cardBg || '#131316',
    page: theme.bg || '#09090b',
    border: theme.cardBorder || '#27272a',
    text: theme.text || '#fafafa',
    muted: theme.textMuted || '#a1a1aa',
    dim: theme.textDim || '#8b8b94',
    inset: theme.inputBg || '#18181b',
    rowHover: theme.rowHover || 'rgba(255,255,255,0.06)',
    primary: theme.primary || '#1F6FB0',
    primaryText: theme.primaryText || '#fff',
    primarySoft: theme.primaryLight || 'rgba(31,111,176,0.14)',
    overlay: theme.overlayBg || 'rgba(0,0,0,0.62)',
    shadowLg: theme.shadowLg || '0 16px 40px rgba(0,0,0,0.45)',
    ok: isDark ? '#4ADE80' : '#15803D',
    okBg: isDark ? 'rgba(74,222,128,0.12)' : '#F0FDF4',
    warn: isDark ? '#FBBF24' : '#92400E',
    warnBg: isDark ? 'rgba(245,158,11,0.12)' : '#FFFBEB',
    danger: isDark ? '#FB7185' : '#B42318',
    dangerBg: isDark ? 'rgba(244,63,94,0.12)' : '#FEF3F2',
    link: isDark ? '#7DB8E8' : '#1F6FB0',
  };
}
