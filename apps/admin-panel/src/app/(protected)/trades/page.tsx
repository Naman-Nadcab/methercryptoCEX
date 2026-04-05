'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LineChart } from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import { getTradingTrades, getTradingOverview, type TradeRow } from '@/lib/trading-api';
import { cn } from '@/lib/cn';
import { useAdminWs } from '@/hooks/useAdminWs';
import { Card, CardContent } from '@/components/ui/Card';
import { CardHeader, CardTitle, Button, Badge, Input, Select, TableSkeleton } from '@/components/ui';

const PAGE_SIZE = 20;

const SIDE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
];

function formatNum(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function formatTime(s: string | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function toIsoBoundary(local: string, endOfDay?: boolean): string | undefined {
  const t = local?.trim();
  if (!t) return undefined;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return undefined;
  if (endOfDay && t.length <= 10) {
    d.setHours(23, 59, 59, 999);
  }
  return d.toISOString();
}

export default function TradesPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  useAdminWs({
    onEvent: (event) => {
      const type = (event?.type as string) ?? '';
      if (type === 'trade_executed') {
        queryClient.invalidateQueries({ queryKey: ['admin', 'trades-page'] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'trading'] });
      }
    },
  });
  const [page, setPage] = useState(1);
  const [market, setMarket] = useState('');
  const [side, setSide] = useState('all');
  const [fromLocal, setFromLocal] = useState('');
  const [toLocal, setToLocal] = useState('');

  const fromIso = useMemo(() => toIsoBoundary(fromLocal), [fromLocal]);
  const toIso = useMemo(() => toIsoBoundary(toLocal, true), [toLocal]);

  useEffect(() => {
    setPage(1);
  }, [market, side, fromLocal, toLocal]);

  const { data: overviewData } = useQuery({
    queryKey: ['admin', 'trading', 'overview', token],
    queryFn: () => getTradingOverview(token),
    enabled: !!token,
    staleTime: 30000,
  });
  const ts = overviewData?.data?.tradeStats as Record<string, any> | undefined;

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ['admin', 'trades-page', token, page, market, side, fromIso, toIso],
    staleTime: 30_000,
    queryFn: () =>
      getTradingTrades(token, {
        page,
        limit: PAGE_SIZE,
        market: market.trim() || undefined,
        side: side === 'all' ? undefined : side,
        from: fromIso,
        to: toIso,
      }),
    enabled: !!token,
    refetchInterval: 15_000,
  });

  const payload = data?.data;
  const trades = (payload?.trades ?? []) as TradeRow[];
  const pagination = payload?.pagination;
  const totalPages = Math.max(1, pagination?.totalPages ?? 1);
  const total = pagination?.total ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-admin-text">Trade History</h1>
        <p className="text-xs text-admin-muted mt-0.5">Executed trades with filters, pagination, and 15s auto-refresh.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-3 px-3">
            <p className="text-[10px] uppercase tracking-wider text-admin-muted font-medium">Trades (24h)</p>
            <p className="text-lg font-bold text-admin-text tabular-nums">{ts?.trades_24h ?? '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-3">
            <p className="text-[10px] uppercase tracking-wider text-admin-muted font-medium">Volume (24h)</p>
            <p className="text-lg font-bold text-admin-text tabular-nums">
              {ts?.volume_24h ? `$${Number(ts.volume_24h).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-3">
            <p className="text-[10px] uppercase tracking-wider text-admin-muted font-medium">Largest Trade</p>
            <p className="text-lg font-bold text-admin-text tabular-nums">
              {ts?.largest_trade_usd
                ? `$${Number(ts.largest_trade_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-3">
            <p className="text-[10px] uppercase tracking-wider text-admin-muted font-medium">Avg Trade Size</p>
            <p className="text-lg font-bold text-admin-text tabular-nums">
              {ts?.avg_trade_size
                ? `$${Number(ts.avg_trade_size).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full min-w-[160px] sm:w-48">
          <Input label="Market" placeholder="e.g. BTC_USDT" value={market} onChange={(e) => setMarket(e.target.value)} />
        </div>
        <div className="w-full min-w-[120px] sm:w-36">
          <Select label="Side" size="sm" value={side} onChange={setSide} options={[...SIDE_OPTIONS]} />
        </div>
        <div className="w-full min-w-[180px] sm:w-52">
          <Input
            type="datetime-local"
            label="From"
            value={fromLocal}
            onChange={(e) => setFromLocal(e.target.value)}
          />
        </div>
        <div className="w-full min-w-[180px] sm:w-52">
          <Input type="datetime-local" label="To" value={toLocal} onChange={(e) => setToLocal(e.target.value)} />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Trades</CardTitle>
            {isFetching && !isLoading && (
              <span className="text-xs text-admin-muted">Refreshing…</span>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto rounded-ds-md border border-admin-border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-white/[0.02] text-xs font-medium uppercase tracking-wide text-admin-muted">
                <tr>
                  {['Trade ID', 'Market', 'Buyer', 'Seller', 'Price', 'Quantity', 'Fee', 'Side', 'Time'].map((h) => (
                    <th key={h} className="px-3 py-2.5 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-admin-border bg-admin-card">
                {isLoading && (
                  <tr>
                    <td colSpan={9} className="p-0">
                      <TableSkeleton rows={8} cols={6} />
                    </td>
                  </tr>
                )}
                {!isLoading && isError && (
                  <tr>
                    <td colSpan={9} className="px-3 py-12 text-center text-admin-danger">
                      Failed to load trades.
                    </td>
                  </tr>
                )}
                {!isLoading && !isError && trades.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-12 text-center text-admin-muted">
                      No trades match the current filters.
                    </td>
                  </tr>
                )}
                {!isLoading &&
                  !isError &&
                  trades.map((trow) => {
                    const who = trow.user_email ?? trow.user_id ?? '—';
                    const isBuy = String(trow.side).toLowerCase() === 'buy';
                    const feeStr =
                      trow.fee != null && trow.fee !== ''
                        ? `${formatNum(trow.fee)}${trow.fee_asset ? ` ${trow.fee_asset}` : ''}`
                        : '—';
                    return (
                      <tr
                        key={trow.trade_id}
                        className={cn('hover:bg-white/5', trow.is_whale_trade && 'bg-amber-50/25')}
                      >
                        <td className="px-3 py-2 font-mono text-xs">{trow.trade_id}</td>
                        <td className="px-3 py-2">{trow.market ?? '—'}</td>
                        <td className="px-3 py-2 text-admin-text">{isBuy ? who : '—'}</td>
                        <td className="px-3 py-2 text-admin-text">{!isBuy ? who : '—'}</td>
                        <td className="px-3 py-2 tabular-nums">{formatNum(trow.price)}</td>
                        <td className="px-3 py-2 tabular-nums">{formatNum(trow.amount)}</td>
                        <td className="px-3 py-2 tabular-nums text-xs">{feeStr}</td>
                        <td className="px-3 py-2">
                          <Badge variant={isBuy ? 'success' : 'danger'} size="sm">
                            {String(trow.side ?? '').toUpperCase() || '—'}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-admin-muted text-xs">{formatTime(trow.created_at)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-admin-muted">
              Page {pagination?.page ?? page} of {totalPages} · {total.toLocaleString()} trades
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
