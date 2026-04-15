'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, RefreshCw, Search, Thermometer, X } from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import { getWallets, getFundsSummary } from '@/lib/admin';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, Input } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useAdminWs } from '@/hooks/useAdminWs';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';

function fmtAmount(raw: string | undefined): string {
  const n = parseFloat(raw ?? '0');
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  if (Math.abs(n) < 1e-8 && n !== 0) return n.toExponential(2);
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function userLabel(email: string | null | undefined, username: string | null | undefined): string {
  const u = username?.trim();
  if (u) return u;
  if (email?.trim()) return email.trim();
  return '—';
}

export default function WalletsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  useAdminWs({
    onEvent: (event) => {
      const type = (event?.type as string) ?? '';
      if (['deposit_confirmed', 'withdrawal_completed'].includes(type)) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'wallets'] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'funds-summary'] });
      }
    },
  });
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const deferredQ = useDeferredValue(q.trim());
  const pageSize = 20;

  useEffect(() => {
    setPage(1);
  }, [deferredQ]);

  const { data: fundsRes, isLoading: fundsLoading, isError: fundsIsError, error: fundsError, refetch: refetchFunds } = useQuery({
    queryKey: ['admin', 'funds-summary', token],
    staleTime: 30_000,
    queryFn: () => getFundsSummary(token),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  const fundsSummary = fundsRes?.data as Record<string, any> | undefined;

  const { data: walletsRes, isLoading: walletsLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'wallets', token, page, deferredQ, pageSize],
    staleTime: 30_000,
    queryFn: () =>
      getWallets(token, {
        page,
        limit: pageSize,
        search: deferredQ || undefined,
      }),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  const { aum, hotTotal, coldTotal, usersWithBalance } = useMemo(() => {
    const d = fundsRes?.data;
    let a = 0;
    for (const row of d?.ledger_totals ?? []) {
      const n = parseFloat(row.amount ?? '0');
      if (Number.isFinite(n)) a += n;
    }
    let hot = 0;
    for (const row of d?.on_chain_totals?.hot_wallets ?? []) {
      const n = parseFloat(row.balance ?? '0');
      if (Number.isFinite(n)) hot += n;
    }
    let cold = 0;
    let coldAny = false;
    for (const row of d?.on_chain_totals?.cold_wallets ?? []) {
      if (row.balance != null && row.balance !== '') {
        coldAny = true;
        const n = parseFloat(row.balance);
        if (Number.isFinite(n)) cold += n;
      }
    }
    return {
      aum: fmtAmount(String(a)),
      hotTotal: fmtAmount(String(hot)),
      coldTotal: coldAny ? fmtAmount(String(cold)) : '—',
      usersWithBalance: d?.users_with_balance ?? '—',
    };
  }, [fundsRes?.data]);
  const holdings = walletsRes?.data?.holdings ?? [];
  const pagination = walletsRes?.data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;
  const loading = fundsLoading || walletsLoading;

  // Asset filter: derive from loaded data
  const [assetFilter, setAssetFilter] = useState('');
  const allAssets = useMemo(() => {
    const assetSet = new Set<string>();
    for (const h of holdings) if (h.asset) assetSet.add(h.asset);
    return Array.from(assetSet).sort();
  }, [holdings]);

  // Per-chain hot wallet strip from fundsData
  const hotWallets: Array<{ chain: string; balance: string }> = useMemo(() => {
    return (fundsSummary?.on_chain_totals?.hot_wallets ?? []) as Array<{ chain: string; balance: string }>;
  }, [fundsSummary]);

  // Client-side asset filter on top of server results
  const visibleHoldings = useMemo(() => {
    if (!assetFilter) return holdings;
    return holdings.filter((h) => h.asset === assetFilter);
  }, [holdings, assetFilter]);

  function handleRefresh() {
    void refetch();
    void refetchFunds();
  }

  return (
    <AdminPageFrame
      title="Wallets"
      description="Monitor user balances, hot/cold wallet reserves, and asset distribution."
      quickActions={
        <button
          type="button"
          onClick={handleRefresh}
          className="flex items-center gap-1.5 rounded-lg border border-admin-border/60 px-3 py-1.5 text-xs text-admin-muted hover:text-admin-text hover:bg-white/[0.04] transition-colors"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
      }
    >

      {(fundsIsError || fundsRes?.success === false) && (
        <p className="text-sm text-admin-danger" role="alert">
          {(fundsError as Error)?.message ?? fundsRes?.error?.message ?? 'Failed to load funds summary.'}
        </p>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Total AUM', value: aum },
          { label: 'Users with Balance', value: usersWithBalance },
          { label: 'Hot Wallet Total', value: hotTotal, accent: 'orange' },
          { label: 'Cold Wallet Total', value: coldTotal, accent: 'blue' },
        ].map((kpi) => (
          <div key={kpi.label} className={cn(
            'relative rounded-xl border bg-admin-card p-4 overflow-hidden',
            kpi.accent === 'orange' ? 'border-orange-500/20' : kpi.accent === 'blue' ? 'border-blue-500/20' : 'border-admin-border/60'
          )}>
            {kpi.accent && (
              <div className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-xl', kpi.accent === 'orange' ? 'bg-gradient-to-r from-orange-500/70 to-transparent' : 'bg-gradient-to-r from-blue-500/70 to-transparent')} />
            )}
            <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">{kpi.label}</p>
            <p className="mt-2 text-xl font-bold tabular-nums text-admin-text">
              {fundsLoading ? <span className="inline-block h-5 w-16 animate-pulse rounded bg-white/5 align-middle" /> : kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* Per-chain hot wallet strip */}
      {hotWallets.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Thermometer className="h-4 w-4 text-orange-400" />
              <CardTitle>Hot Wallet — Per Chain</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {hotWallets.map((hw) => {
                const n = parseFloat(hw.balance ?? '0');
                return (
                  <div key={hw.chain} className="rounded-lg border border-orange-500/20 bg-orange-950/10 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-orange-400/80">{hw.chain}</p>
                    <p className="mt-1 font-mono text-sm font-bold text-admin-text tabular-nums">
                      {Number.isFinite(n) ? fmtAmount(hw.balance) : '—'}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Asset distribution */}
      {fundsSummary?.asset_breakdown &&
        (fundsSummary.asset_breakdown as Array<{ asset: string; total: number }>).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Asset Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                {(fundsSummary.asset_breakdown as Array<{ asset: string; total: number }>)
                  .slice(0, 12)
                  .map((a) => (
                    <button
                      key={a.asset}
                      type="button"
                      onClick={() => setAssetFilter((prev) => prev === a.asset ? '' : a.asset)}
                      className={cn(
                        'rounded-lg border p-3 text-left transition-colors',
                        assetFilter === a.asset
                          ? 'border-blue-500/40 bg-blue-950/20 ring-1 ring-blue-500/30'
                          : 'border-admin-border hover:border-blue-500/25 hover:bg-white/[0.02]'
                      )}
                    >
                      <p className="text-xs text-admin-muted font-medium">{a.asset}</p>
                      <p className="text-sm font-bold text-admin-text tabular-nums mt-0.5">
                        {Number(a.total).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </p>
                    </button>
                  ))}
              </div>
              {assetFilter && (
                <p className="mt-2 text-xs text-blue-400">Filtering table by <strong>{assetFilter}</strong>. Click again to clear.</p>
              )}
            </CardContent>
          </Card>
        )}

      <Card>
        <CardHeader>
          <CardTitle>User Balances</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <Input
                label=""
                placeholder="Email, user ID, username, asset, or deposit address"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                iconLeft={<Search className="h-4 w-4" />}
              />
            </div>
            {allAssets.length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  value={assetFilter}
                  onChange={(e) => setAssetFilter(e.target.value)}
                  className="rounded-lg border border-admin-border/60 bg-admin-surface px-3 py-2 text-xs text-admin-text focus:outline-none focus:ring-1 focus:ring-blue-500/40"
                >
                  <option value="">All assets</option>
                  {allAssets.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                {assetFilter && (
                  <button type="button" onClick={() => setAssetFilter('')} className="flex h-7 w-7 items-center justify-center rounded-full text-admin-muted hover:text-admin-text hover:bg-white/[0.06]">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          {isError && (
            <p className="text-sm text-admin-danger" role="alert">
              {(error as Error)?.message ?? 'Failed to load wallets.'}
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-admin-border">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="border-b border-admin-border bg-white/[0.02]">
                <tr>
                  {['User', 'Email', 'Asset', 'Available', 'Locked', 'Total', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-medium text-admin-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {walletsLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-16 text-center text-admin-muted">
                      <RefreshCw className="mx-auto h-6 w-6 animate-spin text-admin-primary" aria-hidden />
                      <span className="sr-only">Loading</span>
                    </td>
                  </tr>
                ) : visibleHoldings.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-admin-muted">
                      No wallet balances match your filters.
                    </td>
                  </tr>
                ) : (
                  visibleHoldings.map((row) => {
                    const av = parseFloat(row.available ?? '0');
                    const lk = parseFloat(row.locked ?? '0');
                    const hasLocked = Number.isFinite(lk) && lk > 0;
                    const total = (Number.isFinite(av) ? av : 0) + (Number.isFinite(lk) ? lk : 0);
                    return (
                      <tr
                        key={`${row.user_id}-${row.asset}`}
                        className={cn(
                          'border-b border-admin-border/80 hover:bg-white/[0.025] transition-colors',
                          hasLocked && 'bg-amber-950/[0.08]'
                        )}
                      >
                        <td className="px-4 py-3 font-medium text-admin-text">{userLabel(row.email, row.username)}</td>
                        <td className="max-w-[200px] truncate px-4 py-3 text-admin-muted" title={row.email ?? ''}>
                          {row.email ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="default">{row.asset}</Badge>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs tabular-nums">{fmtAmount(row.available)}</td>
                        <td className={cn('px-4 py-3 font-mono text-xs tabular-nums', hasLocked && 'text-amber-400 font-semibold')}>
                          {fmtAmount(row.locked)}
                          {hasLocked && <span className="ml-1 text-[9px] text-amber-500/70 uppercase tracking-wide">locked</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs font-medium tabular-nums">{fmtAmount(String(total))}</td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/users/${row.user_id}`}
                            className={cn(
                              'inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium',
                              'text-admin-primary hover:bg-admin-primary/10 transition-colors'
                            )}
                          >
                            View user
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-admin-muted">
              {pagination != null
                ? `Page ${pagination.page} of ${totalPages} · ${pagination.total} row(s)`
                : loading ? '…' : null}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={page <= 1 || walletsLoading} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={page >= totalPages || walletsLoading} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </AdminPageFrame>
  );
}
