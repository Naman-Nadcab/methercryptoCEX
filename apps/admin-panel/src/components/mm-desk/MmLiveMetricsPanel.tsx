'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import type { MmControlStatus } from '@/lib/mm-control-api';
import { activeInventoryBias, displaySpreadBps } from '@/lib/mm-desk-helpers';

const biasCopy: Record<ReturnType<typeof activeInventoryBias>, string> = {
  'two-sided': 'Two-sided quoting',
  'favor-bid': 'Skew: favor bids (reduce short / add inventory)',
  'favor-ask': 'Skew: favor asks (reduce long / offload inventory)',
  'both-skipped': 'Both sides guarded — review caps / risk',
};

type Props = {
  status: MmControlStatus | null;
  symbol: string | null;
};

export function MmLiveMetricsPanel({ status, symbol }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Live metrics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!symbol || !status ? (
          <p className="text-admin-muted">Select a symbol to load snapshot fields.</p>
        ) : (
          (() => {
            const row = status.live.find((r) => r.symbol === symbol);
            if (!row) return <p className="text-admin-muted">No live row for this symbol.</p>;
            const spread = displaySpreadBps(symbol, status.pairs, status.bot.envSpreadBps);
            const perf = status.pair_performance?.[symbol];
            const bias = activeInventoryBias(row);
            const pos = Number(row.positionUsd);
            const maxHint = status.pairs[symbol]?.max_position_usd;

            return (
              <div className="space-y-3">
                <MetricRow label="Current spread (config)" value={`${spread} bps`} hint="Manual bps or env baseline for auto" />
                <MetricRow
                  label="Inventory notional"
                  value={`$${pos.toFixed(2)}`}
                  hint={maxHint ? `Pair max position cap: $${maxHint}` : undefined}
                />
                <MetricRow label="Fills (1h est.)" value={perf != null ? String(perf.trades) : '—'} hint="Trade count from desk performance snapshot" />
                <MetricRow
                  label="Last trade time"
                  value="—"
                  hint="Not exposed in MM status API; use exchange trade feed for precise time"
                />
                <MetricRow label="Active bias" value={biasCopy[bias]} />
              </div>
            );
          })()
        )}
      </CardContent>
    </Card>
  );
}

function MetricRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-ds-md border border-admin-border/60 bg-admin-bg/30 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-admin-muted">{label}</p>
      <p className="mt-0.5 font-medium text-admin-text">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-admin-muted">{hint}</p> : null}
    </div>
  );
}
