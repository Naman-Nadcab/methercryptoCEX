'use client';

import { useEffect, useCallback, useRef } from 'react';

type ShortcutHandler = () => void;

interface Shortcut {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  handler: ShortcutHandler;
  /** Skip if focus is in an input/textarea */
  ignoreInput?: boolean;
}

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

/**
 * Register global keyboard shortcuts. Handlers are stable via ref.
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      for (const s of shortcutsRef.current) {
        const metaMatch = s.meta ? (e.metaKey || e.ctrlKey) : true;
        const ctrlMatch = s.ctrl ? e.ctrlKey : true;
        const shiftMatch = s.shift ? e.shiftKey : !e.shiftKey;
        const keyMatch = e.key.toLowerCase() === s.key.toLowerCase();

        if (keyMatch && metaMatch && ctrlMatch && shiftMatch) {
          if (s.ignoreInput && isInputFocused()) continue;
          e.preventDefault();
          s.handler();
          return;
        }
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

/** Detect Mac vs other for display */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.platform?.toLowerCase().includes('mac') ?? false;
}

export function modKey(): string {
  return isMac() ? '⌘' : 'Ctrl';
}
