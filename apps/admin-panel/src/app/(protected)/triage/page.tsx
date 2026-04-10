'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpFromLine,
  ShieldAlert,
  Repeat,
  Activity,
  Gauge,
  UserCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import { getDashboardSummary, getTradingHalt, getSystemHealth } from '@/lib/api';
import { getP2pDisputes } from '@/lib/admin/p2p';
import { cn } from '@/lib/cn';

function Tile({
  href,
  title,
  value,
  subtitle,
  icon: Icon,
  danger,
  loading,
}: {
  href: string;
  title: string;
  value: string;
  subtitle: string;
  icon: typeof Activity;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group rounded-xl border border-admin-border bg-admin-card p-4 shadow-sm transition-colors',
        'hover:border-admin-primary/40 hover:bg-white/[0.02]',
        danger && 'border-admin-danger/30 bg-admin-danger/5'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-admin-muted">{title}</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-admin-text">
            {loading ? <span className="inline-block h-8 w-14 animate-pulse rounded bg-white/10" /> : value}
          </p>
          <p className="mt-1 text-xs text-admin-muted">{subtitle}</p>
        </div>
        <Icon className={cn('h-8 w-8 shrink-0 opacity-80', danger ? 'text-admin-danger' : 'text-admin-primary')} />
      </div>
      <p className="mt-3 text-[11px] font-medium text-admin-primary group-hover:underline">Open →</p>
    </Link>
  );
}

export default function TriagePage() {
  const token = useAdminAuthStore((s) => s.accessToken);

  const dashQ = useQuery({
    queryKey: ['admin', 'dashboard-summary', token],
    queryFn: () => getDashboardSummary(token),
    enabled: !!token,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const haltQ = useQuery({
    queryKey: ['admin', 'trading-halt', token],
    queryFn: () => getTradingHalt(token),
    enabled: !!token,
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  const healthQ = useQuery({
    queryKey: ['admin', 'system-health', token],
    queryFn: () => getSystemHealth(token),
    enabled: !!token,
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  const disputesQ = useQuery({
    queryKey: ['admin', 'triage', 'p2p-disputes', token],
    queryFn: () => getP2pDisputes(token, { limit: 100, offset: 0 }),
    enabled: !!token,
    staleTime: 30_000,
    refetchInterval: 45_000,
  });

  const dash = dashQ.data?.data;
  const halted = haltQ.data?.data?.halted ?? dash?.halted ?? false;
  const pendingWd = dash?.pendingWithdrawals ?? '—';
  const kycPending = dash?.stats?.kyc?.pending;
  const disputeRows = disputesQ.data?.data;
  const openDisputes = Array.isArray(disputeRows) ? disputeRows.length : 0;

  const dbOk = healthQ.data?.data?.database?.status === 'healthy' || healthQ.data?.data?.database?.status === 'ok';
  const redisOk = healthQ.data?.data?.redis?.status === 'healthy' || healthQ.data?.data?.redis?.status === 'ok';
  const healthLabel =
    healthQ.isLoading ? '…' : healthQ.isError ? 'Check monitoring' : dbOk && redisOk ? 'Core OK' : 'Degraded';

  const loading = dashQ.isLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-admin-text">Operations triage</h1>
        <p className="text-xs text-admin-muted mt-0.5 max-w-2xl">
          One screen to see what needs attention right now. Numbers refresh automatically; each tile jumps to the workspace where you can act.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Tile
          href="/withdrawals?status=pending_approval"
          title="Withdrawals pending approval"
          value={typeof pendingWd === 'number' ? String(pendingWd) : String(pendingWd)}
          subtitle="Approve or reject from the queue"
          icon={ArrowUpFromLine}
          loading={loading}
        />
        <Tile
          href="/p2p"
          title="P2P disputes (open-ish)"
          value={disputesQ.isLoading ? '…' : String(openDisputes)}
          subtitle="Filter and resolve on P2P"
          icon={Repeat}
          danger={openDisputes > 0}
          loading={disputesQ.isLoading}
        />
        <Tile
          href="/kyc"
          title="KYC pending"
          value={kycPending != null ? String(kycPending) : '—'}
          subtitle="Review verification queue"
          icon={UserCheck}
          loading={loading}
        />
        <Tile
          href="/admin-control"
          title="Trading halt"
          value={halted ? 'HALTED' : 'Active'}
          subtitle={halted ? 'Trading is stopped — investigate before lifting' : 'Normal trading'}
          icon={ShieldAlert}
          danger={!!halted}
          loading={haltQ.isLoading && dashQ.isLoading}
        />
        <Tile
          href="/monitoring"
          title="System health"
          value={healthLabel}
          subtitle="Queues, RPC, workers"
          icon={Activity}
          loading={healthQ.isLoading}
        />
        <Tile
          href="/admin/mm-control"
          title="MM desk"
          value="Open"
          subtitle="Liquidity / bot controls"
          icon={SlidersHorizontal}
          loading={false}
        />
        <Tile
          href="/risk"
          title="Risk & AML"
          value="Open"
          subtitle="Alerts and escalations"
          icon={Gauge}
          loading={false}
        />
      </div>
    </div>
  );
}
