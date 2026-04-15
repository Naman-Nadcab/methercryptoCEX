/**
 * In-memory runtime overrides for institutional MM / liquidity bot (optional control layer).
 * Defaults preserve legacy env-driven behavior when untouched.
 */
import { config } from '../config/index.js';

export type MMGlobalMode = 'safe' | 'normal' | 'aggressive';

export type MMGlobalRuntimeConfig = {
  enabled: boolean;
  mode: MMGlobalMode;
  /** When set (>0), tightens max position vs env when env is also set; if env is 0, this enables the cap alone. */
  max_position_usd?: number;
  /** When set (>0), tightens daily loss halt vs env using the strictest positive limit across env/global/pairs. */
  max_daily_loss_usd?: number;
  /** MM daily profit soft target (USD); above this, bot reduces size. Default 200 when unset. */
  daily_target_usd?: number;
};

export type SpreadMode = 'auto' | 'manual';
export type FlowMode = 'aggressive' | 'neutral' | 'defensive';
export type RefreshMode = 'slow' | 'normal' | 'fast';
export type VolatilityMode = 'low' | 'medium' | 'high';

export type MMPairRuntimeConfig = {
  enabled: boolean;
  spread_mode: SpreadMode;
  spread_bps: number;
  order_size: number;
  ladder_levels: number;
  refresh_mode: RefreshMode;
  volatility_mode: VolatilityMode;
  flow_mode: FlowMode;
  max_position_usd?: number;
  max_daily_loss_usd?: number;
  /** Optional per-pair capital budget (USD); drives getPairCapital + rebalance. */
  pair_capital_usd?: number;
};

const LIMITS = {
  spreadBps: { min: 1, max: 500 },
  orderSize: { min: 1e-12, max: 1e12 },
  ladderLevels: { min: 1, max: 64 },
  maxUsd: { min: 0, max: 1e10 },
} as const;

const DEFAULT_GLOBAL: MMGlobalRuntimeConfig = {
  enabled: true,
  mode: 'normal',
};

const globalConfig: MMGlobalRuntimeConfig = { ...DEFAULT_GLOBAL };
const pairConfig = new Map<string, MMPairRuntimeConfig>();

/** Phase B: base / effective capital per pair (USD). */
type PairCapitalState = { base: number; effective: number };
const pairCapitalState = new Map<string, PairCapitalState>();

/** trades = MM user fill count in last ~1h from spot_trades (not order placements). */
export type PairPerformanceSnapshot = { pnl_1h: number; trades: number };
const pairPerformance = new Map<string, PairPerformanceSnapshot>();

/** Phase C: last toxic one-sided signal + fill-rate proxy per symbol (bot-updated). */
const toxicFlowBySymbol = new Map<string, boolean>();
const fillRateBySymbol = new Map<string, number>();

const REBALANCE_EVERY_N_CYCLES = 20;
const DEFAULT_DAILY_TARGET_USD = 200;
let liquidityBotCycleCount = 0;

function fallbackGlobalMaxPositionUsd(): number {
  let eff = config.liquidityBot.maxPositionUsd > 0 ? config.liquidityBot.maxPositionUsd : 0;
  const g = globalConfig.max_position_usd;
  if (g != null && g > 0) {
    eff = eff > 0 ? Math.min(eff, g) : g;
  }
  return eff;
}

function clampCapitalUsd(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(LIMITS.maxUsd.max, Math.max(1, n));
}

/**
 * Set base capital for a pair; resets effective to base. Pass 0 to clear.
 */
export function setPairCapitalBase(symbol: string, usd: number): void {
  const k = normalizeMmSymbol(symbol);
  if (!k) return;
  if (!Number.isFinite(usd) || usd <= 0) {
    pairCapitalState.delete(k);
    return;
  }
  const base = clampCapitalUsd(usd);
  pairCapitalState.set(k, { base, effective: base });
}

/**
 * Effective capital limit for the pair (after rebalance). If unset, falls back to global max_position_usd.
 */
export function getPairCapital(symbol: string): number {
  const k = normalizeMmSymbol(symbol);
  const st = pairCapitalState.get(k);
  if (st) return Math.max(0, st.effective);
  return fallbackGlobalMaxPositionUsd();
}

export function getPairCapitalSnapshot(): Record<string, { base_usd: number; effective_usd: number }> {
  const out: Record<string, { base_usd: number; effective_usd: number }> = {};
  for (const [sym, st] of pairCapitalState) {
    out[sym] = { base_usd: st.base, effective_usd: st.effective };
  }
  return out;
}

