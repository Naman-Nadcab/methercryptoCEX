'use client';

import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { KycStatusIndicator } from './KycStatusIndicator';
import { Ban, ShieldOff, KeyRound } from 'lucide-react';

export interface UserHeaderCardProps {
  user: {
    id?: string;
    email?: string | null;
    username?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    country_code?: string | null;
    status?: string;
    created_at?: string;
    kyc_status?: string | null;
    kyc_level?: number | null;
    [key: string]: unknown;
  };
  onSuspend?: () => void;
  onBan?: () => void;
  onReset2FA?: () => void;
}

function displayStatus(s: string | undefined): string {
  if (!s) return '—';
  const lower = s.toLowerCase();
  if (lower === 'locked') return 'Banned';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function UserHeaderCard({ user, onSuspend, onBan, onReset2FA }: UserHeaderCardProps) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || user.email || user.id?.slice(0, 8) || '—';
  const email = (user.email as string) || '—';
  const country = (user.country_code as string) || '—';
  const created = user.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' })
    : '—';
  const status = (user.status as string) ?? '';

  return (
    <div className="rounded-[12px] bg-white p-6 shadow-[0_1px_3px_0_rgba(0,0,0,0.08)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-gray-900">{name}</h1>
          <p className="text-sm text-admin-muted">{email}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-admin-muted">ID: {user.id ?? '—'}</span>
            <span className="text-admin-muted">Country: {country}</span>
            <span>
              <StatusBadge status={displayStatus(status)} />
            </span>
            <span className="text-admin-muted">Created: {created}</span>
          </div>
          <div className="mt-2">
            <KycStatusIndicator
              kycStatus={(user.kyc_status as string) ?? null}
              kycLevel={(user.kyc_level as number) ?? null}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status !== 'suspended' && (
            <Button variant="secondary" size="sm" onClick={onSuspend} className="gap-1">
              <ShieldOff className="h-4 w-4" />
              Suspend User
            </Button>
          )}
          {status !== 'locked' && (
            <Button variant="danger" size="sm" onClick={onBan} className="gap-1">
              <Ban className="h-4 w-4" />
              Ban User
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onReset2FA} className="gap-1">
            <KeyRound className="h-4 w-4" />
            Reset 2FA
          </Button>
        </div>
      </div>
    </div>
  );
}
