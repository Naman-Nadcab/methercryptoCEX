'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Eye, Ban, ShieldOff, KeyRound } from 'lucide-react';
import type { AdminUserRow } from '@/lib/users-api';

export interface UserRowActionsProps {
  user: AdminUserRow;
  onSuspend?: (user: AdminUserRow) => void;
  onBan?: (user: AdminUserRow) => void;
  onReset2FA?: (user: AdminUserRow) => void;
}

export function UserRowActions({ user, onSuspend, onBan, onReset2FA }: UserRowActionsProps) {
  const router = useRouter();
  const status = (user.status ?? '').toLowerCase();

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push(`/users/${user.id}`)}
        className="h-8 px-2"
        title="View"
      >
        <Eye className="h-4 w-4" />
      </Button>
      {status !== 'suspended' && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (onSuspend ? onSuspend(user) : undefined)}
          className="h-8 px-2 text-admin-warning"
          title="Suspend"
        >
          <ShieldOff className="h-4 w-4" />
        </Button>
      )}
      {status !== 'locked' && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (onBan ? onBan(user) : undefined)}
          className="h-8 px-2 text-admin-danger"
          title="Ban"
        >
          <Ban className="h-4 w-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => (onReset2FA ? onReset2FA(user) : undefined)}
        className="h-8 px-2"
        title="Reset 2FA"
      >
        <KeyRound className="h-4 w-4" />
      </Button>
    </div>
  );
}
