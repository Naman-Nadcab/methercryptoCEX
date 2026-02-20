'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useReferencePrice } from '@/hooks/useReferencePrice';

type Market = { id: string; symbol: string; base_asset: string; quote_asset: string };

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
          />
        </div>
        <div className="border border-white/10 rounded overflow-hidden">
          {loading ? (
            <div className="py-12 text-center text-gray-500 text-sm">Loading…</div>
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
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-500">No markets</td>
                  </tr>
                )}
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
        >
          Trade
        </Link>
      </td>
    </tr>
  );
}
