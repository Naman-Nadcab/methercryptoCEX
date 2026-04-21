/**
 * Generic dashboard-style loading skeleton used by Next.js `loading.tsx`
 * boundaries across the user app (dashboard, wallet, trade-meta, p2p, etc.).
 *
 * Renders a header row, a 4-card metric grid, and a list of skeleton rows.
 * Intentionally does NOT import any client-only UI kit so it can be rendered
 * as a server component and shown on the very first paint.
 */
export function PageSkeleton({ rows = 6, metrics = 4 }: { rows?: number; metrics?: number }) {
  return (
    <div className="min-h-screen w-full bg-background px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-7xl space-y-4">
        <div className="h-8 w-56 animate-pulse rounded-md bg-foreground/5" />
        <div className="h-4 w-80 animate-pulse rounded bg-foreground/5" />

        {metrics > 0 ? (
          <div className="grid grid-cols-2 gap-3 pt-2 md:grid-cols-4">
            {Array.from({ length: metrics }).map((_, i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-lg bg-foreground/[0.05]"
                style={{ animationDelay: `${i * 60}ms` }}
              />
            ))}
          </div>
        ) : null}

        <div className="h-px w-full bg-foreground/[0.06]" />

        <div className="space-y-2">
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-md bg-foreground/[0.04]"
              style={{ animationDelay: `${i * 50}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
