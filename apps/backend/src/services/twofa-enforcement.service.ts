/**
 * 2FA / passkey enforcement policy from system_settings.
 * Used by auth (login) and wallet (withdrawal) to require 2FA when policy is enabled.
 */

import { db } from '../lib/database.js';

const KEYS = {
  require_2fa_login: 'require_2fa_login',
  require_2fa_withdrawal: 'require_2fa_withdrawal',
  require_2fa_api_trading: 'require_2fa_api_trading',
} as const;

export interface TwoFaPolicy {
  require2faLogin: boolean;
  require2faWithdrawal: boolean;
  require2faApiTrading: boolean;
}

function parseBool(v: unknown): boolean {
  if (v === true || v === 'true' || v === '1' || v === 1) return true;
  if (typeof v === 'string' && v.toLowerCase() === 'true') return true;
  return false;
}

export async function getTwoFaPolicy(): Promise<TwoFaPolicy> {
  try {
    const rows = await db.query<{ key: string; value: unknown }>(
      `SELECT key, value FROM system_settings WHERE key = ANY($1::text[])`,
      [Object.values(KEYS)]
    );
    const map = Object.fromEntries((rows.rows ?? []).map((r) => [r.key, r.value]));
    return {
      require2faLogin: parseBool(map[KEYS.require_2fa_login]),
      require2faWithdrawal: parseBool(map[KEYS.require_2fa_withdrawal]),
      require2faApiTrading: parseBool(map[KEYS.require_2fa_api_trading]),
    };
  } catch {
    return {
      require2faLogin: false,
      require2faWithdrawal: false,
      require2faApiTrading: false,
    };
  }
}

export async function updateTwoFaPolicy(policy: Partial<TwoFaPolicy>): Promise<void> {
  if (policy.require2faLogin !== undefined) {
    await db.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
      [KEYS.require_2fa_login, JSON.stringify(policy.require2faLogin)]
    );
  }
  if (policy.require2faWithdrawal !== undefined) {
    await db.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
      [KEYS.require_2fa_withdrawal, JSON.stringify(policy.require2faWithdrawal)]
    );
  }
  if (policy.require2faApiTrading !== undefined) {
    await db.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
      [KEYS.require_2fa_api_trading, JSON.stringify(policy.require2faApiTrading)]
    );
  }
}
