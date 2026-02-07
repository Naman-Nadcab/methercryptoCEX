# Global Risk Engine (Step 4)

The risk engine aggregates security signals into a 0–100 score and applies configurable rules to produce **ALLOW**, **CHALLENGE**, or **BLOCK** for sensitive actions.

## Overview

- **Scopes:** `login`, `withdrawal`, `p2p`, `api`, `admin`
- **Signals:** Failed login count, new device, new country, VPN/TOR, IP block attempt, KYC status, amount, velocity
- **Rules:** Stored in `security_risk_rules`; first matching rule (by priority) wins; default **allow** if no rule matches
- **Logging:** Every evaluation is logged to `security_risk_events`; **challenge** and **block** are also written to `audit_logs_immutable`

## Database

### security_risk_rules

| Column   | Type    | Description                          |
|----------|---------|--------------------------------------|
| id       | UUID    | Primary key                          |
| scope    | VARCHAR | login \| withdrawal \| p2p \| api \| admin |
| min_score| INT     | 0–100, inclusive                      |
| max_score| INT     | 0–100, inclusive (min_score ≤ max_score) |
| decision | VARCHAR | allow \| challenge \| block          |
| priority | INT     | Higher = evaluated first             |
| enabled  | BOOLEAN | Rule is applied only when true       |
| created_at | TIMESTAMPTZ | Creation time                    |

### security_risk_events

| Column    | Type    | Description                |
|-----------|---------|----------------------------|
| id        | UUID    | Primary key                |
| actor_type| VARCHAR | user \| admin \| system     |
| actor_id  | VARCHAR | User/admin id              |
| scope     | VARCHAR | Same as rules              |
| score     | INT     | 0–100                      |
| decision  | VARCHAR | allow \| challenge \| block |
| signals   | JSONB   | Explainable signal values  |
| request_id| VARCHAR | Optional request trace     |
| created_at| TIMESTAMPTZ | Event time             |

## Signals and Weights (default)

| Signal             | Weight | Description |
|--------------------|--------|-------------|
| failed_login_count | 15     | Min(failures, 5) / 5 × weight |
| new_device         | 12     | Device not seen before for user |
| new_country        | 15     | Country not seen before (from activity details) |
| vpn_tor            | 20     | VPN/TOR flag from middleware |
| ip_block_attempt   | 25     | Recent access_blocked or login_failed |
| kyc_not_approved   | 18     | No approved KYC application |
| amount_high        | 10     | Withdrawal amount tier (0, 0.5, 1) |
| velocity_high      | 15     | Withdrawal count in last 24h ≥ threshold |
| asset_high_risk    | 8      | Token is_high_risk |

Composite score is capped at 100. Weights are in code; can be made configurable (e.g. Redis) later.

## Engine Logic

1. **Compute signals** for the given scope and context (actor, IP, country, device, amount, etc.).
2. **Score** = weighted sum of signal contributions, rounded, clamped 0–100.
3. **Load rules** for scope, ordered by `priority DESC`.
4. **First rule** where `min_score ≤ score ≤ max_score` determines **decision**.
5. If **no rule** matches → **allow**.

## Integration

### Withdrawal (implemented)

- **Where:** `POST /api/v1/wallet/withdrawals` (on-chain flow), after daily limit check and before 2FA.
- **Context:** userId, amount, IP, country, deviceId, isVpnOrTor, symbol, isHighRiskAsset.
- **BLOCK:** Respond with 403 `RISK_BLOCKED`; do not create withdrawal.
- **CHALLENGE:** Force manual review by setting withdrawal status to `pending_approval` (same as high-amount/high-risk asset).

### Login (post-auth)

- Call `evaluateAndLogRisk({ scope: 'login', actorType: 'user', actorId: userId, context: { userId, ip, countryCode, deviceId, isVpnOrTor }, ... })` after successful OTP/auth.
- **BLOCK:** Invalidate session and return error (or force logout).
- **CHALLENGE:** Require extra OTP or email verification before granting full access.

### P2P order create

- Before creating a P2P order, call `evaluateAndLogRisk({ scope: 'p2p', ... })` with amount and user context.
- **BLOCK:** Reject order creation with 403.
- **CHALLENGE:** Require additional verification or queue for manual review.

### API key usage

- On each sensitive API call (e.g. trade, withdraw), call the engine with `scope: 'api'` and context (IP, user, endpoint).
- **BLOCK:** Return 403.
- **CHALLENGE:** Require re-auth or step-up.

## Admin APIs

All under `/api/v1/admin`, require admin JWT.

- **GET /security/risk-rules** — List with `scope`, `enabled`, `limit`, `offset`.
- **POST /security/risk-rules** — Body: `scope`, `decision`, optional `min_score`, `max_score`, `priority`, `enabled`.
- **GET /security/risk-rules/:id** — Get one.
- **PATCH /security/risk-rules/:id** — Update.
- **PATCH /security/risk-rules/:id/enable** | **/disable** — Toggle.
- **DELETE /security/risk-rules/:id** — Delete.

## Tuning and False Positives

### Reducing false positives

1. **Lower weights** for noisy signals (e.g. new_device if many users use incognito or new browsers).
2. **Narrow rule bands:** Use smaller `[min_score, max_score]` for **block** (e.g. 85–100 only) so only very high risk is blocked; use **challenge** for 50–84.
3. **Scope-specific rules:** Add rules only for `withdrawal` or `login` where impact is highest; leave other scopes without rules (default allow).
4. **KYC:** Once KYC is common, `kyc_not_approved` will often be true for new users; consider lowering its weight or only applying in withdrawal scope.
5. **New country:** Depends on storing `country_code` in activity log details; if rarely set, the signal may be unreliable — consider disabling or lowering weight.

### Reducing false negatives

1. **Add rules** for **block** in high-score bands (e.g. 70–100) for withdrawal/login.
2. **Increase weights** for strong signals (VPN/TOR, ip_block_attempt, failed_login_count).
3. **Velocity:** Lower `VELOCITY_THRESHOLD_WITHDRAWALS` or add more time windows (e.g. 1h count) for stricter velocity checks.

### Rule design

- **Priority:** Higher number = evaluated first. Put “block” rules above “challenge,” and “challenge” above “allow” for the same score band if you want block to win.
- **Overlapping bands:** First matching rule wins. Example: rule A (0–40, allow), rule B (35–70, challenge), rule C (65–100, block). Score 50 → B (challenge); score 68 → B (challenge) if B has higher priority than C.
- **Default allow:** If no rules exist for a scope, or score falls in no band, the engine returns **allow**.

### Monitoring

- Query `security_risk_events` by scope, decision, and time to see challenge/block rate and score distribution.
- Join with `audit_logs_immutable` (action = `risk_engine_decision`) for full audit trail of high-risk decisions.
- Tune rules and weights based on support tickets (false positives) and incident reports (false negatives).
