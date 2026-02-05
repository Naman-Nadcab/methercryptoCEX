# Step 3 — End-to-End EVM Withdrawal Test

Validate the full withdrawal lifecycle in production-like conditions. No new features, limits, or approval logic are changed.

## Prerequisites

1. **EVM hot wallet** with sufficient native balance for one small withdrawal (and gas) on the target chain (e.g. Ethereum, Polygon, Base).
2. **User account** with:
   - Balance in `user_balances` for the chosen token/chain (funding account).
   - KYC/2FA/whitelist satisfied if required by your config.
3. **Admin account** with withdrawal approval permission (e.g. `withdrawal_approver` or `super_admin`).
4. **Backend** running with hot wallet env configured; signing queue processor runs on an interval (~5s).

## Test Flow

### 1. Trigger a small user withdrawal (test amount)

- Log in as the **user** in the frontend.
- Go to **Withdraw** → choose an **EVM chain** and **token** that has a hot wallet with balance.
- Enter a **small test amount** (e.g. minimum withdrawal or 0.001).
- Enter destination address (or whitelisted address if whitelist is on).
- Submit. If the amount/asset requires approval, status will be **pending_approval**.

**Verify:**

- Response returns `status: "pending_approval"` or `"pending"`.
- In DB: `withdrawals` has one row with that `id`, `amount`, `fee`, `net_amount`; `user_balances` has **locked** increased and **available** decreased by `amount + fee` for that user/currency/chain.

### 2. Approve (if status was pending_approval)

- Log in as **admin**.
- Go to **Withdrawals → Pending Approval**.
- Find the withdrawal; open **View** → **Approve**.

**Verify:**

- Success message; row disappears from Pending Approval.
- In DB: `withdrawals.status` = `pending`; row exists in `withdrawal_signing_queue` with `status = 'pending'`.

### 3. Observe status transitions: pending_approval → pending → completed

- **pending_approval**: after user submits (if approval required).
- **pending**: after admin approves (and enqueue succeeds); queue processor will pick it up.
- **completed**: after hot wallet signs and broadcasts; backend updates withdrawal and deducts locked balance.

**Verify in DB:**

- `withdrawals.status` → `completed`.
- `withdrawals.tx_hash` set to the on-chain tx hash.
- `withdrawals.completed_at` set.
- `user_balances`: **locked_balance** decreased by `amount + fee`; **available_balance** unchanged (already reduced at create).

### 4. Log each stage (no secrets)

Backend logs one line per stage with tag `[E2E_WITHDRAWAL]` and only safe fields (no keys, no addresses):

```bash
# Grep for lifecycle during test (replace WITHDRAWAL_ID if you have it)
grep E2E_WITHDRAWAL /path/to/backend.log
```

Expected sequence for one successful withdrawal:

| Stage              | Log message                         | Context (no secrets)                    |
|--------------------|-------------------------------------|-----------------------------------------|
| 1. Created         | `[E2E_WITHDRAWAL] stage=created`    | `withdrawal_id`, `status`, `chain_id`, `symbol` |
| 2. Approved        | `[E2E_WITHDRAWAL] stage=approved`   | `withdrawal_id`, `status=pending`, `chain_id`   |
| 3. Enqueued        | `[E2E_WITHDRAWAL] stage=enqueued`   | `withdrawal_id`, `chain_id`             |
| 4. Signing started | `[E2E_WITHDRAWAL] stage=signing_started` | `withdrawal_id`, `chain_id`, `queue_id` |
| 5. Completed       | `[E2E_WITHDRAWAL] stage=completed`  | `withdrawal_id`, `status=completed`, `chain_id`, `tx_hash` |

### 5. Ensure correctness

- **Hot wallet** signs and broadcasts the tx (signing service uses chain RPC and hot wallet signer).
- **tx_hash** is stored in `withdrawals.tx_hash` and in `withdrawal_signing_queue` for the completed queue item.
- **user_balances**: at create, available → locked; at completion, locked deducted (no refund). One row per (user, currency, chain, account_type).

## Outcome

One successful on-chain withdrawal (status **completed**, `tx_hash` set, balance moved from locked and reflected on-chain) confirms system readiness for EVM withdrawals.

## Troubleshooting

- **Stuck in pending**: Check hot wallet has balance and RPC is reachable; check `withdrawal_signing_queue` for the `withdrawal_id` and queue `status`/`error_message`.
- **Enqueue failed after approve**: e.g. hot wallet cap exceeded; see admin error message and backend logs.
- **Broadcast failed**: Check RPC and gas; see queue `error_message` and `[E2E_WITHDRAWAL]` or signing logs.
