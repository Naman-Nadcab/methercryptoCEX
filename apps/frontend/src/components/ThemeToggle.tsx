'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { useThemeStore } from '@/store/theme';

interface ThemeToggleProps {
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'icon' | 'button' | 'dropdown';
}

export default function ThemeToggle({
  showLabel = false,
  size = 'md',
  variant = 'icon',
}: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme, toggleTheme } = useThemeStore();
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Apply theme on mount and when it changes
  useEffect(() => {
    if (!mounted) return;
    
    const applyTheme = () => {
      if (resolvedTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    applyTheme();
  }, [mounted, resolvedTheme]);

  if (!mounted) {
    return (
      <button className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800">
        <div className={`${size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-6 h-6' : 'w-5 h-5'}`} />
      </button>
    );
  }

  const iconSize = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-6 h-6' : 'w-5 h-5';

  if (variant === 'dropdown') {
    return (
      <div className="relative group">
        <button
          className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title="Change theme"
        >
          {resolvedTheme === 'dark' ? (
            <Moon className={iconSize} />
          ) : (
            <Sun className={iconSize} />
          )}
          {showLabel && (
            <span className="text-sm capitalize">{theme}</span>
          )}
        </button>
        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
          <button
            onClick={() => setTheme('light')}
            className={`flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
              theme === 'light' ? 'text-blue-500' : 'text-gray-700 dark:text-gray-300'
            }`}
          >
            <Sun className="w-4 h-4" />
            Light
          </button>
          <button
            onClick={() => setTheme('dark')}
            className={`flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
              theme === 'dark' ? 'text-blue-500' : 'text-gray-700 dark:text-gray-300'
            }`}
          >
            <Moon className="w-4 h-4" />
            Dark
          </button>
          <button
            onClick={() => setTheme('system')}
            className={`flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
              theme === 'system' ? 'text-blue-500' : 'text-gray-700 dark:text-gray-300'
            }`}
          >
            <Monitor className="w-4 h-4" />
            System
          </button>
        </div>
      </div>
    );
  }

  if (variant === 'button') {
    return (
      <button
        onClick={toggleTheme}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {resolvedTheme === 'dark' ? (
          <>
            <Sun className={iconSize} />
            {showLabel && <span className="text-sm">Light Mode</span>}
          </>
        ) : (
          <>
            <Moon className={iconSize} />
            {showLabel && <span className="text-sm">Dark Mode</span>}
          </>
        )}
      </button>
    );
  }

  // Default icon variant
  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-600 dark:text-gray-300"
      title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {resolvedTheme === 'dark' ? (
        <Sun className={iconSize} />
      ) : (
        <Moon className={iconSize} />
      )}
    </button>
  );
}
