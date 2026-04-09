'use client';

import { Activity, RefreshCw } from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import type { MMGlobalMode, MMGlobalRuntimeConfig, MmControlStatus } from '@/lib/mm-control-api';
import {
  aggregateFillRate,
  deriveDeskRiskLevel,
  mmIsRunning,
  type DeskRiskLevel,
} from '@/lib/mm-desk-helpers';
import { SIGNAL_TEXT, signalPnlDaily, signalFillRate, type SignalLevel } from '@/lib/mm-desk-signals';
import { cn } from '@/lib/cn';

const riskLabel: Record<DeskRiskLevel, string> = {
  low: 'Low',
  normal: 'Normal',
  elevated: 'Elevated',
  high: 'High',
};

const riskBadge: Record<DeskRiskLevel, 'success' | 'default' | 'warning' | 'danger'> = {
  low: 'success',
  normal: 'default',
  elevated: 'warning',
  high: 'danger',
};

type Props = {
  status: MmControlStatus | null;
  globalDraft: MMGlobalRuntimeConfig | null;
  onRefresh: () => void;
  onStopAll: () => void;
  onSafeMode: () => void;
  onResetDesk: () => void;
  onSetMode: (mode: MMGlobalMode) => void;
  globalBusy: boolean;
};

export function MmDeskStatusBar({
  status,
  globalDraft,
  onRefresh,
  onStopAll,
  onSafeMode,
  onResetDesk,
  onSetMode,
  globalBusy,
}: Props) {
  const botOn = status?.bot.enabled ?? false;
  const runtimeOn = globalDraft?.enabled ?? false;
  const running = mmIsRunning(globalDraft ?? undefined, botOn);
  const pnl =
    status?.daily_target_progress?.pnl_today_usd != null
      ? status.daily_target_progress.pnl_today_usd
      : null;
  const fillAvg = status ? aggregateFillRate(status.live) : 0;
  const risk = deriveDeskRiskLevel(globalDraft ?? undefined, status?.live ?? []);
  const mode = globalDraft?.mode ?? 'normal';

  const sigPnl = signalPnlDaily(pnl);
  const sigFill = signalFillRate(fillAvg);

  return (
    <div className="rounded-ds-lg border border-admin-border bg-admin-card/40 backdrop-blur-sm">
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-admin-accent" />
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">MM status</p>
              <div className="flex items-center gap-2">
                {!botOn ? (
                  <Badge variant="warning">Bot off (env)</Badge>
                ) : running ? (
                  <Badge variant="success" className={cn('border border-emerald-500/30', SIGNAL_TEXT.healthy)}>
                    Running
                  </Badge>
                ) : (
                  <Badge variant="danger" className={cn('border border-red-500/30', SIGNAL_TEXT.risk)}>
                    Stopped
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="hidden h-8 w-px bg-admin-border sm:block" aria-hidden />

          <Metric label="PnL today" value={pnl != null ? `$${pnl.toFixed(2)}` : '—'} mono signal={sigPnl} />
          <Metric
            label="Fill rate (avg)"
            value={status?.live.length ? `${(fillAvg * 100).toFixed(0)}%` : '—'}
            mono
            signal={sigFill}
          />
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">Risk level</p>
            <Badge variant={riskBadge[risk]}>{riskLabel[risk]}</Badge>
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" size="sm" className="gap-2" onClick={onRefresh} disabled={globalBusy}>
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
            <Button variant="danger" size="sm" onClick={onStopAll} disabled={globalBusy}>
              Stop all
            </Button>
            <Button variant="outline" size="sm" onClick={onSafeMode} disabled={globalBusy}>
              Safe mode
            </Button>
            <Button variant="secondary" size="sm" onClick={onResetDesk} disabled={globalBusy}>
              Reset desk
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-admin-muted">Mode</span>
            <Button
              variant={mode === 'safe' ? 'primary' : 'outline'}
              size="sm"
              className="h-7 min-w-[4.5rem] px-2 text-xs"
              onClick={() => onSetMode('safe')}
              disabled={globalBusy}
            >
              Safe
            </Button>
            <Button
              variant={mode === 'normal' ? 'primary' : 'outline'}
              size="sm"
              className="h-7 min-w-[4.5rem] px-2 text-xs"
              onClick={() => onSetMode('normal')}
              disabled={globalBusy}
            >
              Normal
            </Button>
            <Button
              variant={mode === 'aggressive' ? 'primary' : 'outline'}
              size="sm"
              className="h-7 min-w-[4.5rem] px-2 text-xs"
              onClick={() => onSetMode('aggressive')}
              disabled={globalBusy}
            >
              Aggressive
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  mono,
  signal,
}: {
  label: string;
  value: string;
  mono?: boolean;
  signal?: SignalLevel;
}) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">{label}</p>
      <p
        className={cn(
          'text-sm font-semibold tabular-nums',
          mono && 'font-mono',
          signal ? SIGNAL_TEXT[signal] : 'text-admin-text'
        )}
      >
        {value}
      </p>
    </div>
  );
}
