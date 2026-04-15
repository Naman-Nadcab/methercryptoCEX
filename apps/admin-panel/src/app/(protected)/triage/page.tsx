'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpFromLine, ShieldAlert, Repeat, Activity, UserCheck,
  Shield, ChevronRight, Zap,
  MessageSquare, Flame, CheckCircle2, RefreshCw, Inbox,
} from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import { getDashboardSummary, getTradingHalt, getSystemHealth } from '@/lib/api';
import { adminFetch } from '@/lib/api';
import { getP2pDisputes } from '@/lib/admin/p2p';
import { cn } from '@/lib/cn';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SmartAlert {
  type: string;
  severity: string;
  message: string;
  count?: number;
}

interface RiskData {
  open_aml_alerts: number;
  high_risk_users: number;
  suspicious_trades: number;
  str_reports: number;
}

interface SupportStats {
  open: number;
  in_progress: number;
  unassigned: number;
  avg_resolution_hours: number;
}

/* ------------------------------------------------------------------ */
/*  Priority levels                                                    */
/* ------------------------------------------------------------------ */

type Priority = 'critical' | 'high' | 'medium' | 'info';

const PRIORITY_STYLES: Record<Priority, { dot: string; ring: string; bg: string; text: string; label: string }> = {
  critical: { dot: 'bg-red-500 animate-pulse', ring: 'ring-red-500/20', bg: 'bg-red-500/[0.04] border-red-500/20', text: 'text-red-400', label: 'Critical' },
  high: { dot: 'bg-orange-500', ring: 'ring-orange-500/20', bg: 'bg-orange-500/[0.04] border-orange-500/20', text: 'text-orange-400', label: 'High' },
  medium: { dot: 'bg-amber-500', ring: 'ring-amber-500/20', bg: 'bg-amber-500/[0.04] border-amber-500/20', text: 'text-amber-400', label: 'Medium' },
  info: { dot: 'bg-blue-500', ring: 'ring-blue-500/20', bg: 'bg-blue-500/[0.04] border-blue-500/20', text: 'text-blue-400', label: 'Info' },
};

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function TriagePage() {
  const token = useAdminAuthStore((s) => s.accessToken);

  const dashQ = useQuery({
    queryKey: ['admin', 'dashboard-summary', token],
    queryFn: () => getDashboardSummary(token),
    enabled: !!token,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const haltQ = useQuery({
    queryKey: ['admin', 'trading-halt', token],
    queryFn: () => getTradingHalt(token),
    enabled: !!token,
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const healthQ = useQuery({
    queryKey: ['admin', 'system-health', token],
    queryFn: () => getSystemHealth(token),
    enabled: !!token,
    staleTime: 15_000,
    refetchInterval: 20_000,
  });

  const disputesQ = useQuery({
    queryKey: ['admin', 'triage', 'p2p-disputes', token],
    queryFn: () => getP2pDisputes(token, { limit: 100, offset: 0 }),
    enabled: !!token,
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  const alertsQ = useQuery({
    queryKey: ['admin', 'triage-smart-alerts', token],
    queryFn: () => adminFetch<{ alerts: SmartAlert[]; summary: { amlOpen: number; pendingWithdrawals: number; circuitOpen: boolean } }>('/operations/smart-alerts', { token }),
    enabled: !!token,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const riskQ = useQuery({
    queryKey: ['admin', 'triage-risk', token],
    queryFn: () => adminFetch<RiskData>('/risk', { token }),
    enabled: !!token,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const supportQ = useQuery({
    queryKey: ['admin', 'triage-support-stats', token],
    queryFn: () => adminFetch<SupportStats>('/support/stats', { token }),
    enabled: !!token,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Extract data
  const dash = dashQ.data?.data;
  const halted = haltQ.data?.data?.halted ?? dash?.halted ?? false;
  const pendingWd = dash?.pendingWithdrawals ?? 0;
  const kycPending = dash?.stats?.kyc?.pending ?? 0;
  const kycReview = dash?.stats?.kyc?.underReview ?? 0;
  const openDisputes = Array.isArray(disputesQ.data?.data) ? disputesQ.data!.data.length : 0;
  const alerts = alertsQ.data?.data?.alerts ?? [];
  const circuitOpen = alertsQ.data?.data?.summary?.circuitOpen ?? false;
  const risk = riskQ.data?.data;
  const openAml = risk?.open_aml_alerts ?? 0;
  const supportStats = supportQ.data?.data;
  const openTickets = (supportStats?.open ?? 0) + (supportStats?.in_progress ?? 0);
  const unassignedTickets = supportStats?.unassigned ?? 0;

  const dbOk = healthQ.data?.data?.database?.status === 'healthy' || healthQ.data?.data?.database?.status === 'ok' || healthQ.data?.data?.database?.status === 'up';
  const redisOk = healthQ.data?.data?.redis?.status === 'healthy' || healthQ.data?.data?.redis?.status === 'ok' || healthQ.data?.data?.redis?.status === 'up';
  const systemHealthy = dbOk && redisOk;

  // Build triage items sorted by priority
  const triageItems = useMemo(() => {
    const items: TriageItem[] = [];

    // Circuit breaker open
    if (circuitOpen) {
      items.push({ id: 'circuit', priority: 'critical', label: 'Circuit Breaker Open', value: 'OPEN', href: '/admin-control', icon: Flame, subtitle: 'Settlement circuit is tripped — investigate immediately' });
    }

    // Trading halted
    if (halted) {
      items.push({ id: 'halted', priority: 'critical', label: 'Trading Halted', value: 'HALTED', href: '/admin-control', icon: ShieldAlert, subtitle: 'All trading is stopped — review before lifting' });
    }

    // System degraded
    if (healthQ.data && !healthQ.isLoading && !systemHealthy) {
      items.push({ id: 'health', priority: 'high', label: 'System Degraded', value: 'Degraded', href: '/monitoring', icon: Activity, subtitle: `DB: ${dbOk ? 'OK' : 'DOWN'} · Redis: ${redisOk ? 'OK' : 'DOWN'}` });
    }

    // Pending withdrawals
    if (pendingWd > 0) {
      items.push({ id: 'withdrawals', priority: pendingWd > 20 ? 'high' : 'medium', label: 'Withdrawals Pending Approval', value: String(pendingWd), href: '/withdrawals?status=pending_approval', icon: ArrowUpFromLine, subtitle: 'Approve or reject from the queue' });
    }

    // Open AML alerts
    if (openAml > 0) {
      items.push({ id: 'aml', priority: openAml > 10 ? 'high' : 'medium', label: 'Open AML Alerts', value: String(openAml), href: '/compliance', icon: Shield, subtitle: 'Review suspicious activity and escalate if needed' });
    }

    // P2P disputes
    if (openDisputes > 0) {
      items.push({ id: 'disputes', priority: openDisputes > 5 ? 'high' : 'medium', label: 'P2P Disputes', value: String(openDisputes), href: '/p2p', icon: Repeat, subtitle: 'Open or under-review disputes needing resolution' });
    }

    // KYC pending
    if (kycPending > 0 || kycReview > 0) {
      const total = kycPending + kycReview;
      items.push({ id: 'kyc', priority: total > 50 ? 'medium' : 'info', label: 'KYC Queue', value: String(total), href: '/kyc', icon: UserCheck, subtitle: `${kycPending} pending · ${kycReview} under review` });
    }

    // Support tickets
    if (openTickets > 0) {
      items.push({ id: 'support', priority: unassignedTickets > 5 ? 'medium' : 'info', label: 'Support Tickets', value: String(openTickets), href: '/support', icon: MessageSquare, subtitle: `${unassignedTickets} unassigned · ${supportStats?.in_progress ?? 0} in progress` });
    }

    // Smart alerts (only ones not already covered)
    for (const alert of alerts) {
      if (alert.type === 'circuit_open' || alert.type === 'withdrawal_spike') continue;
      items.push({ id: `alert-${alert.type}`, priority: alert.severity === 'critical' ? 'critical' : alert.severity === 'high' ? 'high' : 'medium', label: alert.message, value: alert.count != null ? String(alert.count) : '!', href: '/monitoring', icon: Zap, subtitle: `Smart alert · ${alert.severity}` });
    }

    // Zero-state placeholders (show them with check mark)
    if (pendingWd === 0) {
      items.push({ id: 'withdrawals-ok', priority: 'info', label: 'Withdrawals', value: '0', href: '/withdrawals', icon: ArrowUpFromLine, subtitle: 'No pending approvals', resolved: true });
    }
    if (!halted && !circuitOpen) {
      items.push({ id: 'trading-ok', priority: 'info', label: 'Trading Status', value: 'Active', href: '/admin-control', icon: ShieldAlert, subtitle: 'Normal trading', resolved: true });
    }
    if (systemHealthy && healthQ.data) {
      items.push({ id: 'health-ok', priority: 'info', label: 'System Health', value: 'OK', href: '/monitoring', icon: Activity, subtitle: 'All core services operational', resolved: true });
    }

    // Sort: critical first, then high, medium, info; resolved items last
    const pOrder: Record<Priority, number> = { critical: 0, high: 1, medium: 2, info: 3 };
    items.sort((a, b) => {
      if (a.resolved && !b.resolved) return 1;
      if (!a.resolved && b.resolved) return -1;
      return (pOrder[a.priority] ?? 9) - (pOrder[b.priority] ?? 9);
    });

    return items;
  }, [halted, circuitOpen, pendingWd, openAml, openDisputes, kycPending, kycReview, openTickets, unassignedTickets, alerts, systemHealthy, healthQ.data, healthQ.isLoading, dbOk, redisOk, supportStats]);

  const criticalCount = triageItems.filter((i) => i.priority === 'critical' && !i.resolved).length;
  const actionableCount = triageItems.filter((i) => !i.resolved).length;
  const pageStatus = criticalCount > 0 ? 'risk' as const : actionableCount > 0 ? 'warning' as const : 'active' as const;

  const isLoading = dashQ.isLoading || haltQ.isLoading || healthQ.isLoading;

  return (
    <AdminPageFrame
      title="Triage Queue"
      description="Priority-sorted view of everything needing attention right now. Auto-refreshes every 15s."
      status={pageStatus}
    >
      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-admin-border bg-admin-card px-4 py-3">
        <Inbox className="h-4 w-4 text-admin-muted" />
        <div className="flex items-center gap-4">
          <CountBadge label="Actionable" count={actionableCount} color={actionableCount > 0 ? 'text-amber-400' : 'text-emerald-400'} />
          <CountBadge label="Critical" count={criticalCount} color={criticalCount > 0 ? 'text-red-400' : 'text-admin-muted'} pulse={criticalCount > 0} />
          <CountBadge label="Pending WD" count={pendingWd} color={pendingWd > 0 ? 'text-amber-400' : 'text-admin-muted'} />
          <CountBadge label="Open AML" count={openAml} color={openAml > 0 ? 'text-orange-400' : 'text-admin-muted'} />
          <CountBadge label="P2P Disputes" count={openDisputes} color={openDisputes > 0 ? 'text-orange-400' : 'text-admin-muted'} />
          <CountBadge label="KYC" count={kycPending + kycReview} color={kycPending + kycReview > 0 ? 'text-blue-400' : 'text-admin-muted'} />
          <CountBadge label="Support" count={openTickets} color={openTickets > 0 ? 'text-blue-400' : 'text-admin-muted'} />
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-[10px] text-admin-muted">
          <RefreshCw className={cn('h-3 w-3', isLoading && 'animate-spin')} />
          Live
        </div>
      </div>

      {/* Triage items */}
      <div className="space-y-2">
        {triageItems.map((item) => (
          <TriageRow key={item.id} item={item} />
        ))}
      </div>

      {/* All clear banner */}
      {actionableCount === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center py-8 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03]">
          <CheckCircle2 className="h-8 w-8 text-emerald-400 mb-3" />
          <p className="text-sm font-semibold text-emerald-400">All Clear</p>
          <p className="text-xs text-admin-muted mt-1">No items require immediate attention. Check back later or review resolved items above.</p>
        </div>
      )}
    </AdminPageFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  Triage Item type                                                   */
/* ------------------------------------------------------------------ */

interface TriageItem {
  id: string;
  priority: Priority;
  label: string;
  value: string;
  href: string;
  icon: typeof Activity;
  subtitle: string;
  resolved?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Triage Row                                                         */
/* ------------------------------------------------------------------ */

function TriageRow({ item }: { item: TriageItem }) {
  const p = PRIORITY_STYLES[item.priority];
  const Icon = item.icon;

  if (item.resolved) {
    return (
      <Link href={item.href}
        className="flex items-center gap-4 rounded-xl border border-admin-border bg-admin-card px-4 py-3 hover:bg-white/[0.015] transition-colors group">
        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-xs text-admin-muted">{item.label}</span>
          <span className="mx-2 text-xs text-emerald-400 font-semibold">{item.value}</span>
          <span className="text-[10px] text-admin-muted/60">{item.subtitle}</span>
        </div>
        <ChevronRight className="h-3.5 w-3.5 text-admin-muted/40 group-hover:text-admin-text transition-colors shrink-0" />
      </Link>
    );
  }

  return (
    <Link href={item.href}
      className={cn(
        'flex items-center gap-4 rounded-xl border px-4 py-3.5 transition-all group hover:shadow-md hover:shadow-black/10 hover:-translate-y-px',
        p.bg
      )}>
      {/* Priority dot */}
      <div className="flex flex-col items-center gap-1 shrink-0">
        <div className={cn('h-2.5 w-2.5 rounded-full', p.dot)} />
        <span className={cn('text-[8px] font-bold uppercase tracking-wider', p.text)}>{p.label}</span>
      </div>

      {/* Icon */}
      <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06] shrink-0', p.text)}>
        <Icon className="h-5 w-5" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-admin-text">{item.label}</span>
        </div>
        <p className="text-[11px] text-admin-muted mt-0.5">{item.subtitle}</p>
      </div>

      {/* Value */}
      <div className="text-right shrink-0">
        <p className={cn('text-2xl font-bold tabular-nums', p.text)}>{item.value}</p>
      </div>

      {/* Arrow */}
      <ChevronRight className="h-4 w-4 text-admin-muted/50 group-hover:text-admin-text transition-colors shrink-0" />
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  Count Badge                                                        */
/* ------------------------------------------------------------------ */

function CountBadge({ label, count, color, pulse }: { label: string; count: number; color: string; pulse?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-admin-muted">{label}</span>
      <span className={cn('text-xs font-bold tabular-nums', color, pulse && 'animate-pulse')}>{count}</span>
    </div>
  );
}
