/**
 * Role-Based Access Control (RBAC) — frontend enforcement layer.
 *
 * Roles map to permissions. The backend is the source of truth — this layer
 * is for UI gating (hide/disable actions the admin cannot perform).
 */

export const ADMIN_ROLES = {
  SUPER_ADMIN: 'super_admin',
  RISK_MANAGER: 'risk_manager',
  FINANCE_ADMIN: 'finance_admin',
  SUPPORT_AGENT: 'support_agent',
  AUDITOR: 'auditor',
} as const;

export type AdminRole = (typeof ADMIN_ROLES)[keyof typeof ADMIN_ROLES];

export type Permission =
  | 'all'
  | 'withdrawals:approve' | 'withdrawals:view'
  | 'kyc:review'
  | 'deposits:credit' | 'deposits:view'
  | 'users:view' | 'users:edit'
  | 'p2p:disputes'
  | 'aml:view' | 'aml:escalate'
  | 'monitoring:view'
  | 'settings:edit' | 'settings:view'
  | 'control:commands' | 'control:trading'
  | 'markets:manage'
  | 'treasury:sweep'
  | 'risk:export'
  | 'audit:view'
  | 'analytics:view';

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  super_admin:    ['all'],
  risk_manager:   ['monitoring:view', 'aml:view', 'aml:escalate', 'users:view', 'control:trading', 'markets:manage', 'risk:export', 'analytics:view', 'audit:view'],
  finance_admin:  ['withdrawals:approve', 'withdrawals:view', 'deposits:credit', 'deposits:view', 'users:view', 'monitoring:view', 'markets:manage', 'treasury:sweep', 'analytics:view', 'audit:view'],
  support_agent:  ['users:view', 'users:edit', 'kyc:review', 'deposits:view', 'withdrawals:view', 'p2p:disputes'],
  auditor:        ['audit:view', 'monitoring:view', 'analytics:view', 'users:view', 'withdrawals:view', 'deposits:view', 'settings:view', 'risk:export'],
};

const SUPER_ROLES = new Set(['super_admin', 'super admin']);

/**
 * Resolve effective permissions for an admin. Combines role-based and explicit permissions.
 */
export function getEffectivePermissions(role: string | undefined, explicitPermissions: string[] | undefined): Permission[] {
  const normalizedRole = (role ?? '').toLowerCase().replace(/\s+/g, '_');
  if (SUPER_ROLES.has(normalizedRole)) return ['all'];

  const rolePerms = ROLE_PERMISSIONS[normalizedRole] ?? [];
  const explicit = Array.isArray(explicitPermissions) ? explicitPermissions : [];
  const set = new Set<Permission>([...rolePerms, ...(explicit as Permission[])]);
  return Array.from(set);
}

/**
 * Check if an admin has a specific permission.
 */
export function hasPermission(
  role: string | undefined,
  explicitPermissions: string[] | undefined,
  required: Permission
): boolean {
  const perms = getEffectivePermissions(role, explicitPermissions);
  return perms.includes('all') || perms.includes(required);
}

/**
 * Check if an admin has ANY of the listed permissions.
 */
export function hasAnyPermission(
  role: string | undefined,
  explicitPermissions: string[] | undefined,
  required: Permission[]
): boolean {
  return required.some((p) => hasPermission(role, explicitPermissions, p));
}

/**
 * Check if an admin is a super admin.
 */
export function isSuperAdmin(role: string | undefined): boolean {
  const normalizedRole = (role ?? '').toLowerCase().replace(/\s+/g, '_');
  return SUPER_ROLES.has(normalizedRole);
}

/**
 * Get display label for a role.
 */
export function getRoleLabel(role: string | undefined): string {
  const LABELS: Record<string, string> = {
    super_admin: 'Super Admin',
    risk_manager: 'Risk Manager',
    finance_admin: 'Finance Admin',
    support_agent: 'Support Agent',
    auditor: 'Auditor',
    admin: 'Admin',
  };
  const normalized = (role ?? '').toLowerCase().replace(/\s+/g, '_');
  return LABELS[normalized] ?? role ?? 'Unknown';
}