export function recordPairPerformance(
  symbol: string,
  pnl1h: number | null | undefined,
  fills1h: number | null | undefined
): void {
  const k = normalizeMmSymbol(symbol);
  if (!k) return;
  const prev = pairPerformance.get(k) ?? { pnl_1h: 0, trades: 0 };
  const pnl =
    pnl1h != null && Number.isFinite(pnl1h) ? pnl1h : prev.pnl_1h;
  const trades =
    fills1h != null && Number.isFinite(fills1h) && fills1h >= 0 ? Math.floor(fills1h) : 0;
  pairPerformance.set(k, {
    pnl_1h: pnl,
    trades,
  });
}

export function getPairPerformanceSnapshot(): Record<string, PairPerformanceSnapshot> {
  const out: Record<string, PairPerformanceSnapshot> = {};
  for (const [k, v] of pairPerformance) out[k] = { ...v };
  return out;
}

function rebalancePairCapital(): void {
  const keys = [...pairCapitalState.keys()];
  if (keys.length < 3) return;

  const rows = keys.map((sym) => ({
    sym,
    pnl: pairPerformance.get(sym)?.pnl_1h ?? -Infinity,
    state: pairCapitalState.get(sym)!,
  }));
  rows.sort((a, b) => b.pnl - a.pnl);
  const n = rows.length;
  const kTop = Math.max(1, Math.ceil(n * 0.3));
  const topSet = new Set(rows.slice(0, kTop).map((r) => r.sym));
  const bottomSet = new Set(rows.slice(n - kTop).map((r) => r.sym));

  for (const { sym, state } of rows) {
    let eff = state.effective;
    if (topSet.has(sym) && !bottomSet.has(sym)) eff *= 1.1;
    else if (bottomSet.has(sym) && !topSet.has(sym)) eff *= 0.9;
    const lo = state.base * 0.5;
    const hi = state.base * 1.5;
    state.effective = Math.min(hi, Math.max(lo, eff));
    pairCapitalState.set(sym, state);
  }
}

/**
 * Call once per completed liquidity-bot cycle; triggers capital rebalance every N cycles.
 */
export function incrementLiquidityBotCycleCounter(): void {
  liquidityBotCycleCount += 1;
  if (liquidityBotCycleCount % REBALANCE_EVERY_N_CYCLES === 0) {
    rebalancePairCapital();
  }
}

export function getDailyTargetUsd(): number {
  const v = globalConfig.daily_target_usd;
  if (v != null && Number.isFinite(v) && v > 0) {
    return Math.min(LIMITS.maxUsd.max, v);
  }
  return DEFAULT_DAILY_TARGET_USD;
}

export function setMmToxicFlow(symbol: string, toxic: boolean): void {
  toxicFlowBySymbol.set(normalizeMmSymbol(symbol), toxic);
}

export function setMmPairFillRate(symbol: string, rate: number): void {
  const k = normalizeMmSymbol(symbol);
  if (!k) return;
  const r = Number.isFinite(rate) ? rate : 0;
  fillRateBySymbol.set(k, Math.max(0, Math.min(1, r)));
}

/** Last published fill-rate proxy for a pair (0 if never set). */
export function getMmPairFillRate(symbol: string): number {
  const k = normalizeMmSymbol(symbol);
  if (!k) return 0;
  return fillRateBySymbol.get(k) ?? 0;
}

export function getMmPhaseCPerPairSnapshot(): Record<string, { toxic_flow: boolean; fill_rate: number }> {
  const keys = new Set([...toxicFlowBySymbol.keys(), ...fillRateBySymbol.keys()]);
  const out: Record<string, { toxic_flow: boolean; fill_rate: number }> = {};
  for (const s of keys) {
    out[s] = {
      toxic_flow: toxicFlowBySymbol.get(s) ?? false,
      fill_rate: fillRateBySymbol.get(s) ?? 0,
    };
  }
  return out;
}

export function normalizeMmSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/-/g, '_').replace(/\s+/g, '');
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampSpreadBps(n: number): number {
  return clampInt(n, LIMITS.spreadBps.min, LIMITS.spreadBps.max);
}

function parseEnvOrderSize(): number {
  const n = parseFloat(String(config.liquidityBot.orderSize));
  return Number.isFinite(n) && n > 0 ? n : 0.001;
}

