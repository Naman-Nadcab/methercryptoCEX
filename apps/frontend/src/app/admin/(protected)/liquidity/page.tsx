'use client';

import { useState, useMemo } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getSettingsTradingPairs, getOrderbookIntelligence } from '@/lib/admin';
import {
  useLiquidity,
  useOrderbookIntelligence,
  useSpotOrderbook,
} from '@/hooks/admin/useAdminDashboard';
import {
  LiquidityHeatmap,
  OrderbookDepthChart,
} from '@/components/admin/v2/dashboard';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, AlertTriangle } from 'lucide-react';
import type { LiquidityHeatmapRow } from '@/components/admin/v2/dashboard/LiquidityHeatmap';

const HEATMAP_SYMBOLS = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'BNB_USDT', 'XRP_USDT'];
const IMBALANCE_ALERT_THRESHOLD = 0.25;

/** Panel wrapper matching RiskSecurityPanel styling */
function LiquidityPanel({
  title,
  subtitle,
  children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--admin-radius)] border border-[var(--admin-card-border)] bg-white p-4 shadow-[var(--admin-shadow)]">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-[var(--admin-text)]">{title}</h3>
        {subtitle && <p className="text-xs text-[var(--admin-text-muted)] mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export default function LiquidityMonitoringPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const [selectedSymbol, setSelectedSymbol] = useState('ETH_USDT');

  const { data: liquidityData, isLoading: liquidityLoading } = useLiquidity('24h');
  const { data: obIntelData } = useOrderbookIntelligence(selectedSymbol);
  const { data: pairsData } = useQuery({
    queryKey: ['admin', 'settings', 'trading-pairs', token],
    queryFn: () => getSettingsTradingPairs(token, { limit: 100 }),
    enabled: !!token,
  });
  const { data: orderbookData } = useSpotOrderbook(selectedSymbol, 30);

  const intelQueries = useQueries({
    queries: HEATMAP_SYMBOLS.map((sym) => ({
      queryKey: ['admin', 'orderbook-intelligence', sym, token],
      queryFn: () => getOrderbookIntelligence(token, sym),
      enabled: !!token,
    })),
  });

  const byMarket = (liquidityData?.data?.by_market ?? []) as Array<{ market: string; volume: number }>;
  const pairsRaw = (pairsData?.data as { trading_pairs?: Array<{ symbol?: string; base_symbol?: string; quote_symbol?: string }> })?.trading_pairs ?? [];
  const symbolOptions = useMemo(() => {
    const list = pairsRaw.length > 0
      ? pairsRaw.map((p) => (p.symbol ?? `${p.base_symbol ?? ''}_${p.quote_symbol ?? 'USDT'}`).replace(/-/g, '_'))
      : HEATMAP_SYMBOLS;
    return Array.from(new Set(list)).slice(0, 20);
  }, [pairsRaw]);

  const obIntel = obIntelData?.data;
  const orderbook = orderbookData?.data;

  const topProvidersData = byMarket.slice(0, 10).map((m) => ({
    name: m.market,
    volume: Number(m.volume) || 0,
  }));

  const heatmapRows: LiquidityHeatmapRow[] = useMemo(() => {
    const rows: LiquidityHeatmapRow[] = [];
    intelQueries.forEach((q, i) => {
      const data = q.data?.data;
      if (!data) return;
      const total = (data.bidDepth ?? 0) + (data.askDepth ?? 0);
      const bidPct = total > 0 ? ((data.bidDepth ?? 0) / total) * 100 : 50;
      const askPct = total > 0 ? ((data.askDepth ?? 0) / total) * 100 : 50;
      const spreadPct = (data.spreadBps ?? 0) / 100;
      rows.push({
        pair: (data.symbol ?? HEATMAP_SYMBOLS[i]).replace(/_/g, '/'),
        bid: bidPct,
        ask: askPct,
        spread: spreadPct,
      });
    });
    return rows.length > 0 ? rows : [];
  }, [intelQueries]);

  const imbalanceAlerts = useMemo(() => {
    const alerts: { symbol: string; imbalance: number }[] = [];
    intelQueries.forEach((q, i) => {
      const data = q.data?.data;
      if (!data || Math.abs(data.imbalance ?? 0) < IMBALANCE_ALERT_THRESHOLD) return;
      alerts.push({
        symbol: (data.symbol ?? HEATMAP_SYMBOLS[i]).replace(/_/g, '/'),
        imbalance: data.imbalance ?? 0,
      });
    });
    return alerts;
  }, [intelQueries]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--admin-text)]">Liquidity Monitoring</h1>
        <p className="text-sm text-[var(--admin-text-muted)] mt-0.5">
          Heatmap, orderbook depth, top liquidity providers, and imbalance alerts
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="symbol-select" className="text-sm font-medium text-[var(--admin-text)]">
          Pair
        </label>
        <select
          id="symbol-select"
          value={selectedSymbol}
          onChange={(e) => setSelectedSymbol(e.target.value)}
          className="rounded-lg border border-[var(--admin-card-border)] bg-[var(--admin-card-bg)] px-3 py-1.5 text-sm text-[var(--admin-text)] min-w-[140px]"
        >
          {symbolOptions.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, '/')}</option>
          ))}
        </select>
      </div>

      {/* Row 1 – Liquidity heatmap (current symbol) + Orderbook depth */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LiquidityPanel title="Liquidity heatmap" subtitle="Bid/ask depth and spread for selected pair">
          {liquidityLoading && byMarket.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-[var(--admin-primary)] animate-spin" />
            </div>
          ) : heatmapRows.length > 0 ? (
            <LiquidityHeatmap data={heatmapRows} />
          ) : (
            <LiquidityHeatmap />
          )}
        </LiquidityPanel>
        <LiquidityPanel title="Orderbook depth" subtitle={`Bid vs ask depth — ${selectedSymbol.replace(/_/g, '/')}`}>
          {obIntel ? (
            <OrderbookDepthChart
              bidDepth={obIntel.bidDepth ?? 0}
              askDepth={obIntel.askDepth ?? 0}
              symbol={obIntel.symbol}
              height={220}
            />
          ) : (
            <div className="flex items-center justify-center py-12 text-sm text-[var(--admin-text-muted)]">
              Select a pair or wait for data
            </div>
          )}
        </LiquidityPanel>
      </section>

      {/* Row 2 – Top liquidity providers (bar chart) */}
      <LiquidityPanel title="Top liquidity providers" subtitle="24h volume by market">
        {topProvidersData.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-[var(--admin-text-muted)]">
            No volume data
          </div>
        ) : (
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topProvidersData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fill: 'var(--admin-text-muted)' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--admin-text-muted)' }}
                  tickLine={false}
                  tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v))}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--admin-card-bg)',
                    border: '1px solid var(--admin-card-border)',
                    borderRadius: 'var(--admin-radius)',
                  }}
                  formatter={(value: number) => [value.toLocaleString(), 'Volume']}
                />
                <Bar dataKey="volume" fill="var(--admin-primary)" radius={[4, 4, 0, 0]} name="Volume" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </LiquidityPanel>

      {/* Row 3 – Liquidity imbalance alerts */}
      <LiquidityPanel
        title="Liquidity imbalance alerts"
        subtitle={`Symbols with |imbalance| ≥ ${IMBALANCE_ALERT_THRESHOLD * 100}%`}
      >
        {imbalanceAlerts.length === 0 ? (
          <p className="text-sm text-[var(--admin-text-muted)] py-4">No liquidity imbalance alerts (|imbalance| &lt; {IMBALANCE_ALERT_THRESHOLD * 100}%).</p>
        ) : (
          <ul className="space-y-2">
            {imbalanceAlerts.map((a) => (
              <li
                key={a.symbol}
                className="flex items-center gap-2 py-2 px-3 rounded-lg bg-[var(--admin-warning)]/10 border border-[var(--admin-warning)]/30"
              >
                <AlertTriangle className="w-4 h-4 text-[var(--admin-warning)] shrink-0" />
                <span className="text-sm font-medium text-[var(--admin-text)]">{a.symbol}</span>
                <span className="text-sm tabular-nums text-[var(--admin-text-muted)]">
                  Imbalance: {(a.imbalance * 100).toFixed(1)}%
                  {a.imbalance > 0 ? ' (bid-heavy)' : ' (ask-heavy)'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </LiquidityPanel>

      {/* Optional: raw orderbook depth table for selected symbol */}
      {orderbook && (orderbook.bids?.length > 0 || orderbook.asks?.length > 0) && (
        <LiquidityPanel
          title="Orderbook levels"
          subtitle={`${selectedSymbol.replace(/_/g, '/')} — top 10 bid/ask`}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h4 className="font-medium text-[var(--admin-success)] mb-2">Bids</h4>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {(orderbook.bids ?? []).slice(0, 10).map((b: { price: string; quantity: string }, i: number) => (
                  <div key={i} className="flex justify-between font-mono text-xs">
                    <span className="text-[var(--admin-text)]">{b.price}</span>
                    <span className="text-[var(--admin-text-muted)]">{b.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="font-medium text-[var(--admin-danger)] mb-2">Asks</h4>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {(orderbook.asks ?? []).slice(0, 10).map((a: { price: string; quantity: string }, i: number) => (
                  <div key={i} className="flex justify-between font-mono text-xs">
                    <span className="text-[var(--admin-text)]">{a.price}</span>
                    <span className="text-[var(--admin-text-muted)]">{a.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </LiquidityPanel>
      )}
    </div>
  );
}
