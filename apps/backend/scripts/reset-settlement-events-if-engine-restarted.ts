/**
 * Local/E2E only: when Rust matching engine restarts without a persistence snapshot/WAL,
 * `next_event_id` resets to 1 but `settlement_events` still has rows with the same
 * (match_engine_id, engine_event_id) from prior runs. The backend's
 * `INSERT ... ON CONFLICT DO NOTHING` then silently drops every new match → settlement
 * worker has nothing to process → Phase 3/14 cross-trade orders stay OPEN forever.
 *
 * This script compares Rust engine's reported max event_id with the DB max and, if the
 * engine is behind, deletes settlement_events + DLQ rows for that match_engine_id. It is
 * gated on an opt-in env (E2E_AUTO_RESET_SETTLEMENT_ON_ENGINE_RESTART=1) so production
 * never wipes settlement state.
 *
 * Usage (called from scripts/run-e2e-provisioned.sh):
 *   E2E_AUTO_RESET_SETTLEMENT_ON_ENGINE_RESTART=1 \
 *   ENGINE_BASE_URL=http://127.0.0.1:7101 \
 *   ENGINE_HMAC_SECRET_ACTIVE=... \
 *   npx tsx scripts/reset-settlement-events-if-engine-restarted.ts
 */
import crypto from 'node:crypto';

import { db } from '../src/lib/database.js';
import { logger } from '../src/lib/logger.js';

const ENGINE_BASE_URL = (process.env.ENGINE_BASE_URL || 'http://127.0.0.1:7101').replace(/\/$/, '');
const MATCH_ENGINE_ID = (process.env.E2E_MATCH_ENGINE_ID || 'default').trim();
const SECRET = (
  process.env.ENGINE_HMAC_SECRET_ACTIVE ||
  process.env.ENGINE_HMAC_SECRET ||
  ''
).trim();
const SVC_USER = (process.env.ENGINE_HMAC_SERVICE_USER_ID || '00000000-0000-0000-0000-000000000001').trim();

function signedHeaders(method: 'GET', pathWithQuery: string, body: string): Record<string, string> {
  if (!SECRET) return {};
  const inner = pathWithQuery.startsWith('/engine/')
    ? pathWithQuery.slice('/engine'.length) || '/'
    : pathWithQuery;
  const nonce = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  const msg = `v2\n${SVC_USER}\n${MATCH_ENGINE_ID}\n${method}\n${inner}\n${body}\n${nonce}\n`;
  const signature = crypto.createHmac('sha256', SECRET).update(msg, 'utf8').digest('hex');
  return {
    'x-signature': signature,
    'x-nonce': nonce,
    'x-user-id': SVC_USER,
    'x-engine-id': MATCH_ENGINE_ID,
  };
}

async function fetchEngineLastId(): Promise<number | null> {
  const path = '/engine/matches?after_id=0';
  try {
    const res = await fetch(`${ENGINE_BASE_URL}${path}`, {
      headers: signedHeaders('GET', path, ''),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      console.error(`[reset-settlement] engine /engine/matches returned ${res.status}; skipping`);
      return null;
    }
    const j = (await res.json()) as { last_id?: number };
    return Number(j.last_id ?? 0);
  } catch (e) {
    console.error(`[reset-settlement] engine unreachable: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function fetchDbMaxId(): Promise<number> {
  const r = await db.query<{ max_id: string | null }>(
    `SELECT COALESCE(MAX(engine_event_id), 0)::text AS max_id
     FROM settlement_events
     WHERE match_engine_id = $1`,
    [MATCH_ENGINE_ID]
  );
  return Number(r.rows[0]?.max_id ?? 0);
}

async function main(): Promise<void> {
  if (process.env.E2E_AUTO_RESET_SETTLEMENT_ON_ENGINE_RESTART !== '1') {
    console.log('[reset-settlement] gate not set (E2E_AUTO_RESET_SETTLEMENT_ON_ENGINE_RESTART != 1) — skipping');
    return;
  }
  const engineLastId = await fetchEngineLastId();
  const dbMaxId = await fetchDbMaxId();
  console.log(`[reset-settlement] engine_last_id=${engineLastId ?? 'unknown'} db_max_id=${dbMaxId} match_engine_id=${MATCH_ENGINE_ID}`);
  if (engineLastId == null) {
    console.log('[reset-settlement] cannot determine engine state — leaving settlement_events untouched');
    return;
  }
  if (engineLastId >= dbMaxId) {
    console.log('[reset-settlement] engine ahead of (or equal to) DB — no reset needed');
    return;
  }

  await db.transaction(async (client) => {
    await client.query('DELETE FROM settlement_events WHERE match_engine_id = $1', [MATCH_ENGINE_ID]);
    await client.query('DELETE FROM settlement_events_dlq WHERE match_engine_id = $1', [MATCH_ENGINE_ID]);
    await client.query(
      `UPDATE settlement_engine_poll_cursor SET last_after_id = 0 WHERE engine_id = $1`,
      [MATCH_ENGINE_ID]
    );
    await client.query(`UPDATE settlement_poller_cursor SET last_engine_event_id = 0 WHERE id = 1`);
  });

  console.log(`[reset-settlement] cleared settlement_events for match_engine_id=${MATCH_ENGINE_ID} (engine restarted with lower next_event_id)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    logger.error('reset-settlement-events-if-engine-restarted failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    console.error(`[reset-settlement] FATAL: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
