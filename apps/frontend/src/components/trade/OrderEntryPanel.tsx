'use client';

export function OrderEntryPanel() {
  return (
    <div className="h-full min-h-0 bg-[#0b0e11] flex flex-col border-l border-white/5">
      <div className="flex border-b border-white/5">
        <button
          type="button"
          className="flex-1 py-2 text-xs font-medium text-green-500 border-b-2 border-green-500"
        >
          Buy
        </button>
        <button
          type="button"
          className="flex-1 py-2 text-xs font-medium text-muted-foreground"
        >
          Sell
        </button>
      </div>
      <div className="flex-1 min-h-0 p-3 space-y-2">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Price</label>
          <div className="h-9 bg-card/5 rounded border border-white/10" />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Amount</label>
          <div className="h-9 bg-card/5 rounded border border-white/10" />
        </div>
        <div className="pt-2">
          <div className="h-9 bg-card/5 rounded border border-white/10" />
        </div>
      </div>
      <div className="p-3 border-t border-white/5 text-xs text-muted-foreground space-y-1">
        <div className="flex justify-between">
          <span>Available</span>
          <span>—</span>
        </div>
      </div>
    </div>
  );
}
