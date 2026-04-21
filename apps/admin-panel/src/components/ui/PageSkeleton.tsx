/**
 * Admin dashboard loading skeleton used by Next.js `loading.tsx` boundaries.
 *
 * Rendered automatically while a heavy client page's JS chunk is downloading
 * (navigation) or while a server component is streaming. Replaces the previous
 * "blank screen" gap — users see structure immediately, which perceptibly
 * feels 2× faster even when actual TTI is unchanged.
 *
 * NOT wrapped in `'use client'` on purpose: this renders from the server for
 * the very first paint and doesn't need client interactivity.
 */
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="min-h-screen w-full bg-admin-bg p-6">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <div className="h-8 w-64 animate-pulse rounded-md bg-white/5" />
        <div className="h-4 w-96 animate-pulse rounded bg-white/5" />

        <div className="grid grid-cols-1 gap-4 pt-2 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-white/5" />
          ))}
        </div>

        <div className="h-[1px] w-full bg-white/5" />

        <div className="space-y-2">
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-md bg-white/[0.04]"
              style={{ animationDelay: `${i * 60}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
