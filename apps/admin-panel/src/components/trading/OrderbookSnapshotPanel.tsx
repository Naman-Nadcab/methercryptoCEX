'use client';

import { Card, CardContent } from '@/components/ui/Card';
import type { OrderbookSnapshot } from '@/lib/trading-api';

function formatNum(v: string | number): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

export interface OrderbookSnapshotPanelProps {
  data: OrderbookSnapshot | null;
  market: string;
  onMarketChange: (market: string) => void;
  marketOptions: string[];
  isLoading?: boolean;
}

export function OrderbookSnapshotPanel({
  data,
  market,
  onMarketChange,
  marketOptions,
  isLoading,
}: OrderbookSnapshotPanelProps) {
  const bids = data?.bids ?? [];
  const asks = data?.asks ?? [];
  const spreadPct = data?.spread_pct;
  const depth = data?.depth ?? '—';

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-lg font-semibold text-admin-text">Orderbook Snapshot</h2>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div>
            <label htmlFor="ob-market" className="block text-xs font-medium text-admin-muted">
              Market
            </label>
            <select
              id="ob-market"
              value={market}
              onChange={(e) => onMarketChange(e.target.value)}
              className="mt-1 rounded-lg border border-admin-border bg-admin-card px-3 py-2 text-sm text-admin-text"
            >
              {marketOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          {spreadPct != null && (
            <div className="rounded-lg border border-admin-border bg-admin-card/[0.02] px-3 py-2">
              <span className="text-xs font-medium text-admin-muted">Spread: </span>
              <span className="text-sm font-semibold text-admin-text">{spreadPct}%</span>
            </div>
          )}
          <div className="rounded-lg border border-admin-border bg-admin-card/[0.02] px-3 py-2">
            <span className="text-xs font-medium text-admin-muted">Depth: </span>
            <span className="text-sm font-semibold text-admin-text">{depth}</span>
          </div>
        </div>
        {isLoading ? (
          <div className="mt-4 py-8 text-center text-sm text-admin-muted">Loading orderbook…</div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium text-admin-success">Bids</h3>
              <div className="overflow-x-auto rounded-lg border border-admin-border">
                <table className="w-full min-w-[140px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-admin-border bg-white/[0.02]">
                      <th className="px-3 py-2 text-left font-medium text-admin-muted">Price</th>
                      <th className="px-3 py-2 text-right font-medium text-admin-muted">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bids.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="px-3 py-4 text-center text-admin-muted">
                          No bids
                        </td>
                      </tr>
                    ) : (
                      bids.map((b, i) => (
                        <tr key={i} className="border-b border-admin-border/60">
                          <td className="tabular-nums text-admin-success">{formatNum(b.price)}</td>
                          <td className="text-right tabular-nums">{formatNum(b.quantity)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium text-admin-danger">Asks</h3>
              <div className="overflow-x-auto rounded-lg border border-admin-border">
                <table className="w-full min-w-[140px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-admin-border bg-white/[0.02]">
                      <th className="px-3 py-2 text-left font-medium text-admin-muted">Price</th>
                      <th className="px-3 py-2 text-right font-medium text-admin-muted">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {asks.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="px-3 py-4 text-center text-admin-muted">
                          No asks
                        </td>
                      </tr>
                    ) : (
                      asks.map((a, i) => (
                        <tr key={i} className="border-b border-admin-border/60">
                          <td className="tabular-nums text-admin-danger">{formatNum(a.price)}</td>
                          <td className="text-right tabular-nums">{formatNum(a.quantity)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