function clampOrderSize(n: number): number {
  const fb = parseEnvOrderSize();
  if (!Number.isFinite(n) || n <= 0) return fb;
  return Math.min(LIMITS.orderSize.max, Math.max(LIMITS.orderSize.min, n));
}

function clampLadder(n: number, ladderMax: number): number {
  return clampInt(n, LIMITS.ladderLevels.min, Math.min(LIMITS.ladderLevels.max, ladderMax));
}

function clampOptionalUsd(n: unknown): number | undefined {
  if (n === undefined || n === null || n === '') return undefined;
  const v = typeof n === 'string' ? parseFloat(n) : Number(n);
  if (!Number.isFinite(v) || v < 0) return undefined;
  if (v === 0) return undefined;
  return Math.min(LIMITS.maxUsd.max, Math.max(LIMITS.maxUsd.min, v));
}

function isGlobalMode(x: string): x is MMGlobalMode {
  return x === 'safe' || x === 'normal' || x === 'aggressive';
}

function isSpreadMode(x: string): x is SpreadMode {
  return x === 'auto' || x === 'manual';
}

function isFlowMode(x: string): x is FlowMode {
  return x === 'aggressive' || x === 'neutral' || x === 'defensive';
}

function isRefreshMode(x: string): x is RefreshMode {
  return x === 'slow' || x === 'normal' || x === 'fast';
}

function isVolatilityMode(x: string): x is VolatilityMode {
  return x === 'low' || x === 'medium' || x === 'high';
}

export function defaultPairRuntimeConfig(symbol: string): MMPairRuntimeConfig {
  const sym = normalizeMmSymbol(symbol);
  const inBot = config.liquidityBot.symbols.includes(sym);
  return {
    enabled: true,
    spread_mode: 'auto',
    spread_bps: inBot ? config.liquidityBot.spreadBps : 10,
    order_size: inBot ? parseEnvOrderSize() : 100,
    ladder_levels: inBot ? config.institutionalMm.ladderLevels : 10,
    refresh_mode: 'normal',
    volatility_mode: 'medium',
    flow_mode: 'neutral',
  };
}

export function getGlobalMMConfig(): MMGlobalRuntimeConfig {
  return { ...globalConfig };
}

export function updateGlobalMMConfig(partial: Partial<MMGlobalRuntimeConfig>): MMGlobalRuntimeConfig {
  if (partial.enabled !== undefined) globalConfig.enabled = Boolean(partial.enabled);
  if (partial.mode !== undefined) {
    const m = String(partial.mode);
    if (isGlobalMode(m)) globalConfig.mode = m;
  }
  const mp = clampOptionalUsd(partial.max_position_usd);
  if (partial.max_position_usd !== undefined) {
    globalConfig.max_position_usd = mp;
  }
  const md = clampOptionalUsd(partial.max_daily_loss_usd);
  if (partial.max_daily_loss_usd !== undefined) {
    globalConfig.max_daily_loss_usd = md;
  }
  const dt = clampOptionalUsd(partial.daily_target_usd);
  if (partial.daily_target_usd !== undefined) {
    globalConfig.daily_target_usd = dt;
  }
  return getGlobalMMConfig();
}

export function getPairConfig(symbol: string): MMPairRuntimeConfig | undefined {
  const k = normalizeMmSymbol(symbol);
  const v = pairConfig.get(k);
  return v ? { ...v } : undefined;
}

