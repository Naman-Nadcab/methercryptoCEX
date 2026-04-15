'use client';

import { useQuery } from '@tanstack/react-query';
import { getExchangeHealthTier1 } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { RefreshCw, AlertTriangle, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

const TIER1_QUERY_KEY = 'exchange-health-tier1' as const;

export function ExchangeHealthTier1Banner({ token, className }: { token: string | null; className?: string }) {
  const q = useQuery({
    queryKey: ['admin', TIER1_QUERY_KEY, token],
    queryFn: () => getExchangeHealthTier1(token),
    enabled: !!token,
    staleTime: 15_000,
    refetchInterval: () =>
      typeof document !== 'undefined' && document.visibilityState === 'visible' ? 30_000 : false,
  });

  const tier = q.data?.data;
  const overall = tier?.overall;
  const reasons = tier?.reasons ?? [];
  const ts = tier?.timestamp;

  const isGreen = overall === 'GREEN';
  const isYellow = overall === 'YELLOW';

  if (!token) return null;

  return (
    <div
      className={cn(
        'rounded-xl border px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between relative overflow-hidden transition-all duration-500',
        isGreen
          ? 'border-emerald-500/20 bg-gradient-to-r from-emerald-500/5 via-admin-card to-admin-card'
          : isYellow
            ? 'border-amber-500/20 bg-gradient-to-r from-amber-500/8 via-admin-card to-admin-card'
            : 'border-red-500/25 bg-gradient-to-r from-red-500/8 via-admin-card to-admin-card',
        !isGreen && !isYellow && overall && 'shadow-glow-danger',
        className,
      )}
    >
      {/* Subtle pulse glow for non-green states */}
      {overall && !isGreen && (
        <div className={cn(
          'absolute inset-0 rounded-xl pointer-events-none',
          isYellow ? 'bg-gradient-to-r from-amber-500/3 to-transparent' : 'bg-gradient-to-r from-red-500/5 to-transparent subtle-pulse',
        )} />
      )}

      <div className="min-w-0 space-y-1.5 relative z-10">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Status icon */}
          {q.isLoading ? (
            <RefreshCw className="h-4 w-4 animate-spin text-admin-muted" />
          ) : q.isError ? (
            <AlertCircle className="h-4 w-4 text-red-400" />
          ) : isGreen ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          ) : isYellow ? (
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-red-400 subtle-pulse" />
          )}

          <span className="text-xs font-bold uppercase tracking-[0.1em] text-admin-muted">
            Exchange Health
          </span>

          {q.isLoading ? (
            <span className="text-[10px] text-admin-muted">Checking…</span>
          ) : q.isError ? (
            <Badge variant="danger">Unavailable</Badge>
          ) : overall ? (
            <Badge variant={isGreen ? 'success' : isYellow ? 'warning' : 'danger'}>{overall}</Badge>
          ) : (
            <Badge variant="default">Unknown</Badge>
          )}

          {ts && (
            <span className="text-[10px] text-admin-muted/60 tabular-nums font-mono">
              {new Date(ts).toLocaleTimeString()}
            </span>
          )}
        </div>

        {q.isError ? (
          <p className="text-xs text-red-400 flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            {(q.error as Error)?.message ?? 'Health check failed'}
          </p>
        ) : reasons.length > 0 ? (
          <div className="flex flex-wrap gap-2 mt-1">
            {reasons.slice(0, 6).map((r, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-md bg-white/[0.03] border border-admin-border px-2 py-0.5 text-[10px] text-admin-muted">
                <span className={cn('h-1 w-1 rounded-full shrink-0', isYellow ? 'bg-amber-400' : 'bg-red-400')} />
                {r}
              </span>
            ))}
          </div>
        ) : !q.isLoading && overall ? (
          <p className="text-xs text-admin-muted/70">No active degradation signals.</p>
        ) : null}
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="shrink-0 relative z-10"
        onClick={() => void q.refetch()}
        disabled={q.isFetching}
      >
        <RefreshCw className={cn('h-3.5 w-3.5 mr-1', q.isFetching && 'animate-spin')} />
        Retry
      </Button>
    </div>
  );
}

export { TIER1_QUERY_KEY };
