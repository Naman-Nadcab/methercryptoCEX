# Task Status — User List

**Source:** P0–P3 task list  
**Last updated:** February 2026

---

## P0 — Critical

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Spot trades AML (recordAndEvaluate) | ✅ Done | spot.fastify + spot-trigger.service call recordAndEvaluate for buyer + seller per trade |
| 2 | Express path deprecate/remove | ✅ Done | JSDoc @deprecated on matching-engine, trading.routes, websocket/server; index.ts logs deprecation. Default `dev` uses Fastify (server.ts) |

---

## P1 — High Priority

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Internal transfer multi-row fix | ✅ Done | wallet.fastify: receiver lock selects `id` with LIMIT 1; update uses `WHERE id = $2` |
| 2 | Market Making – full implementation | ✅ Done | API key auth (X-API-Key), docs/MARKET_MAKING_API.md, MM risk dashboard (/admin/monitoring/mm-risk) |

---

## P2 — Medium Priority

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Ledger consistency doc | ✅ Done | docs/LEDGER_CONSISTENCY.md |
| 2 | MM risk monitoring dashboard | ✅ Done | GET /admin/monitoring/mm-risk; /admin/monitoring/mm-risk page |
| 3 | FIU logs verification | ✅ Done | docs/FIU_LOGS_VERIFICATION.md; recordAndEvaluate wired for deposits, withdrawals, internal transfer, spot, P2P |
| 4 | Production secrets + monitoring | ✅ Done | docs/PRODUCTION_SECRETS_AND_MONITORING.md |

---

## P3 — Lower Priority

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | E2E + load testing | ✅ Done | Playwright (e2e/smoke.spec.ts), smoke-api.mjs, k6 load script; docs/E2E_LOAD_TESTING.md |
| 2 | Staging + production deploy | ✅ Done | docs/DEPLOYMENT.md; docker-compose with postgres, redis, backend, frontend |

---

## Summary

| Priority | Total | Done | Pending |
|----------|-------|------|---------|
| P0 | 2 | 2 | 0 |
| P1 | 2 | 2 | 0 |
| P2 | 4 | 4 | 0 |
| P3 | 2 | 2 | 0 |
| **Total** | **10** | **10** | **0** |
