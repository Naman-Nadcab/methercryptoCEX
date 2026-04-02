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
      <button className="p-2 rounded-lg bg-accent">
        <div className={`${size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-6 h-6' : 'w-5 h-5'}`} />
      </button>
    );
  }

  const iconSize = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-6 h-6' : 'w-5 h-5';

  if (variant === 'dropdown') {
    return (
      <div className="relative group">
        <button
          className="flex items-center gap-2 p-2 rounded-lg hover:bg-accent transition-colors"
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
        <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
          <button
            onClick={() => setTheme('light')}
            className={`flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-accent ${
              theme === 'light' ? 'text-blue-500' : 'text-foreground/80'
            }`}
          >
            <Sun className="w-4 h-4" />
            Light
          </button>
          <button
            onClick={() => setTheme('dark')}
            className={`flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-accent ${
              theme === 'dark' ? 'text-blue-500' : 'text-foreground/80'
            }`}
          >
            <Moon className="w-4 h-4" />
            Dark
          </button>
          <button
            onClick={() => setTheme('system')}
            className={`flex items-center gap-2 w-full px-4 py-2 text-sm hover:bg-accent ${
              theme === 'system' ? 'text-blue-500' : 'text-foreground/80'
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
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent hover:bg-accent transition-colors"
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
      className="p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground"
      title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
      aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {resolvedTheme === 'dark' ? (
        <Sun className={iconSize} />
      ) : (
        <Moon className={iconSize} />
      )}
    </button>
  );
}
