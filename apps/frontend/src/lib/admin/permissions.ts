/**
 * Admin RBAC permission helpers.
 * Permissions are loaded from GET /api/v1/admin/auth/me and stored in admin-auth store.
 * Example permissions: view_users, view_withdrawals, approve_withdrawals, view_risk, manage_trading, manage_settings
 */

import type { AdminUser } from '@/store/admin-auth';
import { useAdminAuthStore } from '@/store/admin-auth';

function normalizeRole(role: string | undefined): string {
  if (!role) return '';
  return role.toLowerCase().replace(/\s+/g, '_');
}

function isSuperAdmin(admin: AdminUser | null): boolean {
  if (!admin) return false;
  const r = normalizeRole(admin.role);
  return r === 'super_admin' || r === 'superadmin';
}

function getPermissions(admin: AdminUser | null): string[] {
  if (!admin) return [];
  const p = admin.permissions;
  return Array.isArray(p) ? p : [];
}

/**
 * Check if the current admin (from store) has the given permission.
 * Super admin is treated as having all permissions.
 */
export function hasPermission(permission: string): boolean {
  const admin = useAdminAuthStore.getState().admin;
  if (!admin) return false;
  if (isSuperAdmin(admin)) return true;
  return getPermissions(admin).includes(permission);
}

export function canViewUsers(): boolean {
  return hasPermission('view_users');
}

export function canViewWithdrawals(): boolean {
  return hasPermission('view_withdrawals');
}

export function canApproveWithdrawals(): boolean {
  return hasPermission('approve_withdrawals');
}

export function canViewRisk(): boolean {
  return hasPermission('view_risk');
}

export function canManageTrading(): boolean {
  return hasPermission('manage_trading');
}

export function canManageSettings(): boolean {
  return hasPermission('manage_settings');
}

/**
 * For use in Sidebar: filter nav items by permission.
 * Pass the optional permission string for the section; if missing, section is visible to all.
 */
export function canAccessNavPermission(permission: string | undefined): boolean {
  if (!permission) return true;
  return hasPermission(permission);
}
