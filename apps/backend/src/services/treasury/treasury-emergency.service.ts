/**
 * Emergency treasury gates: global pause, per-user freeze, per-asset freeze.
 * Reads system_settings + users.withdrawals_frozen_at (no direct fund-move APIs).
 */
import { db } from '../../lib/database.js';
import { logger } from '../../lib/logger.js';

let cache: { at: number; globalPause: boolean; frozenAssets: Set<string> } = { at: 0, globalPause: false, frozenAssets: new Set() };
const TTL_MS = 3000;

function parseFrozenAssets(raw: unknown): Set<string> {
  const s = new Set<string>();
  try {
    if (Array.isArray(raw)) {
      for (const x of raw) {
        if (typeof x === 'string' && x.trim()) s.add(x.trim().toUpperCase());
      }
      return s;
    }
    if (typeof raw === 'string') {
      const j = JSON.parse(raw) as unknown;
      if (Array.isArray(j)) {
        for (const x of j) {
          if (typeof x === 'string' && x.trim()) s.add(x.trim().toUpperCase());
        }
      }
    }
  } catch {
    /* ignore */
  }
  return s;
}

async function loadEmergencyCache(): Promise<void> {
  const now = Date.now();
  if (now - cache.at < TTL_MS) return;
  let globalPause = false;
  let frozenAssets = new Set<string>();
  try {
    const r = await db.query<{ key: string; value: unknown }>(
      `SELECT key, value FROM system_settings WHERE key IN (
        'emergency_disable_withdrawals',
        'treasury_global_withdraw_pause',
        'treasury_frozen_asset_symbols'
      )`
    );
    const kv: Record<string, unknown> = {};
    for (const row of r.rows) kv[row.key] = row.value;
    const ed = kv.emergency_disable_withdrawals;
    const tg = kv.treasury_global_withdraw_pause;
    globalPause =
      ed === true ||
      ed === 'true' ||
      ed === '1' ||
      String(ed ?? '') === '1' ||
      tg === true ||
      tg === 'true' ||
      tg === '1' ||
      String(tg ?? '') === '1';
    frozenAssets = parseFrozenAssets(kv.treasury_frozen_asset_symbols);
  } catch (e) {
    logger.warn('treasury_emergency: settings read failed', { error: e instanceof Error ? e.message : String(e) });
  }
  cache = { at: now, globalPause, frozenAssets };
}

export async function assertWithdrawalAllowedForTreasuryPolicy(params: {
  userId: string;
  assetSymbol: string;
}): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  await loadEmergencyCache();
  if (cache.globalPause) {
    return { ok: false, code: 'WITHDRAWALS_PAUSED', message: 'Withdrawals are paused by treasury emergency controls.' };
  }
  const sym = params.assetSymbol.trim().toUpperCase();
  if (sym && cache.frozenAssets.has(sym)) {
    return { ok: false, code: 'ASSET_WITHDRAWAL_FROZEN', message: `Withdrawals for ${sym} are temporarily frozen.` };
  }
  const u = await db.query<{ f: string | null }>(
    `SELECT withdrawals_frozen_at::text AS f FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [params.userId]
  );
  if (u.rows[0]?.f) {
    return {
      ok: false,
      code: 'USER_WITHDRAWAL_FROZEN',
      message: 'Withdrawals are frozen for this account. Contact support.',
    };
  }
  const chain = await db.query<{ v: unknown }>(
    `SELECT value AS v FROM system_settings WHERE key = 'treasury_onchain_mismatch_pause' LIMIT 1`
  );
  const v = chain.rows[0]?.v;
  if (v === true || v === 'true' || v === '1' || String(v ?? '') === '1') {
    return {
      ok: false,
      code: 'TREASURY_RECONCILE_HOLD',
      message: 'Withdrawals are paused pending treasury reconciliation review.',
    };
  }
  return { ok: true };
}
