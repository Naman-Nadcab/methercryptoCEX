/**
 * Admin RBAC roles aligned with ADMIN_PANEL_ARCHITECTURE.md.
 * Backend should enforce these on /api/v1/admin/* routes.
 */
export type AdminRole =
  | 'super_admin'
  | 'finance_admin'
  | 'compliance_admin'
  | 'security_admin'
  | 'support_admin'
  | 'marketing_admin';

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: 'Super Admin',
  finance_admin: 'Finance Admin',
  compliance_admin: 'Compliance Admin',
  security_admin: 'Security Admin',
  support_admin: 'Support Admin',
  marketing_admin: 'Marketing Admin',
};

/** Routes (or route prefixes) each role can access. Super Admin has full access. */
export const ADMIN_ROLE_SCOPES: Record<Exclude<AdminRole, 'super_admin'>, string[]> = {
  finance_admin: [
    '/admin/wallets', '/admin/deposits', '/admin/withdrawals', '/admin/fees',
    '/admin/reports/financial', '/admin/dashboard', '/admin/treasury',
    '/admin/trading', '/admin/market-making', '/admin/monitoring/mm-risk',
  ],
  compliance_admin: [
    '/admin/kyc', '/admin/compliance', '/admin/security/compliance', '/admin/dashboard',
    '/admin/p2p', '/admin/users',
  ],
  security_admin: [
    '/admin/security', '/admin/admins', '/admin/admins/logs', '/admin/dashboard',
    '/admin/settings', '/admin/integrations', '/admin/system', '/admin/monitoring',
    '/admin/system-health',
  ],
  support_admin: ['/admin/users', '/admin/support', '/admin/dashboard', '/admin/reports'],
  marketing_admin: ['/admin/referrals', '/admin/notifications', '/admin/reports', '/admin/dashboard'],
};

/** Normalize role string (e.g. "Super Admin" -> "super_admin") for RBAC. */
export function normalizeRole(role: string | undefined): AdminRole {
  if (!role) return 'support_admin';
  const r = role.toLowerCase().replace(/\s+/g, '_');
  const valid: AdminRole[] = ['super_admin', 'finance_admin', 'compliance_admin', 'security_admin', 'support_admin', 'marketing_admin'];
  if (valid.includes(r as AdminRole)) return r as AdminRole;
  if (r === 'superadmin') return 'super_admin';
  return 'support_admin';
}

export function canAccessRoute(role: AdminRole | string | undefined, pathname: string): boolean {
  const r = normalizeRole(typeof role === 'string' ? role : undefined);
  if (r === 'super_admin') return true;
  const scopes = ADMIN_ROLE_SCOPES[r];
  if (!scopes) return false;
  return scopes.some((scope) => pathname === scope || pathname.startsWith(scope + '/'));
}
