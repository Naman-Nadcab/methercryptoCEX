# Deposit Indexer — How to Run

Deposits are credited only after the **indexer** detects on-chain transactions and inserts rows into the `deposits` table. The backend then credits user balances (via repair or confirmation flow).

## Prerequisites

- **Same database** as the backend (indexer writes to `deposits` and related tables).
- **RPC URLs** for the chains you support (EVM, etc.). Set in indexer env or config.
- Backend **migrations** already run (tables `deposits`, `wallets` / `user_wallets`, `blockchains`, `currencies` must exist).

## Indexer app

- **Path:** `apps/indexer`
- **Scripts:**
  - `npm run build` — compile TypeScript
  - `npm run start` — run compiled `dist/index.js`
  - `npm run start:dev` — run with `tsx src/index.ts` (no build)
  - `npm run dev` — watch mode

## Environment

Create `.env` in repo root or in `apps/indexer` (depending on how the indexer loads config). Include at least:

- `DATABASE_URL` — same PostgreSQL URL as backend.
- RPC URLs for each chain you index (e.g. `POLYGON_RPC_URL`, `ETH_RPC_URL`).

If the indexer reads from the repo root `.env`, reuse the same `DATABASE_URL` and RPC vars as the backend.

## Run

From repo root:

```bash
cd apps/indexer
npm install
npm run start:dev
```

Or after build:

```bash
npm run build
npm run start
```

Keep the process running (e.g. via systemd, PM2, or Docker). Only one instance should run per environment to avoid duplicate deposit inserts.

## One-off backfill (optional)

The repo includes `apps/indexer/scan-past-deposits.ts` (or similar) for one-off backfill of past blocks. Run manually if you need to backfill; ensure it uses the same `deposits` schema and uniqueness (e.g. `ON CONFLICT (blockchain_id, tx_hash, to_address) DO NOTHING`) to avoid duplicates.

## After indexer runs

- New deposits to user deposit addresses appear in `deposits` with confirmations.
- Backend repair (e.g. in wallet routes) or indexer confirmation logic credits `user_balances` and sets `credited_at` / `balance_applied_at`.
- User sees balance and deposit history in the app.

## Troubleshooting

- **No deposits credited:** Ensure indexer is running and RPC URLs are correct; check indexer logs and `deposits` table for new rows.
- **Duplicate key errors:** Ensure DB has unique constraint on `(blockchain_id, tx_hash, to_address)` (or `chain_id`) and indexer uses `ON CONFLICT DO NOTHING` or equivalent.
