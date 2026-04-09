/**
 * Inventory-driven skew, size tapering, and extra spread for institutional MM.
 */
import { Decimal, type DecimalInstance } from '../lib/decimal.js';
import { db } from '../lib/database.js';
import { config } from '../config/index.js';

export type InventoryRiskAdjust = {
  /** Shift mid in bps against inventory (+ = favor selling base). */
  midSkewBps: number;
  bidSizeMult: number;
  askSizeMult: number;
  /** Additional half-spread widening (bps) applied symmetrically after vol/oracle. */
  extraSpreadBps: number;
  /** Base notional / total inventory value when known (for MM strategy); null if unavailable. */
  baseRatio: number | null;
};

async function getOracleMid(symbol: string): Promise<DecimalInstance | null> {
  try {
    const row = await db.query<{ price: string }>(
      `SELECT mp.price::text AS price
       FROM market_prices mp
       JOIN spot_markets sm ON sm.base_currency_id = mp.base_currency_id AND sm.quote_currency_id = mp.quote_currency_id
       WHERE sm.symbol = $1 LIMIT 1`,
      [symbol]
    );
    const p = row.rows[0]?.price;
    if (!p) return null;
    const d = new Decimal(p);
    return d.gt(0) ? d : null;
  } catch {
    return null;
  }
}

export async function getInventoryRiskAdjust(symbol: string, userId: string, volBps?: number): Promise<InventoryRiskAdjust> {
  const inv = config.institutionalMm;
  const em = config.eliteMm;
  let soft = inv.inventorySoftRatio;
  let hard = inv.inventoryHardRatio;
  const v = volBps != null && Number.isFinite(volBps) && volBps >= 0 ? volBps : 0;
  const volNorm = Math.min(1, v / Math.max(1, em.invVolRefBps));
  const tighten = em.invVolTightenCoeff * volNorm;
  soft = 0.5 + (soft - 0.5) * (1 - tighten);
  hard = 0.5 + (hard - 0.5) * (1 - tighten);
  if (hard <= soft) hard = Math.min(0.95, soft + 0.02);
  const maxSkew = inv.inventoryMaxSkewBps;
  const taper = inv.inventorySizeTaper;
  const extraPerStep = inv.inventoryExtraSpreadBps;

  let midSkewBps = 0;
  let bidSizeMult = 1;
  let askSizeMult = 1;
  let extraSpreadBps = 0;
  let baseRatioOut: number | null = null;

  try {
    const m = await db.query<{ base_asset: string; quote_asset: string }>(
      `SELECT base_asset, quote_asset FROM spot_markets WHERE symbol = $1`,
      [symbol]
    );
    if (m.rows.length === 0) {
      return { midSkewBps: 0, bidSizeMult: 1, askSizeMult: 1, extraSpreadBps: 0, baseRatio: null };
    }
    const baseAsset = m.rows[0]!.base_asset;
    const quoteAsset = m.rows[0]!.quote_asset;

    const bal = await db.query<{ asset: string; total: string }>(
      `SELECT c.symbol AS asset, (ub.available_balance::numeric + ub.locked_balance::numeric)::text AS total
       FROM user_balances ub
       JOIN currencies c ON c.id = ub.currency_id
       WHERE ub.user_id = $1::uuid AND ub.account_type = 'trading' AND COALESCE(ub.chain_id, '') = ''
         AND UPPER(TRIM(c.symbol)) IN (UPPER($2), UPPER($3))`,
      [userId, baseAsset, quoteAsset]
    );
    const baseBal = new Decimal(bal.rows.find((r) => r.asset.toUpperCase() === baseAsset.toUpperCase())?.total ?? '0');
    const quoteBal = new Decimal(bal.rows.find((r) => r.asset.toUpperCase() === quoteAsset.toUpperCase())?.total ?? '0');

    const mid = await getOracleMid(symbol);
    if (!mid || mid.lte(0)) {
      return { midSkewBps: 0, bidSizeMult: 1, askSizeMult: 1, extraSpreadBps: 0, baseRatio: null };
    }

    const baseValue = baseBal.times(mid);
    const total = baseValue.plus(quoteBal);
    if (total.lte(0)) {
      return { midSkewBps: 0, bidSizeMult: 1, askSizeMult: 1, extraSpreadBps: 0, baseRatio: null };
    }

    const baseRatio = baseValue.div(total).toNumber();
    baseRatioOut = baseRatio;

    if (baseRatio >= hard) {
      midSkewBps = maxSkew;
      bidSizeMult = taper;
      askSizeMult = 1;
      extraSpreadBps = extraPerStep * 2;
    } else if (baseRatio <= 1 - hard) {
      midSkewBps = -maxSkew;
      bidSizeMult = 1;
      askSizeMult = taper;
      extraSpreadBps = extraPerStep * 2;
    } else if (baseRatio >= soft) {
      const t = (baseRatio - soft) / Math.max(1e-6, hard - soft);
      midSkewBps = maxSkew * t;
      bidSizeMult = 1 - (1 - taper) * t;
      askSizeMult = 1;
      extraSpreadBps = extraPerStep * t;
    } else if (baseRatio <= 1 - soft) {
      const t = (soft - baseRatio) / Math.max(1e-6, hard - soft);
      midSkewBps = -maxSkew * t;
      bidSizeMult = 1;
      askSizeMult = 1 - (1 - taper) * t;
      extraSpreadBps = extraPerStep * t;
    }
  } catch {
    /* ignore */
  }

  return { midSkewBps, bidSizeMult, askSizeMult, extraSpreadBps, baseRatio: baseRatioOut };
}

