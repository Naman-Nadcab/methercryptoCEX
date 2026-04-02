'use client';

import { useEffect, useLayoutEffect } from 'react';
import { useThemeStore } from '@/store/theme';

interface ThemeProviderProps {
  children: React.ReactNode;
}

function applyDarkClassFromStore() {
  const { theme } = useThemeStore.getState();
  const dark =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : theme === 'dark';
  document.documentElement.classList.toggle('dark', dark);
}

/**
 * Applies `dark` on <html> only via effects — no extra wrapper divs that change
 * the React tree shape across mounts (avoids hydration / style ordering edge cases).
 */
export default function ThemeProvider({ children }: ThemeProviderProps) {
  const theme = useThemeStore((s) => s.theme);

  useLayoutEffect(() => {
    applyDarkClassFromStore();
  }, [theme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (useThemeStore.getState().theme === 'system') {
        applyDarkClassFromStore();
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return <>{children}</>;
}
