'use client';

import { cn } from '@/lib/cn';
import { Check, Square } from 'lucide-react';

export interface KycStatusIndicatorProps {
  /** Aadhar verified */
  aadhar?: boolean;
  /** PAN verified */
  pan?: boolean;
  /** Face liveness verified */
  face?: boolean;
  /** When backend only provides kyc_status (e.g. approved) — show all green; pending/under_review = mixed; rejected/not_submitted = grey */
  kycStatus?: string | null;
  kycLevel?: number | null;
  className?: string;
}

export function KycStatusIndicator({
  aadhar,
  pan,
  face,
  kycStatus,
  kycLevel,
  className,
}: KycStatusIndicatorProps) {
  const approved = (kycStatus ?? '').toLowerCase() === 'approved';
  const pending = ['pending', 'under_review'].includes((kycStatus ?? '').toLowerCase());

  const aadharOk = aadhar ?? (approved ? true : pending && (kycLevel ?? 0) >= 1 ? undefined : false);
  const panOk = pan ?? (approved ? true : pending && (kycLevel ?? 0) >= 2 ? undefined : false);
  const faceOk = face ?? (approved ? true : pending && (kycLevel ?? 0) >= 3 ? undefined : false);

  const renderItem = (ok: boolean | undefined, label: string) => {
    if (ok === true) {
      return (
        <span key={label} className="inline-flex items-center gap-1 text-admin-success">
          <Check className="h-4 w-4 shrink-0" aria-hidden />
          <span>{label}</span>
        </span>
      );
    }
    return (
      <span key={label} className="inline-flex items-center gap-1 text-admin-muted">
        <Square className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
        <span>{label}</span>
      </span>
    );
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-sm', className)}>
      {renderItem(aadharOk, 'Aadhar')}
      {renderItem(panOk, 'PAN')}
      {renderItem(faceOk, 'Face')}
    </div>
  );
}
