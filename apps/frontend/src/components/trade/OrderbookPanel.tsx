'use client';

export function OrderbookPanel() {
  return (
    <div className="h-full min-h-0 bg-[#0b0e11] flex flex-col border-l border-white/5">
      <div className="px-3 py-2 border-b border-white/5 flex justify-between text-xs text-gray-500">
        <span>Price (USDT)</span>
        <span>Amount (BTC)</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full flex flex-col justify-end text-xs">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
            <div
              key={i}
              className="flex justify-between px-3 py-0.5 text-gray-400"
            >
              <span>—</span>
              <span>—</span>
            </div>
          ))}
        </div>
      </div>
      <div className="px-3 py-1.5 border-t border-white/5 text-center text-xs text-gray-500">
        Spread —
      </div>
    </div>
  );
}
