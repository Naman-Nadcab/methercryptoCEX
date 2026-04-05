'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import { getTradingMarkets, getTradingOrders, getTradingOverview, type OrderRow } from '@/lib/trading-api';
import { cn } from '@/lib/cn';
import { useAdminWs } from '@/hooks/useAdminWs';
import { Card, CardContent } from '@/components/ui/Card';
import { CardHeader, CardTitle, Button, Badge, Input, Select, TableSkeleton } from '@/components/ui';

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'FILLED', label: 'Filled' },
  { value: 'PARTIALLY_FILLED', label: 'Partially Filled' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const;

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

function statusBadgeVariant(status: string): 'default' | 'success' | 'warning' | 'danger' | 'info' {
  const u = (status ?? '').toUpperCase();
  if (u === 'FILLED') return 'success';
  if (u === 'OPEN' || u === 'NEW') return 'warning';
  if (u === 'PARTIALLY_FILLED') return 'info';
  if (u === 'CANCELLED' || u === 'REJECTED') return 'danger';
  return 'default';
}

export default function OrdersPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  useAdminWs({
    onEvent: (event) => {
      const type = (event?.type as string) ?? '';
      if (['order_created', 'order_cancelled', 'order_filled'].includes(type)) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'orders-page'] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'trading'] });
      }
    },
  });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('all');
  const [market, setMarket] = useState('');
  const [side, setSide] = useState('all');
  const [searchDraft, setSearchDraft] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchDraft.trim()), 400);
    return () => clearTimeout(t);
  }, [searchDraft]);

  useEffect(() => {
    setPage(1);
  }, [status, market, side, debouncedQ]);

  const { data: marketsRes } = useQuery({
    queryKey: ['admin', 'trading', 'markets', token],
    queryFn: () => getTradingMarkets(token),
    enabled: !!token,
    staleTime: 60_000,
  });

  const { data: overviewData } = useQuery({
    queryKey: ['admin', 'trading', 'overview', token],
    queryFn: () => getTradingOverview(token),
    enabled: !!token,
    staleTime: 30000,
  });
  const ov = overviewData?.data?.orderStats as Record<string, any> | undefined;

  const marketOptions = useMemo(() => {
    const rows = marketsRes?.data?.markets ?? [];
    const opts = rows.map((m) => ({ value: m.symbol, label: m.symbol }));
    return [{ value: '', label: 'All markets' }, ...opts];
  }, [marketsRes?.data?.markets]);

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ['admin', 'orders-page', token, page, status, market, side, debouncedQ],
    staleTime: 30_000,
    queryFn: () =>
      getTradingOrders(token, {
        page,
        limit: PAGE_SIZE,
        status: status === 'all' ? undefined : status,
        market: market || undefined,
        side: side === 'all' ? undefined : side,
        q: debouncedQ || undefined,
      }),
    enabled: !!token,
    refetchInterval: 15_000,
  });

  const payload = data?.data;
  const orders = (payload?.orders ?? []) as OrderRow[];
  const pagination = payload?.pagination;
  const totalPages = Math.max(1, pagination?.totalPages ?? 1);
  const total = pagination?.total ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-admin-text">Orders</h1>
        <p className="text-xs text-admin-muted mt-0.5">Spot orders with filters, pagination, and 15s auto-refresh.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-3 px-3">
            <p className="text-[10px] uppercase tracking-wider text-admin-muted font-medium">Open Orders</p>
            <p className="text-lg font-bold text-admin-text tabular-nums">{ov?.open ?? '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-3">
            <p className="text-[10px] uppercase tracking-wider text-admin-muted font-medium">Fill Rate</p>
            <p className="text-lg font-bold text-admin-text tabular-nums">
              {ov?.fill_rate != null ? `${Number(ov.fill_rate).toFixed(1)}%` : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-3">
            <p className="text-[10px] uppercase tracking-wider text-admin-muted font-medium">Avg Order Size</p>
            <p className="text-lg font-bold text-admin-text tabular-nums">
              {ov?.avg_size != null ? `$${Number(ov.avg_size).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-3">
            <p className="text-[10px] uppercase tracking-wider text-admin-muted font-medium">Cancel Rate</p>
            <p className="text-lg font-bold text-admin-text tabular-nums">
              {ov?.cancel_rate != null ? `${Number(ov.cancel_rate).toFixed(1)}%` : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full min-w-[140px] sm:w-40">
          <Select label="Status" size="sm" value={status} onChange={setStatus} options={[...STATUS_OPTIONS]} />
        </div>
        <div className="w-full min-w-[160px] sm:w-48">
          <Select label="Market" size="sm" value={market} onChange={setMarket} options={marketOptions} />
        </div>
        <div className="w-full min-w-[120px] sm:w-36">
          <Select label="Side" size="sm" value={side} onChange={setSide} options={[...SIDE_OPTIONS]} />
        </div>
        <div className="w-full min-w-[200px] sm:flex-1 sm:max-w-md">
          <Input
            label="Search"
            placeholder="Order ID or user email / ID"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
          />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Order book</CardTitle>
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
                  {['Order ID', 'User', 'Market', 'Side', 'Type', 'Price', 'Quantity', 'Filled', 'Status', 'Created'].map(
                    (h) => (
                      <th key={h} className="px-3 py-2.5 whitespace-nowrap">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-admin-border bg-admin-card">
                {isLoading && (
                  <tr>
                    <td colSpan={10} className="p-0">
                      <TableSkeleton rows={8} cols={7} />
                    </td>
                  </tr>
                )}
                {!isLoading && isError && (
                  <tr>
                    <td colSpan={10} className="px-3 py-12 text-center text-admin-danger">
                      Failed to load orders.
                    </td>
                  </tr>
                )}
                {!isLoading && !isError && orders.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-12 text-center text-admin-muted">
                      No orders match the current filters.
                    </td>
                  </tr>
                )}
                {!isLoading &&
                  !isError &&
                  orders.map((o) => (
                    <tr key={o.order_id} className="hover:bg-white/5">
                      <td className="px-3 py-2 font-mono text-xs">{o.order_id}</td>
                      <td className="px-3 py-2 text-admin-text">{o.user_email ?? o.user_id ?? '—'}</td>
                      <td className="px-3 py-2">{o.market ?? '—'}</td>
                      <td
                        className={cn(
                          'px-3 py-2 font-medium',
                          String(o.side).toLowerCase() === 'buy' ? 'text-admin-success' : 'text-admin-danger'
                        )}
                      >
                        {String(o.side ?? '').toUpperCase() || '—'}
                      </td>
                      <td className="px-3 py-2 capitalize">{o.order_type ? String(o.order_type).replace(/_/g, ' ') : '—'}</td>
                      <td className="px-3 py-2 tabular-nums">{formatNum(o.price)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatNum(o.amount)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatNum(o.filled)}</td>
                      <td className="px-3 py-2">
                        <Badge variant={statusBadgeVariant(o.status)} size="sm">
                          {String(o.status ?? '—').replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-admin-muted text-xs">{formatTime(o.created_at)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-admin-muted">
              Page {pagination?.page ?? page} of {totalPages} · {total.toLocaleString()} orders
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
