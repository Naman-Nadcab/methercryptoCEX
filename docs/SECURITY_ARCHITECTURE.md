# Exchange Security Architecture — Industry-Grade Design

**Scope:** Centralized crypto exchange (Spot, P2P, INR fiat gateway).  
**Stack:** Node.js, Fastify (TypeScript), PostgreSQL, Redis, BullMQ.  
**Goal:** Complete, production-grade security system aligned with Binance/Bybit-level practices and India-focused compliance.

---

## 1. High-Level System Architecture

```
                                    ┌─────────────────────────────────────────────────────────────┐
                                    │                    API GATEWAY / LOAD BALANCER                │
                                    │              (TLS, DDoS mitigation, WAF optional)             │
                                    └─────────────────────────────────────────────────────────────┘
                                                                  │
                                                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                        SECURITY MIDDLEWARE STACK (Fastify)                                           │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │
│  │ Request ID   │ │ Rate Limit   │ │ IP Check     │ │ Geo/Country  │ │ VPN/TOR      │ │ Captcha     │   ...         │
│  │ CORS/Helmet  │ │ (Redis)      │ │ (Admin WL /  │ │ Restriction  │ │ Detection    │ │ (optional)  │              │
│  │              │ │              │ │  User BL/WL) │ │              │ │              │ │             │              │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘              │
│         │                 │                │                 │                 │                 │                    │
│         └─────────────────┴────────────────┴─────────────────┴─────────────────┴─────────────────┘                    │
│                                                          │                                                           │
│                                                          ▼                                                           │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                              GLOBAL RISK ENGINE (pre-auth & post-auth)                                         │   │
│  │   Inputs: IP, geo, device_id, user_id, action_type, amount, velocity, KYC tier, rules from DB                 │   │
│  │   Output: ALLOW | CHALLENGE (2FA/email/device) | BLOCK                                                         │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                          │                                                           │
└──────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────────┘
                                                          │
         ┌────────────────────────────────────────────────┼────────────────────────────────────────────────┐
         │                        APPLICATION LAYER        │                                              │
         │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ │ ┌─────────────┐ ┌─────────────┐ ┌──────────┐ │
         │  │ Auth        │ │ User        │ │ Wallet      │ │ Trading     │ │ P2P         │ │ Admin    │ │
         │  │ (login, 2FA,│ │ (profile,  │ │ (deposit,   │ │ (orders,    │ │ (ads,       │ │ (KYC,    │ │
         │  │  passkey,   │ │  devices,  │ │  withdraw,  │ │  orderbook) │ │  orders,    │ │  users,  │ │
         │  │  OTP)       │ │  API keys) │ │  whitelist) │ │             │ │  disputes)  │ │  config) │ │
         │  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └────┬─────┘ │
         │         │               │               │               │               │              │       │
         └─────────┼───────────────┼───────────────┼───────────────┼───────────────┼──────────────┼───────┘
                   │               │               │               │               │              │
                   ▼               ▼               ▼               ▼               ▼              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              SECURITY & COMPLIANCE SERVICES (shared)                                                 │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐              │
│  │ Activity        │ │ Fraud           │ │ AML /           │ │ Audit Log       │ │ Withdrawal      │              │
│  │ Monitor         │ │ Detection       │ │ Compliance      │ │ (append-only)   │ │ Security        │              │
│  │ (log every      │ │ (velocity,      │ │ (KYC, STR/CTR,  │ │ (immutable)     │ │ (whitelist,     │              │
│  │  action)        │ │  multi-account, │ │  thresholds)    │ │                 │ │  timelock,      │              │
│  │                 │ │  wash, P2P)     │ │                 │ │                 │ │  approval)      │              │
│  └────────┬────────┘ └────────┬────────┘ └────────┬────────┘ └────────┬────────┘ └────────┬────────┘              │
│           │                   │                   │                   │                   │                        │
└───────────┼───────────────────┼───────────────────┼───────────────────┼───────────────────┼────────────────────────┘
            │                   │                   │                   │                   │
            ▼                   ▼                   ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  PostgreSQL                    │  Redis                         │  BullMQ / Events                                     │
│  • users, user_sessions        │  • rate_limit:*                │  • fraud_check queue                                 │
│  • user_activity_logs          │  • ip_blacklist, ip_whitelist   │  • aml_alert queue                                   │
│  • admin_activity_logs         │  • session:*                   │  • notification queue                                 │
│  • audit_logs (append-only)    │  • device_trust:*              │  • withdrawal_approval queue                         │
│  • security_* tables           │  • risk_score:*                │                                                      │
│  • kyc_*, withdrawal_*         │  • lock:* (account lock)       │                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Data flow (summary):**
- Every request passes: identity (optional) → IP/geo/device checks → rate limit → risk engine (pre-auth for login/signup, post-auth for sensitive actions).
- Sensitive actions (login, 2FA change, withdrawal, API key create, etc.) are logged by Activity Monitor and optionally Audit Log.
- Withdrawals go through Withdrawal Security (whitelist, timelock, amount rules, admin approval) and can emit AML/fraud signals.
- Fraud and AML consume events and DB state; they produce alerts and risk-score updates used by the Global Risk Engine.

---

## 2. Folder & Module Structure

```
apps/backend/src/
├── config/
│   └── index.ts                    # existing; extend with security.*
├── database/
│   ├── migrate.ts                  # existing; add security migrations
│   └── migrations/
│       └── security-*.sql         # optional per-module SQL files
├── lib/
│   ├── database.ts
│   ├── redis.ts
│   ├── logger.ts
│   ├── encryption.ts
│   ├── totp-verify.ts
│   └── security/
│       ├── geo.ts                  # IP → country (maxmind or API)
│       ├── vpn-tor.ts              # VPN/Proxy/TOR detection (optional provider)
│       ├── device-fingerprint.ts   # hash & validate fingerprint
│       ├── captcha.ts              # verify captcha token (reCAPTCHA / hCaptcha)
│       └── risk-formula.ts         # risk score calculation helpers
├── middleware/
│   ├── auth.ts                     # existing JWT/session
│   ├── rateLimiter.ts              # existing
│   ├── security.ts                 # existing (adapt to Fastify)
│   ├── ip-management.ts            # admin IP WL, user IP BL/WL, country
│   ├── risk-engine.ts              # global risk check (ALLOW/CHALLENGE/BLOCK)
│   └── audit.ts                    # attach audit context; call audit log write
├── services/
│   ├── auth.service.ts
│   ├── otp.service.ts
│   ├── activity-monitor.service.ts # log user/admin actions
│   ├── session.service.ts          # list/revoke sessions; forced logout
│   ├── device.service.ts           # trusted devices; new device verification
│   ├── withdrawal-security.service.ts # whitelist, timelock, cooldown, rules
│   ├── withdrawal-approval.service.ts # existing; integrate with security
│   ├── fraud-detection.service.ts  # velocity, multi-account, wash, P2P abuse
│   ├── aml-compliance.service.ts   # KYC lifecycle, thresholds, STR/CTR logs
│   ├── api-key.service.ts          # create/rotate keys; scopes; IP bind
│   └── audit-log.service.ts        # append-only immutable audit
├── routes/
│   ├── auth.fastify.ts
│   ├── user.fastify.ts
│   ├── wallet.fastify.ts
│   ├── admin.fastify.ts
│   └── security.fastify.ts         # user: devices, sessions, IP prefs, 2FA
├── jobs/                           # BullMQ workers (optional)
│   ├── fraud-check.job.ts
│   ├── aml-alert.job.ts
│   └── risk-score-sync.job.ts
└── types/
    └── index.ts                    # extend with security types
