'use client';

import { useQuery } from '@tanstack/react-query';
import { getControlOverview } from '@/lib/api';
import { getAdminSpotOrderbook, getMmEliteProfitability } from '@/lib/mm-desk-extra-api';
import { parseEliteSymbolMetrics } from '@/lib/mm-desk-elite-parse';
import { Card, CardHeader, CardTitle, CardContent, Skeleton } from '@/components/ui';

function sumTopNotional(levels: { price: string; quantity: string }[], n: number) {
  return levels.slice(0, n).reduce((sum, l) => {
    const p = Number(l.price);
    const q = Number(l.quantity);
    return sum + (Number.isFinite(p) && Number.isFinite(q) ? p * q : 0);
  }, 0);
}

function fmtUsd(n: number) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

/** 0–3 edge vs half-spread from backend; map to a simple 0–100 desk score. */
function execScorePct(eff: number) {
  return Math.round(Math.min(100, Math.max(0, (eff / 3) * 100)));
}

type Props = { token: string | null; symbol: string | null };

export function MmExecutionDepthPanel({ token, symbol }: Props) {
  const enabled = !!token && !!symbol;

  const obQ = useQuery({
    queryKey: ['admin', 'mm-desk-orderbook', token, symbol],
    queryFn: () => getAdminSpotOrderbook(token, symbol!, 20),
    enabled,
    staleTime: 10_000,
  });

  const eliteQ = useQuery({
    queryKey: ['admin', 'mm-elite-profitability', token],
    queryFn: () => getMmEliteProfitability(token),
    enabled: !!token,
    staleTime: 15_000,
  });

  const overviewQ = useQuery({
    queryKey: ['admin', 'control-overview', 'mm-desk', token],
    queryFn: () => getControlOverview(token),
    enabled: !!token,
    staleTime: 10_000,
  });

  const symMap = eliteQ.data?.data?.symbols;
  const elite =
    symbol && symMap && typeof symMap === 'object'
      ? parseEliteSymbolMetrics((symMap as Record<string, unknown>)[symbol])
      : null;

  const rawOv = overviewQ.data?.data as
    | { spotMetrics?: { tradesPerSecond?: number; tradesLastMinute?: number } }
    | undefined;
  const tps = rawOv?.spotMetrics?.tradesPerSecond;
  const tlm = rawOv?.spotMetrics?.tradesLastMinute;

  const bids = obQ.data?.data?.bids ?? [];
  const asks = obQ.data?.data?.asks ?? [];
  const bidDepth = sumTopNotional(bids, 8);
  const askDepth = sumTopNotional(asks, 8);

  if (!symbol) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Execution & depth</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-admin-muted">
          Select a market row to load execution stats and book depth.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="font-mono text-base">{symbol}</CardTitle>
        <p className="text-xs text-admin-muted">
          Venue trade speed is global; window fills and fill-quality rows use MM bot metrics when configured.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {obQ.isLoading && !obQ.data ? <Skeleton className="h-16 w-full" /> : null}

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-admin-border/60 bg-admin-bg/30 p-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-admin-muted">Bid depth</div>
            <div className="font-mono text-admin-text" title="Top-of-book notional, first 8 levels">
              {fmtUsd(bidDepth)}
            </div>
          </div>
          <div className="rounded-md border border-admin-border/60 bg-admin-bg/30 p-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-admin-muted">Ask depth</div>
            <div className="font-mono text-admin-text" title="Top-of-book notional, first 8 levels">
              {fmtUsd(askDepth)}
            </div>
          </div>
        </div>

        <div className="rounded-md border border-admin-border/60 bg-admin-bg/30 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-admin-muted">Last window fills</div>
          <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-xs text-admin-text">
            <span className="text-admin-muted">1h count</span>
            <span>{elite?.fills1h != null ? elite.fills1h : '—'}</span>
            <span className="text-admin-muted">5m count</span>
            <span>{elite?.fills5m != null ? elite.fills5m : '—'}</span>
          </div>
        </div>

        <div className="rounded-md border border-admin-border/60 bg-admin-bg/30 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-admin-muted">Trade speed (venue)</div>
          <div className="font-mono text-xs text-admin-text">
            {tps != null ? `${tps.toFixed(2)} /s` : '—'}
            {tlm != null ? <span className="ml-2 text-admin-muted">({tlm} trades / min)</span> : null}
          </div>
        </div>

        <div className="rounded-md border border-admin-border/60 bg-admin-bg/30 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-admin-muted">Fill quality (1h)</div>
          <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-xs text-admin-text">
            <span className="text-admin-muted">Score</span>
            <span title="Edge vs configured half-spread, normalized">
              {elite?.executionEfficiency != null ? `${execScorePct(elite.executionEfficiency)}%` : '—'}
            </span>
            <span className="text-admin-muted">Avg slip</span>
            <span>{elite?.avgSlippageBps != null ? `${elite.avgSlippageBps.toFixed(1)} bps` : '—'}</span>
          </div>
        </div>

        {obQ.isError ? <p className="text-xs text-admin-danger">Order book snapshot failed.</p> : null}
        {eliteQ.data?.data && 'configured' in eliteQ.data.data && eliteQ.data.data.configured === false ? (
          <p className="text-[11px] text-admin-muted">Elite MM metrics unavailable (liquidity bot not configured).</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
