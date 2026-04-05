/**
 * Admin Operational Control — wallet operations, backups, rate limit monitoring.
 * Aggregates data from funds/summary, feature_toggles, system_settings, and Redis.
 */

import type { FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { getAdminWithPermission } from './admin.fastify.js';
import { logAuditFromRequest } from '../services/audit-log.service.js';

export default async function adminOperationalRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    const isRead = request.method.toUpperCase() === 'GET';
    const admin = await getAdminWithPermission(
      app,
      request,
      reply,
      isRead ? 'monitoring:view' : 'control:commands'
    );
    if (!admin) return;
  });

  // PATCH /operational/wallet-status — set deposit/withdrawal pause via feature_toggles
  app.patch<{ Body: { depositPaused?: boolean; withdrawalPaused?: boolean } }>('/operational/wallet-status', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'control:commands');
    if (!admin) return;
    try {
      const { depositPaused, withdrawalPaused } = request.body ?? {};
      if (depositPaused != null) {
        await db.query(
          `UPDATE feature_toggles SET is_enabled = $1, updated_at = NOW() WHERE feature_key = 'deposit.enabled'`
        , [!depositPaused]);
      }
      if (withdrawalPaused != null) {
        await db.query(
          `UPDATE feature_toggles SET is_enabled = $1, updated_at = NOW() WHERE feature_key = 'withdrawal.enabled'`
        , [!withdrawalPaused]);
      }
      logAuditFromRequest(request, {
        actorType: 'admin',
        actorId: admin.adminId,
        action: 'wallet_status_updated',
        resourceType: 'feature_toggles',
        newValue: { depositPaused, withdrawalPaused },
      }).catch(() => {});
      return reply.send({ success: true, data: { message: 'Updated' } });
    } catch (e) {
      logger.warn('Wallet status update error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update' } });
    }
  });

  // GET /operational/wallet-status — deposit/withdrawal toggles
  app.get('/operational/wallet-status', async (request, reply) => {
    try {
      const featuresRes = await db.query<{ feature_key: string; is_enabled: boolean }>(
        `SELECT feature_key, is_enabled FROM feature_toggles WHERE feature_key IN ('deposit.enabled', 'withdrawal.enabled')`
      );
      const features = Object.fromEntries(
        (featuresRes.rows ?? []).map((r) => [r.feature_key, r.is_enabled])
      );
      return reply.send({
        success: true,
        data: {
          depositPaused: !features['deposit.enabled'],
          withdrawalPaused: !features['withdrawal.enabled'],
        },
      });
    } catch (e) {
      logger.warn('Wallet status fetch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Failed to fetch wallet status' },
      });
    }
  });

  // GET /operational/rate-limits — API volume, violations, bot traffic (Redis + mock)
  app.get('/operational/rate-limits', async (request, reply) => {
    try {
      const monitoring = await import('../services/exchange-monitoring.service.js').then((m) =>
        m.getMonitoringCounters()
      ).catch(() => ({}));
      const counters = monitoring as Record<string, number>;

      // Aggregate from monitoring counters (keys are without prefix)
      const requestVolume = counters['api_requests_24h'] ?? counters['spot_orders_24h'] ?? 0;
      const violations = counters['rate_limit_violations'] ?? 0;
      const botSpikes = counters['bot_traffic_spikes'] ?? 0;

      // Sample Redis rate limit keys (avoid KEYS in prod; use SCAN or dedicated counter)
      let rateLimitKeysCount = 0;
      try {
        const keys = await redis.keys('rate:*');
        rateLimitKeysCount = keys?.length ?? 0;
      } catch {
        // ignore
      }

      const baseReq = requestVolume > 0 ? Math.round(requestVolume / 24) : 0;
      const series24h = Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        requests: baseReq,
        violations: violations > 0 ? Math.floor(violations / 24) : 0,
      }));

      return reply.send({
        success: true,
        data: {
          requestVolume24h: requestVolume,
          rateLimitViolations: violations,
          botTrafficSpikes: botSpikes,
          rateLimitKeysCount,
          series24h,
          suspiciousApiKeys: [], // Would come from api_key_usage analysis
        },
      });
    } catch (e) {
      logger.warn('Rate limits fetch error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({
        success: true,
        data: {
          requestVolume24h: 0,
          rateLimitViolations: 0,
          botTrafficSpikes: 0,
          rateLimitKeysCount: 0,
          series24h: [],
          suspiciousApiKeys: [],
        },
      });
    }
  });

  // GET /operational/backups — list backup history
  app.get('/operational/backups', async (request, reply) => {
    try {
      const hasTable = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'backup_history') AS exists`
      ).then((r) => r.rows[0]?.exists === true).catch(() => false);

      if (!hasTable) {
        return reply.send({ success: true, data: { backups: [], message: 'backup_history table not created' } });
      }

      const rows = await db.query<{ id: string; type: string; size_bytes: number | null; status: string; created_at: string }>(
        `SELECT id, type, size_bytes, status, created_at::text FROM backup_history ORDER BY created_at DESC LIMIT 50`
      );
      const backups = (rows.rows ?? []).map((r) => ({
        id: r.id,
        type: r.type,
        sizeBytes: r.size_bytes,
        status: r.status,
        createdAt: r.created_at,
      }));
      return reply.send({ success: true, data: { backups } });
    } catch (e) {
      logger.warn('Backups list error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.send({ success: true, data: { backups: [] } });
    }
  });

  // POST /operational/backups/create — trigger database snapshot
  app.post('/operational/backups/create', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'settings:edit');
    if (!admin) return;
    try {
      const hasTable = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'backup_history') AS exists`
      ).then((r) => r.rows[0]?.exists === true).catch(() => false);

      if (!hasTable) {
        await db.query(`
          CREATE TABLE IF NOT EXISTS backup_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            type VARCHAR(50) DEFAULT 'manual',
            size_bytes BIGINT,
            status VARCHAR(20) DEFAULT 'pending',
            path TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            created_by VARCHAR(255)
          )
        `);
      }

      const { v4: uuidv4 } = await import('uuid');
      const id = uuidv4();
      await db.query(
        `INSERT INTO backup_history (id, type, status, created_by) VALUES ($1, 'manual', 'pending', $2)`,
        [id, admin.adminId]
      );

      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      const fs = await import('fs');

      const backupDir = process.env.BACKUP_DIR || '/tmp/exchange-backups';
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `backup-${timestamp}.sql.gz`;
      const filePath = `${backupDir}/${filename}`;

      const dbUrl = process.env.DATABASE_URL || '';

      try {
        await execAsync(`pg_dump "${dbUrl}" --no-owner --no-acl | gzip > "${filePath}"`, { timeout: 120000 });
        const stats = fs.statSync(filePath);
        await db.query(
          `UPDATE backup_history SET status = 'completed', size_bytes = $1, path = $2 WHERE id = $3`,
          [stats.size, filePath, id]
        );
        return reply.send({
          success: true,
          data: { id, status: 'completed', sizeBytes: stats.size, path: filename, message: 'Database backup completed' },
        });
      } catch (pgErr) {
        logger.error('pg_dump failed', { error: pgErr instanceof Error ? pgErr.message : 'Unknown' });
        await db.query(`UPDATE backup_history SET status = 'failed' WHERE id = $1`, [id]);
        return reply.send({
          success: true,
          data: { id, status: 'failed', message: 'pg_dump execution failed. Ensure pg_dump is installed and DATABASE_URL is set.' },
        });
      }
    } catch (e) {
      logger.error('Backup create error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'BACKUP_FAILED', message: 'Failed to create backup' },
      });
    }
  });

  // POST /operational/backups/:id/restore — restore from backup (stub)
  app.post<{ Params: { id: string } }>('/operational/backups/:id/restore', async (request, reply) => {
    const admin = await getAdminWithPermission(app, request, reply, 'settings:edit');
    if (!admin) return;
    const { id } = request.params;
    try {
      await db.query(
        `INSERT INTO audit_logs (action, details, admin_id) VALUES ('backup:restore_request', $1, $2)`,
        [JSON.stringify({ backupId: id }), admin.adminId]
      );
      return reply.send({
        success: true,
        data: { message: 'Restore requested. Manual intervention required.' },
      });
    } catch (e) {
      logger.error('Backup restore request error', { error: e instanceof Error ? e.message : 'Unknown' });
      return reply.status(500).send({
        success: false,
        error: { code: 'RESTORE_FAILED', message: 'Failed to process restore request' },
      });
    }
  });
}
