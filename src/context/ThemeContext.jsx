import React, { createContext, useContext, useState, useMemo } from 'react';

const ThemeContext = createContext(null);

export const themes = {
  dark: {
    bg: '#0F172A',
    cardBg: '#1E293B',
    text: '#F1F5F9',
    textDim: '#94A3B8',
    textMuted: '#64748B',
    border: '#334155',
    hoverBg: 'rgba(255,255,255,0.05)',
    inputBg: '#0F172A',
    accent: '#3B82F6',
    accentHover: '#2563EB',
  },
  light: {
    bg: '#F0F4F8',
    cardBg: '#FFFFFF',
    text: '#1E293B',
    textDim: '#475569',
    textMuted: '#64748B',
    border: '#E2E8F0',
    hoverBg: 'rgba(0,0,0,0.05)',
    inputBg: '#F8FAFC',
    accent: '#3B82F6',
    accentHover: '#2563EB',
  }
};

export function ThemeProvider({ children }) {
  const [isDarkMode, setIsDarkMode] = useState(true);

  const theme = useMemo(() => isDarkMode ? themes.dark : themes.light, [isDarkMode]);

  const toggleTheme = () => setIsDarkMode(prev => !prev);

  const value = useMemo(() => ({
    theme,
    isDarkMode,
    toggleTheme
  }), [theme, isDarkMode]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export default ThemeContext;
