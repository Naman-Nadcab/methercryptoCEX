'use client';

import { useMemo, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/auth';
import { hasPermission, hasAnyPermission, isSuperAdmin, getEffectivePermissions, type Permission } from '@/lib/rbac';

/**
 * Hook for permission checks throughout the admin panel.
 * Uses the admin's role and explicit permissions from the auth store.
 */
export function usePermission() {
  const admin = useAdminAuthStore((s) => s.admin);
  const role = admin?.role;
  const explicitPerms = admin?.permissions;

  const effectivePermissions = useMemo(
    () => getEffectivePermissions(role, explicitPerms),
    [role, explicitPerms]
  );

  const can = useCallback(
    (permission: Permission) => hasPermission(role, explicitPerms, permission),
    [role, explicitPerms]
  );

  const canAny = useCallback(
    (permissions: Permission[]) => hasAnyPermission(role, explicitPerms, permissions),
    [role, explicitPerms]
  );

  const isSuper = useMemo(() => isSuperAdmin(role), [role]);

  return {
    can,
    canAny,
    isSuper,
    role: role ?? 'admin',
    effectivePermissions,
  };
}
