/**
 * Global admin RBAC route map (default-deny: paths must match a rule).
 */

const SUPER_ROLES = ['super_admin', 'super admin', 'Super Admin'];

export const ADMIN_IMPLICIT_ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: ['all'],
  risk_manager: [
    'monitoring:view',
    'aml:view',
    'aml:escalate',
    'users:view',
    'users:edit',
    'control:trading',
    'markets:manage',
    'risk:export',
    'analytics:view',
    'audit:view',
  ],
  finance_admin: [
    'withdrawals:approve',
    'withdrawals:view',
    'deposits:credit',
    'deposits:view',
    'users:view',
    'monitoring:view',
    'markets:manage',
    'treasury:sweep',
    'analytics:view',
    'audit:view',
  ],
  support_agent: ['users:view', 'users:edit', 'kyc:review', 'deposits:view', 'withdrawals:view', 'p2p:disputes'],
  auditor: [
    'audit:view',
    'monitoring:view',
    'analytics:view',
    'users:view',
    'withdrawals:view',
    'deposits:view',
    'settings:view',
    'risk:export',
  ],
  withdrawal_approver: ['withdrawals:approve'],
  kyc_reviewer: ['kyc:review'],
  aml_reviewer: ['aml:view'],
};

export const ADMIN_LEGACY_ROLE_PERMISSION: Record<string, string> = {
  withdrawal_approver: 'withdrawals:approve',
  kyc_reviewer: 'kyc:review',
  aml_reviewer: 'aml:view',
  risk_manager: 'monitoring:view',
};

export function hasAdminRbacPermission(role: string, permission: string): boolean {
  const normalizedRole = (role || '').toLowerCase().replace(/\s+/g, '_');
  if (SUPER_ROLES.some((r) => r.toLowerCase().replace(/\s+/g, '_') === normalizedRole)) return true;
  const perms = ADMIN_IMPLICIT_ROLE_PERMISSIONS[normalizedRole] || [];
  return perms.includes('all') || perms.includes(permission);
}

export function getImplicitRolePermissions(normalizedRole: string): string[] {
  return ADMIN_IMPLICIT_ROLE_PERMISSIONS[normalizedRole] ?? [];
}

/** URL pathname under /api/v1/admin (leading slash, no query). */
const ADMIN_ROUTE_RULES: Array<{ pattern: RegExp; read: string; write: string }> = [
  { pattern: /^\/compliance\b/, read: 'aml:view', write: 'aml:escalate' },
  { pattern: /^\/(indexer|oracle)\b/, read: 'monitoring:view', write: 'settings:edit' },
  { pattern: /^\/(users|search|kyc)\b/, read: 'users:view', write: 'users:edit' },
  {
    pattern:
      /^\/(withdrawals|deposits|treasury|funds|hot-wallets|deposit-sweeps|wallets|cold-wallets|escrows)\b/,
    read: 'withdrawals:view',
    write: 'withdrawals:approve',
  },
  {
    pattern: /^\/(trading|trading-halt|matches|settlement|spot|engine)\b/,
    read: 'monitoring:view',
    write: 'control:trading',
  },
  { pattern: /^\/(risk|aml)\b/, read: 'aml:view', write: 'aml:escalate' },
  {
    pattern: /^\/(system|settings|control|safe-mode|notification-prefs)\b/,
    read: 'settings:view',
    write: 'settings:edit',
  },
  {
    pattern: /^\/(monitoring|analytics|liquidity-bot|dashboard|dashboard-summary|system-health)\b/,
    read: 'analytics:view',
    write: 'analytics:view',
  },
  { pattern: /^\/(audit|security)\b/, read: 'audit:view', write: 'audit:view' },
  {
    pattern: /^\/(fees|staking|markets|announcements|notifications|support|p2p|referral)\b/,
    read: 'monitoring:view',
    write: 'settings:edit',
  },
  { pattern: /^\/(admin-users|roles)\b/, read: 'settings:view', write: 'settings:edit' },
  {
    pattern: /^\/(operations|operational|mm-control|proof-of-reserves|playbooks)\b/,
    read: 'analytics:view',
    write: 'settings:edit',
  },
  { pattern: /^\/incidents\b/, read: 'monitoring:view', write: 'settings:edit' },
];

export function isSuperAdminRole(role: string): boolean {
  const normalizedRole = (role || '').toLowerCase().replace(/\s+/g, '_');
  return SUPER_ROLES.some((r) => r.toLowerCase().replace(/\s+/g, '_') === normalizedRole);
}

/**
 * Default-deny RBAC: every authenticated admin route must match a rule and satisfy permission.
 */
export function evaluateAdminRouteRbac(
  role: string,
  method: string,
  adminRelativePath: string
): { allowed: boolean; required?: string; mapped?: boolean } {
  const isWrite = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method.toUpperCase());
  for (const rule of ADMIN_ROUTE_RULES) {
    if (rule.pattern.test(adminRelativePath)) {
      const required = isWrite ? rule.write : rule.read;
      if (hasAdminRbacPermission(role, required)) {
        return { allowed: true, required, mapped: true };
      }
      const normalizedRole = (role || '').toLowerCase().replace(/\s+/g, '_');
      const legacy = ADMIN_LEGACY_ROLE_PERMISSION[normalizedRole];
      if (legacy === required) {
        return { allowed: true, required, mapped: true };
      }
      return { allowed: false, required, mapped: true };
    }
  }
  return { allowed: false, mapped: false };
}
