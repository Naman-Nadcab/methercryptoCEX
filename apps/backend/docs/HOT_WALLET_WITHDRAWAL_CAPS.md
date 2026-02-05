# Per-hot-wallet withdrawal caps

Per-chain hot wallet limits: **max_single_tx** and **max_daily_outflow** (rolling 24h). Enforced before enqueue and before signing; chain-aware.

## Schema (hot_wallets)

```sql
ALTER TABLE hot_wallets ADD COLUMN IF NOT EXISTS max_single_tx DECIMAL(36,18);
ALTER TABLE hot_wallets ADD COLUMN IF NOT EXISTS max_daily_outflow DECIMAL(36,18);
```

- **max_single_tx** – Maximum value (in native token) for a single withdrawal from this hot wallet. `NULL` = no limit.
- **max_daily_outflow** – Maximum total value (in native token) that can leave this hot wallet in a rolling 24h window. `NULL` = no limit.

Daily outflow is computed as the sum of `net_amount` of **completed** withdrawals for that chain where `completed_at >= NOW() - INTERVAL '24 hours'`. The amount used for both caps is the withdrawal’s **net_amount** (value sent from the hot wallet).

## Enforcement

1. **Before enqueue** (`enqueueWithdrawal` in `withdrawal-signing.service.ts`)
   - After validating withdrawal status and resolving the hot wallet for the withdrawal’s chain, `checkHotWalletCaps(chainId, parseFloat(net_amount))` is called.
   - If caps fail → enqueue is not performed; returns `{ enqueued: false, reason, code }`.

2. **Before signing** (`processSigningQueue` in `withdrawal-signing.service.ts`)
   - After loading the withdrawal and checking status, `checkHotWalletCaps(chainId, parseFloat(w.net_amount))` is called.
   - If caps fail → queue item is marked failed with the cap message; no signing or broadcast.

Chain resolution uses `resolveHotWalletChainId(chainId)` so limits are applied per hot wallet (per chain), not per request chain id when multiple chains map to the same hot wallet.

## Service API (hot-wallet.service.ts)

- **getHotWalletCaps(chainId)** – Returns `{ max_single_tx, max_daily_outflow }` or `null` if no active hot wallet.
- **getDailyOutflowForChain(chainId)** – Returns sum of completed withdrawal `net_amount` in the last 24h for that chain.
- **checkHotWalletCaps(chainId, withdrawalNetAmount)** – Returns `{ allowed, code, message? }`. Used by enqueue and signing.

## Failure response codes

| Code | When | HTTP / behaviour |
|------|------|-------------------|
| **HOT_WALLET_SINGLE_TX_CAP_EXCEEDED** | Withdrawal `net_amount` > hot wallet’s `max_single_tx` | Enqueue returns `{ enqueued: false, code, reason }`. Approve returns 400 with `HOT_WALLET_CAP_EXCEEDED` and message. |
| **HOT_WALLET_DAILY_CAP_EXCEEDED** | Current 24h outflow + this withdrawal would exceed `max_daily_outflow` | Same as above. |
| **HOT_WALLET_CAP_EXCEEDED** | Used by approval flow when enqueue fails due to either cap | Admin `POST /admin/withdrawals/:id/approve` returns **400** with `error.code === 'HOT_WALLET_CAP_EXCEEDED'` and `error.message` set to the underlying reason. |

User create-withdrawal response may include **enqueueCode** and **enqueueReason** when the withdrawal is created with status `pending` but enqueue fails (e.g. cap); frontend can use these to show a message without failing the request.

When the signing processor hits a cap, the queue row is marked **failed** with the cap message (no retry for that withdrawal until limits or outflow change).

## Running migrations

From `apps/backend`:

```bash
npm run migrate
```

This adds `max_single_tx` and `max_daily_outflow` to `hot_wallets` if not already present.
