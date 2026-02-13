/**
 * Spot-only risk. Re-exports from spot-risk.service.
 * No margin, positions, equity, or mark-price logic.
 * - validateSpotOrderRisk: uses settlement "balances" (engine path).
 * - validateSpotOrderRiskUserBalances: uses user_balances (in-process spot); same authority as execution.
 */
export {
  validateSpotOrderRisk,
  validateSpotOrderRiskUserBalances,
  type ValidateSpotOrderRiskParams,
  type ValidateSpotOrderRiskUserBalancesParams,
} from './spot-risk.service.js';