export type MmPositionGuard = {
  positionUsd: string;
  skipBidPlacement: boolean;
  skipAskPlacement: boolean;
};

/**
 * When total notional (base×mid + quote) exceeds maxPositionUsd, stop adding risk on one side only
 * when inventory is skewed: base-heavy → skip bids; quote-heavy → skip asks. Near-neutral (45–55%) allows both.
 */
export async function getMmPositionGuard(
  symbol: string,
  userId: string,
  mid: DecimalInstance,
  maxPositionUsd: number
): Promise<MmPositionGuard> {
  if (!Number.isFinite(maxPositionUsd) || maxPositionUsd <= 0) {
    return { positionUsd: '0', skipBidPlacement: false, skipAskPlacement: false };
  }
  try {
    const m = await db.query<{ base_asset: string; quote_asset: string }>(
      `SELECT base_asset, quote_asset FROM spot_markets WHERE symbol = $1`,
      [symbol]
    );
    if (m.rows.length === 0) {
      return { positionUsd: '0', skipBidPlacement: false, skipAskPlacement: false };
    }
    const baseAsset = m.rows[0]!.base_asset;
    const quoteAsset = m.rows[0]!.quote_asset;

    const bal = await db.query<{ asset: string; total: string }>(
      `SELECT c.symbol AS asset, (ub.available_balance::numeric + ub.locked_balance::numeric)::text AS total
       FROM user_balances ub
       JOIN currencies c ON c.id = ub.currency_id
       WHERE ub.user_id = $1::uuid AND ub.account_type = 'trading' AND COALESCE(ub.chain_id, '') = ''
         AND UPPER(TRIM(c.symbol)) IN (UPPER($2), UPPER($3))`,
      [userId, baseAsset, quoteAsset]
    );
    const baseBal = new Decimal(bal.rows.find((r) => r.asset.toUpperCase() === baseAsset.toUpperCase())?.total ?? '0');
    const quoteBal = new Decimal(bal.rows.find((r) => r.asset.toUpperCase() === quoteAsset.toUpperCase())?.total ?? '0');

    if (!mid.isFinite() || mid.lte(0)) {
      return { positionUsd: '0', skipBidPlacement: false, skipAskPlacement: false };
    }

    const baseValue = baseBal.times(mid);
    const total = baseValue.plus(quoteBal);
    const positionUsd = total.toString();
    if (total.lte(maxPositionUsd)) {
      return { positionUsd, skipBidPlacement: false, skipAskPlacement: false };
    }

    const baseRatio = total.gt(0) ? baseValue.div(total).toNumber() : 0.5;
    let skipBidPlacement = false;
    let skipAskPlacement = false;
    if (baseRatio > 0.55) skipBidPlacement = true;
    else if (baseRatio < 0.45) skipAskPlacement = true;
    return { positionUsd, skipBidPlacement, skipAskPlacement };
  } catch {
    return { positionUsd: '0', skipBidPlacement: false, skipAskPlacement: false };
  }
}
