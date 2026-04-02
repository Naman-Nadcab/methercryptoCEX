'use client';

export interface RecentTradeRow {
  price: string;
  quantity: string;
  side: string;
  time: string;
}

interface SpotRecentTradesPanelProps {
  trades: RecentTradeRow[];
  onPriceClick?: (price: string, quantity: string) => void;
}

export function SpotRecentTradesPanel({ trades, onPriceClick }: SpotRecentTradesPanelProps) {
  const rows = trades.slice(0, 20);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0b0e11] border-l border-white/5">
      <div className="flex justify-between px-3 py-2 border-b border-white/5 text-xs text-muted-foreground">
        <span>Price</span>
        <span>Amount</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {rows.map((t, i) => (
          <button
            key={`${i}-${t.price}-${t.time}`}
            type="button"
            onClick={() => onPriceClick?.(t.price, t.quantity)}
            className={`w-full flex justify-between items-center px-3 py-0.5 min-h-[24px] text-xs font-mono tabular-nums text-right hover:bg-card/5 ${
              t.side === 'buy' ? 'text-green-500' : 'text-red-500'
            }`}
          >
            <span className="font-medium w-[36%] min-w-0 text-right truncate">{t.price}</span>
            <span className={`w-[36%] min-w-0 text-right truncate ${t.side === 'buy' ? 'text-green-500/80' : 'text-red-500/80'}`}>{t.quantity}</span>
            <span className="text-muted-foreground text-[10px] ml-1 shrink-0">{t.time}</span>
          </button>
        ))}
        {rows.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">No recent trades</div>
        )}
      </div>
    </div>
  );
}
