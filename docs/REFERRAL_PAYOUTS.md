# Referral payouts

Referral commissions are tracked in the database. This doc summarizes the current state and how to run or report payouts.

---

## Current implementation

- **Tables:** `referral_codes`, `referral_relationships`, `referral_commissions` (and optionally `referral_campaigns`).
- **User flow:** Signup with referral code → relationship created; commission rates come from the referral code or campaign.
- **Commission records:** Rows in `referral_commissions` with `status` (e.g. `pending`, `credited`), `commission_amount`, `commission_currency`, `source_type`, `referrer_id`, `referee_id`, etc.
- **Admin:** `GET /admin/referrals/commissions` lists commissions with filters and stats (total_credited, total_pending).

---

## Payout execution

- **Crediting:** The actual “payout” (e.g. crediting the referrer’s balance) is **not** automated in the codebase. Options:
  1. **Cron job:** Periodically select `referral_commissions` with `status = 'pending'`, aggregate by referrer, and credit their funding balance (then set status to `credited`).
  2. **Manual:** Admin uses existing manual-credit or a dedicated “Referral payout” tool to credit referrers and mark commissions as credited.
- **Reporting:** Use `GET /admin/referrals/commissions` and existing stats for reporting; export to CSV if needed (can be added as an admin endpoint).

---

## Recommended next steps

1. Define payout frequency (e.g. weekly/monthly) and minimum threshold.
2. Implement a small **payout job** that: selects pending commissions, groups by referrer, credits balance (with ledger entry), updates commission status to `credited`, and logs the run.
3. Add an **admin report** or export for referral payouts (e.g. date range, referrer, amount, status).
