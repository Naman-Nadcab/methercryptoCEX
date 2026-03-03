'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Menu,
  Bell,
  Search,
  Settings,
  LogOut,
  ChevronDown,
  AlertTriangle,
  ArrowUpFromLine,
  Scale,
} from 'lucide-react';
import { useAdminAuthStore } from '@/store/admin-auth';
import ThemeToggle from '@/components/ThemeToggle';
import { StatusBadge } from '@/components/admin/control-plane';
import { getApiBaseUrl } from '@/lib/getApiUrl';

const API_URL = getApiBaseUrl();

interface HeaderProps {
  onMenuClick: () => void;
}

type TradingHaltState = { halted: boolean } | null;
type DashboardStatsState = {
  users?: { active?: number };
  p2p?: { openDisputes?: number };
} | null;
type WithdrawalStatsState = { pending_approval?: number } | null;

export default function Header({ onMenuClick }: HeaderProps) {
  const router = useRouter();
  const { admin, logout, accessToken } = useAdminAuthStore();
  const [showAlerts, setShowAlerts] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [tradingHalt, setTradingHalt] = useState<TradingHaltState>(null);
  const [dashboardStats, setDashboardStats] = useState<DashboardStatsState>(null);
  const [withdrawalStats, setWithdrawalStats] = useState<WithdrawalStatsState>(null);

  useEffect(() => {
    if (!accessToken) return;
    const abort = new AbortController();
    Promise.all([
      fetch(`${API_URL}/api/v1/admin/trading-halt`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: abort.signal,
      })
        .then((r) => r.json())
        .then((d) => (d?.success && d?.data ? { halted: !!d.data.halted } : null))
        .catch(() => null),
      fetch(`${API_URL}/api/v1/admin/dashboard/stats`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: abort.signal,
      })
        .then((r) => r.json())
        .then((d) => (d?.success && d?.data ? d.data : null))
        .catch(() => null),
      fetch(`${API_URL}/api/v1/admin/withdrawals?limit=1`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: abort.signal,
      })
        .then((r) => r.json())
        .then((d) => (d?.success && d?.data?.stats ? d.data.stats : null))
        .catch(() => null),
    ]).then(([halt, stats, wStats]) => {
      setTradingHalt(halt);
      setDashboardStats(stats);
      setWithdrawalStats(wStats);
    });
    return () => abort.abort();
  }, [accessToken]);

  const handleLogout = () => {
    logout();
    router.push('/admin/login');
  };

  const systemStatus =
    tradingHalt === null
      ? null
      : tradingHalt.halted
        ? ('HALTED' as const)
        : ('LIVE' as const);
  const pendingApproval = withdrawalStats?.pending_approval ?? 0;
  const openDisputes = dashboardStats?.p2p?.openDisputes ?? 0;
  const activeSessions = dashboardStats?.users?.active ?? 0;
  const hasAlerts = pendingApproval > 0 || openDisputes > 0;

  return (
    <header className="h-11 bg-card border-b border-border flex items-center justify-between px-2.5 lg:px-3 text-[12px] sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-[4px]"
          aria-label="Open menu"
        >
          <Menu className="w-4 h-4" />
        </button>
        <div className="hidden md:flex items-center gap-1.5 bg-muted/50 rounded-[4px] px-2 py-1 w-44">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder="Search…"
            className="bg-transparent border-none outline-none text-[12px] text-foreground placeholder-muted-foreground w-full min-w-0"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden lg:flex items-center gap-3 mr-1">
          {systemStatus != null && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Trading</span>
              <StatusBadge variant={systemStatus === 'HALTED' ? 'HALTED' : 'LIVE'} showDot />
            </div>
          )}
          <div className="w-px h-4 bg-border" />
          <div className="text-right">
            <span className="text-[11px] text-muted-foreground tabular-nums">
              Sessions {dashboardStats === null ? '—' : activeSessions}
            </span>
          </div>
        </div>

        <ThemeToggle variant="icon" size="sm" />

        <div className="relative">
          <button
            onClick={() => { setShowAlerts(!showAlerts); setShowProfile(false); }}
            className="relative p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-[4px]"
            aria-label="Alerts"
          >
            <Bell className="w-4 h-4" />
            {hasAlerts && (
              <span className="absolute top-0.5 right-0.5 min-w-[14px] h-[14px] px-0.5 flex items-center justify-center bg-destructive text-destructive-foreground text-[10px] font-medium rounded">
                {pendingApproval + openDisputes > 99 ? '99+' : pendingApproval + openDisputes}
              </span>
            )}
          </button>
          {showAlerts && (
            <div className="absolute right-0 mt-1 w-64 bg-card border border-border rounded-[4px] shadow-lg z-50 animate-admin-scale-in">
              <div className="px-3 py-2 border-b border-border">
                <h3 className="text-[12px] font-semibold text-foreground">Operator alerts</h3>
              </div>
              <div className="py-1">
                <Link href="/admin/withdrawals?status=pending_approval" onClick={() => setShowAlerts(false)} className="flex items-center justify-between gap-2 px-3 py-2 text-[12px] text-foreground hover:bg-muted/60">
                  <span className="flex items-center gap-2"><ArrowUpFromLine className="w-3.5 h-3.5 text-muted-foreground" />Pending withdrawals</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{pendingApproval}</span>
                </Link>
                <Link href="/admin/p2p/disputes" onClick={() => setShowAlerts(false)} className="flex items-center justify-between gap-2 px-3 py-2 text-[12px] text-foreground hover:bg-muted/60">
                  <span className="flex items-center gap-2"><Scale className="w-3.5 h-3.5 text-muted-foreground" />Open disputes</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{openDisputes}</span>
                </Link>
                {!hasAlerts && (
                  <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> No pending alerts
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => { setShowProfile(!showProfile); setShowAlerts(false); }}
            className="flex items-center gap-1.5 p-1.5 hover:bg-muted/60 rounded-[4px]"
          >
            <div className="w-7 h-7 rounded bg-muted flex items-center justify-center shrink-0">
              <span className="text-[10px] font-medium text-muted-foreground uppercase">
                {admin?.name?.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) || 'AD'}
              </span>
            </div>
            <div className="hidden md:block text-left min-w-0">
              <p className="text-[12px] font-medium text-foreground truncate">{admin?.name || 'Admin'}</p>
              <p className="text-[10px] text-muted-foreground truncate">{admin?.email || ''}</p>
            </div>
            <ChevronDown className="w-3 h-3 text-muted-foreground hidden md:block shrink-0" />
          </button>
          {showProfile && (
            <div className="absolute right-0 mt-1 w-44 bg-card border border-border rounded-[4px] shadow-lg z-50 animate-admin-scale-in">
              <div className="p-2.5 border-b border-border">
                <p className="text-[12px] font-medium text-foreground truncate">{admin?.name || 'Admin'}</p>
                <p className="text-[10px] text-muted-foreground truncate">{admin?.email || ''}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 capitalize">{admin?.role?.replace('_', ' ') || 'Admin'}</p>
              </div>
              <div className="p-1">
                <Link href="/admin/settings/features" onClick={() => setShowProfile(false)} className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-foreground hover:bg-muted/60 rounded-[4px]">
                  <Settings className="w-3.5 h-3.5" /> Settings
                </Link>
              </div>
              <div className="p-1 border-t border-border">
                <button onClick={handleLogout} className="w-full flex items-center gap-2 px-2 py-1.5 text-[12px] text-destructive hover:bg-destructive/10 rounded-[4px]">
                  <LogOut className="w-3.5 h-3.5" /> Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
