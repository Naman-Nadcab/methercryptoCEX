'use client';

/**
 * Pro panel: balances from the same API as the order form; PnL / avg entry from
 * client-side FIFO on trade history for this market (approximation; fees in quote only).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useBalancesByAccount } from '@/lib/balances';
import { useSpotMarketTicker } from './SpotMarketDataContext';
import { formatValueFixedTrim } from './terminalFormat';
import { TrendingUp, TrendingDown, Wallet } from 'lucide-react';

type TradeRow = {
  side: string;
  price: string;
  quantity: string;
  fee: string;
  fee_asset: string | null;
  created_at: string;
};

function computeFifoPosition(
  trades: TradeRow[],
  quoteAsset: string,
  markPrice: number
): { netBase: number; avgEntry: number | null; unrealizedQuote: number | null; realizedQuote: number } {
  let position = 0;
  let costBasisQuote = 0;
  let realizedQuote = 0;

  const sorted = [...trades].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  for (const t of sorted) {
    const p = parseFloat(t.price) || 0;
    const q = parseFloat(t.quantity) || 0;
    if (q <= 0 || p <= 0) continue;
    const fee = parseFloat(t.fee || '0') || 0;
    const feeInQuote = !t.fee_asset || t.fee_asset === quoteAsset;

    if (t.side === 'buy') {
      costBasisQuote += p * q + (feeInQuote ? fee : 0);
      position += q;
    } else {
      const avgCost = position > 1e-16 ? costBasisQuote / position : 0;
      const closeQty = Math.min(q, Math.max(0, position));
      realizedQuote += (p - avgCost) * closeQty - (feeInQuote ? fee : 0);
      costBasisQuote -= avgCost * closeQty;
      position -= q;
      if (position < 1e-12) {
        position = 0;
        costBasisQuote = 0;
      }
    }
  }

  const avgEntry = position > 1e-12 ? costBasisQuote / position : null;
  const unrealizedQuote =
    avgEntry != null && Number.isFinite(markPrice) && position > 1e-12
      ? (markPrice - avgEntry) * position
      : null;

  return { netBase: position, avgEntry, unrealizedQuote, realizedQuote };
}

export function SpotPositionPanel({
  symbol,
  baseAsset,
  quoteAsset,
  isAuth,
  tradesVersion,
  pricePrecision,
  qtyPrecision,
}: {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  isAuth: boolean;
  tradesVersion: number;
  pricePrecision: number;
  qtyPrecision: number;
}) {
  const { ticker } = useSpotMarketTicker();
  const { data: balancesByAccount = [] } = useBalancesByAccount(isAuth);

  const { data: trades = [] } = useQuery({
    queryKey: ['spot-position-trades', symbol, tradesVersion],
    queryFn: async () => {
      const raw = await api.get(
        `/api/v1/spot/trade-history?page=1&limit=200&market=${encodeURIComponent(symbol)}`,
        { notifyOnError: false }
      );
      const res = raw as { success?: boolean; data?: TradeRow[] };
      return res.success && Array.isArray(res.data) ? res.data : [];
    },
    enabled: isAuth && !!symbol,
    staleTime: 15_000,
  });

  const baseBal = balancesByAccount.find((b) => b.symbol === baseAsset)?.trading ?? '0';
  const quoteBal = balancesByAccount.find((b) => b.symbol === quoteAsset)?.trading ?? '0';

  const last = ticker?.last_price != null && ticker.last_price !== '' ? parseFloat(ticker.last_price) : NaN;
  const mark = Number.isFinite(last) ? last : NaN;

  const fifo = useMemo(
    () => (Number.isFinite(mark) ? computeFifoPosition(trades, quoteAsset, mark) : null),
    [trades, quoteAsset, mark]
  );

  if (!isAuth || !symbol) {
    return (
      <div className="shrink-0 rounded-lg border border-gray-200/90 bg-background/80 px-3 py-2.5 text-[11px] text-muted-foreground dark:border-border/90 dark:bg-card/40 dark:text-muted-foreground">
        Sign in to see position and balances for this pair.
      </div>
    );
  }

  const u = fifo?.unrealizedQuote;
  const r = fifo?.realizedQuote;
  const avg = fifo?.avgEntry;

  return (
    <div className="shrink-0 space-y-2 rounded-lg border border-gray-200/90 bg-gradient-to-b from-gray-50/90 to-white px-3 py-2.5 dark:border-border/90 dark:from-gray-900/50 dark:to-[#181a20]">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        <Wallet className="h-3.5 w-3.5" aria-hidden />
        Position · {baseAsset}/{quoteAsset}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <div>
          <span className="text-muted-foreground">{baseAsset} (trading)</span>
          <p className="font-mono font-semibold tabular-nums text-foreground">
            {formatValueFixedTrim(baseBal, qtyPrecision)}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">{quoteAsset} (trading)</span>
          <p className="font-mono font-semibold tabular-nums text-foreground">
            {formatValueFixedTrim(quoteBal, Math.min(10, pricePrecision + 2))}
          </p>
        </div>
        <div className="col-span-2 border-t border-gray-200/80 pt-1.5 dark:border-border/80">
          <span className="text-muted-foreground">Avg entry (FIFO, fills)</span>
          <p className="font-mono tabular-nums text-foreground">
            {avg != null && avg > 0 ? formatValueFixedTrim(String(avg), pricePrecision) : '—'}{' '}
            {avg != null && avg > 0 ? quoteAsset : ''}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Unrealized PnL</span>
          <p
            className={`flex items-center gap-0.5 font-mono font-semibold tabular-nums ${
              u == null || Math.abs(u) < 1e-12
                ? 'text-muted-foreground'
                : u > 0
                  ? 'text-price-up'
                  : 'text-price-down'
            }`}
          >
            {u != null && Math.abs(u) >= 1e-12 ? (
              <>
                {u > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {u > 0 ? '+' : ''}
                {formatValueFixedTrim(String(u), Math.min(8, pricePrecision + 2))} {quoteAsset}
              </>
            ) : (
              '—'
            )}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Realized (session fills)</span>
          <p
            className={`font-mono font-semibold tabular-nums ${
              r == null || Math.abs(r) < 1e-12
                ? 'text-muted-foreground'
                : r > 0
                  ? 'text-price-up'
                  : 'text-price-down'
            }`}
          >
            {r != null && Math.abs(r) >= 1e-12
              ? `${r > 0 ? '+' : ''}${formatValueFixedTrim(String(r), Math.min(8, pricePrecision + 2))} ${quoteAsset}`
              : '—'}
          </p>
        </div>
      </div>
      <p className="text-[9px] leading-snug text-muted-foreground dark:text-muted-foreground">
        PnL uses last price and up to 200 recent trades on this pair; balances match your trading wallet.
      </p>
    </div>
  );
}
