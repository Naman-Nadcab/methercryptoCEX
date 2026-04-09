import type { MMGlobalRuntimeConfig, MmControlStatus } from '@/lib/mm-control-api';

/** Trading-desk semantic colors (tailwind). */
export type SignalLevel = 'healthy' | 'warning' | 'risk';

export const SIGNAL_TEXT: Record<SignalLevel, string> = {
  healthy: 'text-emerald-400',
  warning: 'text-amber-400',
  risk: 'text-red-400',
};

export const SIGNAL_SOFT_BG: Record<SignalLevel, string> = {
  healthy: 'bg-emerald-500/10',
  warning: 'bg-amber-500/10',
  risk: 'bg-red-500/10',
};

/** 1h pair PnL (quote): green near flat/up, yellow drift, red stress. */
export function signalPnl1h(pnl: number | null | undefined): SignalLevel {
  if (pnl == null || !Number.isFinite(pnl)) return 'warning';
  if (pnl >= -2) return 'healthy';
  if (pnl >= -40) return 'warning';
  return 'risk';
}

/** Daily desk PnL (USD). */
export function signalPnlDaily(pnl: number | null | undefined): SignalLevel {
  if (pnl == null || !Number.isFinite(pnl)) return 'warning';
  if (pnl >= 0) return 'healthy';
  if (pnl >= -80) return 'warning';
  return 'risk';
}

/**
 * Fill-rate proxy [0,1]: very cold or very hot → caution; mid band → healthy.
 */
export function signalFillRate(fr: number): SignalLevel {
  if (!Number.isFinite(fr)) return 'warning';
  if (fr >= 0.1 && fr <= 0.72) return 'healthy';
  if (fr < 0.1 || fr <= 0.88) return 'warning';
  return 'risk';
}

export function signalToxic(toxic: boolean): SignalLevel {
  return toxic ? 'risk' : 'healthy';
}

/** Desk row status: active = on track, risk = guards/toxic, paused = off. */
export function signalDeskStatus(status: 'active' | 'risk' | 'paused'): SignalLevel {
  if (status === 'active') return 'healthy';
  if (status === 'risk') return 'warning';
  return 'risk';
}

export type DeskAlertFixId = 'enable_mm_runtime' | 'safe_desk_mode';

export type DeskAlertFix = {
  id: DeskAlertFixId;
  label: string;
};

export type DeskAlert = {
  id: string;
  level: 'critical' | 'warning';
  message: string;
  symbol?: string;
  fixes?: DeskAlertFix[];
};

export function buildDeskAlerts(
  status: MmControlStatus | null,
  global: MMGlobalRuntimeConfig | null
): DeskAlert[] {
  const alerts: DeskAlert[] = [];
  if (!status) return alerts;

  if (!status.bot.enabled) {
    alerts.push({
      id: 'env-bot-off',
      level: 'critical',
      message: 'Liquidity bot is off (environment). No automated quotes will run.',
    });
  }

  if (global && !global.enabled && status.bot.enabled) {
    alerts.push({
      id: 'runtime-stopped',
      level: 'critical',
      message: 'MM runtime is disabled — bot cycles are skipped until re-enabled.',
      fixes: [{ id: 'enable_mm_runtime', label: 'Enable MM runtime' }],
    });
  }

  if (global?.mode === 'aggressive' && status.live.some((r) => r.toxic_flow)) {
    alerts.push({
      id: 'aggr-toxic',
      level: 'warning',
      message: 'Aggressive desk mode while toxic-flow flags are present — consider Safe mode.',
      fixes: [{ id: 'safe_desk_mode', label: 'Set Safe mode' }],
    });
  }

  const toxicSyms = status.live.filter((r) => r.toxic_flow).map((r) => r.symbol);
  if (toxicSyms.length === 1) {
    alerts.push({
      id: `toxic-${toxicSyms[0]}`,
      level: 'critical',
      message: `Toxic-flow signal on ${toxicSyms[0]} — wider spread / reduced size may be active.`,
      symbol: toxicSyms[0],
      fixes: [{ id: 'safe_desk_mode', label: 'Set Safe mode' }],
    });
  } else if (toxicSyms.length > 1) {
    alerts.push({
      id: 'toxic-multi',
      level: 'critical',
      message: `Toxic-flow on ${toxicSyms.length} markets: ${toxicSyms.slice(0, 5).join(', ')}${toxicSyms.length > 5 ? '…' : ''}`,
      fixes: [{ id: 'safe_desk_mode', label: 'Set Safe mode' }],
    });
  }

  const pausedPairs = status.live.filter((r) => {
    const cfg = status.pairs[r.symbol];
    return global?.enabled && cfg?.enabled === false;
  });
  if (pausedPairs.length > 0 && global?.enabled) {
    alerts.push({
      id: 'pairs-paused',
      level: 'warning',
      message: `${pausedPairs.length} market(s) have pair runtime disabled: ${pausedPairs
        .map((r) => r.symbol)
        .slice(0, 6)
        .join(', ')}${pausedPairs.length > 6 ? '…' : ''}`,
    });
  }

  const guarded = status.live.filter((r) => r.skipBidPlacement || r.skipAskPlacement);
  if (guarded.length > 0) {
    alerts.push({
      id: 'inventory-guard',
      level: 'warning',
      message: `${guarded.length} market(s) under inventory/cap guard (bid/ask placement skewed).`,
    });
  }

  const maxLoss = global?.max_daily_loss_usd;
  const prog = status.daily_target_progress;
  if (maxLoss && maxLoss > 0 && prog && prog.pnl_today_usd < -0.72 * maxLoss) {
    alerts.push({
      id: 'daily-pnl-stress',
      level: 'critical',
      message: `Daily PnL (${prog.pnl_today_usd.toFixed(0)} USD) is near configured max daily loss (${maxLoss} USD).`,
      fixes: [{ id: 'safe_desk_mode', label: 'Set Safe mode' }],
    });
  }

  return alerts;
}
