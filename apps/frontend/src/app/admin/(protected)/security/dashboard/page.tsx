'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import {
  securityApi,
  type SecurityDashboardData,
} from '@/lib/securityApi';
import { StatCard } from '@/components/admin/security/StatCard';

const ROUTES = {
  riskRules: '/admin/security/risk-rules',
  ipRules: '/admin/security/ip-rules',
  withdrawals: '/admin/security/withdrawals',
  sessions: '/admin/security/sessions',
} as const;

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4 animate-pulse">
      <div className="h-4 w-24 rounded bg-slate-200 dark:bg-slate-600" />
      <div className="mt-2 h-8 w-16 rounded bg-slate-200 dark:bg-slate-600" />
    </div>
  );
}

function DashboardGrid({ data }: { data: SecurityDashboardData }) {
  const {
    risk,
    access,
    withdrawals,
    accounts,
  } = data;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard
        label="Risk Blocks (24h)"
        value={risk.blocksLast24h}
        variant="danger"
        href={ROUTES.riskRules}
      />
      <StatCard
        label="Risk Challenges (24h)"
        value={risk.challengesLast24h}
        variant="default"
        href={ROUTES.riskRules}
      />
      <StatCard
        label="Access Blocked (24h)"
        value={access.accessBlockedLast24h}
        variant="warning"
        href={ROUTES.ipRules}
      />
      <StatCard
        label="VPN / TOR Detections"
        value={access.vpnTorDetectionsLast24h}
        variant="warning"
        href={ROUTES.ipRules}
      />
      <StatCard
        label="Withdrawals Pending Approval"
        value={withdrawals.pendingAdminApproval}
        variant="danger"
        href={ROUTES.withdrawals}
      />
      <StatCard
        label="Withdrawals Blocked"
        value={withdrawals.blockedBySecurity}
        variant="danger"
        href={ROUTES.withdrawals}
      />
      <StatCard
        label="Locked Users"
        value={accounts.usersCurrentlyLocked}
        variant="warning"
        href={ROUTES.sessions}
      />
      <StatCard
        label="Failed Logins (24h)"
        value={accounts.loginFailedLast24h}
        variant="warning"
        href={ROUTES.sessions}
      />
    </div>
  );
}

export default function SecurityDashboardPage() {
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['admin', 'security', 'dashboard'],
    queryFn: () => securityApi.dashboard(),
    refetchInterval: securityApi.refreshIntervalMs,
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
          Security Dashboard
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Real-time overview of platform security
        </p>
      </header>

      {isError && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-red-800 dark:text-red-200"
        >
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium">Failed to load security data</p>
            <p className="text-sm opacity-90">
              {error instanceof Error ? error.message : 'Something went wrong'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded border border-red-300 dark:border-red-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-slate-800"
          >
            Retry
          </button>
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {!isLoading && !isError && data && (
        <DashboardGrid data={data} />
      )}
    </div>
  );
}
