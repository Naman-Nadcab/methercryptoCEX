'use client';

import {
  useState, useEffect, useCallback, useRef, useMemo, memo,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  Search, Zap, Siren, LayoutDashboard, Activity, PieChart,
  Users, ShieldCheck, Shield, Wallet, Landmark, ArrowDownToLine,
  ArrowUpFromLine, CreditCard, TrendingUp, BarChart3, ShoppingCart,
  LineChart, Repeat, Droplets, AlertTriangle, FileText, Bell,
  Cable, Settings, Cog, Gauge, PauseCircle, Lock, ShieldAlert,
  Download, RefreshCw, UserSearch, SearchCode, Eye,
} from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import { useAdminIncidentStore } from '@/store/adminIncidents';
import { adminFetch } from '@/lib/admin/apiClient';
import {
  searchCommands, groupCommands,
  type CommandEntry, type CommandCategory,
} from '@/lib/commandRegistry';
import { useKeyboardShortcuts, modKey } from '@/lib/useKeyboardShortcuts';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/*  Icon resolver                                                      */
/* ------------------------------------------------------------------ */

const ICON_MAP: Record<string, typeof Search> = {
  Search, Zap, Siren, LayoutDashboard, Activity, PieChart,
  Users, ShieldCheck, Shield, Wallet, Landmark, ArrowDownToLine,
  ArrowUpFromLine, CreditCard, TrendingUp, BarChart3, ShoppingCart,
  LineChart, Repeat, Droplets, AlertTriangle, FileText, Bell,
  Cable, Settings, Cog, Gauge, PauseCircle, Lock, ShieldAlert,
  Download, RefreshCw, UserSearch, SearchCode, Eye,
};

function resolveIcon(name: string) {
  return ICON_MAP[name] ?? Search;
}

/* ------------------------------------------------------------------ */
/*  Category badge config                                              */
/* ------------------------------------------------------------------ */

const CATEGORY_STYLE: Record<CommandCategory, { label: string; class: string }> = {
  navigate: { label: 'Page', class: 'bg-blue-100 text-blue-700' },
  action: { label: 'Action', class: 'bg-amber-100 text-amber-700' },
  search: { label: 'Search', class: 'bg-violet-100 text-violet-700' },
};

