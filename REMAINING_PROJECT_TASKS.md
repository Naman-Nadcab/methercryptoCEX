# Exchange Project — Remaining Tasks

**Based on:** Deep system audit, UI_REMAINING.md, REMAINING-TASKS.md  
**Last updated:** February 2025

---

## P0 — Critical (Fix Before Go-Live)

### Auth & Security
| # | Task | Location | Notes |
|---|------|----------|-------|
| 1 | Add rate limit on verify-otp | `auth.fastify.ts` | 5/min per IP |
| 2 | Add rate limit on login | `auth.fastify.ts` | 5/min per IP |
| 3 | Add rate limit on passkey routes | `auth.fastify.ts` | 10/min per IP |
| 4 | Add Idempotency-Key for P2P order create | `p2p.fastify.ts` | Prevent double orders on retry |
| 5 | Fix TOTP encryption fallback | `totp-verify.ts` | Remove `default-encryption-key`; require `TOTP_ENCRYPTION_KEY` |
| 6 | Make SESSION_CORE_URL configurable | `authDecision.plugin.ts` | Add to env/config |
| 7 | Make LOCK_SERVICE_URL configurable | `authLock.plugin.ts` | Add to env/config |

### KYC
| # | Task | Location | Notes |
|---|------|----------|-------|
| 8 | Implement real KYC document upload | `kyc.ts` | Replace stub; persist to storage |
| 9 | Remove/Replace DigiLocker auto-approve | KYC flow | Production-unsafe; integrate real provider or remove |

### Audit Trail
| # | Task | Location | Notes |
|---|------|----------|-------|
| 10 | Audit trail for manual credit | `admin.fastify.ts` | Write to `audit_logs_immutable` |
| 11 | Audit trail for user suspend/activate | Admin user routes | Store reason in immutable audit |
| 12 | Audit trail for KYC approve/reject | KYC admin routes | Consistent immutable logging |
| 13 | Audit trail for escrow freeze/unfreeze | P2P escrow admin | Add to immutable audit |

---

## P1 — High Priority

### Backend
| # | Task | Location | Notes |
|---|------|----------|-------|
| 14 | Fix indexer schema mismatch | `ChainIndexer.ts` | Align `user_wallets`/`blockchains` with `wallets`/`chains` |
| 15 | Fix P2P GET /ads limit/offset validation | `p2p.fastify.ts` | Coerce/validate; avoid NaN in SQL |
| 16 | Fix P2P payment method validation | `p2p.service.ts` | Use `user_p2p_payment_methods` |
| 17 | Session IP from request | `auth.service.ts` | Pass real client IP, not 127.0.0.1 |
| 18 | Empty response handling in api.ts | `lib/api.ts` | Avoid throwing on empty bodies |
| 19 | KYC schema consistency | Migrations | Unify `kyc_applications` vs `kyc_records` |

### Frontend
| # | Task | Location | Notes |
|---|------|----------|-------|
| 20 | Invalidate balance cache after mutations | Wallet/transfer/convert flows | Invalidate `['balances']` after withdraw, transfer, convert |
| 21 | Wire Spot page to live data | `SpotTradingDesign` or `SpotTradingGrid` | Replace design placeholders with real orderbook, ticker, orders |
| 22 | Dashboard markets — live API | `dashboard/page.tsx` | Replace mock data with `/api/v1/spot/markets` or ticker |
| 23 | Standardize API base URL | All frontend API calls | Use `getApiBaseUrl()` everywhere; remove direct `NEXT_PUBLIC_API_URL` |

---

## P2 — UI Tasks Remaining

### User Dashboard
| # | Task | Page | Notes |
|---|------|------|-------|
| 24 | Spot trading — wire live chart | `/dashboard/spot` | Use `useChartAdapter` + candles API; ensure OHLCV populated |
| 25 | Spot trading — wire orderbook | `/dashboard/spot` | Connect `SpotOrderbookPanel` to real orderbook API/WS |
| 26 | Spot trading — wire order entry | `/dashboard/spot` | Connect to place order API, balance, fees |
| 27 | Spot trading — wire bottom panel | `/dashboard/spot` | Open orders, order history, trade history, assets from API |
| 28 | Assets PnL chart | `/dashboard/assets/pnl` | Replace `generateMockChartData()` with real API or keep mock |
| 29 | Assets Overview chart | `/dashboard/assets/overview` | Wire to API or document as placeholder |
| 30 | Convert page price chart | `/dashboard/assets/convert` | "Price chart coming soon" — implement |
| 31 | 2FA setup UI | `/dashboard/security` | Remove "Coming Soon"; implement enable/disable 2FA |
| 32 | Password reset / forgot password | Auth flow | Verify frontend flow wired to backend |
| 33 | Dashboard home — live tickers | `/dashboard` | Use spot ticker API for market data |
| 34 | Dashboard identity link | `/dashboard` | Verify `/dashboard/identity` exists and works |

