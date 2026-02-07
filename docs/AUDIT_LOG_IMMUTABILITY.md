# Immutable Audit Log — Enforcement Notes

## Database

- **Table:** `audit_logs_immutable`
- **Triggers:** `BEFORE UPDATE` and `BEFORE DELETE` raise an exception. No row can be updated or deleted.
- **Application code:** Do not run `UPDATE` or `DELETE` on this table. Use only `INSERT`.
- **Migrations:** The migration that creates the table also creates the triggers. To truly enforce at DB level, you can additionally:
  - Use **RLS** with a policy that forbids UPDATE/DELETE for all roles (including superuser, if desired), or
  - Restrict table permissions so application roles have only `INSERT` and `SELECT` (no `UPDATE`/`DELETE`).

## Application

- **Service:** `audit-log.service.ts` exposes only `logAudit()` and `logAuditFromRequest()`, which perform inserts. There is no API to update or delete audit records.
- **Best-effort:** Logging is non-blocking; insert failures are caught and logged and do not affect the main request.
- **Idempotency:** The same event may be logged more than once (e.g. retries). Rely on `request_id` + `created_at` + `action` + `resource_*` for correlation; do not assume uniqueness.

## Compliance

- Append-only storage supports tamper-evident audit trails.
- For stronger guarantees, consider writing a hash chain (e.g. previous row hash in each new row) or shipping logs to a WORM store.
- Retain data according to your regulatory requirements (e.g. 5–7 years for financial records).
