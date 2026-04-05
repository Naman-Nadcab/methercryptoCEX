'use client';

import { type ReactNode } from 'react';
import { usePermission } from '@/hooks/usePermission';
import { type Permission, getRoleLabel } from '@/lib/rbac';
import { cn } from '@/lib/cn';

interface ProtectedActionProps {
  /** Required permission(s) — if array, ANY match grants access */
  permission: Permission | Permission[];
  /** What to render if the admin has permission */
  children: ReactNode;
  /** Fallback if unauthorized. Defaults to hidden (null). */
  fallback?: 'hidden' | 'disabled' | 'tooltip' | ReactNode;
  /** Tooltip message when disabled/tooltip fallback */
  tooltipMessage?: string;
}

/**
 * Conditionally renders or disables children based on the admin's permissions.
 *
 * Usage:
 * ```tsx
 * <ProtectedAction permission="control:trading" fallback="disabled">
 *   <Button onClick={pauseTrading}>Pause Trading</Button>
 * </ProtectedAction>
 * ```
 */
export function ProtectedAction({
  permission,
  children,
  fallback = 'hidden',
  tooltipMessage,
}: ProtectedActionProps) {
  const { can, canAny, role } = usePermission();

  const hasAccess = Array.isArray(permission) ? canAny(permission) : can(permission);

  if (hasAccess) return <>{children}</>;

  if (fallback === 'hidden') return null;

  const message = tooltipMessage ?? `Requires ${Array.isArray(permission) ? permission.join(' or ') : permission} permission (current role: ${getRoleLabel(role)})`;

  if (fallback === 'disabled') {
    return (
      <div className="relative group inline-block" aria-disabled="true">
        <div className="opacity-40 pointer-events-none select-none">{children}</div>
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-[10px] rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none shadow-lg max-w-[280px]">
          {message}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900" />
        </div>
      </div>
    );
  }

  if (fallback === 'tooltip') {
    return (
      <div className="relative group inline-block cursor-not-allowed">
        <div className="opacity-50 pointer-events-none">{children}</div>
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-[10px] rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none shadow-lg max-w-[280px]">
          {message}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900" />
        </div>
      </div>
    );
  }

  return <>{fallback}</>;
}

/**
 * A role badge component for displaying admin role.
 */
export function RoleBadge({ role, className }: { role: string; className?: string }) {
  const ROLE_COLORS: Record<string, string> = {
    super_admin:   'bg-purple-100 text-purple-700 border-purple-200',
    risk_manager:  'bg-amber-100 text-amber-700 border-amber-200',
    finance_admin: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    support_agent: 'bg-blue-100 text-blue-700 border-blue-200',
    auditor:       'bg-white/5 text-admin-text border-admin-border',
  };

  const normalized = (role ?? '').toLowerCase().replace(/\s+/g, '_');
  const color = ROLE_COLORS[normalized] ?? 'bg-white/5 text-admin-text border-admin-border';

  return (
    <span className={cn(
      'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
      color,
      className
    )}>
      {getRoleLabel(role)}
    </span>
  );
}
