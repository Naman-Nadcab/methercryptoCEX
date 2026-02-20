# Exchange – Remaining Tasks

**Generated:** February 2025  
**Source:** DEEP-AUDIT.md, EXCHANGE-FEATURES-AUDIT.md

---

## Critical (Fix First)

| # | Task | Location | Notes |
|---|------|----------|-------|
| 1 | **Audit trail – manual credit** | `admin.fastify.ts` / manual credit route | Ensure manual credit writes to `audit_logs_immutable` |
| 2 | **Audit trail – user status change** | Admin user suspend/freeze/activate | Store reason in DB/immutable audit |
| 3 | **Audit trail – KYC approve/reject** | KYC review routes | Log to `audit_logs_immutable` consistently |
| 4 | **Audit trail – escrow freeze/unfreeze** | P2P escrow admin actions | Verify and add immutable audit logging |
| 5 | **KYC schema consistency** | Migrations + code | Unify `kyc_applications` vs `kyc_records` usage |

---

## High Priority

| # | Task | Location | Notes |
|---|------|----------|-------|
| 6 | **Session-core URL configurable** | `authDecision.plugin.ts` | Use env `SESSION_CORE_URL` |
| 7 | **Lock service URL configurable** | `authLock.plugin.ts` | Use env `LOCK_SERVICE_URL` |
| 8 | **Session IP from request** | `auth.service.ts:194` | Pass real client IP instead of `127.0.0.1` |
| 9 | **Dashboard markets – live API** | `dashboard/page.tsx` | Replace mock data with spot markets API |
| 10 | **Empty response handling** | `lib/api.ts` | Avoid throwing on empty response bodies |

---

## Medium Priority

| # | Task | Location | Notes |
|---|------|----------|-------|
| 11 | **Admin sidebar vs routes** | Admin layout | Validate links; fix 404s |
| 12 | **Support / reports** | Admin support, custom reports | Complete placeholder implementations |
| 13 | **Feature flags mapping** | Admin features page | Ensure toggles map to backend flags |
| 14 | **Dashboard announcements** | Dashboard page | Add loading and error UI |
| 15 | **Dead links** | Dashboard layout | Earn, Copy Trading, Demo Trading – implement or remove |
| 16 | **Dashboard identity link** | `dashboard/page.tsx` | Verify `/dashboard/identity` exists |

---

## FIU/IND Compliance

| # | Task | Notes |
|---|------|-------|
| 17 | Explicit FIU-IND registration flow | Dedicated reporting integration |
| 18 | RBI-specific controls | Document and implement |
| 19 | PMLA procedural docs | In-code documentation for PMLA flow |

---

## Lower Priority

| # | Task | Notes |
|---|------|-------|
| 20 | Rate limits review | Auth, trading, P2P per-route limits |
| 21 | Monitoring & alerting | Settlement worker, deposit credit, withdrawal signing |
| 22 | OTP delivery | Monitor SMTP/SMS timeouts |
| 23 | 404 pages | Consistent not-found handling |

---

## Already Fixed

- Redis URL configurable (`lib/redis.ts`)
- Dashboard layout KYC status API URL (`getApiBaseUrl()`)
- Indexer build errors (ChainIndexer.ts – WebSocket types, tokenInfo null)
