# PHASE-12 — Exchange Abuse & Fraud Resilience

High-severity protections only. Financial safety and attack resistance.

---

## 1. P2P Abuse

| Protection | Implementation |
|------------|----------------|
| **Escrow exhaustion** | `assertP2PEscrowCap(sellerId, amount)` in `p2p.service` before `moveToEscrow`. Max 30 open escrows per user; max total locked 500,000 (configurable in `abuse-resilience.service.ts`). Throws `P2P_ESCROW_CAP_EXCEEDED` / `P2P_ESCROW_TOTAL_CAP_EXCEEDED`. |
| **Order spam** | `assertP2POrderVelocity(userId)`: max 20 orders per user (as buyer or seller) in rolling 1 hour. Throws `P2P_ORDER_VELOCITY_EXCEEDED`. Existing `rateLimiters.p2p` (30/min) on POST /p2p/orders. |
| **Risk-based block** | Before create order, `evaluateP2PRisk()` in route; if decision === `block`, return 403 `RISK_BLOCKED`. Risk engine P2P signals: `p2p_order_velocity_high`, `p2p_escrow_exposure_high` (plus existing login/device/VPN/KYC). |

---

## 2. Spot Abuse

| Protection | Implementation |
|------------|----------------|
| **Self-trade prevention** | **Settlement path:** In `settlement-worker.ts` `applyMatch()`, if `taker_user_id === maker_user_id` throw `SELF_TRADE_REJECTED` — no balance update. **In-process path:** `matching-engine.service.ts` already skips self-trade in matching loop. |
| **Order rate limit** | Spot place order: `rateLimitByUser('spot:order', 30, 60)` — 30 orders per user per minute. Spot cancel: `rateLimitByUser('spot:cancel', 60, 60)`. Reduces rapid create/cancel and order spam. |
| **Circuit breaker** | Existing per-symbol circuit in `spot.fastify.ts`: after threshold failures, market set to `maintenance`. |

---

## 3. Balance Safety

| Protection | Implementation |
|------------|----------------|
| **Rapid create/cancel** | Spot and P2P rate limits above. P2P velocity cap (20 orders/hour) limits churn. |
| **Suspicious movement** | Withdrawal velocity and amount signals already in risk engine. P2P escrow caps limit single-user exposure. |

---

## 4. Risk Signals

| Signal | Scope | Use |
|--------|--------|-----|
| `p2p_order_velocity_high` | p2p | Orders in last hour ≥ 15 → 1; ≥ 10 → 0.5. Weight 12. |
| `p2p_escrow_exposure_high` | p2p | Open escrow count ≥ 20 or total ≥ 100k → 1; count ≥ 10 → 0.5. Weight 15. |
| Existing | all | failed_login_count, new_device, new_country, vpn_tor, ip_block_attempt, kyc_not_approved, velocity_high (withdrawal), amount_high. |

Rules: `security_risk_rules` by scope (e.g. p2p). If no rule matches, decision = allow. Admin configures score bands → allow / challenge / block.

---

## 5. Operational Controls

| Control | Implementation |
|---------|----------------|
| **Emergency halt** | Redis key `trading_halt:global` = `1` or `true`. `getTradingHalted()`: if Redis error, **fail closed** (returns true). Checked in spot POST /order and P2P createOrder; returns 503 / throws `TRADING_HALTED`. |
| **Admin set/clear halt** | `GET /admin/trading-halt` — returns `{ halted }`. `POST /admin/trading-halt` body `{ halted: boolean }` — sets Redis key. Behind admin auth + IP whitelist + rate limit. |
| **Abuse monitoring** | All risk evaluations logged to `security_risk_events`; challenge/block to audit. P2P escrow/velocity violations logged in abuse-resilience.service. |

---

## Files Touched

- `services/settlement/settlement-worker.ts` — self-trade rejection.
- `lib/trading-halt.ts` — get/set global trading halt (Redis).
- `services/abuse-resilience.service.ts` — isTradingHalted, assertP2PEscrowCap, assertP2POrderVelocity, evaluateP2PRisk.
- `services/risk-engine.service.ts` — P2P signals and scoring.
- `services/p2p.service.ts` — halt + escrow cap + velocity before moveToEscrow.
- `routes/p2p.routes.ts` — evaluateP2PRisk before createOrder; 403 on block.
- `routes/spot.fastify.ts` — trading halt check; rate limit place + cancel.
- `routes/admin.fastify.ts` — GET/POST /admin/trading-halt.

---

## Config / Constants (tunable in code)

- `P2P_MAX_OPEN_ESCROWS_PER_USER` = 30  
- `P2P_MAX_ESCROW_TOTAL_PER_USER` = '500000'  
- `P2P_ORDER_VELOCITY_WINDOW_MINUTES` = 60, `P2P_ORDER_VELOCITY_MAX` = 20  
- Spot order: 30/min per user; cancel: 60/min per user  

No UI changes. No formatting/style suggestions.
