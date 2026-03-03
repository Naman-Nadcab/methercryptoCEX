# Admin RBAC (Role-Based Access Control)

Admin routes are protected by JWT + session. Sensitive actions additionally require a **role** or **permission**.

---

## Roles

| Role | Effect |
|------|--------|
| `super_admin` | Bypasses all permission checks; can do hot wallet, manual credit, and any admin action. |
| `withdrawal_approver` | Can approve/reject withdrawals (same as permission `withdrawals:approve`). |
| `kyc_reviewer` | Can approve/reject KYC (same as permission `kyc:review`). |
| Other roles | No automatic grant; use `permissions` array on the admin user. |

---

## Permissions matrix

Permissions are stored on `admin_users.permissions` (TEXT[]). If the admin has **super_admin** role, the permissions array is not checked.

| Permission | Description | Routes / actions |
|------------|-------------|------------------|
| `withdrawals:approve` | Approve or reject user withdrawals | POST /admin/withdrawals/:id/approve, reject; admin-security withdrawal approve/reject |
| `kyc:review` | Approve or reject KYC applications | PATCH /admin/kyc/:id/review |
| `deposits:credit` or `manual_credit` | Manual balance credit | POST /admin/deposits/manual-credit (currently also requires super_admin in code) |
| `users:edit` | Edit user details | User update routes (when enforced) |
| `p2p:disputes` | Resolve P2P disputes | P2P dispute resolve (when enforced) |
| `aml:view` | View AML dashboard and alerts | GET /admin/aml/* (when enforced) |
| `settings:edit` | Change system settings | Settings routes (when enforced) |
| `all` | Grant all of the above | Any permission check |

---

## Implementation

- **Helper:** `getAdminWithPermission(app, request, reply, 'withdrawals:approve')` — returns admin or sends 403.
- **Withdrawal approval:** Uses `getAdminForWithdrawalApproval` (same as `getAdminWithPermission(..., 'withdrawals:approve')`).
- **KYC review:** Uses `getAdminWithPermission(..., 'kyc:review')`.
- To add enforcement on more routes, call `getAdminWithPermission` with the appropriate permission key from `ADMIN_PERMISSION_MATRIX` in `admin.fastify.ts`.

---

## Assigning permissions

- **Database:** Update `admin_users.permissions` (e.g. `ARRAY['withdrawals:approve', 'kyc:review']`).
- **Admin UI:** A future admin “Roles & Permissions” page could list admins and allow editing their permissions; backend already supports the array.
