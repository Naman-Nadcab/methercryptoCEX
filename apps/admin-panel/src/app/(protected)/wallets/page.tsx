'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet, Loader2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import { getWallets, getFundsSummary } from '@/lib/admin';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, Input } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useAdminWs } from '@/hooks/useAdminWs';

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

  const { data: fundsRes, isLoading: fundsLoading, isError: fundsIsError, error: fundsError } = useQuery({
    queryKey: ['admin', 'funds-summary', token],
    staleTime: 30_000,
    queryFn: () => getFundsSummary(token),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  const fundsSummary = fundsRes?.data as Record<string, any> | undefined;

  const { data: walletsRes, isLoading: walletsLoading, isError, error } = useQuery({
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-admin-text">Wallets</h1>
        <p className="text-xs text-admin-muted mt-0.5">Monitor user balances, hot/cold wallet reserves, and asset distribution.</p>
      </div>

      {(fundsIsError || fundsRes?.success === false) && (
        <p className="text-sm text-admin-danger" role="alert">
          {(fundsError as Error)?.message ??
            fundsRes?.error?.message ??
            'Failed to load funds summary.'}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Total AUM', value: aum },
          { label: 'Users with Balance', value: usersWithBalance },
          { label: 'Hot Wallet Total', value: hotTotal },
          { label: 'Cold Wallet Total', value: coldTotal },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-admin-border bg-admin-card p-4">
            <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">{kpi.label}</p>
            <p className="mt-2 text-xl font-bold tabular-nums text-admin-text">
              {fundsLoading ? (
                <span className="inline-block h-5 w-16 animate-pulse rounded bg-white/5 align-middle" />
              ) : (
                kpi.value
              )}
            </p>
          </div>
        ))}
      </div>

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
                    <div key={a.asset} className="rounded-lg border border-admin-border p-3">
                      <p className="text-xs text-admin-muted font-medium">{a.asset}</p>
                      <p className="text-sm font-bold text-admin-text tabular-nums mt-0.5">
                        {Number(a.total).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </p>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

      <Card>
        <CardHeader>
          <CardTitle>User balances</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Search"
            placeholder="Email, user ID, username, asset, or deposit address"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            iconLeft={<Search className="h-4 w-4" />}
          />

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
                    <th key={h} className="px-4 py-2.5 font-medium text-admin-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {walletsLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-16 text-center text-admin-muted">
                      <Loader2 className="mx-auto h-8 w-8 animate-spin text-admin-primary" aria-hidden />
                      <span className="sr-only">Loading</span>
                    </td>
                  </tr>
                ) : holdings.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-admin-muted">
                      No wallet balances match your filters.
                    </td>
                  </tr>
                ) : (
                  holdings.map((row) => {
                    const av = parseFloat(row.available ?? '0');
                    const lk = parseFloat(row.locked ?? '0');
                    const total = (Number.isFinite(av) ? av : 0) + (Number.isFinite(lk) ? lk : 0);
                    return (
                      <tr key={`${row.user_id}-${row.asset}`} className="border-b border-admin-border/80 hover:bg-white/5">
                        <td className="px-4 py-3 font-medium text-admin-text">{userLabel(row.email, row.username)}</td>
                        <td className="max-w-[200px] truncate px-4 py-3 text-admin-muted" title={row.email ?? ''}>
                          {row.email ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="default">{row.asset}</Badge>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs tabular-nums">{fmtAmount(row.available)}</td>
                        <td className="px-4 py-3 font-mono text-xs tabular-nums">{fmtAmount(row.locked)}</td>
                        <td className="px-4 py-3 font-mono text-xs font-medium tabular-nums">{fmtAmount(String(total))}</td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/users/${row.user_id}`}
                            className={cn(
                              'inline-flex h-8 items-center rounded-ds-md px-3 text-sm font-medium',
                              'text-admin-primary hover:bg-admin-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-primary'
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
                : loading
                  ? '…'
                  : null}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1 || walletsLoading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= totalPages || walletsLoading}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
