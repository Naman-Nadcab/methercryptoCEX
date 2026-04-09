'use client';

import { Settings2, Power, PowerOff, RotateCcw, Zap, Ban, Undo2 } from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import type { MmControlStatus } from '@/lib/mm-control-api';
import {
  derivePairDeskStatus,
  displaySpreadBps,
  type LiveRow,
  type PairDeskStatus,
} from '@/lib/mm-desk-helpers';
import {
  SIGNAL_TEXT,
  signalDeskStatus,
  signalFillRate,
  signalPnl1h,
  signalToxic,
} from '@/lib/mm-desk-signals';
import type { ParsedEliteSymbol } from '@/lib/mm-desk-elite-parse';
import { computeCapitalUsagePct, computeInventorySkewPct } from '@/lib/mm-desk-elite-parse';
import { MmDeskSparkline } from './MmDeskSparkline';
import { MmDeskMiniBar, MmDeskSkewBar } from './MmDeskMiniBar';
import { cn } from '@/lib/cn';

const statusLabel: Record<PairDeskStatus, string> = {
  active: 'Active',
  risk: 'Risk',
  paused: 'Paused',
};

const statusVariant: Record<PairDeskStatus, 'success' | 'warning' | 'danger'> = {
  active: 'success',
  risk: 'warning',
  paused: 'danger',
};

export type PairSparkHistory = Record<string, { pnl: number[]; fill: number[] }>;

type Props = {
  status: MmControlStatus;
  selectedSymbol: string | null;
  globalEnabled: boolean;
  globalMaxPositionUsd?: number;
  sparkHistory: PairSparkHistory;
  eliteBySymbol?: Record<string, ParsedEliteSymbol | null>;
  onSelect: (symbol: string) => void;
  onPairToggle: (symbol: string, enabled: boolean) => void;
  onConfigure: (symbol: string) => void;
  onResetPair: (symbol: string) => void;
  onForceRequote: (symbol: string) => void;
  onRequestCancelAll: (symbol: string) => void;
  onRequestUnwind: (symbol: string) => void;
  pendingSymbol: string | null;
  forceRequoteSymbol?: string | null;
};

