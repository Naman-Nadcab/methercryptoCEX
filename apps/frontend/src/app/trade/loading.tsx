/**
 * Trade view (chart + orderbook + order form) is JS-heavy; show a dedicated
 * skeleton rather than the generic one so the layout matches what appears.
 */
export default function TradeLoading() {
  return (
    <div className="min-h-screen w-full bg-background p-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <div className="h-12 animate-pulse rounded bg-foreground/5" />
          <div className="h-[460px] animate-pulse rounded-lg bg-foreground/[0.05]" />
          <div className="h-40 animate-pulse rounded-lg bg-foreground/[0.05]" />
        </div>
        <div className="space-y-3">
          <div className="h-[320px] animate-pulse rounded-lg bg-foreground/[0.05]" />
          <div className="h-48 animate-pulse rounded-lg bg-foreground/[0.05]" />
        </div>
      </div>
    </div>
  );
}
