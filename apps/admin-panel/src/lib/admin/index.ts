/**
 * Admin API — re-exports for Tier-1 admin panel.
 * All data from existing backend /api/v1/admin/* endpoints.
 * Conflicting names: getEscrows from wallets only; getSettingsTradingPairs from trading only.
 */

export * from './apiClient';
export * from './users';
export * from './wallets';
export * from './trading';
export {
  getP2pOverview,
  getP2pOrders,
  getP2pDisputes,
  resolveP2pDispute,
  getP2pAds,
  getP2pMerchants,
  reviewP2pMerchant,
  getEscrows as getP2pEscrows,
  freezeEscrow,
  unfreezeEscrow,
} from './p2p';
export {
  getSettings,
  patchSettings,
  getSettingsBlockchains,
  getSettingsCurrencies,
  getAdmins,
  getAdminLogs,
} from './settings';
export * from './analytics';
export * from './risk';
export * from './search';
export * from './systemHealth';
export * from './featureFlags';
