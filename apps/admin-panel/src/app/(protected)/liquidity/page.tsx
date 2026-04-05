'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Droplets } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { adminFetch } from '@/lib/api';
import { getLiquidityAnalytics, getLiquidityHistory } from '@/lib/analytics-api';
import { getControlStatus } from '@/lib/control-api';
import { useAdminAuthStore } from '@/store/auth';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button, Skeleton, TableSkeleton } from '@/components/ui';
import { useAdminWs } from '@/hooks/useAdminWs';

const REFETCH_MS = 30_000;

type LiquidityBotConfig = {
  enabled: boolean;
  spreadBps: number;
  orderSize: number;
  symbols: string[];
  apiKeyConfigured: boolean;
  apiKeyPreview: string | null;
};

function engineBadgeVariant(
  status: string | undefined
): 'success' | 'warning' | 'danger' | 'default' {
  const s = (status ?? '').toLowerCase();
  if (s.includes('up') || s === 'active' || s === 'running' || s === 'healthy') return 'success';
  if (s.includes('degraded') || s.includes('warn')) return 'warning';
  if (s.includes('down') || s.includes('stop') || s.includes('halt')) return 'danger';
  return 'default';
}

export default function LiquidityPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  useAdminWs({
    onEvent: (event) => {
      const type = (event?.type as string) ?? '';
      if (type === 'trade_executed') {
        queryClient.invalidateQueries({ queryKey: ['admin', 'analytics', 'liquidity'] });
      }
    },
  });

  const controlQ = useQuery({
    queryKey: ['admin', 'control', 'status', token],
    staleTime: 30_000,
    queryFn: () => getControlStatus(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const liqQ = useQuery({
    queryKey: ['admin', 'analytics', 'liquidity', token],
    staleTime: 30_000,
    queryFn: () => getLiquidityAnalytics(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const historyQ = useQuery({
    queryKey: ['admin', 'analytics', 'liquidity-history', token],
    staleTime: 30_000,
    queryFn: () => getLiquidityHistory(token),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const botQ = useQuery({
    queryKey: ['admin', 'liquidity-bot', 'config', token],
    staleTime: 30_000,
    queryFn: () => adminFetch<LiquidityBotConfig>('/liquidity-bot/config', { token }),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const rows = liqQ.data?.success ? liqQ.data.data?.liquidity ?? [] : [];
  const engine = controlQ.data?.success ? controlQ.data.data?.liquidity_engine_status : undefined;
  const bot = botQ.data?.success ? botQ.data.data : undefined;
  const historyData = historyQ.data;
  const historyRows = useMemo(() => {
    const raw = historyData?.data?.history ?? [];
    return (raw as Array<{ date: string; liquidity_score: number }>).map((d) => ({
      date: d.date?.slice(5, 10) ?? '',
      liquidity_score: d.liquidity_score ?? 0,
    }));
  }, [historyData]);

  const histLast = useMemo(() => {
    const h = historyData?.success ? historyData.data?.history ?? [] : [];
    return h.length ? h[h.length - 1] : null;
  }, [historyData]);

  const spreadScore = useMemo(() => {
    if (!rows.length) return null;
    const avgSpread = rows.reduce((a, r) => a + Number(r.spread_percent ?? 0), 0) / rows.length;
    const score = Math.max(0, Math.min(100, 100 - avgSpread));
    return { score: Math.round(score * 10) / 10, avgSpread: Math.round(avgSpread * 1000) / 1000 };
  }, [rows]);

  const loading =
    controlQ.isLoading || liqQ.isLoading || botQ.isLoading || historyQ.isLoading;
  const fetching =
    controlQ.isFetching || liqQ.isFetching || botQ.isFetching || historyQ.isFetching;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-admin-text">Liquidity</h1>
          <p className="text-xs text-admin-muted mt-0.5">Monitor spread scores, market liquidity, and bot configuration.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={fetching && !loading}
          onClick={() => {
            void controlQ.refetch();
            void liqQ.refetch();
            void historyQ.refetch();
            void botQ.refetch();
          }}
        >
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card compact>
          <CardContent className="space-y-2 p-0">
            <p className="text-xs font-medium uppercase tracking-wide text-admin-muted">Liquidity engine</p>
            {controlQ.isLoading ? (
              <Skeleton className="h-4 w-16" />
            ) : controlQ.data?.success === false ? (
              <p className="text-sm text-admin-danger">{controlQ.data.error?.message ?? 'Unavailable'}</p>
            ) : (
              <Badge variant={engineBadgeVariant(engine)}>{engine ?? 'Unknown'}</Badge>
            )}
          </CardContent>
        </Card>
        <Card compact>
          <CardContent className="space-y-2 p-0">
            <p className="text-xs font-medium uppercase tracking-wide text-admin-muted">Total spread score</p>
            {liqQ.isLoading ? (
              <Skeleton className="h-4 w-16" />
            ) : spreadScore == null ? (
              <p className="text-sm text-admin-muted">No market data.</p>
            ) : (
              <>
                <p className="text-2xl font-semibold tabular-nums text-admin-text">{spreadScore.score}</p>
                <p className="text-xs text-admin-muted">Weighted from avg spread {spreadScore.avgSpread}% across markets.</p>
                {histLast && (
                  <p className="text-xs text-admin-muted">
                    14d reference ({historyQ.data?.data?.market ?? '—'}): liquidity score {histLast.liquidity_score} on{' '}
                    {histLast.date}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
        <Card compact>
          <CardContent className="space-y-2 p-0">
            <p className="text-xs font-medium uppercase tracking-wide text-admin-muted">Active markets</p>
            {liqQ.isLoading ? (
              <Skeleton className="h-4 w-16" />
            ) : (
              <p className="text-2xl font-semibold tabular-nums text-admin-text">{rows.length}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Liquidity Score Trend (14d)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[220px]">
            {historyRows.length === 0 ? (
              <div className="flex h-full items-center justify-center text-admin-muted text-sm">No history data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={historyRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="liquidity_score" name="Score" stroke="#6366F1" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Liquidity by market</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {liqQ.isLoading ? (
            <div className="px-6 py-6">
              <TableSkeleton />
            </div>
          ) : liqQ.data?.success === false ? (
            <p className="px-6 py-10 text-center text-sm text-admin-danger">
              {liqQ.data.error?.message ?? 'Failed to load liquidity.'}
            </p>
          ) : rows.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-admin-muted">No liquidity rows returned.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-admin-border bg-white/[0.02] text-xs font-semibold uppercase tracking-wide text-admin-muted">
                    <th className="px-6 py-3">Market</th>
                    <th className="px-6 py-3">Spread %</th>
                    <th className="px-6 py-3">Orderbook depth</th>
                    <th className="px-6 py-3">Liquidity score</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.market} className="border-b border-admin-border last:border-0 hover:bg-white/5">
                      <td className="px-6 py-3 font-medium text-admin-text">{r.market}</td>
                      <td className="px-6 py-3 tabular-nums">{Number(r.spread_percent ?? 0).toFixed(3)}%</td>
                      <td className="px-6 py-3 tabular-nums">{Number(r.orderbook_depth ?? 0).toLocaleString()}</td>
                      <td className="px-6 py-3 tabular-nums">{Number(r.liquidity_score ?? 0).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Liquidity bot configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {botQ.isLoading ? (
            <Skeleton className="h-4 w-16" />
          ) : botQ.data?.success === false ? (
            <p className="text-admin-danger">{botQ.data.error?.message ?? 'Config unavailable.'}</p>
          ) : !bot ? (
            <p className="text-admin-muted">No configuration returned.</p>
          ) : (
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase text-admin-muted">Enabled</dt>
                <dd className="mt-1 font-medium text-admin-text">{bot.enabled ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-admin-muted">Spread (bps)</dt>
                <dd className="mt-1 font-mono text-admin-text">{bot.spreadBps}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-admin-muted">Order size</dt>
                <dd className="mt-1 font-mono text-admin-text">{bot.orderSize}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-admin-muted">API key</dt>
                <dd className="mt-1 font-mono text-xs text-admin-text">
                  {bot.apiKeyConfigured ? bot.apiKeyPreview ?? 'Configured' : 'Not configured'}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase text-admin-muted">Symbols</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {bot.symbols?.length ? (
                    bot.symbols.map((s) => (
                      <Badge key={s} variant="default" className="text-[10px]">
                        {s}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-admin-muted">—</span>
                  )}
                </dd>
              </div>
            </dl>
          )}
          <p className="text-xs text-admin-muted pt-2 border-t border-admin-border">Read-only view of server configuration.</p>
        </CardContent>
      </Card>
    </div>
  );
}
