/**
 * Read-only hybrid routing decision. Does NOT execute hedges or touch balances.
 */
import { Decimal } from '../lib/decimal.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { externalLiquidityConfigService } from './external-liquidity-config.service.js';
import { isLiquidityBotRateLimitExempt } from '../lib/liquidity-bot-rate-limit.js';

export type HybridExecutionDecision = 'INTERNAL_ONLY' | 'INTERNAL_PLUS_HEDGE';

export type HybridOrderInput = {
  userId: string;
  market: string;
  side: 'buy' | 'sell';
  type: string;
  /** Quote notional in USD when quote is USDT/USD/BUSD; null otherwise (safe default = internal only). */
  notionalUsd: string | null;
  quoteIsUsd: boolean;
};

export async function decideExecution(order: HybridOrderInput): Promise<HybridExecutionDecision> {
  if (!config.hybrid.hybridEnabled) return 'INTERNAL_ONLY';
  if (isLiquidityBotRateLimitExempt(order.userId)) return 'INTERNAL_ONLY';

  const stopish = order.type === 'stop_loss' || order.type === 'stop_limit' || order.type === 'trailing_stop_market';
  if (stopish) return 'INTERNAL_ONLY';

  if (!order.quoteIsUsd || order.notionalUsd == null) return 'INTERNAL_ONLY';

  const cfg = await externalLiquidityConfigService.getHybridConfig(order.market);
  if (!cfg?.enabled) return 'INTERNAL_ONLY';
  if (!cfg.hedge_enabled) return 'INTERNAL_ONLY';
  /** Actual hedge enqueue/worker are gated by `HEDGE_ENABLED`; decision may still be PLUS for observability. */

  const n = new Decimal(order.notionalUsd);
  if (!n.isFinite() || n.lte(0)) return 'INTERNAL_ONLY';

  const smallMax = new Decimal(cfg.small_trade_max_notional_usd);
  const largeMin = new Decimal(cfg.large_trade_min_notional_usd);
  const perCap = new Decimal(cfg.max_hedge_notional_usd_per_order);

  if (n.lte(smallMax)) return 'INTERNAL_ONLY';

  if (n.gte(largeMin)) {
    if (perCap.gt(0) && n.gt(perCap)) {
      return 'INTERNAL_ONLY';
    }
    const providers = await externalLiquidityConfigService.getActiveProviders();
    if (providers.length === 0) {
      if (!cfg.fallback_to_internal) {
        logger.warn('hybrid_no_active_providers_strict_internal_only', {
          market: order.market,
          note: 'fallback_to_internal=false; trade stays internal-only until a provider is active',
        });
      }
      return 'INTERNAL_ONLY';
    }
    return 'INTERNAL_PLUS_HEDGE';
  }

  if (cfg.between_band_policy === 'prefer_hedge') {
    const providers = await externalLiquidityConfigService.getActiveProviders();
    if (providers.length === 0) {
      if (!cfg.fallback_to_internal) {
        logger.warn('hybrid_no_active_providers_strict_internal_only', {
          market: order.market,
          band: 'prefer_hedge',
        });
      }
      return 'INTERNAL_ONLY';
    }
    return 'INTERNAL_PLUS_HEDGE';
  }

  return 'INTERNAL_ONLY';
}
