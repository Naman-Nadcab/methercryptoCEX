# Load Tests (k6)

## Spot Order Load Test

Tests `POST /api/v1/spot/order` with API key auth.

### Prerequisites

- [k6](https://k6.io/docs/get-started/installation/) installed
- Backend running (default: http://localhost:4000)
- API key with spot trading permission (create via dashboard or admin)

### Run

```bash
# Markets + tickers only (no auth)
k6 run load/k6-spot-order.js

# Full test with order placement (API key required)
API_KEY=your-api-key k6 run load/k6-spot-order.js

# Custom duration and VUs
VUS=10 DURATION=60s API_KEY=xxx k6 run load/k6-spot-order.js

# Different base URL
BASE_URL=https://api.example.com API_KEY=xxx k6 run load/k6-spot-order.js
```

### Env Vars

| Var | Default | Description |
|-----|---------|-------------|
| BASE_URL | http://localhost:4000 | Backend URL |
| API_KEY | (empty) | X-API-Key for order placement |
| VUS | 5 | Virtual users |
| DURATION | 30s | Test duration |

### Thresholds

- `http_req_duration` p95 &lt; 5s
- `http_req_failed` rate &lt; 10%
