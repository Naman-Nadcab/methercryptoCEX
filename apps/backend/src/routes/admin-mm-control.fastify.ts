/**
 * MM runtime control (in-memory). New routes only — does not alter legacy /admin handlers.
 */
import type { FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { Decimal, type DecimalInstance } from '../lib/decimal.js';
import { getAdminWithPermission } from './admin.fastify.js';
import {
  getGlobalMMConfig,
  updateGlobalMMConfig,
  getPairConfig,
  updatePairConfig,
  normalizeMmSymbol,
  listMmPairConfigKeys,
  getAllPairConfigsSnapshot,
  defaultPairRuntimeConfig,
  resolveEffectiveMaxPositionUsdForSymbol,
  getPairCapitalSnapshot,
  getPairPerformanceSnapshot,
  getDailyTargetUsd,
  getMmPhaseCPerPairSnapshot,
  type MMGlobalRuntimeConfig,
  type MMPairRuntimeConfig,
} from '../services/mm-runtime-config.service.js';
import { fetchBotOpenLimitOrders } from '../services/liquidity-bot.service.js';
import { getMmPositionGuard } from '../services/mm-inventory-risk.service.js';
import { getMmSymbolProfitMetrics } from '../services/mm-pnl-metrics.service.js';
import { getMmUserDailyPnlUsd } from '../services/mm-risk.service.js';
import { getMmSpreadLearningSnapshot } from '../services/mm-strategy.service.js';

async function readOracleMid(symbol: string): Promise<DecimalInstance | null> {
  try {
    const row = await db.query<{ price: string }>(
      `SELECT mp.price::text AS price
       FROM market_prices mp
       JOIN spot_markets sm ON sm.base_currency_id = mp.base_currency_id AND sm.quote_currency_id = mp.quote_currency_id
       WHERE sm.symbol = $1 AND sm.status IN ('active', 'maintenance')
       LIMIT 1`,
      [symbol]
    );
    const p = row.rows[0]?.price;
    if (!p) return null;
    const mid = new Decimal(p);
    return mid.gt(0) && mid.isFinite() ? mid : null;
  } catch {
    return null;
  }
}

function parseJsonBody<T extends Record<string, unknown>>(body: unknown): Partial<T> {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return {};
  return body as Partial<T>;
}

export default async function adminMmControlRoutes(app: FastifyInstance) {
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

  app.get('/mm-control/global', async (_request, reply) => {
    return reply.send({ success: true, data: getGlobalMMConfig() });
  });

  app.post('/mm-control/global', async (request, reply) => {
    const partial = parseJsonBody<MMGlobalRuntimeConfig>(request.body);
    const next = updateGlobalMMConfig(partial);
    return reply.send({ success: true, data: next });
  });

  app.get<{ Params: { symbol: string } }>('/mm-control/pair/:symbol', async (request, reply) => {
    const sym = normalizeMmSymbol(request.params.symbol);
    if (!sym) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_SYMBOL', message: 'Invalid symbol' } });
    }
    const stored = getPairConfig(sym);
    return reply.send({
      success: true,
      data: {
        symbol: sym,
        configured: Boolean(stored),
        config: stored ?? defaultPairRuntimeConfig(sym),
      },
    });
  });

  app.post<{ Params: { symbol: string } }>('/mm-control/pair/:symbol', async (request, reply) => {
    const sym = normalizeMmSymbol(request.params.symbol);
    if (!sym) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_SYMBOL', message: 'Invalid symbol' } });
    }
    const partial = parseJsonBody<MMPairRuntimeConfig>(request.body);
    const next = updatePairConfig(sym, partial);
    return reply.send({ success: true, data: { symbol: sym, config: next } });
  });

  app.get('/mm-control/status', async (_request, reply) => {
    try {
      const globalCfg = getGlobalMMConfig();
      const pairKeys = listMmPairConfigKeys();
      const pairs = getAllPairConfigsSnapshot();
      const botSymbols = config.liquidityBot.symbols;
      const unionSymbols = [...new Set([...botSymbols, ...pairKeys])].sort();

      let live: Array<{
        symbol: string;
        openOrders: number;
        positionUsd: string;
        skipBidPlacement: boolean;
        skipAskPlacement: boolean;
        pnl1hUsd: number | null;
        fill_rate: number;
        toxic_flow: boolean;
      }> = [];

      const phaseC = getMmPhaseCPerPairSnapshot();
      const spreadLearning = getMmSpreadLearningSnapshot();
      const targetUsd = getDailyTargetUsd();
      let dailyPnlToday = 0;
      let botUserId: string | undefined;

      if (config.liquidityBot.enabled && config.liquidityBot.apiKey) {
        const keyRow = await db.query<{ user_id: string }>(
          `SELECT user_id::text FROM user_api_keys WHERE api_key = $1 AND deleted_at IS NULL LIMIT 1`,
          [config.liquidityBot.apiKey]
        );
        const userId = keyRow.rows[0]?.user_id;
        botUserId = userId;
        if (userId) {
          dailyPnlToday = await getMmUserDailyPnlUsd(userId);
          live = await Promise.all(
            unionSymbols.map(async (sym) => {
              const mid = await readOracleMid(sym);
              const open = await fetchBotOpenLimitOrders(userId, sym);
              const maxPos = resolveEffectiveMaxPositionUsdForSymbol(sym);
              const pos =
                mid && mid.gt(0)
                  ? await getMmPositionGuard(sym, userId, mid, maxPos)
                  : {
                      positionUsd: '0',
                      skipBidPlacement: false,
                      skipAskPlacement: false,
                    };
              let pnl1hUsd: number | null = null;
              try {
                const mx = await getMmSymbolProfitMetrics(sym, userId);
                pnl1hUsd = mx.h1?.pnlQuote ?? null;
              } catch {
                pnl1hUsd = null;
              }
              const pc = phaseC[sym] ?? { toxic_flow: false, fill_rate: 0 };
              return {
                symbol: sym,
                openOrders: open.length,
                positionUsd: pos.positionUsd,
                skipBidPlacement: pos.skipBidPlacement,
                skipAskPlacement: pos.skipAskPlacement,
                pnl1hUsd,
                fill_rate: pc.fill_rate,
                toxic_flow: pc.toxic_flow,
              };
            })
          );
        }
      }

      const dailyTargetProgress =
        targetUsd > 0 ? Math.min(1, Math.max(0, dailyPnlToday / targetUsd)) : 0;

      return reply.send({
        success: true,
        data: {
          global: globalCfg,
          pairKeys,
          pairs,
          capital_per_pair: getPairCapitalSnapshot(),
          pair_performance: getPairPerformanceSnapshot(),
          daily_target_progress: {
            target_usd: targetUsd,
            pnl_today_usd: botUserId ? dailyPnlToday : 0,
            progress: botUserId ? dailyTargetProgress : 0,
          },
          spread_learning: spreadLearning,
          bot: {
            enabled: config.liquidityBot.enabled,
            symbols: botSymbols,
            envSpreadBps: config.liquidityBot.spreadBps,
            envOrderSize: config.liquidityBot.orderSize,
            envLadderLevels: config.institutionalMm.ladderLevels,
          },
          live,
        },
      });
    } catch (e) {
      logger.warn('mm-control status failed', { error: e instanceof Error ? e.message : String(e) });
      return reply.status(500).send({
        success: false,
        error: { code: 'STATUS_FAILED', message: 'Failed to load MM control status' },
      });
    }
  });
}
