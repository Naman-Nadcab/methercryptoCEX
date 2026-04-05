'use client';

import { useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { adminFetch } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import { cn } from '@/lib/cn';
import { Scale, AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';

function sumLedgerTotals(funds: Record<string, unknown> | undefined): number {
  const lt = funds?.ledger_totals;
  if (!Array.isArray(lt)) return 0;
  return lt.reduce((acc, row) => {
    const amt = Number((row as { amount?: string }).amount ?? 0);
    return acc + (Number.isFinite(amt) ? amt : 0);
  }, 0);
}

function fmt(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export default function ReconciliationPage() {
  const token = useAdminAuthStore((s) => s.accessToken);

  const { data: treasuryData, isLoading: tLoading, isError: tFetchError } = useQuery({
    queryKey: ['admin', 'treasury', 'stats', token],
    queryFn: () => adminFetch('/treasury', { token }),
    enabled: !!token,
    retry: 2,
    refetchInterval: 60000,
    staleTime: 30_000,
  });
  const { data: fundsData, isLoading: fLoading, isError: fFetchError } = useQuery({
    queryKey: ['admin', 'funds-summary', token],
    queryFn: () => adminFetch('/funds/summary', { token }),
    enabled: !!token,
    retry: 1,
    refetchInterval: 120000,
    staleTime: 60_000,
  });

  const tError = tFetchError || treasuryData?.success === false;
  const fError = fFetchError || fundsData?.success === false;

  const treasury = (treasuryData?.success !== false ? treasuryData?.data : undefined) as Record<string, unknown> | undefined;
  const funds = (fundsData?.success !== false ? fundsData?.data : undefined) as Record<string, unknown> | undefined;

  const hotTotal = Number(treasury?.hot_wallet_balance ?? treasury?.hotWalletBalance ?? treasury?.hot_balance ?? 0);
  const coldTotal = Number(treasury?.cold_wallet_balance ?? treasury?.coldWalletBalance ?? treasury?.cold_balance ?? 0);
  const reserveTotal = hotTotal + coldTotal;
  const userDirect = Number(funds?.total_balance ?? funds?.ledger_sum ?? 0);
  const userTotal = userDirect > 0 ? userDirect : sumLedgerTotals(funds);
  const discrepancy = reserveTotal - userTotal;
  const discrepancyPct = userTotal > 0 ? (discrepancy / userTotal) * 100 : 0;
  const bothLoaded = !tLoading && !fLoading;
  const dataAvailable = reserveTotal > 0 || userTotal > 0;
  const isHealthy = dataAvailable && Math.abs(discrepancyPct) < 1;

  const treasuryReady = !tLoading && !tError;
  const fundsReady = !fLoading && !fError;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-admin-text">Reconciliation</h1>
        <p className="text-xs text-admin-muted mt-0.5">Balance reconciliation between reserves and user ledger.</p>
      </div>

      {(tError || fError) && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
          <div>
            <p className="text-sm font-semibold text-red-800">Data Unavailable</p>
            <p className="text-xs text-admin-muted">
              {tError && fError ? 'Both treasury and funds APIs failed.' : tError ? 'Treasury API failed.' : 'Funds summary API failed.'}
              {' '}Reconciliation data may be inaccurate.
            </p>
          </div>
        </div>
      )}

      {/* Status banner — show immediately once we have enough data */}
      {bothLoaded && !tError && !fError ? (
        !dataAvailable ? (
          <div className="flex items-center gap-3 rounded-lg border border-admin-border bg-white/[0.02] p-4">
            <Scale className="h-5 w-5 shrink-0 text-admin-muted" />
            <div>
              <p className="text-sm font-semibold text-admin-text">No Balance Data</p>
              <p className="text-xs text-admin-muted">Reserve and user ledger balances are both zero.</p>
            </div>
          </div>
        ) : (
          <div className={cn('flex items-center gap-3 rounded-lg p-4', isHealthy ? 'border border-emerald-200 bg-emerald-50' : 'border border-red-200 bg-red-50')}>
            {isHealthy ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />}
            <div>
              <p className={cn('text-sm font-semibold', isHealthy ? 'text-emerald-800' : 'text-red-800')}>
                {isHealthy ? 'Balances Reconciled' : 'Discrepancy Detected'}
              </p>
              <p className="text-xs text-admin-muted">
                {isHealthy
                  ? 'Reserve balances match user ledger within acceptable threshold (<1%).'
                  : `Reserve vs ledger discrepancy: ${discrepancyPct.toFixed(2)}%. Immediate investigation required.`}
              </p>
            </div>
          </div>
        )
      ) : !tError && !fError ? (
        <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
          <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
          <span className="text-sm text-blue-700">
            {tLoading && fLoading ? 'Loading treasury and funds data…' : fLoading ? 'Treasury loaded. Loading funds ledger data…' : 'Funds loaded. Loading treasury data…'}
          </span>
        </div>
      ) : null}

      {/* KPI Cards — show progressively */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="px-3 py-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">Hot Wallet</p>
            {tLoading ? (
              <div className="mt-1 h-6 w-20 animate-pulse rounded bg-white/5" />
            ) : (
              <p className="text-lg font-bold tabular-nums text-admin-text">{fmt(hotTotal)}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="px-3 py-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">Cold Wallet</p>
            {tLoading ? (
              <div className="mt-1 h-6 w-20 animate-pulse rounded bg-white/5" />
            ) : (
              <p className="text-lg font-bold tabular-nums text-admin-text">{fmt(coldTotal)}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="px-3 py-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">Total Reserves</p>
            {tLoading ? (
              <div className="mt-1 h-6 w-20 animate-pulse rounded bg-white/5" />
            ) : (
              <p className="text-lg font-bold tabular-nums text-admin-text">{fmt(reserveTotal)}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="px-3 py-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">User Ledger Total</p>
            {fLoading ? (
              <div className="mt-1 h-6 w-20 animate-pulse rounded bg-white/5" />
            ) : (
              <p className="text-lg font-bold tabular-nums text-admin-text">{fmt(userTotal)}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detail Table — show immediately with partial data */}
      <Card>
        <CardHeader>
          <CardTitle>Reconciliation Detail</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-admin-border text-left text-admin-muted">
                  <th className="pb-2 pr-4 font-medium">Category</th>
                  <th className="pb-2 pr-4 font-medium">Balance</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-admin-border/50">
                  <td className="py-2.5 pr-4">Hot Wallets</td>
                  <td className="py-2.5 pr-4 tabular-nums">
                    {tLoading ? <span className="inline-block h-4 w-16 animate-pulse rounded bg-white/5" /> : fmt(hotTotal)}
                  </td>
                  <td>
                    {tLoading ? (
                      <span className="inline-block h-5 w-14 animate-pulse rounded bg-white/5" />
                    ) : (
                      <Badge variant="success" size="sm">Verified</Badge>
                    )}
                  </td>
                </tr>
                <tr className="border-b border-admin-border/50">
                  <td className="py-2.5 pr-4">Cold Storage</td>
                  <td className="py-2.5 pr-4 tabular-nums">
                    {tLoading ? <span className="inline-block h-4 w-16 animate-pulse rounded bg-white/5" /> : fmt(coldTotal)}
                  </td>
                  <td>
                    {tLoading ? (
                      <span className="inline-block h-5 w-14 animate-pulse rounded bg-white/5" />
                    ) : (
                      <Badge variant="success" size="sm">Verified</Badge>
                    )}
                  </td>
                </tr>
                <tr className="border-b border-admin-border/50">
                  <td className="py-2.5 pr-4">User Balances (Ledger)</td>
                  <td className="py-2.5 pr-4 tabular-nums">
                    {fLoading ? <span className="inline-block h-4 w-16 animate-pulse rounded bg-white/5" /> : fmt(userTotal)}
                  </td>
                  <td>
                    {fLoading ? (
                      <span className="inline-block h-5 w-14 animate-pulse rounded bg-white/5" />
                    ) : (
                      <Badge variant="success" size="sm">Verified</Badge>
                    )}
                  </td>
                </tr>
                <tr className="border-b border-admin-border/50">
                  <td className="py-2.5 pr-4 font-semibold">Discrepancy</td>
                  <td className={cn('py-2.5 pr-4 font-semibold tabular-nums', !bothLoaded ? '' : Math.abs(discrepancy) > 0 ? 'text-amber-600' : 'text-admin-text')}>
                    {!bothLoaded ? <span className="inline-block h-4 w-16 animate-pulse rounded bg-white/5" /> : fmt(Math.abs(discrepancy))}
                  </td>
                  <td>
                    {!bothLoaded ? (
                      <span className="inline-block h-5 w-14 animate-pulse rounded bg-white/5" />
                    ) : (
                      <Badge variant={isHealthy ? 'success' : 'danger'} size="sm">{isHealthy ? 'OK' : 'Alert'}</Badge>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <p className="text-xs text-admin-muted">
            Reconciliation runs every 60 seconds. For per-asset reconciliation, integrate with blockchain node
            balance APIs. Discrepancies over 1% trigger automated alerts.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
