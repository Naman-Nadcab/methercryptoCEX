'use client';

import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { adminFetch } from '@/lib/api';
import { getTreasuryReconciliation } from '@/lib/treasury-api';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  Scale,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import Link from 'next/link';

function sumLedgerTotals(funds: Record<string, unknown> | undefined): number {
  const lt = funds?.ledger_totals;
  if (!Array.isArray(lt)) return 0;
  return lt.reduce((acc, row) => {
    const amt = Number((row as { amount?: string }).amount ?? 0);
    return acc + (Number.isFinite(amt) ? amt : 0);
  }, 0);
}

function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function fmtTs(ts: string | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return d.toLocaleTimeString();
}

export default function ReconciliationPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();

  const { data: treasuryData, isLoading: tLoading, isError: tFetchError } = useQuery({
    queryKey: ['admin', 'treasury', 'stats', token],
    queryFn: () => adminFetch('/treasury', { token }),
    enabled: !!token,
    retry: 2,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: fundsData, isLoading: fLoading, isError: fFetchError } = useQuery({
    queryKey: ['admin', 'funds-summary', token],
    queryFn: () => adminFetch('/funds/summary', { token }),
    enabled: !!token,
    retry: 1,
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  // The dedicated reconciliation endpoint — used by Treasury page too
  const { data: reconData, isLoading: reconLoading } = useQuery({
    queryKey: ['admin', 'treasury', 'reconciliation', token],
    queryFn: () => getTreasuryReconciliation(token),
    enabled: !!token,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const tError = tFetchError || treasuryData?.success === false;
  const fError = fFetchError || fundsData?.success === false;

  const treasury = (treasuryData?.success !== false ? treasuryData?.data : undefined) as Record<string, unknown> | undefined;
  const funds = (fundsData?.success !== false ? fundsData?.data : undefined) as Record<string, unknown> | undefined;
  const recon = reconData?.success !== false ? reconData?.data : undefined;

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

  // Use recon API for per-chain mismatches when available
  const reconMatched = recon?.matched;
  const reconMismatches = recon?.mismatches ?? [];
  const reconLastChecked = recon?.lastCheckedAt;
  const hasReconData = recon != null;

  function handleRefresh() {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'treasury'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'funds-summary'] });
  }

  const pageStatus = !isHealthy && bothLoaded && dataAvailable ? 'warning' as const : 'active' as const;

  return (
    <AdminPageFrame
      title="Reconciliation"
      description="Live balance reconciliation between on-chain reserves and the user ledger."
      status={pageStatus}
      quickActions={
        <button
          type="button"
          onClick={handleRefresh}
          className="flex items-center gap-1.5 rounded-lg border border-admin-border/60 px-3 py-1.5 text-xs text-admin-muted hover:text-admin-text hover:bg-white/[0.04] transition-colors"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', (tLoading || fLoading || reconLoading) && 'animate-spin')} />
          Refresh
        </button>
      }
    >

      {/* ── Error banner ── */}
      {(tError || fError) && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-950/20 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
          <div>
            <p className="text-sm font-semibold text-red-300">Data Unavailable</p>
            <p className="text-xs text-admin-muted">
              {tError && fError ? 'Both treasury and funds APIs failed.' : tError ? 'Treasury API failed.' : 'Funds summary API failed.'}
              {' '}Reconciliation results may be incomplete.
            </p>
          </div>
        </div>
      )}

      {/* ── Status banner ── */}
      {bothLoaded && !tError && !fError && (
        !dataAvailable ? (
          <div className="flex items-center gap-3 rounded-xl border border-admin-border/60 bg-white/[0.02] p-4">
            <Scale className="h-5 w-5 shrink-0 text-admin-muted" />
            <div>
              <p className="text-sm font-semibold text-admin-text">No Balance Data</p>
              <p className="text-xs text-admin-muted">Reserve and user ledger balances are both zero or unavailable.</p>
            </div>
          </div>
        ) : isHealthy ? (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-950/15 p-4">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
            <div>
              <p className="text-sm font-semibold text-emerald-300">Balances Reconciled</p>
              <p className="text-xs text-admin-muted">
                Reserve balances match user ledger within acceptable threshold (&lt;1%). Discrepancy: {discrepancyPct.toFixed(3)}%.
              </p>
            </div>
            {reconLastChecked && (
              <span className="ml-auto flex items-center gap-1 text-[10px] text-admin-muted">
                <Clock className="h-3 w-3" />{fmtTs(reconLastChecked)}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-950/15 p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
            <div>
              <p className="text-sm font-semibold text-amber-300">Discrepancy Detected</p>
              <p className="text-xs text-admin-muted">
                Reserve vs ledger discrepancy: <strong>{discrepancyPct.toFixed(2)}%</strong> ({fmt(Math.abs(discrepancy))} raw units).
                Threshold: 1%. Investigation required.
              </p>
            </div>
            <Link href="/treasury" className="ml-auto flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-950/20 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-950/30 transition-colors whitespace-nowrap">
              View Treasury <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        )
      )}

      {/* Loading banner */}
      {(tLoading || fLoading) && (
        <div className="flex items-center gap-2 rounded-xl border border-admin-border/50 bg-white/[0.02] px-4 py-3">
          <RefreshCw className="h-4 w-4 animate-spin text-admin-muted" />
          <span className="text-sm text-admin-muted">
            {tLoading && fLoading ? 'Loading treasury and funds data…' : fLoading ? 'Loading funds ledger…' : 'Loading treasury data…'}
          </span>
        </div>
      )}

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Hot Wallet (on-chain)', value: hotTotal, loading: tLoading },
          { label: 'Cold Storage (on-chain)', value: coldTotal, loading: tLoading },
          { label: 'Total Reserves', value: reserveTotal, loading: tLoading, highlight: true },
          { label: 'User Ledger Total', value: userTotal, loading: fLoading },
        ].map(({ label, value, loading, highlight }) => (
          <div key={label} className={cn(
            'relative rounded-xl border bg-admin-card p-4 overflow-hidden',
            highlight ? 'border-blue-500/25' : 'border-admin-border/60'
          )}>
            {highlight && <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-blue-500/60 to-blue-500/0 rounded-t-xl" />}
            <p className="text-[10px] font-medium uppercase tracking-widest text-admin-muted">{label}</p>
            {loading ? (
              <div className="mt-2 h-6 w-24 animate-pulse rounded bg-white/[0.06]" />
            ) : (
              <p className="mt-2 text-xl font-bold tabular-nums text-admin-text">{fmt(value)}</p>
            )}
            <p className="mt-0.5 text-[10px] text-admin-muted">raw units</p>
          </div>
        ))}
      </div>

      {/* ── Discrepancy summary ── */}
      {bothLoaded && dataAvailable && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-admin-border/60 bg-admin-card p-4">
            <p className="text-[10px] font-medium uppercase tracking-widest text-admin-muted">Discrepancy (abs)</p>
            <p className={cn('mt-2 text-xl font-bold tabular-nums', Math.abs(discrepancy) === 0 ? 'text-emerald-400' : 'text-amber-400')}>
              {fmt(Math.abs(discrepancy))}
            </p>
            <p className="mt-0.5 text-[10px] text-admin-muted">raw units</p>
          </div>
          <div className="rounded-xl border border-admin-border/60 bg-admin-card p-4">
            <p className="text-[10px] font-medium uppercase tracking-widest text-admin-muted">Discrepancy %</p>
            <p className={cn('mt-2 text-xl font-bold tabular-nums', Math.abs(discrepancyPct) < 1 ? 'text-emerald-400' : 'text-amber-400')}>
              {discrepancyPct.toFixed(3)}%
            </p>
            <p className="mt-0.5 text-[10px] text-admin-muted">threshold: 1%</p>
          </div>
          <div className="rounded-xl border border-admin-border/60 bg-admin-card p-4">
            <p className="text-[10px] font-medium uppercase tracking-widest text-admin-muted">Overall Status</p>
            <div className="mt-2">
              {!dataAvailable ? (
                <Badge variant="default">No Data</Badge>
              ) : isHealthy ? (
                <Badge variant="success">Reconciled</Badge>
              ) : (
                <Badge variant="warning">Discrepancy</Badge>
              )}
            </div>
            <p className="mt-0.5 text-[10px] text-admin-muted">computed from live data</p>
          </div>
        </div>
      )}

      {/* ── Per-chain reconciliation (from /treasury/reconciliation) ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Balance Detail</CardTitle>
            {reconLastChecked && (
              <span className="flex items-center gap-1 text-[10px] text-admin-muted">
                <Clock className="h-3 w-3" />Last checked: {fmtTs(reconLastChecked)}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-admin-border/60">
                  <th className="pb-2.5 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-admin-muted">Category</th>
                  <th className="pb-2.5 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-admin-muted">Balance</th>
                  <th className="pb-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-admin-muted">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-admin-border/40">
                  <td className="py-3 pr-4 text-admin-text">Hot Wallets (on-chain)</td>
                  <td className="py-3 pr-4 font-mono tabular-nums">
                    {tLoading ? <span className="inline-block h-4 w-20 animate-pulse rounded bg-white/[0.06]" /> : fmt(hotTotal)}
                  </td>
                  <td className="py-3">
                    {tLoading
                      ? <span className="inline-block h-5 w-16 animate-pulse rounded bg-white/[0.06]" />
                      : tError
                      ? <Badge variant="danger" size="sm">API Error</Badge>
                      : <Badge variant="default" size="sm">Loaded</Badge>}
                  </td>
                </tr>
                <tr className="border-b border-admin-border/40">
                  <td className="py-3 pr-4 text-admin-text">Cold Storage (on-chain)</td>
                  <td className="py-3 pr-4 font-mono tabular-nums">
                    {tLoading ? <span className="inline-block h-4 w-20 animate-pulse rounded bg-white/[0.06]" /> : coldTotal > 0 ? fmt(coldTotal) : <span className="text-admin-muted">not configured</span>}
                  </td>
                  <td className="py-3">
                    {tLoading
                      ? <span className="inline-block h-5 w-16 animate-pulse rounded bg-white/[0.06]" />
                      : tError
                      ? <Badge variant="danger" size="sm">API Error</Badge>
                      : coldTotal > 0
                      ? <Badge variant="default" size="sm">Loaded</Badge>
                      : <Badge variant="default" size="sm">No Data</Badge>}
                  </td>
                </tr>
                <tr className="border-b border-admin-border/40">
                  <td className="py-3 pr-4 text-admin-text">User Balances (Ledger)</td>
                  <td className="py-3 pr-4 font-mono tabular-nums">
                    {fLoading ? <span className="inline-block h-4 w-20 animate-pulse rounded bg-white/[0.06]" /> : fmt(userTotal)}
                  </td>
                  <td className="py-3">
                    {fLoading
                      ? <span className="inline-block h-5 w-16 animate-pulse rounded bg-white/[0.06]" />
                      : fError
                      ? <Badge variant="danger" size="sm">API Error</Badge>
                      : <Badge variant="default" size="sm">Loaded</Badge>}
                  </td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-semibold text-admin-text">Net Discrepancy</td>
                  <td className={cn('py-3 pr-4 font-mono font-semibold tabular-nums', !bothLoaded ? 'text-admin-muted' : Math.abs(discrepancy) === 0 ? 'text-emerald-400' : 'text-amber-400')}>
                    {!bothLoaded ? <span className="inline-block h-4 w-20 animate-pulse rounded bg-white/[0.06]" /> : fmt(Math.abs(discrepancy))}
                  </td>
                  <td className="py-3">
                    {!bothLoaded
                      ? <span className="inline-block h-5 w-16 animate-pulse rounded bg-white/[0.06]" />
                      : <Badge variant={isHealthy ? 'success' : 'warning'} size="sm">{isHealthy ? 'Within threshold' : 'Exceeds 1%'}</Badge>}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ⚠ Currency note */}
          <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-950/10 px-3 py-2.5 text-xs text-amber-300/80">
            <strong>Note:</strong> On-chain balances are in raw units (may be mixed assets/chains). Ledger total is the sum of all user balances in ledger units. Direct numeric comparison is an approximation — not a USD-denominated audit. Use the{' '}
            <Link href="/treasury" className="underline hover:text-amber-200">Treasury</Link> page for per-chain detail.
          </div>
        </CardContent>
      </Card>

      {/* ── Per-chain mismatches from /treasury/reconciliation ── */}
      {hasReconData && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>On-chain vs DB Reconciliation</CardTitle>
              {reconMatched !== undefined && (
                <Badge variant={reconMatched ? 'success' : 'warning'} size="sm">
                  {reconMatched ? 'All chains matched' : `${reconMismatches.length} mismatch${reconMismatches.length !== 1 ? 'es' : ''}`}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {reconLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => <div key={i} className="h-10 w-full animate-pulse rounded-lg bg-white/[0.04]" />)}
              </div>
            ) : reconMismatches.length === 0 ? (
              <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <div>
                  <p className="text-sm font-semibold text-emerald-300">All chains reconciled</p>
                  <p className="text-xs text-admin-muted">On-chain balances match database records for all active chains.</p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-admin-border/60">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-admin-border/60">
                      {['Chain', 'On-chain Balance', 'DB Balance', 'Difference'].map((h) => (
                        <th key={h} className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-admin-muted bg-white/[0.015]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reconMismatches.map((m, i) => (
                      <tr key={i} className="border-t border-admin-border/40 hover:bg-white/[0.015]">
                        <td className="px-3 py-2.5 font-mono font-semibold text-admin-text">{m.chain}</td>
                        <td className="px-3 py-2.5 font-mono tabular-nums">{m.onChainBalance}</td>
                        <td className="px-3 py-2.5 font-mono tabular-nums">{m.dbBalance}</td>
                        <td className="px-3 py-2.5 font-mono font-semibold text-amber-400">{m.diff}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </AdminPageFrame>
  );
}