```

**Admin UI (frontend)** should expose:
- Activity Monitor (user + admin logs, filters, export).
- IP Management (admin whitelist, user blacklist/whitelist, country rules).
- Device Management (view/revoke user devices).
- Withdrawal Security (rules, approval queue, overrides).
- Fraud Detection (alerts, velocity/multi-account/wash/P2P reports).
- AML/Compliance (KYC queue, STR/CTR logs, escalation).
- API Key Management (view/revoke user API keys).
- Audit Log viewer (read-only, no delete/edit).
- Global Risk Engine (rules config, risk thresholds, override actions).

---

## 3. PostgreSQL Database Schema (Security-Focused)

Enums and tables below extend or align with your existing schema. Use migrations (e.g. in `migrate.ts`) so existing tables are unchanged where possible.

### 3.1 Enums

```sql
-- Activity (extend existing activity_type if needed)
CREATE TYPE security_action_type AS ENUM (
  'login', 'login_failed', 'logout',
  'password_change', 'password_reset_request', 'password_reset_confirm',
  '2fa_enable', '2fa_disable', '2fa_verify_failed',
  'passkey_register', 'passkey_authenticate', 'passkey_remove',
  'otp_send', 'otp_verify_failed',
  'api_key_create', 'api_key_delete', 'api_key_rotate',
  'withdrawal_request', 'withdrawal_approve', 'withdrawal_reject', 'withdrawal_complete',
  'withdrawal_address_add', 'withdrawal_address_remove', 'withdrawal_address_confirm',
  'kyc_submit', 'kyc_approve', 'kyc_reject',
  'device_trust', 'device_untrust', 'device_removed',
  'p2p_ad_create', 'p2p_order_place', 'p2p_dispute_open', 'p2p_dispute_resolve',
  'order_place', 'order_cancel',
  'settings_change', 'ip_whitelist_change', 'account_lock', 'account_unlock'
);

CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE risk_decision AS ENUM ('allow', 'challenge', 'block');
CREATE TYPE audit_actor_type AS ENUM ('user', 'admin', 'system', 'api_key');

-- IP & device
CREATE TYPE ip_rule_type AS ENUM ('admin_whitelist', 'user_whitelist', 'user_blacklist', 'country_block', 'country_allow');
CREATE TYPE device_trust_status AS ENUM ('pending', 'trusted', 'revoked');

-- Withdrawal security
CREATE TYPE withdrawal_approval_tier AS ENUM ('auto', 'manual_low', 'manual_high', 'manual_critical');
CREATE TYPE address_whitelist_status AS ENUM ('pending_confirm', 'confirmed', 'disabled');

-- AML
CREATE TYPE aml_alert_type AS ENUM ('large_txn', 'velocity', 'high_risk_country', 'sanctions', 'pep', 'other');
CREATE TYPE aml_alert_status AS ENUM ('open', 'under_review', 'escalated', 'closed_no_action', 'closed_str', 'closed_ctr');
CREATE TYPE str_ctr_type AS ENUM ('str', 'ctr');
```

### 3.2 Core Security Tables

```sql
-- ========== Activity Monitor (extend user_activity_logs / admin_activity_logs) ==========
-- Ensure columns exist: ip_address INET, user_agent TEXT, device_id VARCHAR, country_code CHAR(2), details JSONB

ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS ip_address INET;
ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS device_id VARCHAR(255);
ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS country_code CHAR(2);
ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS geo_region VARCHAR(100);
ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS risk_score INT;
ALTER TABLE user_activity_logs ADD COLUMN IF NOT EXISTS risk_decision VARCHAR(20);

-- ========== IP Management ==========
CREATE TABLE IF NOT EXISTS security_ip_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_type ip_rule_type NOT NULL,
  scope VARCHAR(20) NOT NULL DEFAULT 'global',  -- 'global' | 'admin' | user_id
  scope_id UUID,                                -- admin_id or user_id when scope != global
  value TEXT NOT NULL,                          -- IP, CIDR, or country_code
  value_type VARCHAR(20) NOT NULL DEFAULT 'ip', -- 'ip' | 'cidr' | 'country'
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  UNIQUE(rule_type, scope, scope_id, value)
);
CREATE INDEX idx_security_ip_rules_scope ON security_ip_rules(scope, scope_id) WHERE is_active;
CREATE INDEX idx_security_ip_rules_value ON security_ip_rules(value_type, value) WHERE is_active;

CREATE TABLE IF NOT EXISTS security_vpn_tor_providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(50) NOT NULL,
  api_key_encrypted TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== Device Management ==========
CREATE TABLE IF NOT EXISTS user_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_fingerprint_hash VARCHAR(64) NOT NULL,
  device_name VARCHAR(255),
  device_type VARCHAR(50),
  browser VARCHAR(100),
  os VARCHAR(100),
  ip_address INET,
  country_code CHAR(2),
  trust_status device_trust_status DEFAULT 'pending',
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  UNIQUE(user_id, device_fingerprint_hash)
);
CREATE INDEX idx_user_devices_user ON user_devices(user_id);
CREATE INDEX idx_user_devices_fingerprint ON user_devices(device_fingerprint_hash);

