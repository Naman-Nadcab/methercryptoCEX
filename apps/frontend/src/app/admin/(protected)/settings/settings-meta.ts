/**
 * Frontend-only label/type mapping for system settings.
 * Keys are stored exactly as-is; we never rename backend keys.
 */

export type SettingType = 'boolean' | 'number' | 'string' | 'vip_fees';

export interface SettingMeta {
  label: string;
  description?: string;
  type: SettingType;
  /** Section for grouping in UI */
  section: string;
}

export const SETTINGS_SECTIONS = [
  'Platform Controls',
  'Trading Controls',
  'KYC Rules',
  'Withdrawal Limits',
  'P2P Controls',
  'Referral System',
  'Fees & VIP',
  'Other',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Keys that are booleans: store "true" / "false" only */
const BOOLEAN_KEYS = new Set([
  'deposits_enabled',
  'trading_enabled',
  'withdrawals_enabled',
  'p2p_enabled',
  'maintenance_mode',
  'kyc_required_for_trading',
  'kyc_required_for_withdrawal',
  'new_user_registration',
  'enable_registration',
  'enable_trading',
]);

/** VIP fee keys: JSON string, table editor */
const VIP_FEE_KEYS = new Set([
  'fee_rates_vip_0',
  'fee_rates_vip_1',
  'fee_rates_vip_2',
  'fee_rates_vip_3',
  'fee_rates_vip_4',
  'fee_rates_vip_5',
]);

/** Human-readable labels for known keys */
const LABELS: Record<string, string> = {
  platform_name: 'Platform Name',
  support_email: 'Support Email',
  maintenance_mode: 'Maintenance Mode',
  enable_registration: 'New User Registration',
  enable_trading: 'Trading Enabled',
  deposits_enabled: 'Deposits Enabled',
  trading_enabled: 'Trading Enabled',
  withdrawals_enabled: 'Withdrawals Enabled',
  p2p_enabled: 'P2P Enabled',
  new_user_registration: 'New User Registration',
  kyc_required_for_trading: 'KYC Required for Trading',
  kyc_required_for_withdrawal: 'KYC Required for Withdrawal',
  max_daily_withdrawal_usdc: 'Max Daily Withdrawal (USDC)',
  max_daily_withdrawal_usd: 'Max Daily Withdrawal (USD)',
  min_withdrawal_btc: 'Min Withdrawal (BTC)',
  max_open_orders_per_pair: 'Max Open Orders Per Pair',
  referral_reward_percentage: 'Referral Reward %',
  fee_rates_vip_0: 'VIP 0 Fee Rates',
  fee_rates_vip_1: 'VIP 1 Fee Rates',
  fee_rates_vip_2: 'VIP 2 Fee Rates',
  fee_rates_vip_3: 'VIP 3 Fee Rates',
  fee_rates_vip_4: 'VIP 4 Fee Rates',
  fee_rates_vip_5: 'VIP 5 Fee Rates',
};

/** Section assignment per key */
const KEY_SECTION: Record<string, SettingsSection> = {
  platform_name: 'Platform Controls',
  support_email: 'Platform Controls',
  maintenance_mode: 'Platform Controls',
  new_user_registration: 'Platform Controls',
  enable_registration: 'Platform Controls',
  deposits_enabled: 'Platform Controls',
  withdrawals_enabled: 'Platform Controls',
  trading_enabled: 'Trading Controls',
  enable_trading: 'Trading Controls',
  max_open_orders_per_pair: 'Trading Controls',
  kyc_required_for_trading: 'KYC Rules',
  kyc_required_for_withdrawal: 'KYC Rules',
  max_daily_withdrawal_usdc: 'Withdrawal Limits',
  max_daily_withdrawal_usd: 'Withdrawal Limits',
  min_withdrawal_btc: 'Withdrawal Limits',
  p2p_enabled: 'P2P Controls',
  referral_reward_percentage: 'Referral System',
  fee_rates_vip_0: 'Fees & VIP',
  fee_rates_vip_1: 'Fees & VIP',
  fee_rates_vip_2: 'Fees & VIP',
  fee_rates_vip_3: 'Fees & VIP',
  fee_rates_vip_4: 'Fees & VIP',
  fee_rates_vip_5: 'Fees & VIP',
};

export function getSettingMeta(key: string): SettingMeta {
  const type: SettingType = BOOLEAN_KEYS.has(key)
    ? 'boolean'
    : VIP_FEE_KEYS.has(key)
      ? 'vip_fees'
      : LABELS[key] && (key.includes('max_') || key.includes('min_') || key.includes('percentage') || key.includes('_usd') || key.includes('_usdc') || key.includes('_btc'))
        ? 'number'
        : 'string';
  const section = KEY_SECTION[key] ?? 'Other';
  return {
    label: LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    type,
    section,
  };
}

export function isBooleanKey(key: string): boolean {
  return BOOLEAN_KEYS.has(key);
}

export function isVipFeeKey(key: string): boolean {
  return VIP_FEE_KEYS.has(key);
}

/** Default structure for VIP fee JSON (backend may store same shape) */
export interface VipFeeRow {
  spot_maker?: number;
  spot_taker?: number;
  fiat_maker?: number;
  fiat_taker?: number;
}

export function parseVipFeeJson(raw: string | undefined): VipFeeRow {
  if (!raw || typeof raw !== 'string') return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      spot_maker: typeof o.spot_maker === 'number' ? o.spot_maker : undefined,
      spot_taker: typeof o.spot_taker === 'number' ? o.spot_taker : undefined,
      fiat_maker: typeof o.fiat_maker === 'number' ? o.fiat_maker : undefined,
      fiat_taker: typeof o.fiat_taker === 'number' ? o.fiat_taker : undefined,
    };
  } catch {
    return {};
  }
}

export function stringifyVipFeeJson(row: VipFeeRow): string {
  return JSON.stringify({
    spot_maker: row.spot_maker ?? 0,
    spot_taker: row.spot_taker ?? 0,
    fiat_maker: row.fiat_maker ?? 0,
    fiat_taker: row.fiat_taker ?? 0,
  });
}
