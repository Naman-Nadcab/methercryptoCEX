# Activity Monitoring and Session Management

This document describes the production-grade activity monitoring and session management used by the exchange backend, including indexes and performance considerations.

## Overview

- **Sessions:** Stored in `user_sessions` with optional Redis cache; JWT carries `sessionId` for validation.
- **User activity:** Security-relevant actions (login, logout, password/2FA changes, etc.) are written to `user_activity_logs`.
- **Admin activity:** Admin actions (e.g. withdrawal approve/reject) are written to `admin_activity_logs`.
- Security-sensitive actions are also written to the **immutable audit log** (`audit_logs_immutable`); see `AUDIT_LOG_IMMUTABILITY.md`. Activity logs are for analytics and support; the audit log is the source of truth for compliance.

## Session Management

### Table: `user_sessions`

| Column         | Type      | Description                    |
|----------------|-----------|--------------------------------|
| id             | UUID      | Primary key; used in JWT       |
| user_id        | UUID      | References `users(id)`         |
| session_token  | VARCHAR   | Opaque token (optional Redis)  |
| device_type    | VARCHAR   | e.g. `web`, `mobile`           |
| device_id      | VARCHAR   | Optional device fingerprint    |
| ip_address     | INET      | Client IP at creation          |
| user_agent     | TEXT      | Client user agent              |
| is_active      | BOOLEAN   | False when revoked             |
| created_at     | TIMESTAMPTZ | Session creation time        |
| expires_at     | TIMESTAMPTZ | Session expiry                |
| revoked_at    | TIMESTAMPTZ | Set when session is revoked  |

### Indexes (sessions)

- `idx_user_sessions_user_id` — list sessions by user.
- `idx_user_sessions_token` — lookup by session_token if needed.
- `idx_user_sessions_active` — partial index on `(is_active, expires_at) WHERE is_active = TRUE` for active-session queries.
- `idx_user_sessions_device_id` — partial index on `device_id` when present (device-based queries).

Listing active sessions is done by `user_id` and `is_active = TRUE` and `expires_at > NOW()`. The partial index on active sessions keeps these queries efficient.

### Operations

- **Create session:** On login (e.g. after OTP verify), `session.service.createSession()` inserts a row and optionally sets Redis `session:{sessionId}` with TTL.
- **Revoke session:** Logout calls `revokeSession(sessionId)` (sets `is_active = FALSE`, `revoked_at = NOW()`, and clears Redis).
- **Revoke all except current:** `revokeAllExceptCurrent(userId, currentSessionId)` revokes all other active sessions for the user.

## Activity Logs

### Table: `user_activity_logs`

| Column        | Type    | Description                          |
|---------------|---------|--------------------------------------|
| id            | BIGSERIAL | Primary key                        |
| user_id       | UUID    | Actor                               |
| session_id    | UUID    | Optional; references user_sessions  |
| activity_type | VARCHAR | e.g. login_success, login_failed, logout |
| activity_details / details | JSONB | Optional metadata        |
| ip_address    | INET    | Client IP                            |
| user_agent    | TEXT    | Client user agent                    |
| device_id     | VARCHAR | Optional device fingerprint         |
| created_at    | TIMESTAMPTZ | Event time                        |

### Indexes (user_activity_logs)

- `idx_user_activity_logs_user_id` — filter by user.
- `idx_user_activity_logs_activity_type` — filter by action type.
- `idx_user_activity_logs_created` — time-range queries (DESC for “recent first”).
- `idx_user_activity_logs_user_created` — composite `(user_id, created_at DESC)` for “recent activity for user” (e.g. security dashboard).

### Table: `admin_activity_logs`

| Column     | Type        | Description        |
|------------|-------------|--------------------|
| id         | UUID        | Primary key        |
| admin_id   | UUID        | References admin_users |
| action     | VARCHAR     | e.g. withdrawal_approved, withdrawal_rejected |
| details    | JSONB       | Optional metadata  |
| ip_address | INET        | Client IP          |
| user_agent | TEXT        | Client user agent  |
| device_id  | VARCHAR     | Optional           |
| created_at | TIMESTAMPTZ | Event time         |

### Indexes (admin_activity_logs)

- `idx_admin_activity_logs_admin_id` — filter by admin.
- `idx_admin_activity_logs_created` — time-range queries.
- `idx_admin_activity_logs_admin_created` — composite `(admin_id, created_at DESC)` for “recent activity for admin”.

## Performance Notes

1. **Listing sessions** — Queries use `user_id` and `is_active`; the partial index on active sessions avoids scanning revoked/expired rows when listing “my devices”.
2. **Recent activity** — Use the composite indexes `(user_id, created_at DESC)` and `(admin_id, created_at DESC)` for “last N events per user/admin” to avoid full table scans.
3. **Time-range reporting** — `created_at DESC` indexes support “activity in last 24h/7d” efficiently.
4. **Best-effort logging** — Activity and session services are designed so logging failures do not break the main request (try/catch, log and continue). The immutable audit log remains the authoritative record for security-sensitive actions.

## Retention and Archival

- Activity tables are append-only from the app’s perspective and can grow large. Consider:
  - **Retention policy:** e.g. keep raw rows for 90 days, then archive to cold storage.
  - **Partitioning:** Partition `user_activity_logs` and `admin_activity_logs` by `created_at` (e.g. monthly) to simplify archival and pruning.
  - **Aggregates:** Pre-aggregate counts or rollups for dashboards to avoid scanning full history.

These policies can be implemented in migrations or separate maintenance jobs without changing the application’s insert path.
