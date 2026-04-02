'use client';

import { useState, useMemo } from 'react';
import { Star, Search } from 'lucide-react';
import { formatValueFixedTrim, formatCompactNumber } from '@/components/trade/terminalFormat';
import { Skeleton } from '@/components/ui/Skeleton';

export type MarketRow = {
  symbol: string;
  base_asset: string;
  quote_asset: string;
  last_price?: string | null;
  change_24h?: number | null;
  volume_24h?: string | null;
};

type TabId = 'favorites' | 'usdt' | 'btc';

interface MarketsSidebarProps {
  markets: MarketRow[];
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  loading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
  /** Optional: user's favorite symbols (e.g. from localStorage) */
  favorites?: string[];
  onToggleFavorite?: (symbol: string) => void;
}

export function MarketsSidebar({
  markets,
  selectedSymbol,
  onSelectSymbol,
  loading = false,
  errorMessage,
  onRetry,
  favorites = [],
  onToggleFavorite,
}: MarketsSidebarProps) {
  const [tab, setTab] = useState<TabId>('usdt');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    let list = markets;
    if (tab === 'usdt') list = list.filter((m) => m.quote_asset === 'USDT');
    else if (tab === 'btc') list = list.filter((m) => m.quote_asset === 'BTC');
    else if (tab === 'favorites') list = list.filter((m) => favorites.includes(m.symbol));
    if (search.trim()) {
      const q = search.toUpperCase().replace(/\//g, '_');
      list = list.filter((m) => m.symbol.toUpperCase().includes(q) || m.base_asset.toUpperCase().includes(q));
    }
    return list;
  }, [markets, tab, search, favorites]);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'favorites', label: 'Favorites' },
    { id: 'usdt', label: 'USDT' },
    { id: 'btc', label: 'BTC' },
  ];

  return (
    <div className="exchange-ui flex flex-col h-full bg-[#161A1F] border-r border-[#2B3139] min-w-0">
      <div className="flex border-b border-[#2B3139]">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2.5 text-small font-medium transition-colors ${
              tab === t.id ? 'text-[#EAECEF] border-b-2 border-[#16C784]' : 'text-[#848E9C] hover:text-[#EAECEF]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-2 border-b border-[#2B3139]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#848E9C]" />
          <input
            type="text"
            placeholder="Search pair"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-8 pl-8 pr-3 rounded bg-[#0B0E11] border border-[#2B3139] text-[#EAECEF] text-small placeholder:text-[#848E9C] focus:outline-none focus:border-[#2B3139] focus:ring-1 focus:ring-[#16C784]/30"
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-small">
          <thead className="sticky top-0 bg-[#161A1F] z-10">
            <tr className="text-[#848E9C] font-medium">
              <th className="text-left py-2 px-2">Pair</th>
              <th className="text-right py-2 px-2">Last</th>
              <th className="text-right py-2 px-2">24h%</th>
              <th className="text-right py-2 px-2">Vol</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <tr key={i} className="border-b border-[#2B3139]/50">
                  <td className="py-1.5 px-2">
                    <Skeleton className="h-4 w-20 bg-[#2B3139]" />
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    <Skeleton className="ml-auto h-4 w-14 bg-[#2B3139]" />
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    <Skeleton className="ml-auto h-4 w-10 bg-[#2B3139]" />
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    <Skeleton className="ml-auto h-4 w-12 bg-[#2B3139]" />
                  </td>
                  <td className="w-6" />
                </tr>
              ))
            ) : errorMessage ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center">
                  <p className="mb-3 text-sm text-red-400">{errorMessage}</p>
                  {onRetry ? (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="rounded-lg bg-[#16C784] px-4 py-2 text-sm font-medium text-[#0B0E11] min-h-[44px]"
                    >
                      Retry
                    </button>
                  ) : null}
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-[#848E9C]">
                  No markets match your filters.
                </td>
              </tr>
            ) : (
              filtered.map((m) => {
                const pair = `${m.base_asset}/${m.quote_asset}`;
                const isSelected = m.symbol === selectedSymbol;
                const change = m.change_24h;
                const isUp = change != null && change >= 0;
                return (
                  <tr
                    key={m.symbol}
                    className={`border-b border-[#2B3139]/50 hover:bg-white/5 transition-colors cursor-pointer ${
                      isSelected ? 'bg-[#16C784]/10' : ''
                    }`}
                    onClick={() => onSelectSymbol(m.symbol)}
                  >
                    <td className="py-1.5 px-2">
                      <div className="flex items-center gap-1">
                        {onToggleFavorite && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleFavorite(m.symbol);
                            }}
                            className="p-0.5 rounded text-[#848E9C] hover:text-[#16C784]"
                            aria-label={favorites.includes(m.symbol) ? 'Remove favorite' : 'Add favorite'}
                          >
                            <Star
                              className="w-3.5 h-3.5"
                              fill={favorites.includes(m.symbol) ? '#16C784' : 'transparent'}
                            />
                          </button>
                        )}
                        <span className="font-medium text-[#EAECEF]">{pair}</span>
                      </div>
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-[#EAECEF] tabular-nums">
                      {m.last_price != null ? formatValueFixedTrim(m.last_price, 4) : '—'}
                    </td>
                    <td className={`py-1.5 px-2 text-right font-mono tabular-nums ${isUp ? 'text-buy' : 'text-sell'}`}>
                      {change != null && Number.isFinite(change) ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '—'}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-[#848E9C] tabular-nums">
                      {m.volume_24h != null ? formatCompactNumber(m.volume_24h) : '—'}
                    </td>
                    <td className="w-6" />
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
