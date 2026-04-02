'use client';

export function BottomPanel() {
  return (
    <div className="h-[260px] flex-shrink-0 flex border-t border-white/5 bg-[#0b0e11]">
      <div className="flex border-r border-white/5">
        <button
          type="button"
          className="px-4 py-2 text-xs font-medium text-muted-foreground border-b-2 border-transparent"
        >
          Open Orders
        </button>
        <button
          type="button"
          className="px-4 py-2 text-xs font-medium text-muted-foreground"
        >
          Order History
        </button>
        <button
          type="button"
          className="px-4 py-2 text-xs font-medium text-muted-foreground"
        >
          Trade History
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <table className="w-full text-xs text-muted-foreground">
          <thead>
            <tr className="border-b border-white/5">
              <th className="text-left py-2 px-3 font-medium text-muted-foreground">Time</th>
              <th className="text-left py-2 px-3 font-medium text-muted-foreground">Pair</th>
              <th className="text-left py-2 px-3 font-medium text-muted-foreground">Type</th>
              <th className="text-right py-2 px-3 font-medium text-muted-foreground">Price</th>
              <th className="text-right py-2 px-3 font-medium text-muted-foreground">Amount</th>
              <th className="text-right py-2 px-3 font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-white/5">
              <td className="py-2 px-3">—</td>
              <td className="py-2 px-3">—</td>
              <td className="py-2 px-3">—</td>
              <td className="py-2 px-3 text-right">—</td>
              <td className="py-2 px-3 text-right">—</td>
              <td className="py-2 px-3 text-right">—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
