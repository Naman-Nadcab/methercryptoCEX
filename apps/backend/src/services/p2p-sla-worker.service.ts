import { db } from '../lib/database.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { p2pService } from './p2p.service.js';

/**
 * Every minute (caller schedules interval): payment_confirmed orders past SLA → auto-release or auto-dispute.
 */
export async function runP2PSlaTick(): Promise<void> {
  if (!config.p2p.slaWorkerEnabled) return;
  const minutes = config.p2p.slaReleaseMinutes;
  const action = config.p2p.slaAction;

  const r = await db.query<{ id: string; seller_id: string; buyer_id: string }>(
    `SELECT id, seller_id, buyer_id
     FROM p2p_orders
     WHERE status = 'payment_confirmed'
       AND payment_confirmed_at IS NOT NULL
       AND payment_confirmed_at < NOW() - ($1::int * INTERVAL '1 minute')`,
    [minutes]
  );

  for (const row of r.rows) {
    try {
      if (action === 'release') {
        await p2pService.releaseCrypto(row.id, row.seller_id, undefined, { slaAutoRelease: true });
      } else {
        await p2pService.openDispute(
          row.id,
          row.buyer_id,
          'Automatic dispute: seller did not release within the platform SLA window',
          []
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('already exists') || msg.includes('Payment not yet') || msg.includes('SLA window not elapsed')) {
        continue;
      }
      logger.warn('P2P SLA worker: action failed', { orderId: row.id, action, error: msg });
    }
  }
}