### Admin Panel
| # | Task | Page | Notes |
|---|------|------|-------|
| 35 | Admin sidebar — fix 404 links | Admin layout | Validate all sidebar links; fix dead routes |
| 36 | Admin reports (financial/users/trading) | Reports pages | Verify backend endpoints; implement or remove |
| 37 | Admin support / tickets | Support pages | Implement or remove placeholder |
| 38 | Admin KYC settings | KYC settings page | Ensure backend GET/PATCH for KYC config |
| 39 | Feature flags mapping | Admin features page | Ensure toggles map to backend flags |

### P2P
| # | Task | Page | Notes |
|---|------|------|-------|
| 40 | P2P chat UI | P2P order detail | `p2p_chat_messages` table exists; implement chat API + UI |

### General UI
| # | Task | Notes |
|---|------|-------|
| 41 | Dead links — Earn, Copy Trading, Demo Trading | Implement pages or remove from nav |
| 42 | Responsive / mobile | Audit mobile behavior for key flows |
| 43 | Error states & loading | Ensure consistent loading/error UI |
| 44 | 404 / not-found | Consistent handling across app |
| 45 | Transfer double-submit guard | Verify `if (submitting) return` and aria-busy |

---

## P3 — Medium Priority

### Backend
| # | Task | Notes |
|---|------|-------|
| 46 | Add optional orderbook depth param | `GET /spot/orderbook/:symbol` |
| 47 | Document trading halt admin controls | Add to admin docs |
| 48 | VPN/TOR integration | Replace stub with real provider for production |
| 49 | API versioning & deprecation policy | Document strategy |
| 50 | WebSocket reconnection docs | Document client retry/backoff |

### Infrastructure
| # | Task | Notes |
|---|------|-------|
| 51 | Docker-compose — add Postgres | Or document deployment |
| 52 | Docker-compose — add Indexer | Or document run |
| 53 | Settlement worker deployment | Move from docs/ to deployable service |
| 54 | Non-EVM indexers | Solana, Tron, Bitcoin if needed |

### Compliance
| # | Task | Notes |
|---|------|-------|
| 55 | FIU-IND registration flow | If required for India |
| 56 | RBI-specific controls | Document and implement |
| 57 | PMLA procedural docs | In-code documentation |

### UI
| # | Task | Notes |
|---|------|-------|
| 58 | Dashboard announcements | Add loading and error UI |
| 59 | Admin header search | Wire or remove placeholder |
| 60 | OTP rate limit — add IP keying | In addition to identifier |

---

## P4 — Lower Priority

| # | Task | Notes |
|---|------|-------|
| 61 | Rate limits review | Auth, trading, P2P per-route audit |
| 62 | Monitoring & alerting | Settlement, deposit, withdrawal signing |
| 63 | OTP delivery monitoring | SMTP/SMS timeout handling |
| 64 | Enable minimal CSP | Test and enable |
| 65 | P2P ads query invalidation | Invalidate on order create |
| 66 | P2P "All Payment Methods" filter | Backend support if needed |

---

## Summary Counts

| Priority | Backend | Frontend/UI | Infrastructure | Total |
|----------|---------|-------------|----------------|--------|
| P0 | 9 | 0 | 0 | 9 |
| P1 | 6 | 4 | 0 | 10 |
| P2 | 0 | 22 | 0 | 22 |
| P3 | 5 | 3 | 4 | 12 |
| P4 | 0 | 0 | 6 | 6 |
| **Total** | **20** | **29** | **10** | **59** |

---

## Quick Reference

- **Auth rate limits**: Tasks 1–3  
- **P2P idempotency**: Task 4  
- **KYC fixes**: Tasks 8–9  
- **Spot page live data**: Tasks 21, 24–27  
- **Balance cache**: Task 20  
- **2FA UI**: Task 31  
- **Admin 404s**: Task 35  