-- ========== Withdrawal Security ==========
CREATE TABLE IF NOT EXISTS withdrawal_address_whitelist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain_id VARCHAR(50) NOT NULL,
  token_id UUID,
  address_encrypted TEXT NOT NULL,
  address_tag_encrypted TEXT,
  label VARCHAR(255),
  status address_whitelist_status DEFAULT 'pending_confirm',
  confirmed_at TIMESTAMPTZ,
  timelock_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, chain_id, address_encrypted)
);
CREATE INDEX idx_withdrawal_whitelist_user ON withdrawal_address_whitelist(user_id);

CREATE TABLE IF NOT EXISTS security_withdrawal_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  rule_type VARCHAR(50) NOT NULL,  -- 'amount_threshold_inr', 'amount_threshold_usd', 'cooldown_after_security', 'new_address_timelock'
  config JSONB NOT NULL,
  approval_tier withdrawal_approval_tier NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== Fraud Detection ==========
CREATE TABLE IF NOT EXISTS fraud_signals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID,
  signal_type VARCHAR(50) NOT NULL,  -- 'velocity_login', 'multi_account', 'wash_trade', 'p2p_abuse', 'withdrawal_velocity'
  entity_type VARCHAR(50),           -- 'user' | 'order' | 'p2p_order' | 'withdrawal'
  entity_id UUID,
  score INT NOT NULL,
  details JSONB,
  status VARCHAR(20) DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_fraud_signals_user ON fraud_signals(user_id);
CREATE INDEX idx_fraud_signals_type_created ON fraud_signals(signal_type, created_at DESC);

-- ========== AML / Compliance ==========
CREATE TABLE IF NOT EXISTS aml_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  alert_type aml_alert_type NOT NULL,
  title VARCHAR(255),
  description TEXT,
  amount_inr NUMERIC(20,2),
  amount_crypto NUMERIC(36,18),
  currency VARCHAR(20),
  reference_type VARCHAR(50),
  reference_id UUID,
  status aml_alert_status DEFAULT 'open',
  assigned_to UUID REFERENCES admin_users(id),
  str_ctr_filed str_ctr_type,
  filed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  closed_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_aml_alerts_user ON aml_alerts(user_id);
CREATE INDEX idx_aml_alerts_status ON aml_alerts(status);
CREATE INDEX idx_aml_alerts_created ON aml_alerts(created_at DESC);

CREATE TABLE IF NOT EXISTS aml_str_ctr_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  log_type str_ctr_type NOT NULL,
  report_id VARCHAR(100),
  user_id UUID,
  alert_id UUID REFERENCES aml_alerts(id),
  payload_json_encrypted TEXT,
  filed_at TIMESTAMPTZ DEFAULT NOW(),
  filed_by UUID REFERENCES admin_users(id)
);
CREATE INDEX idx_aml_str_ctr_filed ON aml_str_ctr_logs(filed_at DESC);

