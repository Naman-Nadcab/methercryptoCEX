'use client';

interface SpotDepthChartProps {
  bids: { price: string; quantity: string }[];
  asks: { price: string; quantity: string }[];
  height?: number;
  className?: string;
}

function qtyToNum(q: string): number {
  const n = parseFloat(q);
  return Number.isFinite(n) ? n : 0;
}

export function SpotDepthChart({ bids, asks, height, className }: SpotDepthChartProps) {
  const bidQtys = bids.map((r) => qtyToNum(r.quantity));
  const askQtys = asks.map((r) => qtyToNum(r.quantity));
  const cumBid = bidQtys.reduce<number[]>((a, q, i) => [...a, (a[i - 1] ?? 0) + q], []);
  const cumAsk = askQtys.reduce<number[]>((a, q, i) => [...a, (a[i - 1] ?? 0) + q], []);
  const maxCum = Math.max(...cumBid, ...cumAsk, 1);
  const viewBoxHeight = height ?? 100;
  const maxH = viewBoxHeight - 4;
  const bidPoints = cumBid.map((v, i) => {
    const x = 50 - (i / Math.max(1, cumBid.length - 1)) * 50;
    const y = maxH - (v / maxCum) * maxH;
    return `${x},${y}`;
  });
  const askPoints = cumAsk.map((v, i) => {
    const x = 50 + (i / Math.max(1, cumAsk.length - 1)) * 50;
    const y = maxH - (v / maxCum) * maxH;
    return `${x},${y}`;
  });
  const bidPath = bidPoints.length >= 2 ? `50,${maxH} ${bidPoints.join(' ')} 0,${maxH}` : `0,${maxH} 50,${maxH}`;
  const askPath = askPoints.length >= 2 ? `50,${maxH} ${askPoints.join(' ')} 100,${maxH}` : `50,${maxH} 100,${maxH}`;

  return (
    <div
      className={`bg-card border-t border-border px-2 pb-2 ${height != null ? 'flex-shrink-0' : ''} ${className ?? ''}`}
      style={height != null ? { height } : undefined}
    >
      <svg viewBox={`0 0 100 ${viewBoxHeight}`} className="w-full h-full min-h-[120px]" preserveAspectRatio="none">
        <defs>
          <linearGradient id="depth-bid-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(34, 197, 94)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="rgb(34, 197, 94)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="depth-ask-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(239, 68, 68)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="rgb(239, 68, 68)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={bidPath} fill="url(#depth-bid-fill)" />
        <polygon points={askPath} fill="url(#depth-ask-fill)" />
      </svg>
    </div>
  );
}
