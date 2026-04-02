'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, TrendingUp, Wallet, FileText } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SPOT_TRADE_HREF } from '@/lib/tier1-canonical-routes';
import { WALLET_HREF, ROUTES } from '@/lib/routes';

interface GlobalSearchProps {
  accessToken?: string | null;
  className?: string;
}

interface SearchResult {
  type: 'market' | 'asset' | 'help';
  label: string;
  href: string;
  subtitle?: string;
}

export function GlobalSearch({ accessToken, className = '' }: GlobalSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const fetchMarkets = useCallback(async (q: string) => {
    const url = getApiBaseUrl();
    if (!url) return [];
    const res = await fetch(`${url}/api/v1/spot/tickers`);
    const data = await res.json();
    if (!data?.success || !Array.isArray(data?.data)) return [];
    const upper = q.toUpperCase();
    return data.data
      .filter((t: { symbol: string; base_asset: string }) =>
        t.symbol?.toUpperCase().includes(upper) || t.base_asset?.toUpperCase().includes(upper)
      )
      .slice(0, 5)
      .map((t: { symbol: string; base_asset: string; quote_asset: string }) => ({
        type: 'market' as const,
        label: `${t.base_asset}/${t.quote_asset ?? 'USDT'}`,
        href: `${SPOT_TRADE_HREF}?symbol=${(t.symbol || t.base_asset + '_USDT').replace(/-/g, '_')}`,
        subtitle: 'Spot market',
      }));
  }, []);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      const all: SearchResult[] = [];
      try {
        const markets = await fetchMarkets(q);
        all.push(...markets);
      } catch {
        // ignore
      }
      const assets = ['BTC', 'ETH', 'USDT', 'USDC', 'SOL', 'BNB', 'XRP', 'DOGE', 'AVAX', 'MATIC', 'LINK', 'DOT']
        .filter((a) => a.toUpperCase().includes(q.toUpperCase()))
        .slice(0, 3)
        .map((a) => ({
          type: 'asset' as const,
          label: a,
          href: WALLET_HREF,
          subtitle: 'Asset',
        }));
      all.push(...assets);
      const helpTerms = ['deposit', 'withdraw', 'kyc', '2fa', 'api', 'p2p', 'fee', 'security', 'transfer'];
      const matched = helpTerms.filter((h) => h.includes(q.toLowerCase())).slice(0, 2);
      matched.forEach((h) =>
        all.push({
          type: 'help' as const,
          label: `Help: ${h}`,
          href: `${ROUTES.dashboard.help}?q=${encodeURIComponent(h)}`,
          subtitle: 'Help article',
        })
      );
      setResults(all);
      setLoading(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [open, query, fetchMarkets]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const handleSelect = (href: string) => {
    setOpen(false);
    setQuery('');
    router.push(href);
  };

  const IconMap = { market: TrendingUp, asset: Wallet, help: FileText };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className="flex items-center gap-2 h-9 px-3 rounded-lg bg-muted/50 dark:bg-muted border border-border text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors duration-150 text-sm w-full min-w-[160px] max-w-[240px]"
      >
        <Search className="w-[18px] h-[18px] flex-shrink-0" />
        <span className="flex-1 text-left truncate">Search…</span>
        <kbd className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">⌘K</kbd>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-popover dark:bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="p-2 border-b border-border">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search markets, assets, help…"
              className="w-full h-9 px-3 rounded bg-background border border-input text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-2">
            {query.trim().length < 2 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">Type at least 2 characters</div>
            ) : loading ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">Searching…</div>
            ) : results.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">No results found</div>
            ) : (
              results.map((r, i) => {
                const Icon = IconMap[r.type];
                return (
                  <button
                    key={`${r.type}-${r.label}-${i}`}
                    type="button"
                    onClick={() => handleSelect(r.href)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-foreground hover:bg-muted transition-colors"
                  >
                    <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{r.label}</p>
                      {r.subtitle && <p className="text-xs text-muted-foreground">{r.subtitle}</p>}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
