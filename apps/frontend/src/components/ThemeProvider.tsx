'use client';

import { useEffect, useState } from 'react';
import { useThemeStore } from '@/store/theme';

interface ThemeProviderProps {
  children: React.ReactNode;
}

export default function ThemeProvider({ children }: ThemeProviderProps) {
  const { theme, resolvedTheme, setTheme } = useThemeStore();
  const [mounted, setMounted] = useState(false);

  // Handle initial theme setup
  useEffect(() => {
    setMounted(true);
    
    // Apply theme immediately
    const applyTheme = (isDark: boolean) => {
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    // Get system preference
    const getSystemTheme = () => {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    };

    // Apply based on stored theme or system preference
    if (theme === 'system') {
      applyTheme(getSystemTheme());
    } else {
      applyTheme(theme === 'dark');
    }

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (theme === 'system') {
        applyTheme(e.matches);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  // Apply theme whenever it changes
  useEffect(() => {
    if (!mounted) return;

    if (resolvedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [mounted, resolvedTheme]);

  // Prevent flash of wrong theme
  if (!mounted) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-900">
        {children}
      </div>
    );
  }

  return <>{children}</>;
}
