# E2E Test Suite

## API E2E (Node/TypeScript)

Run all phases:

```bash
npm run test:e2e
```

Run specific phases (e.g. 1, 2, and 3):

```bash
npm run test:e2e -- --phase=1,2,3
```

### Environment

| Variable | Description | Default |
|----------|-------------|---------|
| `E2E_BASE_URL` | Backend API base URL | `http://localhost:4000` |
| `E2E_ENGINE_URL` | Rust matching engine URL | `http://localhost:7101` |
| `E2E_JWT` | User JWT for authenticated tests | — |
| `E2E_API_KEY` | API key for spot/wallet tests | — |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | Admin login (optional) | — |
| `E2E_TIMEOUT_MS` | Request timeout (ms) | `10000` |

Ensure the backend (and optionally Redis, DB, matching engine) is running before executing E2E.

## Playwright (UI)

```bash
npm run e2e
npm run e2e:ui
```

See root `package.json` and `e2e/smoke.spec.ts`.

## Load tests

- **k6:** `npm run load`, `npm run load:health`, `npm run load:stress`
- **Artillery:** `artillery run load/artillery-config.yml`

See `docs/E2E_TEST_PLAN.md` and `docs/MANUAL_QA_CHECKLIST.md`.
