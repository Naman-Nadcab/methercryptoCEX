'use client';

export function OrderEntryPanel() {
  return (
    <div className="h-full min-h-0 bg-background flex flex-col border-l border-border">
      <div className="flex border-b border-border">
        <button
          type="button"
          className="flex-1 py-2 text-xs font-medium text-buy border-b-2 border-green-500"
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
          <div className="h-9 bg-card/5 rounded border border-border" />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Amount</label>
          <div className="h-9 bg-card/5 rounded border border-border" />
        </div>
        <div className="pt-2">
          <div className="h-9 bg-card/5 rounded border border-border" />
        </div>
      </div>
      <div className="p-3 border-t border-border text-xs text-muted-foreground space-y-1">
        <div className="flex justify-between">
          <span>Available</span>
          <span>—</span>
        </div>
      </div>
    </div>
  );
}
