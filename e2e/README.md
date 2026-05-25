# E2E Test Suite

## API E2E (Node/TypeScript)

Run all phases:

```bash
npm run test:e2e
```

Full run **with QA traders + JWT/API keys** (writes `e2e/.e2e-credentials.json`, gitignored):

```bash
npm run test:e2e:provisioned
```

Run specific `--phase=N` values (1-based index into the runner queue — **there is no phase slot 10**):

| `--phase=` | Automated suite |
|------------|------------------|
| 1 | Phase 1 — System health (+ optional Rust engine ping) |
| 2 | Phase 2 — Authentication |
| 3 | Phase 3 — Spot trading |
| 4 | Phase 4 — Rust matching engine HTTP |
| 5 | Phase 5 — Wallet |
| 6 | Phase 6 — Internal transfer |
| 7 | Phase 7 — P2P |
| 8 | Phase 8 — Liquidity bot / oracle |
| 9 | Phase 9 — Public WebSocket |
| 10 | Phase 11 — Security |
| 11 | Phase 12 — Failure / resilience |
| 12 | Phase 13 — Tier-1 metrics & observability |
| 13 | Phase 14 — Private WebSocket lifecycle |
| 14 | Phase 15 — WS / REST parity |

Examples:

```bash
npm run test:e2e -- --phase=1,2,3
E2E_BASE_URL=http://127.0.0.1:4000 npm run test:e2e -- --phase=12
```

### Environment

| Variable | Description | Default |
|----------|-------------|---------|
| `E2E_BASE_URL` | Backend API base URL | `http://localhost:4000` |
| `E2E_ENGINE_URL` | Rust matching engine URL | `http://localhost:7101` |
| `E2E_JWT` | User JWT | — |
| `E2E_API_KEY` | API key for trading / wallet tests | — |
| `E2E_COUNTERPARTY_JWT` | Second user JWT (cross trades, Phase 14) | — |
| `E2E_COUNTERPARTY_API_KEY` | Second user API key | — |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | Admin login (optional) | — |
| `E2E_TIMEOUT_MS` | Request timeout (ms) | `10000` |
| `E2E_RATE_LIMIT_ATTEMPTS` | Security runner spot POST burst count | `48` |

**Provision credentials manually:**

```bash
cd apps/backend && npx tsx scripts/e2e-provision-credentials.ts
# Or write JSON for Playwright / scripts:
cd apps/backend && npx tsx scripts/e2e-provision-credentials.ts --emit-json ../../e2e/.e2e-credentials.json
```

### Operations notes

- **`matching_engine` down** in `/health` → Phase 1 may still PASS; Phase 4 may SKIP/FAIL depending on routing. Decide per environment whether Rust engine is required.
- **`indexer_lag_sec` high** → wire alerts (`ALERT_WEBHOOK_URL`) and runbook; deposit UX depends on indexer.
- **Security runner with auth:** `npm run test:security:provisioned` (reuses credential JSON).

Ensure PostgreSQL + Redis (+ NATS/RabbitMQ as per your deploy) run before executing E2E.

## Playwright (browser + lightweight API)

```bash
npm run e2e
npm run e2e:smoke
npm run e2e:ui
```

- `e2e/smoke.spec.ts` — loads key marketing/trading routes (needs `BASE_URL`, default frontend `http://localhost:3000`).
- `e2e/playwright-api-journey.spec.ts` — public markets + optional authenticated calls using `e2e/.e2e-credentials.json` or `E2E_*` env.

Playwright loads `BASE_URL` from env (see `playwright.config.ts`). API checks use `E2E_API_BASE_URL` or `E2E_BASE_URL` or `http://127.0.0.1:4000`.

## Load tests (quick)

```bash
npm run load:health:quick    # skips if k6 not installed (exit 0)
npm run load:health
```

## References

- `docs/E2E_TEST_PLAN.md`
- `docs/MANUAL_QA_CHECKLIST.md`
