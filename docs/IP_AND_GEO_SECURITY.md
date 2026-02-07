# IP Management, Geo Restrictions, and VPN/TOR Detection

This document describes the production-grade IP rules, geo restrictions, and VPN/TOR detection layer (Step 3 of the security system).

## Overview

- **IP rules:** Stored in `security_ip_rules`; support whitelist/blacklist and optional country code per scope (`admin` | `user`).
- **Middleware:** Runs on every request (except `/` and `/health`); resolves client IP and country, evaluates rules, returns 403 with a reason code on block.
- **Admin scope:** If any whitelist rule exists for `admin`, only whitelisted IPs (and optionally countries) are allowed; blacklist is also applied.
- **User scope:** Only blacklist is applied; no whitelist requirement.
- **VPN/TOR:** Pluggable provider with Redis cache; fail-open (allow request if provider errors).

## Client IP and Proxies

### Header order

The app resolves the client IP in this order:

1. **CF-Connecting-IP** — When behind Cloudflare, this is the connecting client IP. Prefer this when present.
2. **X-Real-IP** — Often set by a single reverse proxy (e.g. Nginx).
3. **X-Forwarded-For** — Comma-separated list: `client, proxy1, proxy2`. The **leftmost** value is treated as the original client when the server is behind a trusted proxy.
4. **request.ip** — Set by Fastify when `trustProxy: true` (typically from the same as X-Forwarded-For leftmost).

### Trusting proxies

- The Fastify server is started with **trustProxy: true**, so `request.ip` is derived from proxy headers.
- Only run behind a **trusted** reverse proxy (e.g. Nginx, Cloudflare). Do not trust `X-Forwarded-For` from the open internet.
- If using multiple hops (e.g. Cloudflare → Nginx → app), ensure the edge (Cloudflare) sets **CF-Connecting-IP** or that the last proxy before the app sets **X-Real-IP** or the correct **X-Forwarded-For** so the app sees the real client IP.

### Cloudflare

- **CF-Connecting-IP:** Client IP seen by Cloudflare; use this when the app is behind Cloudflare.
- **CF-IPCountry:** Two-letter country code (e.g. `US`, `GB`). The middleware uses this for country-based rules. `XX` or invalid values are ignored.
- Ensure the app is only reachable through Cloudflare (or your proxy) so that headers cannot be spoofed by clients.

### Security notes

- Restrict which proxies can set headers (e.g. Cloudflare IP ranges, or a single Nginx box). Do not accept arbitrary X-Forwarded-For from untrusted clients.
- For high-assurance environments, consider terminating TLS at the app and not trusting forwarded headers from the internet.

## Database: security_ip_rules

| Column       | Type    | Description                                |
|-------------|---------|--------------------------------------------|
| id          | UUID    | Primary key                                |
| scope       | 'admin' \| 'user' | Applies to admin or user routes    |
| rule_type   | 'whitelist' \| 'blacklist' | Allow or deny          |
| ip_cidr     | VARCHAR(45) | CIDR or single IP (e.g. 192.168.1.0/24, 10.0.0.1) |
| country_code| VARCHAR(2)  | Optional; ISO 2-letter (e.g. US, RU)        |
| enabled     | BOOLEAN | Rule is active when true                    |
| created_at  | TIMESTAMPTZ | Creation time                            |

At least one of `ip_cidr` or `country_code` must be set. Matching uses PostgreSQL `inet`: client IP is checked with `client_ip::inet << ip_cidr::inet` for CIDR rules; country is matched when `country_code` is set (and request country comes from e.g. CF-IPCountry).

Indexes: `(scope, enabled)`, `(scope, rule_type)`, `(scope, country_code)` for fast lookup.

## Middleware behavior

1. **Skip:** `/`, `/health` are not checked.
2. **Client IP and country:** Set on request as `request.clientIp` and `request.countryCode`.
3. **VPN/TOR:** Result cached in Redis; set on request as `request.securityFlags.isVpnOrTor`. Fail-open on error.
4. **Scope:** From URL path: `/api/v1/admin` (and paths containing `/admin`) → `admin`; otherwise `user`.
5. **Admin:** If any enabled whitelist rule exists for scope `admin`, allow only if the client matches at least one whitelist rule. Blacklist always denies.
6. **User:** Blacklist denies; no whitelist requirement.
7. **On block:** 403 with `code: IP_NOT_WHITELISTED` or `IP_BLACKLISTED`, and logging to `audit_logs_immutable` (and `user_activity_logs` when `request.user` is set).

## Admin APIs

All under `/api/v1/admin`; require admin JWT.

- **GET /security/ip-rules** — List with query `scope`, `enabled`, `limit`, `offset`. Returns `{ rules, total }`.
- **POST /security/ip-rules** — Body: `scope`, `rule_type`, optional `ip_cidr`, `country_code`, `enabled`. At least one of `ip_cidr` or `country_code` required.
- **GET /security/ip-rules/:id** — Get one rule.
- **PATCH /security/ip-rules/:id** — Partial update (`rule_type`, `ip_cidr`, `country_code`, `enabled`).
- **PATCH /security/ip-rules/:id/enable** — Set `enabled = true`.
- **PATCH /security/ip-rules/:id/disable** — Set `enabled = false`.
- **DELETE /security/ip-rules/:id** — Delete rule.

## VPN/TOR provider

- **Interface:** `VpnTorProvider`: `{ name, check(ip): Promise<boolean> }`.
- **Default:** Stub provider always returns `false`. Replace with a real API (e.g. IPQualityScore, GetIPIntel) by calling `setVpnTorProvider(provider)` at startup.
- **Cache:** Results keyed by IP in Redis with TTL 1 hour.
- **Fail-open:** On provider or cache error, the check is treated as “not VPN/TOR” so the request is not blocked by this layer.

## Example integration

- **Auth (user):** `POST /api/v1/auth/verify-otp` and other auth routes go through the global `onRequest` hook. User-scope IP rules apply (blacklist only). Blocked requests get 403 and an audit log entry.
- **Admin:** `POST /api/v1/admin/auth/login` and all `/api/v1/admin/*` routes use admin scope. If admin whitelist rules exist, only whitelisted IPs (and countries) can reach admin at all; otherwise 403 before login.

No changes are required inside individual auth or admin route handlers; the middleware runs first and blocks when rules so require.
