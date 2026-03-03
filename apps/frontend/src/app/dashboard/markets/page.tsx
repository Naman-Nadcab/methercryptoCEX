'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useReferencePrice } from '@/hooks/useReferencePrice';
import { EmptyState } from '@/components/ui/EmptyState';
import { BarChart3 } from 'lucide-react';

type Market = { id: string; symbol: string; base_asset: string; quote_asset: string };

function MarketsTableSkeleton() {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-white/10 text-left text-xs text-gray-500 uppercase tracking-wider">
          <th className="py-3 px-3 font-medium">Pair</th>
          <th className="py-3 px-3 font-medium text-right">Last Price</th>
          <th className="py-3 px-3 font-medium text-right">24h Change</th>
          <th className="py-3 px-3 font-medium text-right">24h High</th>
          <th className="py-3 px-3 font-medium text-right">24h Low</th>
          <th className="py-3 px-3 font-medium text-right">Action</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: 8 }).map((_, i) => (
          <tr key={i} className="border-b border-white/5">
            <td className="py-2.5 px-3"><span className="h-4 w-20 bg-white/10 rounded block animate-pulse" /></td>
            <td className="py-2.5 px-3 text-right"><span className="h-4 w-16 bg-white/10 rounded block animate-pulse ml-auto" /></td>
            <td className="py-2.5 px-3 text-right"><span className="h-4 w-12 bg-white/10 rounded block animate-pulse ml-auto" /></td>
            <td className="py-2.5 px-3 text-right"><span className="h-4 w-16 bg-white/10 rounded block animate-pulse ml-auto" /></td>
            <td className="py-2.5 px-3 text-right"><span className="h-4 w-16 bg-white/10 rounded block animate-pulse ml-auto" /></td>
            <td className="py-2.5 px-3 text-right"><span className="h-4 w-12 bg-white/10 rounded block animate-pulse ml-auto" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function MarketsPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchMarkets = useCallback(async () => {
    const res = await api.get<Market[]>('/api/v1/spot/markets');
    const data = Array.isArray(res.data) ? res.data : [];
    if (res.success) setMarkets(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  const filtered = search.trim()
    ? markets.filter(
        (m) =>
          m.symbol.toLowerCase().includes(search.trim().toLowerCase()) ||
          m.base_asset.toLowerCase().includes(search.trim().toLowerCase())
      )
    : markets;

  return (
    <div className="min-h-screen bg-[#0b0e11] dark:bg-[#0b0e11] text-white p-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h1 className="text-lg font-semibold text-white">Markets</h1>
          <input
            type="text"
            placeholder="Search pair..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 px-3 w-48 bg-white/5 border border-white/10 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/20"
            aria-label="Search trading pairs"
          />
        </div>
        <div className="border border-white/10 rounded overflow-hidden">
          {loading ? (
            <MarketsTableSkeleton />
          ) : filtered.length === 0 ? (
            <div className="py-12">
              <EmptyState
                icon={BarChart3}
                title="No markets found"
                description={search.trim() ? 'Try a different search term.' : 'No trading markets are available yet.'}
                action={search.trim() ? undefined : { label: 'Go to Spot', href: '/dashboard/spot' }}
              />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-3 font-medium">Pair</th>
                  <th className="py-3 px-3 font-medium text-right">Last Price</th>
                  <th className="py-3 px-3 font-medium text-right">24h Change</th>
                  <th className="py-3 px-3 font-medium text-right">24h High</th>
                  <th className="py-3 px-3 font-medium text-right">24h Low</th>
                  <th className="py-3 px-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <MarketsRow key={m.id} market={m} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function MarketsRow({ market }: { market: Market }) {
  const ref = useReferencePrice(market.symbol, market.quote_asset === 'USDT' ? 'usdt' : 'usd');
  const displayPrice = ref.price != null ? ref.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : '—';
  const change = ref.changePercent24h;
  const isPositive = change != null && change >= 0;
  const isNegative = change != null && change < 0;

  return (
    <tr className="border-b border-white/5 hover:bg-white/5">
      <td className="py-2.5 px-3 font-medium tabular-nums text-white">{market.symbol.replace('_', '/')}</td>
      <td className="py-2.5 px-3 text-right tabular-nums">{displayPrice}</td>
      <td className={`py-2.5 px-3 text-right tabular-nums ${isPositive ? 'text-green-500' : isNegative ? 'text-red-500' : 'text-gray-400'}`}>
        {change != null ? `${isPositive ? '+' : ''}${change.toFixed(2)}%` : '—'}
      </td>
      <td className="py-2.5 px-3 text-right tabular-nums text-gray-400">—</td>
      <td className="py-2.5 px-3 text-right tabular-nums text-gray-400">—</td>
      <td className="py-2.5 px-3 text-right">
        <Link
          href={`/dashboard/spot?symbol=${encodeURIComponent(market.symbol)}`}
          className="text-blue-400 hover:text-blue-300 text-xs font-medium"
          aria-label={`Trade ${market.symbol.replace('_', '/')}`}
        >
          Trade
        </Link>
      </td>
    </tr>
  );
}
