'use client';

import { useState, useMemo } from 'react';
import { Star, Search } from 'lucide-react';
import { formatValueFixedTrim, formatCompactNumber } from '@/components/trade/terminalFormat';
import { Skeleton } from '@/components/ui/Skeleton';
import { CoinIcon } from '@/components/ui/CoinIcon';

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
  /**
   * `terminal` — spot right-rail: Binance-like density, no outer border, sticky column header in list scroll.
   */
  variant?: 'default' | 'terminal';
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
  variant = 'default',
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

  const isTerminal = variant === 'terminal';

  return (
    <div
      className={
        isTerminal
          ? 'exchange-ui flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card'
          : 'exchange-ui flex h-full min-h-0 min-w-0 flex-col border-r border-border bg-card'
      }
    >
      {/* Tabs + search: fixed to top of section; list scrolls independently below (Binance-style). */}
      <div
        className={
          isTerminal
            ? 'sticky top-0 z-20 shrink-0 border-b border-border bg-card'
            : 'shrink-0 border-b border-border'
        }
      >
        <div className="flex">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={
                isTerminal
                  ? `flex-1 py-2 text-label font-semibold tracking-wide transition-colors ${
                      tab === t.id
                        ? 'border-b-2 border-primary text-foreground'
                        : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground'
                    }`
                  : `flex-1 py-2.5 text-small font-medium transition-colors ${
                      tab === t.id ? 'border-b-2 border-buy text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className={isTerminal ? 'border-t border-border px-2 py-1.5' : 'border-b border-border p-2'}>
          <div className="relative">
            <Search
              className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground ${isTerminal ? 'left-2 h-3.5 w-3.5' : 'left-2.5 h-4 w-4'}`}
            />
            <input
              type="text"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={
                isTerminal
                  ? 'h-8 w-full rounded-md border border-border bg-muted/50 pl-7 pr-2 text-label text-foreground placeholder:text-muted-foreground/55 focus:border-primary/40 focus:outline-none focus:ring-0'
                  : 'h-8 w-full rounded border border-border bg-background pl-8 pr-3 text-foreground text-small placeholder:text-muted-foreground/60 focus:border-border focus:outline-none focus:ring-1 focus:ring-buy/25'
              }
            />
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
        <table className={`w-full ${isTerminal ? 'text-label' : 'text-small'}`}>
          <thead
            className={
              isTerminal
                ? 'sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur-sm'
                : 'sticky top-0 z-10 bg-card'
            }
          >
            <tr className="font-medium text-muted-foreground">
              <th className={`text-left ${isTerminal ? 'px-2 py-1.5' : 'px-2 py-2'}`}>Pair</th>
              <th className={`text-right ${isTerminal ? 'px-2 py-1.5' : 'px-2 py-2'}`}>Last</th>
              <th className={`text-right ${isTerminal ? 'px-2 py-1.5' : 'px-2 py-2'}`}>24h%</th>
              <th className={`text-right ${isTerminal ? 'px-2 py-1.5' : 'px-2 py-2'}`}>Vol</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="px-2 py-1.5">
                    <Skeleton className="h-4 w-20 bg-accent" />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Skeleton className="ml-auto h-4 w-14 bg-accent" />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Skeleton className="ml-auto h-4 w-10 bg-accent" />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Skeleton className="ml-auto h-4 w-12 bg-accent" />
                  </td>
                  <td className="w-6" />
                </tr>
              ))
            ) : errorMessage ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center">
                  <p className="mb-3 text-sm text-sell">{errorMessage}</p>
                  {onRetry ? (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="min-h-[44px] rounded-lg bg-buy/90 px-4 py-2 text-sm font-medium tracking-wide text-neutral-950 hover:bg-buy active:scale-[0.99]"
                    >
                      Retry
                    </button>
                  ) : null}
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className={
                    isTerminal
                      ? 'px-2 py-6 text-center text-label text-muted-foreground'
                      : 'px-3 py-8 text-center text-sm text-muted-foreground'
                  }
                >
                  No markets match your filters.
                </td>
              </tr>
            ) : (
              filtered.map((m) => {
                const pair = `${m.base_asset}/${m.quote_asset}`;
                const isSelected = m.symbol === selectedSymbol;
                const change = m.change_24h;
                const isUp = change != null && change >= 0;
                const rowBorder = 'border-b border-border/50';
                const rowHover = isTerminal ? 'hover:bg-muted/45' : 'hover:bg-muted/30';
                const cellY = isTerminal ? 'py-1.5' : 'py-1.5';
                const starHover = 'hover:text-primary';
                return (
                  <tr
                    key={m.symbol}
                    className={`cursor-pointer transition-colors ${rowBorder} ${rowHover} ${
                      isSelected ? (isTerminal ? 'bg-muted/60' : 'bg-buy/10') : ''
                    }`}
                    onClick={() => onSelectSymbol(m.symbol)}
                  >
                    <td className={`px-2 ${cellY}`}>
                      <div className="flex min-w-0 items-center gap-0.5">
                        {onToggleFavorite && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleFavorite(m.symbol);
                            }}
                            className={`rounded p-0.5 text-muted-foreground transition-colors ${starHover}`}
                            aria-label={favorites.includes(m.symbol) ? 'Remove favorite' : 'Add favorite'}
                          >
                            <Star
                              className={`h-3 w-3 ${favorites.includes(m.symbol) ? 'fill-primary text-primary' : ''}`}
                            />
                          </button>
                        )}
                        <CoinIcon symbol={m.base_asset} size={isTerminal ? 15 : 18} />
                        <span className="truncate font-medium text-foreground">{pair}</span>
                      </div>
                    </td>
                    <td className={`numeric px-2 text-right ${cellY} text-foreground`}>
                      {m.last_price != null ? formatValueFixedTrim(m.last_price, 4) : '—'}
                    </td>
                    <td
                      className={`numeric px-2 text-right ${cellY} ${isUp ? 'text-buy' : 'text-sell'}`}
                    >
                      {change != null && Number.isFinite(change) ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '—'}
                    </td>
                    <td className={`numeric px-2 text-right text-muted-foreground ${cellY}`}>
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
