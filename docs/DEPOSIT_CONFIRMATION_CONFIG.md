# Deposit confirmation configuration

Deposits are credited only after the required number of **block confirmations** is reached. This reduces reorg risk.

---

## Where it is configured

| Layer | Source | Notes |
|-------|--------|--------|
| **Backend (DB)** | `chains.confirmations_required` | Default `12` in migrations. Used when returning chain/deposit info to the frontend (e.g. deposit address page). |
| **Indexer** | `apps/indexer/src/config/chains.ts` | Per-chain `confirmations` (e.g. 25 for ETH, BSC, Polygon, Base, Arbitrum). Used when creating/updating deposit rows and when deciding if a deposit is creditable. |
| **Deposits table** | `deposits.required_confirmations` | Set per deposit (from indexer chain config or chain row). Backend credits when `deposits.confirmations >= required_confirmations`. |

---

## Flow

1. **Indexer** detects an incoming transfer and inserts a row in `deposits` with `required_confirmations` from its chain config (e.g. 25).
2. **ConfirmationTracker** (indexer) periodically updates `deposits.confirmations` from the current block height.
3. **Backend** `deposit-credit.service` credits a deposit when `confirmations >= COALESCE(required_confirmations, 1)`.

---

## Changing confirmations per chain

- **Backend:** Update `chains.confirmations_required` for the chain (e.g. via admin or migration). This affects what the API returns to the UI; the indexer may still use its own config when creating new deposits.
- **Indexer:** Edit `apps/indexer/src/config/chains.ts` and change the `confirmations` value for the chain, then redeploy the indexer. New deposits will use the new value.
- **Single source of truth:** For a single place to configure, the indexer could be changed to read `required_confirmations` from the backend `chains` table when writing deposits (future improvement).

---

## Defaults

- Backend `chains`: `confirmations_required` default **12** (migration).
- Indexer: **25** for Ethereum, BSC, Polygon, Base, Arbitrum.
- Deposit credit logic: `COALESCE(required_confirmations, 1)` so at least 1 confirmation is required if not set.
