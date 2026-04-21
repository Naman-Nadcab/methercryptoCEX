/**
 * Web Push (VAPID) user-facing routes.
 *
 * - GET    /api/v1/push/vapid-key   → returns VAPID public key (frontend uses it during subscribe)
 * - POST   /api/v1/push/subscribe   → persist browser push subscription for the authenticated user
 * - POST   /api/v1/push/unsubscribe → mark an endpoint disabled
 * - POST   /api/v1/push/test        → send a test push to the calling user (dev aid + user self-verify)
 *
 * No 3rd-party key required — VAPID keys live in backend .env and are generated with
 *   node -e "console.log(require('web-push').generateVAPIDKeys())"
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { logger } from '../lib/logger.js';
import { rateLimitByUser } from '../lib/rate-limit-fastify.js';
import {
  getVapidPublicKey,
  isPushEnabled,
  removeSubscription,
  saveSubscription,
  sendPushToUser,
} from '../services/push.service.js';

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(256),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
});

export default async function pushRoutes(app: FastifyInstance) {
  app.get('/vapid-key', async (_req: FastifyRequest, reply: FastifyReply) => {
    const key = getVapidPublicKey();
    if (!key) {
      return reply.code(503).send({
        success: false,
        error: { code: 'PUSH_DISABLED', message: 'Web Push is not configured on this server' },
      });
    }
    // Cache for 1 day; public, static value.
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send({ success: true, data: { publicKey: key } });
  });

  app.post('/subscribe', {
    preHandler: [app.authenticateUser, rateLimitByUser('push:subscribe', 20, 60)],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!isPushEnabled()) {
        return reply.code(503).send({
          success: false,
          error: { code: 'PUSH_DISABLED', message: 'Web Push is not configured' },
        });
      }
      const userId = (request as any).user?.id as string | undefined;
      if (!userId) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });

      const parsed = subscribeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Invalid subscription payload' },
        });
      }

      const ua = (request.headers['user-agent'] as string | undefined)?.slice(0, 500);
      await saveSubscription(
        userId,
        parsed.data.endpoint,
        parsed.data.keys.p256dh,
        parsed.data.keys.auth,
        ua
      );
      return reply.send({ success: true, data: { subscribed: true } });
    } catch (error) {
      logger.error('push/subscribe failed', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.code(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to save subscription' },
      });
    }
  });

  app.post('/unsubscribe', {
    preHandler: [app.authenticateUser, rateLimitByUser('push:unsubscribe', 20, 60)],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = (request as any).user?.id as string | undefined;
      if (!userId) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });

      const parsed = unsubscribeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ success: false, error: { code: 'INVALID_INPUT' } });
      }
      await removeSubscription(userId, parsed.data.endpoint);
      return reply.send({ success: true, data: { unsubscribed: true } });
    } catch (error) {
      logger.error('push/unsubscribe failed', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR' } });
    }
  });

  app.post('/test', {
    preHandler: [app.authenticateUser, rateLimitByUser('push:test', 3, 60)],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).user?.id as string | undefined;
    if (!userId) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });

    const result = await sendPushToUser(userId, {
      title: 'Test notification',
      body: 'Push notifications are working. You will get alerts here for key account events.',
      tag: 'push-test',
      url: '/dashboard/preferences',
    });
    return reply.send({ success: true, data: result });
  });
}