export function updatePairConfig(symbol: string, partial: Partial<MMPairRuntimeConfig>): MMPairRuntimeConfig {
  const k = normalizeMmSymbol(symbol);
  const prev = pairConfig.get(k) ?? defaultPairRuntimeConfig(k);
  const next: MMPairRuntimeConfig = { ...prev };

  if (partial.enabled !== undefined) next.enabled = Boolean(partial.enabled);
  if (partial.spread_mode !== undefined) {
    const s = String(partial.spread_mode);
    if (isSpreadMode(s)) next.spread_mode = s;
  }
  if (partial.spread_bps !== undefined) next.spread_bps = clampSpreadBps(Number(partial.spread_bps));
  if (partial.order_size !== undefined) next.order_size = clampOrderSize(Number(partial.order_size));
  if (partial.ladder_levels !== undefined) {
    next.ladder_levels = clampLadder(Number(partial.ladder_levels), config.institutionalMm.ladderMax);
  }
  if (partial.refresh_mode !== undefined) {
    const r = String(partial.refresh_mode);
    if (isRefreshMode(r)) next.refresh_mode = r;
  }
  if (partial.volatility_mode !== undefined) {
    const v = String(partial.volatility_mode);
    if (isVolatilityMode(v)) next.volatility_mode = v;
  }
  if (partial.flow_mode !== undefined) {
    const f = String(partial.flow_mode);
    if (isFlowMode(f)) next.flow_mode = f;
  }
  if (partial.max_position_usd !== undefined) {
    next.max_position_usd = clampOptionalUsd(partial.max_position_usd);
  }
  if (partial.max_daily_loss_usd !== undefined) {
    next.max_daily_loss_usd = clampOptionalUsd(partial.max_daily_loss_usd);
  }
  if (partial.pair_capital_usd !== undefined) {
    const raw = partial.pair_capital_usd as number | string | null | undefined;
    const num = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
    if (raw === null || !Number.isFinite(num) || num <= 0) {
      next.pair_capital_usd = undefined;
      setPairCapitalBase(k, 0);
    } else {
      const c = clampCapitalUsd(num);
      if (c > 0) {
        next.pair_capital_usd = c;
        setPairCapitalBase(k, c);
      }
    }
  }

  pairConfig.set(k, next);
  return { ...next };
}

export function listMmPairConfigKeys(): string[] {
  return [...pairConfig.keys()].sort();
}

export function getAllPairConfigsSnapshot(): Record<string, MMPairRuntimeConfig> {
  const out: Record<string, MMPairRuntimeConfig> = {};
  for (const [k, v] of pairConfig) out[k] = { ...v };
  return out;
}

/**
 * Remove a runtime pair config from memory. Returns true if the key existed.
 * Note: env-defined symbols remain in `live` regardless (they re-appear from bot.symbols).
 */
export function deletePairConfig(symbol: string): boolean {
  const k = normalizeMmSymbol(symbol);
  if (!k || !pairConfig.has(k)) return false;
  pairConfig.delete(k);
  pairCapitalState.delete(k);
  return true;
}

/**
 * Bulk-load pair configs (e.g. from DB on startup). Does NOT overwrite configs already in memory.
 */
export function loadPairConfigsBulk(rows: Array<{ symbol: string; config: MMPairRuntimeConfig }>): void {
  for (const row of rows) {
    const k = normalizeMmSymbol(row.symbol);
    if (!k || pairConfig.has(k)) continue; // don't overwrite runtime changes
    const safe = buildSafePairConfig(k, row.config);
    if (safe) pairConfig.set(k, safe);
  }
}

/** Build a fully validated pair config from an untrusted source (e.g. DB row). Returns null if symbol invalid. */
function buildSafePairConfig(symbol: string, raw: Partial<MMPairRuntimeConfig>): MMPairRuntimeConfig | null {
  const k = normalizeMmSymbol(symbol);
  if (!k) return null;
  return updatePairConfig(k, raw);
}

/**
 * Strictest positive daily loss cap: env, global runtime, and any per-pair limits on traded symbols.
 */
export function resolveEffectiveMaxDailyLossUsd(symbols: string[]): number {
  let eff = config.liquidityBot.maxDailyLossUsd > 0 ? config.liquidityBot.maxDailyLossUsd : 0;
  const g = globalConfig.max_daily_loss_usd;
  if (g != null && g > 0) {
    eff = eff > 0 ? Math.min(eff, g) : g;
  }
  for (const sym of symbols) {
    const p = pairConfig.get(normalizeMmSymbol(sym));
    const pl = p?.max_daily_loss_usd;
    if (pl != null && pl > 0) {
      eff = eff > 0 ? Math.min(eff, pl) : pl;
    }
  }
  return eff;
}

/**
 * Per-symbol max position USD: env → global runtime → pair (each may tighten).
 */
export function resolveEffectiveMaxPositionUsdForSymbol(symbol: string): number {
  let eff = config.liquidityBot.maxPositionUsd > 0 ? config.liquidityBot.maxPositionUsd : 0;
  const g = globalConfig.max_position_usd;
  if (g != null && g > 0) {
    eff = eff > 0 ? Math.min(eff, g) : g;
  }
  const p = pairConfig.get(normalizeMmSymbol(symbol));
  const pl = p?.max_position_usd;
  if (pl != null && pl > 0) {
    eff = eff > 0 ? Math.min(eff, pl) : pl;
  }
  return eff;
}
