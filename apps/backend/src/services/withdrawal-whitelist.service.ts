/**
 * Withdrawal Address Whitelist service (Step 5B).
 * Manages withdrawal_address_whitelist and withdrawal_address_timelocks.
 * Withdrawal flow should call isAddressAllowed() before creating a withdrawal.
 */

import { db } from '../lib/database.js';
import type { PoolClient } from 'pg';

const DEFAULT_TIMELOCK_HOURS = 24;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AddAddressParams {
  userId: string;
  asset: string;
  address: string;
  label?: string | null;
  /** Hours until address can be used; default 24. Only applied for NEW addresses. */
  timelockHours?: number;
}

export interface AddAddressResult {
  addressId: string;
  /** When the address becomes usable; null if already unlocked or idempotent add (existing address). */
  unlockAt: Date | null;
}

export interface IsAddressAllowedParams {
  userId: string;
  asset: string;
  address: string;
}

export interface IsAddressAllowedResult {
  allowed: boolean;
  /** If not allowed due to timelock, the time when it will unlock. */
  unlockAt?: Date | null;
}

export interface DisableAddressParams {
  userId: string;
  addressId: string;
}

export interface ListAddressesParams {
  userId: string;
  /** If set, filter by asset (e.g. "ETH"). */
  asset?: string | null;
}

export interface WhitelistAddressRow {
  id: string;
  asset: string;
  address: string;
  label: string | null;
  enabled: boolean;
  added_at: string;
  /** Latest unlock time from timelocks; null if none. */
  unlock_at: Date | null;
  /** True if there is an active timelock (NOW() < unlock_at). */
  is_locked: boolean;
}

// ---------------------------------------------------------------------------
// addAddress
// Idempotent: if (userId, asset, address) already exists, return existing id
// and do not create a new timelock. Only NEW addresses get a timelock.
// ---------------------------------------------------------------------------

