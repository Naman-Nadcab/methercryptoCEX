# Admin Funds Summary & Reconciliation (Solvency View)

API and UI guidance for the admin **Funds Summary** view: ledger totals (what we owe users), on-chain totals (hot/cold and user deposit addresses), and reconciliation status.

---

## Authentication

All endpoints require admin authentication. Unauthorized requests receive `401 Unauthorized`.

---

## GET /admin/funds/summary

Returns ledger totals (from `user_balances`), on-chain totals (hot wallets; cold and user deposit addresses when available), and reconciliation status with any mismatches.

### Request

- **Method:** `GET`
- **Path:** `/admin/funds/summary`

### Response (200 OK)

```json
{
  "success": true,
  "data": {
    "ledger_totals": [
      {
        "chain_id": "uuid",
        "chain_name": "string",
        "chain_symbol": "string",
        "token_id": "uuid",
        "token_symbol": "string",
        "amount": "string (numeric)"
      }
    ],
    "on_chain_totals": {
      "user_deposit_addresses": null,
      "hot_wallets": [
        { "chain_id": "string", "chain_name": "string", "balance": "string (wei or raw)" }
      ],
      "cold_wallets": [
        { "chain_id": "string", "chain_name": "string", "address": "string | null", "balance": null }
      ]
    },
    "reconciliation": {
      "status": "MATCH | MISMATCH",
      "mismatches": [
        {
          "chain_id": "uuid",
          "chain_name": "string",
          "token_symbol": "string",
          "ledger_amount": "string",
          "on_chain_amount": "string",
          "difference": "string (ledger - on_chain)"
        }
      ]
    }
  }
}
```

- **ledger_totals**: Sum of `available_balance + locked_balance` from `user_balances`, grouped by chain and token. Only rows with total > 0. Source: `user_balances` joined with `currencies` and `blockchains`.
- **on_chain_totals**:
  - **user_deposit_addresses**: Total balance across all user deposit addresses. Not computed by this API (would require indexer or RPC aggregation); always `null`.
  - **hot_wallets**: From `hot_wallets` table; `balance` is `balance_cache` (typically native token in smallest unit, e.g. wei).
  - **cold_wallets**: One entry per hot wallet chain with `cold_wallet_address`; `balance` is not fetched (would require RPC), so `null`.
- **reconciliation**:
  - **status**: `MATCH` when there are no mismatches; `MISMATCH` when any native-token comparison differs.
  - **mismatches**: Only present when `status === 'MISMATCH'`. Per-chain comparison of **ledger native token** (e.g. ETH on Ethereum) vs **hot wallet** `balance_cache` (converted to human units). `difference = ledger_amount - on_chain_amount`. Listed only when the absolute difference exceeds one smallest unit.

### Errors

| Status | When |
|--------|------|
| 401 | Not authenticated as admin |
| 500 | `FETCH_FAILED` — server/DB error |

---

## Admin UI: Suggested layout

### 1. Summary cards (top)

- **Ledger total** — Sum of all `ledger_totals[].amount` (note: mixed tokens; for display only or “by chain”).
- **Reconciliation status** — Single badge: **MATCH** (e.g. green) or **MISMATCH** (e.g. red/amber). If `MISMATCH`, show count of mismatches (e.g. “2 chains”).
- **Last updated** — From response timestamp or a “Refreshed at” label.

### 2. Ledger totals table

| Column     | Source              | Notes |
|-----------|---------------------|--------|
| Chain     | `chain_name`        | Optional: `chain_symbol` |
| Token     | `token_symbol`      | |
| Amount    | `amount`            | Format with token decimals |
| (optional)| `chain_id` / `token_id` | For linking to chain/token settings |

Data: `data.ledger_totals`. Empty state: “No user balances.”

### 3. On-chain totals table (or sections)

- **Hot wallets**: Rows from `data.on_chain_totals.hot_wallets` — Chain, Balance (show as “raw” or convert using chain decimals if you have them), optional link to Hot Wallets page.
- **Cold wallets**: Rows from `data.on_chain_totals.cold_wallets` — Chain, Address (truncate + copy), Balance (show “—” or “N/A” when `balance === null`).
- **User deposit addresses**: Show “Not aggregated” or “Requires indexer” when `user_deposit_addresses === null`.

### 4. Mismatches / reconciliation panel

- Visible when `data.reconciliation.status === 'MISMATCH'`.
- Table: Chain, Token, Ledger amount, On-chain amount, **Difference**.
- Data: `data.reconciliation.mismatches`.
- Use difference to drive severity (e.g. large absolute value = stronger warning).

### 5. Refresh strategy

- **Manual**: Prominent “Refresh” button that calls `GET /admin/funds/summary` and replaces all cards/tables. Optionally show a short loading state and “Refreshed at &lt;time&gt;” after success.
- **Periodic**: Optional auto-refresh every 60–300 seconds when the Funds Summary page is focused. Use a timer; clear it on route change or tab blur to avoid unnecessary load. Do not replace manual refresh; use periodic only as a convenience.

---

## How to interpret mismatches

- **What is compared**: For each chain that has a hot wallet, the API compares:
  - **Ledger**: Sum of user balances for the **native** token of that chain (e.g. ETH on Ethereum), from `user_balances`.
  - **On-chain**: Hot wallet `balance_cache` for that chain (converted to human units).
  - **Difference** = ledger amount − on-chain amount (in human units).

- **MATCH**: For every such chain, the difference is zero (within one smallest unit). Ledger and hot-wallet native balances are in line.

- **MISMATCH** (difference ≠ 0):
  - **Positive difference** (ledger > on-chain): Users are owed more than the hot wallet holds. Possible causes: deposits not yet swept to hot, pending withdrawals not yet sent, or hot balance cache stale (refresh hot balance). Investigate deposits and hot wallet balance refresh.
  - **Negative difference** (ledger < on-chain): Hot wallet holds more than user ledger. Possible causes: sweep from user addresses not yet credited, or timing (e.g. recent withdrawal). Check recent credits and withdrawals.
  - **Action**: Use Admin Deposits (filter by chain/token) and Hot Wallets balance refresh to reconcile. If user deposit addresses were aggregated, that would also help; currently they are not in this API.

- **Limitations**:
  - Reconciliation is only for **native token per chain** (e.g. ETH, BNB). ERC20/other tokens on the same chain are not compared here.
  - **User deposit addresses** and **cold wallet** balances are not included in the on-chain side of this comparison; only hot wallet `balance_cache` is used.
  - Hot wallet `balance_cache` must be refreshed (e.g. via Hot Wallets UI) for the comparison to be meaningful.

This view supports a **solvency check**: ensuring that, at least for native tokens, what the ledger says we owe (user balances) is backed by what we show on-chain in hot wallets, and flagging when it is not.
