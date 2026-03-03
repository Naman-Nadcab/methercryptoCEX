/**
 * Market Making risk controls: emergency stop, daily loss cap, inventory imbalance.
 * Admin can emergency-stop a user; dashboard shows risk metrics.
 */

import { Decimal } from '../lib/decimal.js';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

const MM_EMERGENCY_STOPPED_PREFIX = 'mm_emergency_stopped:';
const MM_EMERGENCY_STOPPED_KEYS_PATTERN = 'mm_emergency_stopped:*';

export async function isUserMmEmergencyStopped(userId: string): Promise<boolean> {
  try {
    const v = await redis.get(`${MM_EMERGENCY_STOPPED_PREFIX}${userId}`);
    return v === '1';
  } catch {
    return false;
  }
}

export async function setMmEmergencyStopped(userId: string, stopped: boolean): Promise<void> {
  try {
    const key = `${MM_EMERGENCY_STOPPED_PREFIX}${userId}`;
    if (stopped) {
      await redis.set(key, '1');
    } else {
      await redis.del(key);
    }
  } catch (e) {
    logger.error('MM emergency stop update failed', { userId, stopped, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

export async function getMmEmergencyStoppedUserIds(): Promise<string[]> {
  try {
    const keys = await redis.keys(MM_EMERGENCY_STOPPED_KEYS_PATTERN);
    return keys.map((k) => k.replace(MM_EMERGENCY_STOPPED_PREFIX, ''));
  } catch {
    return [];
  }
}

/** Per-user daily PnL from spot_trades (simplified: sell value - buy value + fees). */
export async function getMmRiskData(): Promise<{
  apiKeysCount: number;
  topTraders: { userId: string; volume24h: string }[];
  usersWithKeys: { userId: string; keysCount: number }[];
  topTradersDailyPnl: { userId: string; volume24h: string; dailyPnlUsd: string }[];
  inventoryImbalance: { userId: string; imbalanceRatio: number; baseExcess: string }[];
  emergencyStoppedUsers: string[];
}> {
  const [apiKeysRes, topTradersRes, usersWithKeysRes, emergencyStopped] = await Promise.all([
    db.query<{ count: string }>('SELECT COUNT(*)::text as count FROM user_api_keys WHERE deleted_at IS NULL'),
    db.query<{ user_id: string; volume: string }>(
      `SELECT user_id, COALESCE(SUM(quantity::numeric * price::numeric), 0)::text as volume
       FROM spot_trades WHERE created_at >= NOW() - INTERVAL '24 hours'
       GROUP BY user_id ORDER BY volume::numeric DESC LIMIT 20`
    ),
    db.query<{ user_id: string; keys_count: string }>(
      `SELECT user_id, COUNT(*)::text as keys_count FROM user_api_keys WHERE deleted_at IS NULL GROUP BY user_id`
    ),
    getMmEmergencyStoppedUserIds(),
  ]);

  const topUserIds = topTradersRes.rows.slice(0, 10).map((r) => r.user_id);
  let dailyPnlRows: { user_id: string; pnl: string }[] = [];
  let imbalanceRows: { user_id: string; base_excess: string; quote_value: string }[] = [];

  if (topUserIds.length > 0) {
    const pnlRes = await db.query<{ user_id: string; pnl: string }>(
      `SELECT user_id,
        (COALESCE(SUM(CASE WHEN side = 'sell' THEN quantity::numeric * price::numeric ELSE 0 END), 0) -
         COALESCE(SUM(CASE WHEN side = 'buy' THEN quantity::numeric * price::numeric ELSE 0 END), 0) -
         COALESCE(SUM(COALESCE(fee::numeric, 0)), 0))::text as pnl
       FROM spot_trades
       WHERE created_at >= NOW() - INTERVAL '24 hours' AND user_id = ANY($1)
       GROUP BY user_id`,
      [topUserIds]
    );
    dailyPnlRows = pnlRes.rows;
    const imbRes = await db.query<{ user_id: string; total_balance: string; max_currency_balance: string }>(
      `SELECT ub.user_id,
        COALESCE(SUM((ub.available_balance::numeric + ub.locked_balance::numeric)), 0)::text as total_balance,
        COALESCE(MAX(ub.available_balance::numeric + ub.locked_balance::numeric), 0)::text as max_currency_balance
       FROM user_balances ub
       WHERE ub.account_type = 'trading' AND ub.user_id = ANY($1)
       GROUP BY ub.user_id`,
      [topUserIds]
    );
    imbalanceRows = imbRes.rows.map((r) => ({
      user_id: r.user_id,
      base_excess: r.max_currency_balance,
      quote_value: r.total_balance,
    }));
  }

  const pnlByUser = new Map(dailyPnlRows.map((r) => [r.user_id, r.pnl]));
  const imbalanceByUser = new Map(imbalanceRows.map((r) => [r.user_id, r]));

  const topTraders = topTradersRes.rows.map((r) => ({ userId: r.user_id, volume24h: r.volume }));
  const topTradersDailyPnl = topTradersRes.rows.slice(0, 10).map((r) => ({
    userId: r.user_id,
    volume24h: r.volume,
    dailyPnlUsd: pnlByUser.get(r.user_id) ?? '0',
  }));
  const inventoryImbalance = topTradersRes.rows.slice(0, 10).map((r) => {
    const imb = imbalanceByUser.get(r.user_id);
    const maxCurr = imb?.base_excess ?? '0';
    const total = imb?.quote_value ?? '0';
    const totalNum = parseFloat(total);
    const maxNum = parseFloat(maxCurr);
    const ratio = totalNum > 0 ? maxNum / totalNum : 0;
    return { userId: r.user_id, imbalanceRatio: ratio, baseExcess: maxCurr };
  });

  return {
    apiKeysCount: parseInt(apiKeysRes.rows[0]?.count ?? '0', 10),
    topTraders,
    usersWithKeys: usersWithKeysRes.rows.map((r) => ({ userId: r.user_id, keysCount: parseInt(r.keys_count, 10) })),
    topTradersDailyPnl,
    inventoryImbalance,
    emergencyStoppedUsers: emergencyStopped,
  };
}
