'use client';

import { useState } from 'react';

export interface OrderbookLevel {
  price: string;
  quantity: string;
}

export interface RecentTradeRow {
  id: string;
  market: string;
  side: string;
  price: string;
  quantity: string;
  time: string;
}

interface SpotOrderbookPanelProps {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  quoteAsset: string;
  baseAsset: string;
  onPriceClick?: (price: string, quantity: string) => void;
  loading?: boolean;
  recentTrades?: RecentTradeRow[];
}

const MAX_ROWS = 12;

function qtyToNum(q: string): number {
  const n = parseFloat(q);
  return Number.isFinite(n) ? n : 0;
}

function LevelRow({
  price,
  quantity,
  side,
  onSelect,
  emphasize,
  depthPct,
}: {
  price: string;
  quantity: string;
  side: 'buy' | 'sell';
  onSelect?: () => void;
  emphasize?: boolean;
  depthPct: number;
}) {
  const barClr = side === 'buy' ? 'bg-green-500/20' : 'bg-red-500/20';
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative w-full flex justify-between items-center px-3 text-xs font-mono tabular-nums text-right h-[22px] hover:bg-white/5 transition-colors overflow-hidden ${
        side === 'buy' ? 'text-green-500' : 'text-red-500'
      } ${side === 'buy' ? 'bg-green-500/[0.04]' : 'bg-red-500/[0.04]'}`}
    >
      <span
        aria-hidden
        className={`absolute inset-y-0 right-0 ${barClr} transition-all duration-200`}
        style={{ width: `${Math.max(2, depthPct)}%` }}
      />
      <span className={`relative z-10 w-[52%] min-w-0 text-right truncate ${emphasize ? 'font-semibold' : ''}`}>{price}</span>
      <span className="relative z-10 w-[48%] min-w-0 text-right text-gray-400 truncate">{quantity}</span>
    </button>
  );
}

function SkeletonRow({ side }: { side: 'buy' | 'sell' }) {
  return (
    <div
      className={`h-[22px] flex justify-between items-center px-3 text-right ${
        side === 'buy' ? 'bg-green-500/[0.04]' : 'bg-red-500/[0.04]'
      }`}
    >
      <span className="w-[52%] h-3 bg-white/10 rounded animate-pulse" />
      <span className="w-[48%] h-3 bg-white/10 rounded animate-pulse" />
    </div>
  );
}

export function SpotOrderbookPanel({
  bids,
  asks,
  quoteAsset,
  baseAsset,
  onPriceClick,
  loading = false,
  recentTrades = [],
}: SpotOrderbookPanelProps) {
  const [tab, setTab] = useState<'orderbook' | 'trades'>('orderbook');
  const bidRows = bids.slice(0, MAX_ROWS);
  const askRows = asks.slice(0, MAX_ROWS);

  const allQtys = [...askRows.map((r) => qtyToNum(r.quantity)), ...bidRows.map((r) => qtyToNum(r.quantity))];
  const maxQty = Math.max(...allQtys, 1);
  const depthPct = (q: string) => Math.min(100, (qtyToNum(q) / maxQty) * 100);

  const bestBid = bidRows[0];
  const bestAsk = askRows[0];
  const spread =
    bestBid && bestAsk
      ? parseFloat(bestAsk.price) - parseFloat(bestBid.price)
      : 0;
  const spreadPct =
    bestBid && parseFloat(bestBid.price) > 0 && Number.isFinite(spread)
      ? (spread / parseFloat(bestBid.price)) * 100
      : 0;

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0b0e11] border-l border-white/5">
      <div className="flex border-b border-white/5">
        <button type="button" onClick={() => setTab('orderbook')} className={`flex-1 px-2 py-1.5 text-[11px] font-medium ${tab === 'orderbook' ? 'text-white border-b border-blue-500' : 'text-gray-500 hover:text-gray-300'}`}>Orderbook</button>
        <button type="button" onClick={() => setTab('trades')} className={`flex-1 px-2 py-1.5 text-[11px] font-medium ${tab === 'trades' ? 'text-white border-b border-blue-500' : 'text-gray-500 hover:text-gray-300'}`}>Trades</button>
      </div>
      {tab === 'trades' ? (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="flex justify-between px-2 py-1 text-[10px] text-gray-500 font-mono border-b border-white/5">
            <span>Price</span>
            <span>Amount</span>
            <span>Time</span>
          </div>
          {recentTrades.length === 0 ? (
            <div className="px-2 py-4 text-center text-[11px] text-gray-500">No recent trades</div>
          ) : (
            recentTrades.slice(0, 24).map((t) => (
              <div key={t.id} className="flex justify-between px-2 py-0.5 text-[11px] font-mono border-b border-white/5 hover:bg-white/5">
                <span className={t.side === 'buy' ? 'text-green-500' : 'text-red-500'}>{t.price}</span>
                <span className="text-gray-400">{t.quantity}</span>
                <span className="text-gray-500">{t.time ? new Date(t.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</span>
              </div>
            ))
          )}
        </div>
      ) : (
        <>
      <div className="flex justify-between px-2 py-1 border-b border-white/5 text-[11px] text-gray-500 font-mono">
        <span className="w-[52%] min-w-0 text-right">Price ({quoteAsset})</span>
        <span className="w-[48%] min-w-0 text-right">Amount ({baseAsset})</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <>
              <div className="border-b border-white/5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonRow key={`sk-a-${i}`} side="sell" />
                ))}
              </div>
              <div>
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonRow key={`sk-b-${i}`} side="buy" />
                ))}
              </div>
            </>
          ) : (
            <>
              {askRows.length > 0 && (
                <div className="border-b border-white/5">
                  {askRows.map((row, i) => (
                    <LevelRow
                      key={`a-${i}-${row.price}`}
                      price={row.price}
                      quantity={row.quantity}
                      side="sell"
                      emphasize={i === 0}
                      depthPct={depthPct(row.quantity)}
                      onSelect={onPriceClick ? () => onPriceClick(row.price, row.quantity) : undefined}
                    />
                  ))}
                </div>
              )}
              {bestBid && bestAsk && Number.isFinite(spread) && (
                <div className="px-3 py-1.5 flex justify-between items-center border-b border-white/5 bg-white/[0.02] text-[10px] font-mono text-gray-400">
                  <span>Spread</span>
                  <span className="tabular-nums">
                    {spread.toFixed(4)} ({spreadPct >= 0.01 ? spreadPct.toFixed(2) : '<0.01'}%)
                  </span>
                </div>
              )}
              {bidRows.length > 0 && (
                <div>
                  {bidRows.map((row, i) => (
                    <LevelRow
                      key={`b-${i}-${row.price}`}
                      price={row.price}
                      quantity={row.quantity}
                      side="buy"
                      emphasize={i === 0}
                      depthPct={depthPct(row.quantity)}
                      onSelect={onPriceClick ? () => onPriceClick(row.price, row.quantity) : undefined}
                    />
                  ))}
                </div>
              )}
              {bidRows.length === 0 && askRows.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-gray-500">No data</div>
              )}
            </>
          )}
        </div>
      </div>
        </>
      )}
    </div>
  );
}
