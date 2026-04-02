/**
 * Rate-limit exemption for the internal liquidity bot user (burst / velocity / cancel burst).
 */
import { db } from './database.js';
import { config } from '../config/index.js';

let cachedBotUserId: string | null | undefined;

export function resetLiquidityBotUserCache(): void {
  cachedBotUserId = undefined;
}

/** Resolve bot user_id from LIQUIDITY_BOT_API_KEY (cached). */
export async function getLiquidityBotUserId(): Promise<string | null> {
  if (!config.liquidityBot.apiKey) return null;
  if (cachedBotUserId !== undefined) return cachedBotUserId;
  try {
    const r = await db.query<{ user_id: string }>(
      `SELECT user_id::text FROM user_api_keys
       WHERE api_key = $1 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [config.liquidityBot.apiKey]
    );
    cachedBotUserId = r.rows[0]?.user_id ?? null;
  } catch {
    cachedBotUserId = null;
  }
  return cachedBotUserId;
}

export async function warmLiquidityBotUserCache(): Promise<void> {
  if (config.liquidityBot.enabled && config.liquidityBot.apiKey) {
    await getLiquidityBotUserId();
  }
}

export function isLiquidityBotRateLimitExempt(userId: string): boolean {
  const id = userId.trim().toLowerCase();
  if (config.liquidityBot.rateLimitExemptUserIds.has(id)) return true;
  if (cachedBotUserId != null && id === cachedBotUserId.trim().toLowerCase()) return true;
  return false;
}
