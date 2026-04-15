'use client';

import { useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Search, Bell, User, ChevronDown, ChevronRight,
  Activity, PauseCircle, CheckCircle, LogOut, Command,
  Zap, Lock, ShieldAlert, Siren, RefreshCw,
  Wifi, WifiOff,
} from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import { useQuery } from '@tanstack/react-query';
import { getTradingHalt, getControlOverview, getSystemHealth, getExchangeHealthTier1 } from '@/lib/api';
import { useAdminAlertStore } from '@/store/adminAlerts';
import { useRealtimeStore } from '@/store/realtime';
import { getPageMeta } from '@/lib/pageMeta';
import { modKey } from '@/lib/useKeyboardShortcuts';
import { openCommandPalette } from './GlobalCommandPalette';
import { TIER1_QUERY_KEY } from '@/components/admin-shell/ExchangeHealthTier1Banner';
import { cn } from '@/lib/cn';

type SystemState = 'healthy' | 'degraded' | 'halted';

const STATE_CONFIG: Record<SystemState, { dot: string; text: string; pulse: boolean }> = {
  healthy:  { dot: 'bg-admin-success', text: 'text-admin-success', pulse: false },
  degraded: { dot: 'bg-admin-warning', text: 'text-admin-warning', pulse: true },
  halted:   { dot: 'bg-admin-danger', text: 'text-admin-danger', pulse: true },
};