export async function addAddress(params: AddAddressParams): Promise<AddAddressResult> {
  const {
    userId,
    asset,
    address,
    label = null,
    timelockHours = DEFAULT_TIMELOCK_HOURS,
  } = params;

  const normalizedAddress = address.trim();
  const normalizedAsset = asset.trim().toUpperCase();
  if (!normalizedAddress || !normalizedAsset) {
    throw new Error('asset and address are required');
  }
  // Store address in lowercase so (user_id, asset, address) is idempotent for 0xABC vs 0xabc
  const addressToStore = normalizedAddress.toLowerCase();

  return db.transaction(async (client: PoolClient) => {
    // Check for existing row (idempotent): same user, asset, address (case-insensitive)
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM withdrawal_address_whitelist
       WHERE user_id = $1 AND asset = $2 AND LOWER(TRIM(address)) = LOWER(TRIM($3))`,
      [userId, normalizedAsset, normalizedAddress]
    );

    if (existing.rows.length > 0) {
      const addressId = existing.rows[0]!.id;
      // Existing address: no new timelock. Resolve latest unlock_at for this address.
      const latest = await client.query<{ unlock_at: string | null }>(
        `SELECT MAX(unlock_at) AS unlock_at FROM withdrawal_address_timelocks WHERE address_id = $1`,
        [addressId]
      );
      const unlockAtRaw = latest.rows[0]?.unlock_at;
      const unlockAt = unlockAtRaw ? new Date(unlockAtRaw) : null;
      return { addressId, unlockAt };
    }

    // New address: insert whitelist then timelock
    const insertWhitelist = await client.query<{ id: string }>(
      `INSERT INTO withdrawal_address_whitelist (user_id, asset, address, label, enabled)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id`,
      [userId, normalizedAsset, addressToStore, label?.trim() || null]
    );
    const addressId = insertWhitelist.rows[0]!.id;

    const unlockAt = new Date(Date.now() + timelockHours * 60 * 60 * 1000);
    await client.query(
      `INSERT INTO withdrawal_address_timelocks (user_id, address_id, unlock_at)
       VALUES ($1, $2, $3)`,
      [userId, addressId, unlockAt]
    );

    return { addressId, unlockAt };
  });
}

// ---------------------------------------------------------------------------
// isAddressAllowed
// Address must exist, be enabled, and have no active timelock.
// Multiple timelocks: we use the latest unlock_at; allowed only when NOW() >= that.
// ---------------------------------------------------------------------------

export async function isAddressAllowed(params: IsAddressAllowedParams): Promise<IsAddressAllowedResult> {
  const { userId, asset, address } = params;
  const normalizedAddress = address.trim();
  const normalizedAsset = asset.trim().toUpperCase();

  const row = await db.query<{ id: string }>(
    `SELECT id FROM withdrawal_address_whitelist
     WHERE user_id = $1 AND asset = $2 AND LOWER(TRIM(address)) = LOWER(TRIM($3)) AND enabled = TRUE`,
    [userId, normalizedAsset, normalizedAddress]
  );

  if (row.rows.length === 0) {
    return { allowed: false };
  }

  const addressId = row.rows[0]!.id;

  // Latest unlock time for this address (multiple timelocks → use max)
  const timelock = await db.query<{ unlock_at: string | null }>(
    `SELECT MAX(unlock_at) AS unlock_at FROM withdrawal_address_timelocks WHERE address_id = $1`,
    [addressId]
  );
  const unlockAtRaw = timelock.rows[0]?.unlock_at;
  const unlockAt = unlockAtRaw ? new Date(unlockAtRaw) : null;

  if (!unlockAt || new Date() >= unlockAt) {
    return { allowed: true };
  }

  return { allowed: false, unlockAt };
}

// ---------------------------------------------------------------------------
// disableAddress
// Soft disable: set enabled = false. User can only disable their own.
// ---------------------------------------------------------------------------

export async function disableAddress(params: DisableAddressParams): Promise<boolean> {
  const { userId, addressId } = params;
  const result = await db.query(
    `UPDATE withdrawal_address_whitelist SET enabled = FALSE WHERE id = $1 AND user_id = $2`,
    [addressId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// listAddresses
// Returns whitelist rows for user (optional asset filter) with unlock status.
// ---------------------------------------------------------------------------

export async function listAddresses(params: ListAddressesParams): Promise<WhitelistAddressRow[]> {
  const { userId, asset = null } = params;
  const normalizedAsset = asset?.trim().toUpperCase() || null;

  const rows = await db.query<{
    id: string;
    asset: string;
    address: string;
    label: string | null;
    enabled: boolean;
    added_at: string;
    unlock_at: string | null;
  }>(
    `SELECT w.id, w.asset, w.address, w.label, w.enabled, w.added_at,
            (SELECT MAX(t.unlock_at) FROM withdrawal_address_timelocks t WHERE t.address_id = w.id) AS unlock_at
     FROM withdrawal_address_whitelist w
     WHERE w.user_id = $1 AND ($2::text IS NULL OR w.asset = $2)
     ORDER BY w.asset, w.added_at DESC`,
    [userId, normalizedAsset]
  );

  const now = new Date();
  return rows.rows.map((r) => ({
    id: r.id,
    asset: r.asset,
    address: r.address,
    label: r.label,
    enabled: r.enabled,
    added_at: r.added_at,
    unlock_at: r.unlock_at ? new Date(r.unlock_at) : null,
    is_locked: r.unlock_at ? now < new Date(r.unlock_at) : false,
  }));
}

/*
  Example usage (commented):

  // Add a new withdrawal address (24h timelock by default)
  const { addressId, unlockAt } = await addAddress({
    userId: 'user-uuid',
    asset: 'ETH',
    address: '0x1234...',
    label: 'My cold wallet',
    timelockHours: 24,
  });

  // Before creating a withdrawal, check if address is allowed
  const { allowed, unlockAt } = await isAddressAllowed({
    userId: 'user-uuid',
    asset: 'ETH',
    address: '0x1234...',
  });
  if (!allowed) {
    if (unlockAt) throw new Error(`Address locked until ${unlockAt.toISOString()}`);
    else throw new Error('Address not whitelisted or disabled');
  }

  // Disable an address (user can only disable their own)
  await disableAddress({ userId: 'user-uuid', addressId: 'whitelist-row-uuid' });

  // List user's whitelisted addresses (optionally by asset)
  const list = await listAddresses({ userId: 'user-uuid', asset: 'ETH' });
  list.forEach((a) => {
    console.log(a.address, a.is_locked ? `unlocks at ${a.unlock_at}` : 'usable');
  });
*/