/* ------------------------------------------------------------------ */
/*  Text highlighting                                                  */
/* ------------------------------------------------------------------ */

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  const lowerQuery = query.toLowerCase();
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === lowerQuery ? (
          <mark key={i} className="bg-admin-primary/20 text-admin-primary rounded-sm px-0.5">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Palette state (shared via context-like approach for topbar trigger) */
/* ------------------------------------------------------------------ */

let _openPalette: (() => void) | null = null;

export function openCommandPalette() {
  _openPalette?.();
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

function GlobalCommandPaletteInner() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmAction, setConfirmAction] = useState<CommandEntry | null>(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [executing, setExecuting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const queryClient = useQueryClient();
  const token = useAdminAuthStore((s) => s.accessToken);
  const createIncident = useAdminIncidentStore((s) => s.createIncident);

  _openPalette = useCallback(() => setOpen(true), []);

  useKeyboardShortcuts([
    { key: 'k', meta: true, handler: () => setOpen((s) => !s) },
    { key: '/', handler: () => setOpen(true), ignoreInput: true },
  ]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setConfirmAction(null);
      setConfirmInput('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => { setSelectedIndex(0); }, [query]);

  const results = useMemo(() => searchCommands(query), [query]);
  const grouped = useMemo(() => groupCommands(results), [results]);

  const flatItems = useMemo(() => results, [results]);

  const scrollToSelected = useCallback((index: number) => {
    const el = listRef.current?.querySelector(`[data-index="${index}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, []);

  const executeCommand = useCallback((cmd: CommandEntry) => {
    if (cmd.category === 'navigate' && cmd.href) {
      setOpen(false);
      router.push(cmd.href);
      return;
    }

    if (cmd.category === 'search') {
      if (cmd.id === 'search-user') {
        setOpen(false);
        router.push('/users');
      } else if (cmd.id === 'search-txn') {
        setOpen(false);
        router.push('/trades');
      } else if (cmd.id === 'search-wallet') {
        setOpen(false);
        router.push('/treasury');
      }
      return;
    }

    if (cmd.severity === 'danger') {
      setConfirmAction(cmd);
      setConfirmInput('');
      return;
    }

    performAction(cmd);
  }, [router]);

  const performAction = useCallback(async (cmd: CommandEntry) => {
    setExecuting(true);
    try {
      switch (cmd.id) {
        case 'act-pause-trading':
          await adminFetch('/trading/halt', {
            method: 'POST',
            body: {
              halted: true,
              reason:
                'Command palette: emergency global trading pause — operator must document incident in runbook/audit.',
            },
            token,
          });
          queryClient.invalidateQueries({ queryKey: ['admin', 'trading-halt'] });
          break;
        case 'act-freeze-withdrawals':
          await adminFetch('/control/freeze-withdrawals', { method: 'POST', body: { freeze: true }, token });
          break;
        case 'act-emergency-mode':
          await adminFetch('/control/emergency', { method: 'POST', body: { activate: true }, token });
          break;
        case 'act-create-incident':
          createIncident({
            title: 'Manual Incident',
            severity: 'warning',
            triggeringAlertIds: [],
          });
          router.push('/incidents');
          break;
        case 'act-trigger-audit': {
          const blob = new Blob([JSON.stringify({ exported: new Date().toISOString() }, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `audit-export-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
          break;
        }
        case 'act-refresh-all':
          queryClient.invalidateQueries();
          break;
      }
    } finally {
      setExecuting(false);
      setOpen(false);
      setConfirmAction(null);
    }
  }, [token, queryClient, router, createIncident]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (confirmAction) { setConfirmAction(null); return; }
      setOpen(false);
      return;
    }
    if (confirmAction) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => { const next = Math.min(i + 1, flatItems.length - 1); scrollToSelected(next); return next; });
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => { const next = Math.max(i - 1, 0); scrollToSelected(next); return next; });
    }
    if (e.key === 'Enter' && flatItems[selectedIndex]) {
      executeCommand(flatItems[selectedIndex]);
    }
  }, [flatItems, selectedIndex, executeCommand, confirmAction, scrollToSelected]);

  if (!open) return null;

  const mod = modKey();

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[90] animate-fade-in" onClick={() => setOpen(false)} />

      {/* Palette */}
      <div className="fixed inset-0 z-[91] flex items-start justify-center pt-[12vh] px-4" onKeyDown={handleKeyDown}>
        <div className="w-full max-w-xl bg-admin-card border border-admin-border rounded-ds-lg shadow-modal animate-scale-in overflow-hidden">

          {/* Confirmation mode */}
          {confirmAction ? (
            <ConfirmPane
              command={confirmAction}
              input={confirmInput}
              onInputChange={setConfirmInput}
              onConfirm={() => performAction(confirmAction)}
              onCancel={() => setConfirmAction(null)}
              executing={executing}
            />
          ) : (
            <>
              {/* Search input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-admin-border">
                <Search className="w-4 h-4 text-admin-muted shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search pages, actions, users…"
                  className="flex-1 bg-transparent text-sm text-admin-text placeholder:text-admin-muted focus:outline-none"
                />
                <kbd className="text-[10px] text-admin-muted bg-white/5 border border-admin-border rounded px-1.5 py-0.5">ESC</kbd>
              </div>

              {/* Results */}
              <div ref={listRef} className="max-h-[380px] overflow-y-auto">
                {flatItems.length === 0 ? (
                  <div className="flex flex-col items-center py-12 text-admin-muted">
                    <Search className="h-8 w-8 mb-2 opacity-20" />
                    <p className="text-sm">No results for &quot;{query}&quot;</p>
                  </div>
                ) : (
                  grouped.map(({ group, items }) => (
                    <div key={group}>
                      <div className="px-4 pt-3 pb-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted/60">{group}</p>
                      </div>
                      {items.map((cmd) => {
                        const globalIdx = flatItems.indexOf(cmd);
                        const Icon = resolveIcon(cmd.icon);
                        const isSelected = globalIdx === selectedIndex;
                        const catStyle = CATEGORY_STYLE[cmd.category];
                        return (
                          <button
                            key={cmd.id}
                            data-index={globalIdx}
                            onClick={() => executeCommand(cmd)}
                            onMouseEnter={() => setSelectedIndex(globalIdx)}
                            className={cn(
                              'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors',
                              isSelected ? 'bg-admin-primary/5' : 'hover:bg-white/5'
                            )}
                          >
                            <div className={cn(
                              'flex h-8 w-8 items-center justify-center rounded-ds-sm shrink-0',
                              isSelected ? 'bg-admin-primary/10 text-admin-primary' : 'bg-white/5 text-admin-muted'
                            )}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={cn('text-sm font-medium', isSelected ? 'text-admin-primary' : 'text-admin-text')}>
                                <HighlightText text={cmd.label} query={query} />
                              </p>
                              {cmd.description && (
                                <p className="text-xs text-admin-muted truncate">
                                  <HighlightText text={cmd.description} query={query} />
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={cn('text-[9px] font-bold uppercase tracking-wider rounded-full px-1.5 py-0.5', catStyle.class)}>
                                {catStyle.label}
                              </span>
                              {isSelected && (
                                <span className="text-[10px] text-admin-muted">↵</span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>

              {/* Footer */}
              <div className="px-4 py-2 border-t border-admin-border flex items-center gap-4 text-[10px] text-admin-muted bg-white/[0.02]">
                <span className="flex items-center gap-1"><kbd className="bg-white/5 border border-admin-border rounded px-1">↑</kbd><kbd className="bg-white/5 border border-admin-border rounded px-1">↓</kbd> navigate</span>
                <span className="flex items-center gap-1"><kbd className="bg-white/5 border border-admin-border rounded px-1">↵</kbd> select</span>
                <span className="flex items-center gap-1"><kbd className="bg-white/5 border border-admin-border rounded px-1">{mod}+K</kbd> toggle</span>
                <span className="ml-auto">{flatItems.length} commands</span>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export const GlobalCommandPalette = memo(GlobalCommandPaletteInner);

/* ------------------------------------------------------------------ */
/*  Confirmation pane (for dangerous actions)                          */
/* ------------------------------------------------------------------ */

function ConfirmPane({
  command,
  input,
  onInputChange,
  onConfirm,
  onCancel,
  executing,
}: {
  command: CommandEntry;
  input: string;
  onInputChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  executing: boolean;
}) {
  const confirmWord = command.label.toUpperCase().replace(/\s+/g, '');
  const canConfirm = input.trim().toUpperCase() === confirmWord;
  const Icon = resolveIcon(command.icon);
  const isDanger = command.severity === 'danger';
  const inputRefLocal = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRefLocal.current?.focus(), 50);
  }, []);

  return (
    <div className="p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className={cn(
          'flex h-10 w-10 items-center justify-center rounded-ds-md shrink-0',
          isDanger ? 'bg-red-50 text-admin-danger' : 'bg-amber-50 text-admin-warning'
        )}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-admin-text">{command.label}</h3>
          <p className="text-xs text-admin-muted mt-0.5">{command.description}</p>
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-[11px] font-medium text-admin-muted mb-1.5 uppercase tracking-wider">
          Type <span className="text-admin-text font-bold">{confirmWord}</span> to confirm
        </label>
        <input
          ref={inputRefLocal}
          type="text"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && canConfirm && onConfirm()}
          placeholder={confirmWord}
          className="w-full rounded-ds-md border border-admin-border px-3 py-2 text-sm text-admin-text font-mono placeholder:text-admin-muted/40 focus:outline-none focus:ring-2 focus:ring-admin-primary"
        />
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-xs font-medium text-admin-muted border border-admin-border rounded-ds-md hover:bg-white/5 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={!canConfirm || executing}
          className={cn(
            'px-4 py-2 text-xs font-semibold text-white rounded-ds-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
            isDanger ? 'bg-admin-danger hover:bg-admin-danger/90' : 'bg-admin-warning hover:bg-admin-warning/90'
          )}
        >
          {executing ? 'Executing…' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}
