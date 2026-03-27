'use client';

const DEFAULT_PAIRS = [
  { pair: 'BTC/USDT', bid: 85, ask: 82, spread: 0.02 },
  { pair: 'ETH/USDT', bid: 78, ask: 76, spread: 0.03 },
  { pair: 'SOL/USDT', bid: 62, ask: 60, spread: 0.05 },
  { pair: 'BNB/USDT', bid: 71, ask: 69, spread: 0.04 },
  { pair: 'XRP/USDT', bid: 58, ask: 55, spread: 0.06 },
];

function getColor(pct: number) {
  if (pct >= 80) return 'from-emerald-500/30 to-emerald-500/10';
  if (pct >= 60) return 'from-blue-500/30 to-blue-500/10';
  if (pct >= 40) return 'from-amber-500/30 to-amber-500/10';
  return 'from-gray-500/20 to-gray-500/5';
}

export function LiquidityHeatmap() {
  return (
    <div className="space-y-2">
      {DEFAULT_PAIRS.map((row) => (
        <div key={row.pair} className="flex items-center gap-3">
          <span className="admin-metric-label text-xs w-20 shrink-0">{row.pair}</span>
          <div className="flex-1 flex gap-1">
            <div
              className={`h-6 rounded-l bg-gradient-to-r ${getColor(row.bid)} border border-white/10 flex items-center justify-center text-xs admin-metric-value min-w-[48px]`}
              title="Bid depth"
            >
              {row.bid}%
            </div>
            <div
              className={`h-6 rounded-r bg-gradient-to-r ${getColor(row.ask)} border border-white/10 flex items-center justify-center text-xs admin-metric-value min-w-[48px]`}
              title="Ask depth"
            >
              {row.ask}%
            </div>
          </div>
          <span className="admin-metric-label text-xs w-12 text-right">{row.spread}%</span>
        </div>
      ))}
    </div>
  );
}
