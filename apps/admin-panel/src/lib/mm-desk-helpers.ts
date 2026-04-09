import type { MMGlobalRuntimeConfig, MMPairRuntimeConfig, MmControlStatus } from '@/lib/mm-control-api';

export type LiveRow = MmControlStatus['live'][number];

export function mmIsRunning(global: MMGlobalRuntimeConfig | undefined, botEnabled: boolean): boolean {
  return Boolean(global?.enabled && botEnabled);
}

export type DeskRiskLevel = 'low' | 'normal' | 'elevated' | 'high';

export function deriveDeskRiskLevel(
  global: MMGlobalRuntimeConfig | undefined,
  live: LiveRow[]
): DeskRiskLevel {
  const mode = global?.mode ?? 'normal';
  const anyToxic = live.some((r) => r.toxic_flow);
  if (mode === 'safe') return anyToxic ? 'normal' : 'low';
  if (mode === 'aggressive') return anyToxic ? 'high' : 'elevated';
  return anyToxic ? 'elevated' : 'normal';
}

export type PairDeskStatus = 'active' | 'risk' | 'paused';

export function derivePairDeskStatus(
  row: LiveRow,
  pairCfg: MMPairRuntimeConfig | undefined,
  globalEnabled: boolean
): PairDeskStatus {
  if (!globalEnabled || pairCfg?.enabled === false) return 'paused';
  if (row.toxic_flow || row.skipBidPlacement || row.skipAskPlacement) return 'risk';
  return 'active';
}

/** Display spread: manual pair bps else env baseline (desk auto path not fully observable). */
export function displaySpreadBps(
  symbol: string,
  pairs: Record<string, MMPairRuntimeConfig>,
  envSpreadBps: number
): number {
  const c = pairs[symbol];
  if (c?.spread_mode === 'manual') return c.spread_bps;
  return envSpreadBps;
}

export function aggregateFillRate(live: LiveRow[]): number {
  if (!live.length) return 0;
  const sum = live.reduce((a, r) => a + (r.fill_rate ?? 0), 0);
  return sum / live.length;
}

export function activeInventoryBias(row: LiveRow): 'two-sided' | 'favor-bid' | 'favor-ask' | 'both-skipped' {
  if (row.skipBidPlacement && row.skipAskPlacement) return 'both-skipped';
  if (row.skipBidPlacement && !row.skipAskPlacement) return 'favor-ask';
  if (!row.skipBidPlacement && row.skipAskPlacement) return 'favor-bid';
  return 'two-sided';
}

export function buildPairIntelligence(
  symbol: string,
  status: MmControlStatus,
  global: MMGlobalRuntimeConfig
): string[] {
  const row = status.live.find((r) => r.symbol === symbol);
  const pair = status.pairs[symbol];
  const learn = status.spread_learning?.[symbol];
  const reasons: string[] = [];

  if (!global.enabled) reasons.push('Global MM runtime is disabled — bot cycles are skipped.');
  if (pair?.enabled === false) reasons.push('Pair is disabled in runtime config.');
  if (row?.toxic_flow) reasons.push('Toxic-flow signal: desk widened spread and reduced size for this symbol.');
  if (learn != null && Math.abs(learn.adj_bps) >= 1) {
    reasons.push(`Spread learning adj: ${learn.adj_bps > 0 ? '+' : ''}${learn.adj_bps} bps (recent PnL / fill balance).`);
  }
  if (global.mode === 'safe') reasons.push('Desk mode Safe: wider baseline spreads.');
  if (global.mode === 'aggressive') reasons.push('Desk mode Aggressive: tighter baseline spreads.');
  if (status.daily_target_progress && status.daily_target_progress.progress >= 0.5) {
    reasons.push(
      `Daily PnL target progress ${(status.daily_target_progress.progress * 100).toFixed(0)}% — size may be scaled down.`
    );
  }
  if (row?.skipBidPlacement) reasons.push('Inventory / cap guard: bid placement suppressed.');
  if (row?.skipAskPlacement) reasons.push('Inventory / cap guard: ask placement suppressed.');
  if (reasons.length === 0) reasons.push('No abnormal desk signals for this symbol — operating within normal parameters.');
  return reasons;
}

export function defaultPairResetBody(bot: MmControlStatus['bot']): Partial<MMPairRuntimeConfig> {
  const size = typeof bot.envOrderSize === 'number' ? bot.envOrderSize : Number(bot.envOrderSize);
  return {
    enabled: true,
    spread_mode: 'auto',
    spread_bps: bot.envSpreadBps,
    order_size: Number.isFinite(size) && size > 0 ? size : 0.001,
    ladder_levels: bot.envLadderLevels,
    refresh_mode: 'normal',
    volatility_mode: 'medium',
    flow_mode: 'neutral',
  };
}
