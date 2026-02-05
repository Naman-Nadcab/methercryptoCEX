# Deposit consolidation (user deposit → hot wallet)

Sweep funds from **user deposit addresses** into the **hot wallet** so that on-chain balance matches the ledger and Funds Summary moves from MISMATCH → MATCH after `balance_cache` is refreshed.

---

## DB schema

### Table: `deposit_sweeps`

| Column         | Type      | Description |
|----------------|-----------|-------------|
| id             | UUID      | Primary key |
| chain_id       | VARCHAR(64) | Chain (e.g. chains.id) |
| from_address   | VARCHAR(255) | User deposit address (wallets.address) |
| to_address     | VARCHAR(255) | Hot wallet address |
| amount         | DECIMAL(36,18) | Human amount (optional) |
| amount_raw     | TEXT      | Wei/smallest unit for the sweep |
| tx_hash        | VARCHAR(255) | Set when broadcast succeeds |
| status         | VARCHAR(20) | `pending` \| `completed` \| `failed` |
| error_message  | TEXT      | Set when status = failed |
| created_at     | TIMESTAMPTZ | |
| completed_at   | TIMESTAMPTZ | Set when status changes to completed/failed |

- **UNIQUE(chain_id, from_address)** so the same address is never swept twice (idempotent).
- Indexes: `(chain_id, status)`, `(created_at DESC)`.

**Source of sweepable addresses:** `wallets` table (user_id, chain_id, address, encrypted_private_key). Only rows with non-empty `encrypted_private_key` and matching `chain_id` to an active hot wallet are considered.

---

## Service / worker structure

- **`deposit-sweep.service.ts`**
  - **listSweepableAddresses()**  
    For each chain with an active hot wallet (and EVM type), loads `wallets` for that chain_id, skips addresses that already have a `deposit_sweeps` row with status `completed`, and checks on-chain balance via RPC. Returns only addresses with balance ≥ `DEPOSIT_SWEEP_MIN_WEI` and sweep amount (balance − gas reserve) > 0.
  - **executeOneSweep(item)**  
    Inserts/updates a `deposit_sweeps` row (pending), decrypts user key, sends EVM transfer to hot wallet address, updates row to completed/failed, updates `hot_wallets.balance_cache` for that chain, and writes audit log `deposit_sweep_completed`.
  - **runDepositSweep()**  
    Calls `listSweepableAddresses()`, then runs `executeOneSweep()` for each item (errors logged per item; no throw).

- **Worker (server.ts)**  
  `setInterval(runDepositSweep, 120_000)` so the job runs every 2 minutes. Not user-triggered.

- **Config**  
  - `DEPOSIT_SWEEP_ENABLED` (default true)  
  - `DEPOSIT_SWEEP_MIN_WEI` (default 1e15) — minimum balance to consider for sweep (avoids dust).

---

## Chain-specific notes

- **EVM (implemented)**  
  - Uses `chains.rpc_url` and `type = 'evm'`.  
  - Balance via `provider.getBalance(from_address)`.  
  - Sweep = simple transfer: `signer.sendTransaction({ to: hot_address, value: balance - GAS_RESERVE_WEI, gasLimit: 21000 })`.  
  - User key from `wallets.encrypted_private_key` decrypted with `encryption.decryptPrivateKey(encryptedKey, user_id)`.

- **Bitcoin (not implemented)**  
  - Would need UTXO-based sweep: list UTXOs for address, build tx that sends to hot wallet minus fee, sign with wallet key.  
  - Requires Bitcoin RPC and wallet/UTXO helpers.

- **Solana (not implemented)**  
  - Would need account balance and transfer: get SOL balance, then send to hot wallet address, accounting for rent and fees.

---

## Safety

- **Do not sweep if hot wallet is inactive**  
  Only chains with `hot_wallets.is_active = TRUE` are included in `listSweepableAddresses()`.

- **Min balance and gas**  
  Only addresses with balance ≥ `DEPOSIT_SWEEP_MIN_WEI` and `(balance - GAS_RESERVE_WEI) > 0` are swept. Gas reserve is 21000 * 80 wei.

- **Caps**  
  Current implementation does not re-check `min_hot_balance` or per-hot-wallet caps before sweep; sweeps only add to hot wallet. Caps are enforced for withdrawals. Optional future improvement: skip or limit sweeps if hot wallet would exceed a max.

- **Fail-closed**  
  On decrypt/send failure, the row is set to `failed` with `error_message`; the worker continues with other addresses. No partial state: either pending → completed (with tx_hash and balance_cache update) or pending → failed.

---

## How this fixes Funds Summary mismatch

- **Before consolidation**  
  User balances are credited in `user_balances` (ledger). The actual funds sit at **user deposit addresses**. The hot wallet holds little or nothing, so Funds Summary compares ledger (high) vs hot wallet (low) → **MISMATCH**.

- **After consolidation**  
  The worker sweeps from user deposit addresses → hot wallet. Hot wallet balance increases. After **refreshing hot wallet balance** (e.g. via Admin → Hot Wallets → refresh), `balance_cache` reflects the new balance. Funds Summary then compares:
  - **Ledger:** same (user_balances unchanged; we already credited users).
  - **On-chain (hot):** increased by the swept amount.

  For the native token on that chain, ledger and on-chain can then match → **MATCH**.

- **Flow**  
  1. Deposits credited to users → ledger goes up.  
  2. Funds sit at user addresses → hot wallet balance low → MISMATCH.  
  3. Deposit sweep runs → moves funds to hot wallet.  
  4. Refresh hot wallet balance → `balance_cache` updated.  
  5. Funds Summary: ledger ≈ hot (native token) → MATCH.

---

## Admin visibility

- **Route:** `GET /admin/deposit-sweeps` (query: page, limit, chain_id, status).
- **UI:** Wallets → Deposit Sweeps. Table: chain, from_address, amount, tx_hash, status, created_at. Empty state when no sweeps.