export function MmPairTable({
  status,
  selectedSymbol,
  globalEnabled,
  globalMaxPositionUsd,
  sparkHistory,
  eliteBySymbol = {},
  onSelect,
  onPairToggle,
  onConfigure,
  onResetPair,
  onForceRequote,
  onRequestCancelAll,
  onRequestUnwind,
  pendingSymbol,
  forceRequoteSymbol,
}: Props) {
  const cap = status.capital_per_pair ?? {};

  return (
    <div className="overflow-x-auto rounded-ds-md border border-admin-border">
      <table className="w-full min-w-[1320px] text-sm">
        <thead>
          <tr className="border-b border-admin-border bg-admin-bg/80 text-left text-[10px] font-semibold uppercase tracking-wide text-admin-muted">
            <th className="px-3 py-2.5">Symbol</th>
            <th className="px-3 py-2.5">Status</th>
            <th className="px-3 py-2.5">Inv. lean</th>
            <th className="px-3 py-2.5">Capital</th>
            <th className="px-3 py-2.5">Fill %</th>
            <th className="px-3 py-2.5">Trend</th>
            <th className="px-3 py-2.5">Spread</th>
            <th className="px-3 py-2.5">Orders</th>
            <th className="px-3 py-2.5">Position</th>
            <th className="px-3 py-2.5">PnL 1h</th>
            <th className="px-3 py-2.5">Toxic</th>
            <th className="px-3 py-2.5">Force</th>
            <th className="px-3 py-2.5 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {status.live.map((row) => (
            <MmPairRow
              key={row.symbol}
              row={row}
              selected={selectedSymbol === row.symbol}
              pairCfg={status.pairs[row.symbol]}
              capitalEff={cap[row.symbol]?.effective_usd}
              globalMaxPositionUsd={globalMaxPositionUsd}
              spreadBps={displaySpreadBps(row.symbol, status.pairs, status.bot.envSpreadBps)}
              deskStatus={derivePairDeskStatus(row, status.pairs[row.symbol], globalEnabled)}
              configured={status.pairKeys.includes(row.symbol)}
              spark={sparkHistory[row.symbol] ?? { pnl: [], fill: [] }}
              elite={eliteBySymbol[row.symbol] ?? null}
              onSelect={() => onSelect(row.symbol)}
              onPairToggle={(en) => onPairToggle(row.symbol, en)}
              onConfigure={() => onConfigure(row.symbol)}
              onResetPair={() => onResetPair(row.symbol)}
              onForceRequote={() => onForceRequote(row.symbol)}
              onRequestCancelAll={() => onRequestCancelAll(row.symbol)}
              onRequestUnwind={() => onRequestUnwind(row.symbol)}
              busy={pendingSymbol === row.symbol}
              requoteBusy={forceRequoteSymbol === row.symbol}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Base-lean %: -100 short … 0 neutral … +100 long (derived from desk skew 0–100). */
function baseLeanFromSkew(skewPct: number) {
  return Math.round(Math.max(-100, Math.min(100, (skewPct - 50) * 2)));
}

function MmPairRow({
  row,
  selected,
  pairCfg,
  capitalEff,
  globalMaxPositionUsd,
  spreadBps,
  deskStatus,
  configured,
  spark,
  elite,
  onSelect,
  onPairToggle,
  onConfigure,
  onResetPair,
  onForceRequote,
  onRequestCancelAll,
  onRequestUnwind,
  busy,
  requoteBusy,
}: {
  row: LiveRow;
  selected: boolean;
  pairCfg: MmControlStatus['pairs'][string] | undefined;
  capitalEff: number | undefined;
  globalMaxPositionUsd?: number;
  spreadBps: number;
  deskStatus: PairDeskStatus;
  configured: boolean;
  spark: { pnl: number[]; fill: number[] };
  elite: ParsedEliteSymbol | null;
  onSelect: () => void;
  onPairToggle: (enabled: boolean) => void;
  onConfigure: () => void;
  onResetPair: () => void;
  onForceRequote: () => void;
  onRequestCancelAll: () => void;
  onRequestUnwind: () => void;
  busy: boolean;
  requoteBusy: boolean;
}) {
  const pairOn = pairCfg?.enabled !== false;
  const fr = row.fill_rate ?? 0;
  const toxic = row.toxic_flow ?? false;
  const sigStatus = signalDeskStatus(deskStatus);
  const sigFr = signalFillRate(fr);
  const sigPnl = signalPnl1h(row.pnl1hUsd);
  const sigToxic = signalToxic(toxic);

  const positionUsd = Number(row.positionUsd);
  const totalCapUsd = Math.max(
    capitalEff ?? 0,
    pairCfg?.max_position_usd ?? 0,
    globalMaxPositionUsd ?? 0
  );
  const capUsagePct = computeCapitalUsagePct(positionUsd, totalCapUsd);
  const skewPct = computeInventorySkewPct(positionUsd, totalCapUsd, elite?.inventoryBase);
  const baseLean = baseLeanFromSkew(skewPct);

  const pnlStroke =
    sigPnl === 'risk' ? 'stroke-red-400/90' : sigPnl === 'warning' ? 'stroke-amber-400/90' : 'stroke-emerald-400/80';
  const fillStroke =
    sigFr === 'risk' ? 'stroke-red-400/80' : sigFr === 'warning' ? 'stroke-amber-400/80' : 'stroke-sky-400/80';

  const usedAbs = Math.abs(positionUsd);
  const capLabel =
    totalCapUsd > 0
      ? `$${usedAbs.toFixed(0)} / $${totalCapUsd.toFixed(0)} · ${capUsagePct.toFixed(0)}%`
      : '—';

  return (
    <tr
      className={cn(
        'cursor-pointer border-b border-admin-border/60 transition-colors',
        selected ? 'bg-admin-accent/10' : 'hover:bg-admin-card/40'
      )}
      onClick={onSelect}
    >
      <td className="px-3 py-2.5">
        <span className="font-mono font-medium text-admin-text">{row.symbol}</span>
        {!configured && (
          <span className="ml-2 text-[10px] text-admin-muted">defaults</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <Badge
          variant={statusVariant[deskStatus]}
          className={cn('border border-white/10', SIGNAL_TEXT[sigStatus])}
        >
          {statusLabel[deskStatus]}
        </Badge>
      </td>
      <td className="w-[140px] px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-1" title="Inventory lean vs cap (USD) and optional base hint from MM metrics">
          <MmDeskSkewBar skewPct={skewPct} />
          <div className="font-mono text-[10px] tabular-nums text-admin-muted">
            Base lean{' '}
            <span className={cn(baseLean > 0 ? 'text-emerald-300/90' : baseLean < 0 ? 'text-rose-300/90' : '')}>
              {baseLean > 0 ? '+' : ''}
              {baseLean}%
            </span>
          </div>
        </div>
      </td>
      <td className="w-[150px] px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-1">
          <MmDeskMiniBar valuePct={capUsagePct} barClassName="bg-sky-500/75" />
          <div className="font-mono text-[10px] tabular-nums text-admin-muted">{capLabel}</div>
        </div>
      </td>
      <td className={cn('px-3 py-2.5 font-mono text-xs tabular-nums font-semibold', SIGNAL_TEXT[sigFr])}>
        {(fr * 100).toFixed(0)}%
      </td>
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <div className="flex flex-col gap-0.5" title="PnL 1h (recent polls)">
            <span className="text-[9px] uppercase text-admin-muted">PnL</span>
            <MmDeskSparkline values={spark.pnl} strokeClass={pnlStroke} width={52} height={18} />
          </div>
          <div className="flex flex-col gap-0.5" title="Fill rate (recent polls)">
            <span className="text-[9px] uppercase text-admin-muted">Fill</span>
            <MmDeskSparkline values={spark.fill} strokeClass={fillStroke} width={52} height={18} />
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 font-mono tabular-nums text-admin-muted">{spreadBps} bps</td>
      <td className="px-3 py-2.5 tabular-nums">{row.openOrders}</td>
      <td className="px-3 py-2.5 font-mono tabular-nums">{positionUsd.toFixed(2)}</td>
      <td className={cn('px-3 py-2.5 font-mono text-xs tabular-nums font-semibold', SIGNAL_TEXT[sigPnl])}>
        {row.pnl1hUsd != null ? row.pnl1hUsd.toFixed(4) : '—'}
      </td>
      <td className="px-3 py-2.5">
        <span
          className={cn(
            'inline-flex h-2.5 w-2.5 rounded-full',
            sigToxic === 'risk'
              ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.55)]'
              : 'bg-emerald-500/90 shadow-[0_0_6px_rgba(16,185,129,0.35)]'
          )}
          title={toxic ? 'Toxic flow — defensive quoting' : 'Clear'}
        />
      </td>
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-nowrap gap-0.5">
          <Button
            variant="secondary"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={busy || requoteBusy}
            title="Force re-quote (fast refresh — bot may still gate)"
            onClick={onForceRequote}
          >
            <Zap className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={busy}
            title="Cancel all open orders on this market (all users) — confirm"
            onClick={onRequestCancelAll}
          >
            <Ban className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={busy}
            title="Force unwind — operator checklist (no auto API)"
            onClick={onRequestUnwind}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap justify-end gap-1">
          {pairOn ? (
            <Button variant="secondary" size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => onPairToggle(false)} title="Stop pair">
              <PowerOff className="h-3 w-3" />
            </Button>
          ) : (
            <Button variant="secondary" size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => onPairToggle(true)} title="Start pair">
              <Power className="h-3 w-3" />
            </Button>
          )}
          <Button variant="secondary" size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={onConfigure} title="Configure">
            <Settings2 className="h-3 w-3" />
          </Button>
          <Button variant="secondary" size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={onResetPair} title="Reset to env defaults">
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
