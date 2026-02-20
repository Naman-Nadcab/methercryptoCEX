'use client';

export interface OrderbookLevel {
  price: string;
  quantity: string;
}

interface SpotOrderbookPanelProps {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  quoteAsset: string;
  baseAsset: string;
  onPriceClick?: (price: string, quantity: string) => void;
}

const MAX_ROWS = 12;

function LevelRow({
  price,
  quantity,
  side,
  onSelect,
  emphasize,
}: {
  price: string;
  quantity: string;
  side: 'buy' | 'sell';
  onSelect?: () => void;
  emphasize?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative w-full flex justify-between items-center px-3 text-xs font-mono tabular-nums text-right h-[22px] hover:bg-white/5 transition-colors ${
        side === 'buy' ? 'text-green-500' : 'text-red-500'
      } ${side === 'buy' ? 'bg-green-500/[0.04]' : 'bg-red-500/[0.04]'}`}
    >
      <span className="absolute inset-y-0 left-0 w-0.5 bg-current opacity-20" aria-hidden />
      <span className={`w-[52%] min-w-0 text-right truncate ${emphasize ? 'font-semibold' : ''}`}>{price}</span>
      <span className="w-[48%] min-w-0 text-right text-gray-400 truncate">{quantity}</span>
    </button>
  );
}

export function SpotOrderbookPanel({
  bids,
  asks,
  quoteAsset,
  baseAsset,
  onPriceClick,
}: SpotOrderbookPanelProps) {
  const bidRows = bids.slice(0, MAX_ROWS);
  const askRows = asks.slice(0, MAX_ROWS);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0b0e11] border-l border-white/5">
      <div className="flex justify-between px-3 py-1.5 border-b border-white/5 text-xs text-gray-500 font-mono">
        <span className="w-[52%] min-w-0 text-right">Price ({quoteAsset})</span>
        <span className="w-[48%] min-w-0 text-right">Amount ({baseAsset})</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto">
          {askRows.length > 0 && (
            <div className="border-b border-white/5">
              {askRows.map((row, i) => (
                <LevelRow
                  key={`a-${i}-${row.price}`}
                  price={row.price}
                  quantity={row.quantity}
                  side="sell"
                  emphasize={i === 0}
                  onSelect={onPriceClick ? () => onPriceClick(row.price, row.quantity) : undefined}
                />
              ))}
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
                  onSelect={onPriceClick ? () => onPriceClick(row.price, row.quantity) : undefined}
                />
              ))}
            </div>
          )}
          {bidRows.length === 0 && askRows.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-gray-500">No data</div>
          )}
        </div>
      </div>
    </div>
  );
}
