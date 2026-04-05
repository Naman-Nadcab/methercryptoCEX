'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getMarketBySymbol, getMarketFeeHistory } from '@/lib/markets-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatCard } from '@/components/dashboard/StatCard';
import { MarketStatusBadge } from '@/components/markets/MarketStatusBadge';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DetailSkeleton } from '@/components/ui';
import { useAdminWs } from '@/hooks/useAdminWs';
import { ArrowLeft, DollarSign, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/cn';

function formatDate(s: string | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function formatVolume(value: string | number | undefined): string {
  if (value == null || value === '') return '—';
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

type MarketDetailTab = 'overview' | 'fee-history';

export default function MarketDetailPage() {
  const params = useParams();
  const symbol = typeof params?.symbol === 'string' ? params.symbol : '';
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<MarketDetailTab>('overview');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'market', symbol, token],
    queryFn: () => getMarketBySymbol(token, symbol),
    enabled: !!token && !!symbol,
  });

  const { data: feeHistoryData } = useQuery({
    queryKey: ['admin', 'market', symbol, 'fee-history', token],
    queryFn: () => getMarketFeeHistory(token, symbol),
    enabled: !!token && !!symbol && activeTab === 'fee-history',
  });

  useAdminWs({
    onEvent: (ev) => {
      const t = (ev?.type as string) ?? '';
      const evSymbol = (ev?.data as { symbol?: string })?.symbol ?? (ev?.payload as { symbol?: string })?.symbol;
      if (['market_created', 'market_updated', 'market_halted'].includes(t)) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'markets'] });
        if (evSymbol === symbol || !evSymbol) {
          queryClient.invalidateQueries({ queryKey: ['admin', 'market', symbol] });
        }
      }
    },
  });

  const payload = data?.data;
  const market = payload?.market as Record<string, unknown> | undefined;
  const orderbook = payload?.orderbook as {
    bids: Array<{ price: string; quantity: string }>;
    asks: Array<{ price: string; quantity: string }>;
    spread_pct: number | null;
    depth: string;
    spread_health?: string;
    low_liquidity?: boolean;
  } | undefined;
  const recentTrades = (payload?.recent_trades ?? []) as Array<{
    id: string;
    market?: string;
    side: string;
    price: string;
    quantity: string;
    fee?: string;
    created_at: string;
  }>;
  const volume24h = payload?.volume_24h as string | undefined;
  const trades24h = payload?.trades_24h as number | undefined;
  const spreadHealth = (payload?.spread_health ?? orderbook?.spread_health) as string | undefined;
  const lowLiquidity = (payload?.low_liquidity ?? orderbook?.low_liquidity) as boolean | undefined;
  const feeHistory = (feeHistoryData?.data?.fee_history ?? []) as Array<{ date: string; maker_fee: number | null; taker_fee: number | null; admin_email: string | null }>;

  if (!symbol) {
    return (
      <div className="space-y-5">
        <p className="text-admin-muted">Missing market symbol.</p>
        <Link href="/markets">
          <Button variant="secondary">Back to Markets</Button>
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-5">
        <DetailSkeleton rows={8} />
      </div>
    );
  }

  if (isError || !market) {
    return (
      <div className="space-y-5">
        <p className="text-admin-muted">Market not found.</p>
        <Link href="/markets">
          <Button variant="secondary">Back to Markets</Button>
        </Link>
      </div>
    );
  }

  const displaySymbol =
    market.base_asset && market.quote_asset
      ? `${market.base_asset}/${market.quote_asset}`
      : String(market.symbol ?? symbol).replace(/_/g, '/');

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <Link href="/markets">
          <Button variant="secondary" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-admin-text">{displaySymbol}</h1>
          <p className="text-xs text-admin-muted mt-0.5">Market details</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          title="24h Volume"
          value={formatVolume(volume24h)}
          icon={DollarSign}
          iconBg="bg-admin-primary/10 text-admin-primary"
        />
        <StatCard
          title="24h Trades"
          value={trades24h ?? '—'}
          icon={BarChart3}
          iconBg="bg-green-100 text-admin-success"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {spreadHealth && spreadHealth !== '—' && (
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-admin-muted">Spread Health</span>
            <Badge
              variant={
                spreadHealth === 'Good' ? 'success' : spreadHealth === 'Medium' ? 'warning' : 'danger'
              }
            >
              {spreadHealth}
            </Badge>
          </div>
        )}
        {lowLiquidity && (
          <Badge variant="warning">Low Liquidity</Badge>
        )}
      </div>

      <div className="border-b border-admin-border">
        <nav className="flex gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={cn(
              'border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              activeTab === 'overview'
                ? 'border-admin-primary text-admin-primary'
                : 'border-transparent text-admin-muted hover:border-admin-border hover:text-admin-text'
            )}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('fee-history')}
            className={cn(
              'border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              activeTab === 'fee-history'
                ? 'border-admin-primary text-admin-primary'
                : 'border-transparent text-admin-muted hover:border-admin-border hover:text-admin-text'
            )}
          >
            Fee History
          </button>
        </nav>
      </div>

      {activeTab === 'fee-history' && (
        <Card>
          <CardHeader>
            <CardTitle>Fee History</CardTitle>
            <p className="text-sm text-admin-muted">Past fee changes from audit logs.</p>
          </CardHeader>
          <CardContent>
            {feeHistory.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-admin-border text-admin-muted">
                      <th className="pb-2 pr-4">Date</th>
                      <th className="pb-2 pr-4">Maker Fee</th>
                      <th className="pb-2 pr-4">Taker Fee</th>
                      <th className="pb-2">Admin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feeHistory.map((row, i) => (
                      <tr key={i} className="border-b border-admin-border last:border-0">
                        <td className="py-2 pr-4">{formatDate(row.date)}</td>
                        <td className="py-2 pr-4">
                          {row.maker_fee != null ? `${(row.maker_fee * 100).toFixed(2)}%` : '—'}
                        </td>
                        <td className="py-2 pr-4">
                          {row.taker_fee != null ? `${(row.taker_fee * 100).toFixed(2)}%` : '—'}
                        </td>
                        <td className="py-2">{row.admin_email ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-admin-muted">No fee history recorded.</p>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'overview' && (
        <>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Market stats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-admin-muted">Base / Quote</span>
              <span className="font-medium">{String(market.base_asset ?? '—')} / {String(market.quote_asset ?? '—')}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-admin-muted">Status</span>
              <MarketStatusBadge
                status={market.status as string}
                is_active={market.is_active as boolean}
                trading_enabled={market.trading_enabled as boolean}
              />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-admin-muted">Maker fee</span>
              <span>
                {market.maker_fee != null
                  ? `${(parseFloat(String(market.maker_fee)) * 100).toFixed(2)}%`
                  : '—'}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-admin-muted">Taker fee</span>
              <span>
                {market.taker_fee != null
                  ? `${(parseFloat(String(market.taker_fee)) * 100).toFixed(2)}%`
                  : '—'}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-admin-muted">Price / Qty precision</span>
              <span>{Number(market.price_precision ?? '—')} / {Number(market.qty_precision ?? '—')}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-admin-muted">Created</span>
              <span>{formatDate(market.created_at as string)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Orderbook snapshot</CardTitle>
            {orderbook && (
              <p className="text-sm text-admin-muted">
                Spread: {orderbook.spread_pct != null ? `${orderbook.spread_pct}%` : '—'} · Depth: {orderbook.depth ?? '—'}
              </p>
            )}
          </CardHeader>
          <CardContent>
            {orderbook && (orderbook.bids?.length > 0 || orderbook.asks?.length > 0) ? (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="mb-2 font-medium text-green-700">Bids</p>
                  <div className="space-y-1">
                    {(orderbook.bids ?? []).slice(0, 10).map((b, i) => (
                      <div key={i} className="flex justify-between font-mono">
                        <span>{b.price}</span>
                        <span className="text-admin-muted">{b.quantity}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 font-medium text-red-700">Asks</p>
                  <div className="space-y-1">
                    {(orderbook.asks ?? []).slice(0, 10).map((a, i) => (
                      <div key={i} className="flex justify-between font-mono">
                        <span>{a.price}</span>
                        <span className="text-admin-muted">{a.quantity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-admin-muted">No orderbook data.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent trades</CardTitle>
        </CardHeader>
        <CardContent>
          {recentTrades.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-admin-border text-admin-muted">
                    <th className="pb-2 pr-4">Side</th>
                    <th className="pb-2 pr-4">Price</th>
                    <th className="pb-2 pr-4">Quantity</th>
                    <th className="pb-2 pr-4">Fee</th>
                    <th className="pb-2">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTrades.map((t) => (
                    <tr key={t.id} className="border-b border-admin-border last:border-0">
                      <td className="py-2 pr-4">
                        <span className={t.side?.toLowerCase() === 'buy' ? 'text-green-600' : 'text-red-600'}>
                          {t.side ?? '—'}
                        </span>
                      </td>
                      <td className="py-2 pr-4 font-mono">{t.price ?? '—'}</td>
                      <td className="py-2 pr-4 font-mono">{t.quantity ?? '—'}</td>
                      <td className="py-2 pr-4">{t.fee ?? '—'}</td>
                      <td className="py-2">{formatDate(t.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-admin-muted">No recent trades.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Liquidity depth</CardTitle>
          {orderbook && (
            <p className="text-sm text-admin-muted">
              Depth rating: {orderbook.depth ?? '—'}
              {orderbook.spread_pct != null && ` · Spread ${orderbook.spread_pct}%`}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {orderbook && (orderbook.bids?.length > 0 || orderbook.asks?.length > 0) ? (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="mb-2 font-medium text-admin-muted">Top bids (qty)</p>
                <div className="space-y-1 font-mono">
                  {(orderbook.bids ?? []).slice(0, 5).map((b, i) => (
                    <div key={i}>{b.quantity}</div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 font-medium text-admin-muted">Top asks (qty)</p>
                <div className="space-y-1 font-mono">
                  {(orderbook.asks ?? []).slice(0, 5).map((a, i) => (
                    <div key={i}>{a.quantity}</div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-admin-muted">No liquidity data.</p>
          )}
        </CardContent>
      </Card>
        </>
      )}
    </div>
  );
}
