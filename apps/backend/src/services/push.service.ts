/**
 * Web Push (VAPID) service — self-hosted, no 3rd-party key needed.
 *
 * Use `sendPushToUser(userId, payload)` anywhere in backend to dispatch a notification
 * to every active subscription for that user (browsers / devices the user opted into).
 *
 * Failures are swallowed per-subscription and 404/410 responses automatically mark the
 * subscription as disabled (browser unsubscribed / expired).
 */
import webpush from 'web-push';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';

let initialized = false;

function init(): boolean {
  if (initialized) return true;
  if (!config.webPush.enabled || !config.webPush.publicKey || !config.webPush.privateKey) {
    return false;
  }
  try {
    webpush.setVapidDetails(
      config.webPush.subject,
      config.webPush.publicKey,
      config.webPush.privateKey
    );
    initialized = true;
    return true;
  } catch (err) {
    logger.warn('Web Push init failed', { error: err instanceof Error ? err.message : 'Unknown' });
    return false;
  }
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
  data?: Record<string, unknown>;
}

export function isPushEnabled(): boolean {
  return init();
}

export function getVapidPublicKey(): string | null {
  return config.webPush.publicKey || null;
}

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<{ sent: number; failed: number }> {
  if (!init()) return { sent: 0, failed: 0 };

  const r = await db.query<SubRow>(
    `SELECT id, endpoint, p256dh, auth
       FROM push_subscriptions
      WHERE user_id = $1 AND disabled_at IS NULL`,
    [userId]
  );
  if (r.rows.length === 0) return { sent: 0, failed: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;

  await Promise.all(r.rows.map(async (row) => {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        body,
        { TTL: 60 }
      );
      sent++;
      // Best-effort: update last_used_at. Never fail the send on this.
      db.query(`UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = $1`, [row.id]).catch(() => {});
    } catch (err: any) {
      failed++;
      const status = err?.statusCode;
      if (status === 404 || status === 410) {
        // Endpoint gone — disable row permanently.
        db.query(
          `UPDATE push_subscriptions SET disabled_at = NOW() WHERE id = $1`,
          [row.id]
        ).catch(() => {});
      } else {
        logger.warn('Push send failed', { subId: row.id, status, err: err?.message });
      }
    }
  }));

  return { sent, failed };
}

export async function saveSubscription(
  userId: string,
  endpoint: string,
  p256dh: string,
  auth: string,
  userAgent?: string
): Promise<void> {
  await db.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, endpoint)
     DO UPDATE SET
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent,
       disabled_at = NULL,
       last_used_at = NOW()`,
    [userId, endpoint, p256dh, auth, userAgent || null]
  );
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await db.query(
    `UPDATE push_subscriptions SET disabled_at = NOW() WHERE user_id = $1 AND endpoint = $2`,
    [userId, endpoint]
  );
}