-- ========== API Key Security ==========
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(64) NOT NULL UNIQUE,
  key_prefix VARCHAR(10) NOT NULL,
  name VARCHAR(100),
  scopes TEXT[] NOT NULL DEFAULT '{}',
  ip_restrictions TEXT[],
  rate_limit_per_min INT,
  last_used_at TIMESTAMPTZ,
  last_used_ip INET,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS api_key_usage_logs (
  id BIGSERIAL PRIMARY KEY,
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  method VARCHAR(10),
  path TEXT,
  status_code INT,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_api_key_usage_key_created ON api_key_usage_logs(api_key_id, created_at DESC);

-- ========== Audit Log (Immutable) ==========
CREATE TABLE IF NOT EXISTS audit_logs_immutable (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_type audit_actor_type NOT NULL,
  actor_id UUID,
  actor_ip INET,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id UUID,
  old_value_json TEXT,
  new_value_json TEXT,
  request_id VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Partition by month in production; RLS or trigger to forbid UPDATE/DELETE
CREATE INDEX idx_audit_immutable_actor ON audit_logs_immutable(actor_type, actor_id, created_at DESC);
CREATE INDEX idx_audit_immutable_resource ON audit_logs_immutable(resource_type, resource_id);
CREATE INDEX idx_audit_immutable_created ON audit_logs_immutable(created_at DESC);

-- Revoke UPDATE/DELETE for audit table (run as superuser or table owner)
-- ALTER TABLE audit_logs_immutable ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY no_update_delete ON audit_logs_immutable FOR ALL USING (false);

-- ========== Global Risk Engine Config ==========
CREATE TABLE IF NOT EXISTS security_risk_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  action_context VARCHAR(50) NOT NULL,  -- 'login' | 'withdrawal' | 'api' | 'p2p_order' | 'transfer' | etc.
  condition_expression JSONB NOT NULL,  -- e.g. {"risk_score_gt": 70, "country_in": ["XX"]}
  decision risk_decision NOT NULL,
  priority INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_risk_rules_context ON security_risk_rules(action_context, is_active);

-- ========== Account lock (extend users or separate) ==========
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_reason VARCHAR(100);
```

---

## 4. Core Security Middleware Design

Execution order (conceptual):

1. **Request ID** – attach `requestId` to every request/response.
2. **CORS / Helmet** – existing; ensure Fastify equivalents (e.g. `@fastify/cors`, `@fastify/helmet`) are applied.
3. **Rate limit** – existing `rateLimiter`; key by `ip` or `userId` (when authenticated). Use Redis.
4. **IP management** (`ip-management.ts`):
   - For `/api/v1/admin/*`: allow only if request IP is in `security_ip_rules` with `rule_type = 'admin_whitelist'` (or config fallback).
   - For user routes: if user has whitelist enabled, allow only IPs in user’s whitelist; apply blacklist for all users; apply country_block / country_allow from `security_ip_rules`.
5. **Geo** – resolve IP to country (and optionally region); attach to request context for risk and logging.
6. **VPN/TOR** (optional) – call external provider; attach boolean to context; can be used in risk rules.
7. **Risk engine** (`risk-engine.ts`):
   - **Pre-auth** (login, signup, forgot-password): compute risk from IP, geo, device_id, velocity (e.g. failed logins from IP). Return ALLOW / CHALLENGE (e.g. captcha, email OTP) / BLOCK.
   - **Post-auth** (withdrawal, add withdrawal address, enable 2FA, API key create): same idea; add user_id, KYC tier, withdrawal amount. Decision can require 2FA or block.
   - Load `security_risk_rules` for the `action_context`; evaluate in priority order; first matching rule sets decision; default ALLOW if no match.
8. **Audit** – for sensitive routes, after handler success, call `audit-log.service` with actor, action, resource, old/new value (no PII/secrets in payload).

**Fastify hooks (pseudocode):**

- `onRequest`: requestId, rate limit, IP resolution.
- `preHandler`: IP rules, geo, VPN/TOR, risk engine (if route is in risk-context list).
- `onResponse`: audit write for audited routes; activity log write.

**Config (env / DB):**
- `security.adminIpWhitelist` (array or DB).
- `security.vpnTorBlock` (bool).
- `security.captchaRequiredForLogin` (bool).
- `security.maxFailedLogins` (e.g. 5), `lockoutMinutes` (e.g. 30).

---

## 5. Key API Endpoints (Admin + User)

### 5.1 User (Security)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/user/sessions` | List active sessions (with device, IP, last active). |
| DELETE | `/api/v1/user/sessions/:id` | Revoke one session. |
| POST | `/api/v1/user/sessions/revoke-all` | Revoke all other sessions (keep current). |
| GET | `/api/v1/user/devices` | List trusted/pending devices. |
| POST | `/api/v1/user/devices/:id/trust` | Mark device trusted (e.g. after OTP). |
| DELETE | `/api/v1/user/devices/:id` | Remove device and revoke related sessions. |
| GET | `/api/v1/user/ip-preferences` | Get IP whitelist/blacklist (if feature on). |
| POST | `/api/v1/user/ip-preferences` | Add/remove IP rule (whitelist/blacklist). |
| GET | `/api/v1/user/withdrawal-addresses` | List whitelisted withdrawal addresses. |
| POST | `/api/v1/user/withdrawal-addresses` | Add address (pending_confirm; timelock starts). |
| POST | `/api/v1/user/withdrawal-addresses/:id/confirm` | Confirm with email/2FA; set confirmed. |
| DELETE | `/api/v1/user/withdrawal-addresses/:id` | Remove (only if no pending withdrawal). |
| GET | `/api/v1/user/activity` | Paginated activity log (own). |
| GET | `/api/v1/user/api-keys` | List API keys (masked). |
| POST | `/api/v1/user/api-keys` | Create key (scopes, IP restrictions, name). |
| PATCH | `/api/v1/user/api-keys/:id` | Rotate or update name/restrictions. |
| DELETE | `/api/v1/user/api-keys/:id` | Revoke key. |
| POST | `/api/v1/auth/anti-phishing` | Set/update anti-phishing code. |

### 5.2 Admin (Security)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/security/activity` | Activity log (user + admin), filters. |
| GET | `/api/v1/admin/security/ip-rules` | List IP rules (admin WL, global BL, country). |
| POST | `/api/v1/admin/security/ip-rules` | Add IP rule. |
| PATCH | `/api/v1/admin/security/ip-rules/:id` | Toggle active / edit. |
| DELETE | `/api/v1/admin/security/ip-rules/:id` | Remove rule. |
| GET | `/api/v1/admin/security/users/:userId/devices` | User devices. |
| POST | `/api/v1/admin/security/users/:userId/devices/:id/revoke` | Revoke user device. |
| GET | `/api/v1/admin/security/withdrawal-rules` | List withdrawal security rules. |
| POST | `/api/v1/admin/security/withdrawal-rules` | Create rule. |
| PATCH | `/api/v1/admin/security/withdrawal-rules/:id` | Update rule. |
| GET | `/api/v1/admin/security/withdrawal-queue` | Pending approval withdrawals. |
| POST | `/api/v1/admin/security/withdrawal-queue/:id/approve` | Approve. |
| POST | `/api/v1/admin/security/withdrawal-queue/:id/reject` | Reject with reason. |
| GET | `/api/v1/admin/security/fraud/signals` | Fraud alerts (filters). |
| PATCH | `/api/v1/admin/security/fraud/signals/:id` | Mark reviewed / link to user. |
| GET | `/api/v1/admin/security/aml/alerts` | AML alerts. |
| PATCH | `/api/v1/admin/security/aml/alerts/:id` | Assign, escalate, close, file STR/CTR. |
| POST | `/api/v1/admin/security/aml/str-ctr` | Record STR/CTR filing (log only). |
| GET | `/api/v1/admin/security/audit-logs` | Immutable audit log (read-only, filters). |
| GET | `/api/v1/admin/security/risk-rules` | List risk engine rules. |
| POST | `/api/v1/admin/security/risk-rules` | Create rule. |
| PATCH | `/api/v1/admin/security/risk-rules/:id` | Update rule. |
| POST | `/api/v1/admin/security/users/:userId/lock` | Lock user (with reason). |
| POST | `/api/v1/admin/security/users/:userId/unlock` | Unlock user. |
| GET | `/api/v1/admin/security/api-keys` | List API keys (e.g. by user). |
| DELETE | `/api/v1/admin/security/api-keys/:id` | Revoke key. |

---

## 6. Risk Scoring Logic & Formulas

- **Score range:** 0–100 (e.g. 0–30 low, 31–60 medium, 61–85 high, 86–100 critical).
- **Composite:** weighted sum of signals; then apply thresholds for CHALLENGE/BLOCK via `security_risk_rules`.

**Signals (examples):**

| Signal | Weight | Example logic |
|--------|--------|----------------|
| Failed logins (same IP, last 1h) | +15 per 2 failures | min(45, 15 * ceil(failures/2)) |
| New device | +20 | first time this fingerprint for user |
| New country | +25 | country changed since last login |
| VPN/TOR | +30 | provider says proxy/VPN/TOR |
| High-risk country | +25 | country in list (e.g. FATF high-risk) |
| Unverified KYC for withdrawal | +40 | withdrawal and KYC not approved |
| Large withdrawal (vs tier) | +10 to +30 | amount above tier limit or threshold |
| Velocity (withdrawals last 24h) | +20 | e.g. >3 withdrawals in 24h |
| Fraud signal present | +50 | open fraud_signals for user |
| AML alert open | +40 | open aml_alerts for user |

**Formula (conceptual):**

```
risk_score = min(100, 
  failed_login_score 
  + device_score 
  + geo_score 
  + vpn_tor_score 
  + kyc_score 
  + amount_score 
  + velocity_score 
  + fraud_aml_score
)
```

- **Decision:** Load rules for `action_context` (e.g. `login`, `withdrawal`). Sort by `priority` desc. First rule whose `condition_expression` matches (e.g. `risk_score_gt: 70`, `country_in: ['XX']`) returns that rule’s `decision` (ALLOW / CHALLENGE / BLOCK). If none match, default ALLOW (or configurable default).
- **CHALLENGE:** For login → require captcha or email OTP. For withdrawal → require 2FA or email confirm. Return HTTP 403 with code e.g. `RISK_CHALLENGE` and `challenge_type`.

---

## 7. Withdrawal Security State Machine

```
                    ┌─────────────────────────────────────────────────────────────────┐
                    │                     WITHDRAWAL REQUEST                            │
                    └─────────────────────────────────────────────────────────────────┘
                                                          │
                    ┌─────────────────────────────────────┼─────────────────────────────────────┐
                    │ Risk engine BLOCK?                   │                                     │
                    │ → BLOCK                              │ Else                                │
                    └─────────────────────────────────────┘                                     │
                                                          │                                     ▼
                    ┌─────────────────────────────────────┴─────────────────────────────────────┐
                    │ Address in whitelist & confirmed?  No → BLOCK (only whitelist allowed)     │
                    │ Timelock expired?                  No → BLOCK (e.g. 24–48h for new addr)   │
                    │ Cooldown after security change?    No → BLOCK (e.g. 24h after 2FA change)  │
                    └─────────────────────────────────────┴─────────────────────────────────────┘
                                                          │ Yes
                                                          ▼
                    ┌──────────────────────────────────────────────────────────────────────────┐
                    │ Apply amount-based rules from security_withdrawal_rules                   │
                    │ → approval_tier: auto | manual_low | manual_high | manual_critical        │
                    └──────────────────────────────────────────────────────────────────────────┘
                                                          │
        ┌─────────────────────────────────────────────────┼─────────────────────────────────────────────────┐
        │ auto                                             │ manual_*                                          │
        ▼                                                  ▼                                                  │
┌───────────────────┐                          ┌───────────────────────────────────────────────────────────┐  │
│ pending_2fa or    │                          │ status = pending_approval                                  │  │
│ pending_email     │                          │ Admin approves → processing → pending_blockchain →        │  │
│ (if required)     │                          │ completed / failed                                         │  │
└─────────┬─────────┘                          └───────────────────────────────────────────────────────────┘  │
          │                                                                                                    │
          ▼                                                                                                    │
┌───────────────────┐                                                                                          │
│ processing →      │                                                                                          │
│ pending_blockchain│                                                                                          │
│ → completed/failed│                                                                                          │
└───────────────────┘                                                                                          │
```

- **States** (align with existing `withdrawal_status`): `pending_approval`, `pending_email_verify`, `pending_2fa`, `processing`, `pending_blockchain`, `completed`, `failed`, `cancelled`, `rejected`.
- **Timelock:** On add/confirm whitelist address, set `timelock_until = NOW() + 24h` (or 48h); withdrawal allowed only when `NOW() > timelock_until`.
- **Cooldown:** After 2FA/device/password change, set cooldown (e.g. Redis `withdrawal_cooldown:{user_id}` 24h); block withdrawal until expiry.

---

## 8. AML & Compliance Process Flow (India)

- **KYC lifecycle:** Not started → Pending (submitted) → Under review → Approved / Rejected. (Expired if docs outdated.)
- **PAN / Aadhaar:** Store only hashed/encrypted and reference to KYC provider; never log raw PAN/Aadhaar in audit. Prefer provider (e.g. HyperVerge) for verification; you store result and document IDs.
- **High-risk country:** Maintain list (e.g. FATF + internal); block or flag signup/withdrawal from those countries; log in activity and AML.
- **Large transaction monitoring:**
  - INR: threshold e.g. ≥ ₹10L (configurable); single or linked txn.
  - Crypto: equivalent in INR (using daily rate) for deposit/withdrawal/P2P.
- **STR (Suspicious Transaction Report) / CTR (Cash Transaction Report):**
  - Alerts from AML engine → `aml_alerts`; admin reviews and can file STR/CTR.
  - `aml_str_ctr_logs` stores only that a filing was made (report_id, type, timestamp, filed_by); full report content in secure storage or regulator portal, not in app DB in clear text.
- **Flow:**
  1. Transaction or event triggers threshold/rule → create `aml_alerts`.
  2. Compliance dashboard shows open alerts; assign to reviewer.
  3. Reviewer investigates (user KYC, activity, linked accounts).
  4. Decision: close (no action), escalate, or file STR/CTR.
  5. If STR/CTR filed → insert `aml_str_ctr_logs`, update alert status.
  6. All actions (assign, close, file) logged in audit log.

---

## 9. Edge Cases & Attack Scenarios

| Scenario | Mitigation |
|----------|------------|
| Credential stuffing | Rate limit login by IP and by email; account lock after N failures; captcha after 2–3 failures. |
| Session hijack | Secure, httpOnly cookie or short-lived JWT; bind session to IP or device fingerprint (optional); force re-login on sensitive action. |
| Withdrawal to compromised whitelist | Timelock on new address; email/2FA to confirm address; notify on new device login. |
| Multi-account (same person) | Device fingerprint + IP clustering; link accounts in fraud DB; flag for manual review; velocity across “family” of accounts. |
| Wash trading | Detect self-matching (same user both sides); detect circular flow; flag for review and fee reversal. |
| P2P fraud (fake payment / chargeback) | Escrow; release only after confirmation; dispute flow; velocity and reputation; block repeat abusers. |
| API key leak | IP restrictions; scope minimal (e.g. no withdraw); rotation; monitor usage (unusual IP/volume) and revoke. |
| Admin compromise | Admin IP whitelist; 2FA for admin; all admin actions in immutable audit log; alert on sensitive actions. |
| Audit log tampering | Append-only table; RLS/trigger to forbid UPDATE/DELETE; optional hash chain or write to external WORM storage. |
| Race (double withdrawal) | Idempotency key; DB unique constraint on (user, request_id); lock balance row during debit. |
| Geo bypass (VPN to India) | VPN/TOR detection; treat as high risk or block for signup/withdrawal; KYC address vs IP country mismatch flag. |

---

## 10. Best Practices & Production Hardening

- **Secrets:** No secrets in code; use env or secret manager; encrypt at rest for API key hashes, withdrawal addresses, KYC refs.
- **TLS:** Enforce TLS 1.2+; HSTS; no mixed content.
- **Headers:** Helmet (or Fastify equivalent); no verbose server headers; CSP where possible.
- **Dependencies:** Regular updates; audit (npm audit); minimal surface.
- **Logging:** No passwords, tokens, or PII in logs; structured logs; separate security/audit channel.
- **DB:** Least privilege; prepared statements only; no dynamic SQL from input; separate read replica for reporting if needed.
- **Redis:** Auth and TLS in production; key prefix (e.g. `exchange:security:`).
- **Rate limits:** Stricter for auth and withdrawal; per-user and per-IP; back off on repeated violations.
- **Config:** Security rules (risk rules, withdrawal rules, limits) in DB with admin UI; feature flags for new checks.
- **Incident response:** Runbooks for lock account, revoke sessions, disable API key, block IP; alerting on risk_decision=BLOCK and on fraud/AML escalation.
- **India:** Align with RBI/SEBI expectations; maintain STR/CTR trail; retain KYC and transaction data for required period; consider legal review for exact thresholds and reporting flow.

---

This document is the single source of truth for the security system. Implement modules incrementally (e.g. Activity Monitor + IP + Risk Engine first, then Withdrawal Security, then Fraud/AML and Audit), and run migrations for new tables in batches.
