'use client';

type Market = { symbol: string; base_asset: string; quote_asset: string };

interface PairHeaderProps {
  symbol?: string;
  baseAsset?: string;
  quoteAsset?: string;
  lastPrice?: string | null;
  high24h?: string | null;
  low24h?: string | null;
  volume24h?: string | null;
  markets?: Market[];
  onSymbolChange?: (symbol: string) => void;
}

export function PairHeader({
  symbol,
  baseAsset,
  quoteAsset,
  lastPrice,
  high24h,
  low24h,
  volume24h,
  markets,
  onSymbolChange,
}: PairHeaderProps) {
  const sym = symbol ?? 'BTC_USDT';
  const base = baseAsset ?? 'BTC';
  const quote = quoteAsset ?? 'USDT';
  const mkt = markets ?? [];
  const pairLabel = base && quote ? `${base}/${quote}` : sym;
  const onChange = onSymbolChange ?? (() => {});

  return (
    <header className="h-[60px] flex-shrink-0 flex items-center justify-between px-4 bg-[#0b0e11] border-b border-white/5">
      <div className="flex items-center gap-3">
        {mkt.length > 1 ? (
          <select
            value={sym}
            onChange={(e) => onChange(e.target.value)}
            className="text-lg font-semibold text-white bg-transparent border-none outline-none cursor-pointer appearance-none pr-6 focus:ring-0"
          >
            {mkt.map((m) => (
              <option key={m.symbol} value={m.symbol}>
                {m.base_asset}/{m.quote_asset}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-lg font-semibold text-white">{pairLabel}</span>
        )}
        <span className="text-xs text-gray-500">Spot</span>
      </div>
      <div className="flex items-center gap-4 text-sm text-gray-400">
        <span>Price {lastPrice ?? '—'}</span>
        <span>24h High {high24h ?? '—'}</span>
        <span>24h Low {low24h ?? '—'}</span>
        <span>24h Vol {volume24h ?? '—'}</span>
      </div>
    </header>
  );
}
