/** Narrow elite profitability payload for desk UI (best-effort). */
export type ParsedEliteSymbol = {
  fills1h: number | null;
  fills5m: number | null;
  executionEfficiency: number | null;
  avgSlippageBps: number | null;
  inventoryBase: number | null;
};

export function parseEliteSymbolMetrics(raw: unknown): ParsedEliteSymbol | null {
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const h1 = o.h1 as Record<string, unknown> | undefined;
  const m5 = o.m5 as Record<string, unknown> | undefined;
  const fq = o.fillQuality1h as Record<string, unknown> | undefined;
  const mtm = o.markToMarket as Record<string, unknown> | undefined;

  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

  return {
    fills1h: num(h1?.tradeCount),
    fills5m: num(m5?.tradeCount),
    executionEfficiency: num(fq?.executionEfficiency),
    avgSlippageBps: num(fq?.avgSlippageBps),
    inventoryBase: num(mtm?.inventoryBase),
  };
}

/** 50 = neutral; below 50 short-leaning, above 50 long-leaning (USD + optional base inventory hint). */
export function computeInventorySkewPct(
  positionUsd: number,
  capUsd: number,
  inventoryBaseElite?: number | null
): number {
  if (inventoryBaseElite != null && Number.isFinite(inventoryBaseElite) && inventoryBaseElite !== 0) {
    const sign = Math.sign(inventoryBaseElite);
    const mag = Math.min(1, Math.log1p(Math.abs(inventoryBaseElite)) / 6);
    return 50 + sign * mag * 42;
  }
  const cap = Math.max(capUsd, 1e-9);
  const r = Math.min(1, Math.abs(positionUsd) / cap);
  const sign = positionUsd >= 0 ? 1 : -1;
  return 50 + sign * r * 45;
}

export function computeCapitalUsagePct(positionUsdAbs: number, totalCapUsd: number): number {
  if (!Number.isFinite(totalCapUsd) || totalCapUsd <= 0) return 0;
  return Math.min(100, (Math.abs(positionUsdAbs) / totalCapUsd) * 100);
}
