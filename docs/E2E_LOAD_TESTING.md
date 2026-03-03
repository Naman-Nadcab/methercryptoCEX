# E2E & Load Testing

## Quick: API Smoke (No Browser)

Fast backend health check, no Playwright needed:

```bash
# Backend must be running on port 4000
npm run smoke:api
```

---

## E2E (Playwright)

### Setup (one-time)

```bash
npx playwright install chromium
```

### Run

```bash
# Option A: Let Playwright start backend+frontend (takes ~60s first run)
npm run e2e

# Option B: Start servers first, then run tests (faster)
npm run dev:fb
# In another terminal:
SKIP_WEBSERVER=1 npm run e2e

# Debug mode:
npm run e2e:ui
```

### Tests

- `e2e/smoke.spec.ts`: Homepage, login, dashboard redirect, spot, p2p

---

## Load Testing (k6)

### Setup

Install k6: https://k6.io/docs/get-started/installation/

### Run

```bash
# Backend must be running on port 4000
npm run load

# Custom URL and duration:
BASE_URL=http://localhost:4000 VUS=10 DURATION=1m k6 run load/k6-spot-order.js
```

### What it tests

- `load/k6-spot-order.js`: GET /spot/markets and /spot/tickers (no auth required)
