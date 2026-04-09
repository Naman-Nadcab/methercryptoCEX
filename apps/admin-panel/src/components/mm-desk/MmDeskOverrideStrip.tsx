'use client';

import { Badge } from '@/components/ui';
import type { MMGlobalRuntimeConfig, MMPairRuntimeConfig } from '@/lib/mm-control-api';
import { cn } from '@/lib/cn';

type Props = {
  global: MMGlobalRuntimeConfig | null;
  pair: MMPairRuntimeConfig | undefined;
  symbol: string | null;
};

export function MmDeskOverrideStrip({ global, pair, symbol }: Props) {
  if (!symbol || !global) return null;

  const gMode = global.mode;
  const spreadOv = pair?.spread_mode === 'manual';
  const flowOv = pair && pair.flow_mode !== 'neutral';
  const hasOverride = spreadOv || flowOv;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-ds-md border border-admin-border/80 bg-admin-bg/40 px-3 py-2 text-xs">
      <span className="font-medium uppercase tracking-wide text-admin-muted">Effective desk</span>
      <Badge variant="primary" className="capitalize">
        {gMode}
      </Badge>
      <span className="text-admin-muted">global mode</span>
      {pair ? (
        <>
          <span className="text-admin-border">·</span>
          <span className="text-admin-muted">Pair</span>
          <span className="font-mono text-admin-text">{symbol}</span>
          <Badge variant={spreadOv ? 'warning' : 'default'}>{spreadOv ? 'manual spread' : 'auto spread'}</Badge>
          <Badge variant={flowOv ? 'warning' : 'default'} className="capitalize">
            flow: {pair.flow_mode}
          </Badge>
          {hasOverride ? (
            <Badge variant="warning" badgeStyle="outline" className="border-amber-500/40">
              Overrides active
            </Badge>
          ) : (
            <span className={cn('text-[10px] text-admin-muted')}>No pair override vs flow/spread</span>
          )}
        </>
      ) : null}
    </div>
  );
}