export function UnifiedTopbar() {
  const pathname = usePathname();
  const { admin, logout } = useAdminAuthStore();
  const token = useAdminAuthStore((s) => s.accessToken);
  const unreadAlerts = useAdminAlertStore((s) => s.unreadCount);
  const toggleAlertDrawer = useAdminAlertStore((s) => s.toggleDrawer);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);

  const refetchBar = (ms: number) => () =>
    typeof document !== 'undefined' && document.visibilityState === 'visible' ? ms : false;

  const { data: haltData } = useQuery({
    queryKey: ['admin', 'trading-halt', token],
    queryFn: () => getTradingHalt(token),
    enabled: !!token,
    staleTime: 15_000,
    refetchInterval: refetchBar(30_000),
  });

  const { data: controlData } = useQuery({
    queryKey: ['admin', 'control', token],
    queryFn: () => getControlOverview(token),
    enabled: !!token,
    staleTime: 15_000,
    refetchInterval: refetchBar(30_000),
  });

  const { data: healthData } = useQuery({
    queryKey: ['admin', 'system-health', token],
    queryFn: () => getSystemHealth(token),
    enabled: !!token,
    staleTime: 15_000,
    refetchInterval: refetchBar(30_000),
  });

  const { data: tier1Res } = useQuery({
    queryKey: ['admin', TIER1_QUERY_KEY, token],
    queryFn: () => getExchangeHealthTier1(token),
    enabled: !!token,
    staleTime: 15_000,
    refetchInterval: refetchBar(30_000),
  });

  const halted = haltData?.data?.halted ?? false;
  const settlement = (controlData?.data?.settlement as { status?: string })?.status;
  const health = healthData?.data as { database?: { status?: string }; redis?: { status?: string } } | undefined;
  const tier1Overall = tier1Res?.data?.overall;

  const engineState = useMemo<SystemState>(() => {
    const infraOk = (s?: string) => {
      const x = s?.toLowerCase();
      return x === 'healthy' || x === 'ok' || x === 'up';
    };
    let base: SystemState = 'healthy';
    if (health) {
      const dbOk = infraOk(health.database?.status);
      const redisOk = infraOk(health.redis?.status);
      if (!dbOk || !redisOk) base = 'degraded';
    }
    if (tier1Overall === 'RED') return 'halted';
    if (tier1Overall === 'YELLOW') return base === 'healthy' ? 'degraded' : base;
    return base;
  }, [health, tier1Overall]);

  const tradingState = useMemo<SystemState>(() => halted ? 'halted' : 'healthy', [halted]);

  const settlementState = useMemo<SystemState>(() => {
    if (!settlement) return 'healthy';
    const s = settlement.toLowerCase();
    if (s === 'halted' || s === 'down' || s === 'error') return 'halted';
    if (s === 'degraded' || s === 'slow' || s === 'delayed') return 'degraded';
    return 'healthy';
  }, [settlement]);

  const wsState = useRealtimeStore((s) => s.connectionState);
  const pageMeta = getPageMeta(pathname);
  const mod = modKey();

  const handleLogout = useCallback(() => {
    setUserMenuOpen(false);
    logout();
  }, [logout]);

  const QUICK_ACTIONS = [
    { id: 'qa-pause', label: 'Pause Trading', icon: PauseCircle, danger: true },
    { id: 'qa-freeze', label: 'Freeze Withdrawals', icon: Lock, danger: true },
    { id: 'qa-incident', label: 'Create Incident', icon: Siren, danger: false },
    { id: 'qa-refresh', label: 'Refresh Data', icon: RefreshCw, danger: false },
  ];

  const handleQuickAction = useCallback((id: string) => {
    setQuickActionsOpen(false);
    openCommandPalette();
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-admin-border bg-admin-surface/95 backdrop-blur-sm px-5">
      {/* Left — Breadcrumbs */}
      <div className="flex items-center gap-3 min-w-0">
        <nav className="flex items-center gap-1 text-xs text-admin-muted">
          {pageMeta.breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-admin-muted/50" />}
              {crumb.href && i < pageMeta.breadcrumbs.length - 1 ? (
                <Link href={crumb.href} className="hover:text-admin-text transition-colors">
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-admin-text font-medium">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2.5">
        {/* Search / Command trigger */}
        <button
          onClick={openCommandPalette}
          className="hidden md:flex items-center gap-2 rounded-ds-md border border-admin-border bg-white/5 px-3 py-1.5 text-xs text-admin-muted hover:bg-white/10 hover:text-admin-text transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search…</span>
          <kbd className="ml-2 text-[10px] bg-admin-card border border-admin-border rounded px-1 py-0.5 font-mono text-admin-muted">{mod}K</kbd>
        </button>

        {/* Live system status */}
        <div className="hidden lg:flex items-center gap-1 rounded-ds-md border border-admin-border bg-white/5 px-2 py-1.5">
          <StatusDot label="Engine" state={engineState} />
          <span className="mx-1 h-3 w-px bg-admin-border" />
          <StatusDot label="Trading" state={tradingState} />
          <span className="mx-1 h-3 w-px bg-admin-border" />
          <StatusDot label="Settlement" state={settlementState} />
          <span className="mx-1 h-3 w-px bg-admin-border" />
          <WsStatusDot state={wsState} />
        </div>

        {/* Quick actions */}
        <div className="relative">
          <button
            onClick={() => setQuickActionsOpen((s) => !s)}
            className="flex items-center gap-1 rounded-ds-md border border-admin-border bg-white/5 px-2 py-1.5 text-admin-muted hover:bg-white/10 transition-colors"
            aria-label="Quick actions"
          >
            <Zap className="h-3.5 w-3.5" />
            <ChevronDown className="h-3 w-3" />
          </button>
          {quickActionsOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setQuickActionsOpen(false)} />
              <div className="absolute right-0 mt-1 z-20 w-52 bg-admin-card border border-admin-border rounded-ds-md shadow-dropdown py-1 animate-fade-in">
                <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-admin-muted/60">Quick Actions</p>
                {QUICK_ACTIONS.map((qa) => (
                  <button
                    key={qa.id}
                    onClick={() => handleQuickAction(qa.id)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors',
                      qa.danger ? 'text-admin-danger hover:bg-admin-danger/10' : 'text-admin-text hover:bg-white/5'
                    )}
                  >
                    <qa.icon className="h-3.5 w-3.5 shrink-0" />
                    {qa.label}
                  </button>
                ))}
                <div className="my-1 border-t border-admin-border" />
                <button
                  onClick={() => { setQuickActionsOpen(false); openCommandPalette(); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-admin-muted hover:bg-white/5 transition-colors"
                >
                  <Command className="h-3.5 w-3.5" />
                  All commands…
                  <kbd className="ml-auto text-[10px] bg-admin-surface border border-admin-border rounded px-1 text-admin-muted">{mod}K</kbd>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Alert bell */}
        <button
          onClick={toggleAlertDrawer}
          className="relative rounded-ds-md p-2 text-admin-muted hover:bg-white/5 hover:text-admin-text transition-colors"
          aria-label="Alerts"
        >
          <Bell className="h-[18px] w-[18px]" />
          {unreadAlerts > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {unreadAlerts > 99 ? '99+' : unreadAlerts}
            </span>
          )}
        </button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen((s) => !s)}
            className="flex items-center gap-2 rounded-ds-md border border-admin-border bg-white/5 px-2.5 py-1.5 hover:bg-white/10 transition-colors"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-admin-primary/15 text-admin-primary">
              <User className="h-3.5 w-3.5" />
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-xs font-medium text-admin-text leading-none">{admin?.name ?? 'Admin'}</p>
              <p className="text-[10px] text-admin-muted mt-0.5">{admin?.role ?? 'admin'}</p>
            </div>
            <ChevronDown className="h-3 w-3 text-admin-muted" />
          </button>

          {userMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
              <div className="absolute right-0 mt-1 z-20 w-48 bg-admin-card border border-admin-border rounded-ds-md shadow-dropdown py-1 animate-fade-in">
                <div className="px-3 py-2 border-b border-admin-border">
                  <p className="text-xs font-medium text-admin-text">{admin?.name ?? 'Admin'}</p>
                  <p className="text-[10px] text-admin-muted">{admin?.email ?? ''}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-admin-danger hover:bg-admin-danger/10 transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  StatusDot — compact status indicator                               */
/* ------------------------------------------------------------------ */

function StatusDot({ label, state }: { label: string; state: SystemState }) {
  const cfg = STATE_CONFIG[state];
  return (
    <div className="flex items-center gap-1.5" title={`${label}: ${state}`}>
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', cfg.dot, cfg.pulse && 'animate-pulse')} />
      <span className={cn('text-[11px] font-medium', cfg.text)}>{label}</span>
    </div>
  );
}

function WsStatusDot({ state }: { state: string }) {
  const isConnected = state === 'connected';
  const isReconnecting = state === 'reconnecting' || state === 'connecting';
  return (
    <div
      className="flex items-center gap-1.5"
      title={`WebSocket: ${state}`}
    >
      {isConnected ? (
        <Wifi className="h-3 w-3 text-admin-success" />
      ) : (
        <WifiOff className={cn('h-3 w-3', isReconnecting ? 'text-admin-warning animate-pulse' : 'text-admin-muted')} />
      )}
      <span className={cn(
        'text-[11px] font-medium',
        isConnected ? 'text-admin-success' : isReconnecting ? 'text-admin-warning' : 'text-admin-muted'
      )}>
        WS
      </span>
    </div>
  );
}
