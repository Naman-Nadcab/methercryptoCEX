'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, ShieldAlert, Loader2, X, Info } from 'lucide-react';
import { usePermission } from '@/hooks/usePermission';
import { type Permission, getRoleLabel } from '@/lib/rbac';
import { cn } from '@/lib/cn';

export type SafeActionSeverity = 'warning' | 'critical' | 'destructive';

export interface SafeActionConfig {
  title: string;
  description: string;
  /** Detailed impact warning shown in a highlighted box */
  impactWarning?: string;
  /** Word the admin must type to confirm. Auto-derived from title if not provided. */
  confirmWord?: string;
  /** Severity controls color and icon */
  severity?: SafeActionSeverity;
  /** Permission required — blocks execution if admin lacks it */
  requiredPermission?: Permission;
  /** Label on the confirm button */
  confirmLabel?: string;
}

interface SafeActionModalProps extends SafeActionConfig {
  open: boolean;
  onClose: () => void;
  /** Called after confirmation. Can be async — modal shows loading state. */
  onConfirm: () => Promise<void> | void;
}

const SEVERITY_CONFIG: Record<SafeActionSeverity, {
  icon: typeof AlertTriangle;
  iconBg: string;
  iconColor: string;
  btnClass: string;
  borderColor: string;
  impactBg: string;
}> = {
  warning: {
    icon: AlertTriangle,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    btnClass: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500',
    borderColor: 'border-amber-200',
    impactBg: 'bg-amber-50 border-amber-200 text-amber-800',
  },
  critical: {
    icon: ShieldAlert,
    iconBg: 'bg-red-50',
    iconColor: 'text-red-600',
    btnClass: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
    borderColor: 'border-red-200',
    impactBg: 'bg-red-50 border-red-200 text-red-800',
  },
  destructive: {
    icon: ShieldAlert,
    iconBg: 'bg-red-100',
    iconColor: 'text-red-700',
    btnClass: 'bg-red-700 hover:bg-red-800 focus:ring-red-600',
    borderColor: 'border-red-300',
    impactBg: 'bg-red-50 border-red-300 text-red-900',
  },
};

export function SafeActionModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  impactWarning,
  confirmWord,
  severity = 'critical',
  requiredPermission,
  confirmLabel = 'Confirm Action',
}: SafeActionModalProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { can, role } = usePermission();

  const actualConfirmWord = confirmWord ?? title.toUpperCase().replace(/\s+/g, '');
  const canConfirm = input.trim().toUpperCase() === actualConfirmWord.toUpperCase();
  const hasPermissionForAction = requiredPermission ? can(requiredPermission) : true;

  const cfg = SEVERITY_CONFIG[severity];
  const Icon = cfg.icon;

  useEffect(() => {
    if (open) {
      setInput('');
      setLoading(false);
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleConfirm = useCallback(async () => {
    if (!canConfirm || loading || !hasPermissionForAction) return;
    setLoading(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setLoading(false);
    }
  }, [canConfirm, loading, hasPermissionForAction, onConfirm, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[80] animate-fade-in" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-[81] flex items-center justify-center p-4">
        <div className={cn('w-full max-w-md bg-admin-card rounded-ds-lg border shadow-modal animate-scale-in', cfg.borderColor)}>
          {/* Header */}
          <div className="flex items-start gap-3 p-5 pb-0">
            <div className={cn('flex h-10 w-10 items-center justify-center rounded-ds-md shrink-0', cfg.iconBg)}>
              <Icon className={cn('h-5 w-5', cfg.iconColor)} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-admin-text">{title}</h3>
              <p className="text-xs text-admin-muted mt-1 leading-relaxed">{description}</p>
            </div>
            <button onClick={onClose} className="rounded-md p-1 text-admin-muted hover:bg-admin-card/5 transition-colors shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Impact warning */}
          {impactWarning && (
            <div className={cn('mx-5 mt-3 rounded-ds-sm border p-3 text-xs leading-relaxed', cfg.impactBg)}>
              <div className="flex items-start gap-2">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{impactWarning}</span>
              </div>
            </div>
          )}

          {/* Permission check */}
          {!hasPermissionForAction && (
            <div className="mx-5 mt-3 rounded-ds-sm border border-admin-border bg-white/[0.02] p-3 text-xs text-admin-muted">
              <p className="font-medium text-admin-text">Insufficient Permissions</p>
              <p className="mt-0.5">This action requires the <code className="font-mono text-admin-primary">{requiredPermission}</code> permission. Your current role (<strong>{getRoleLabel(role)}</strong>) does not have access.</p>
            </div>
          )}

          {/* Confirm input */}
          {hasPermissionForAction && (
            <div className="px-5 mt-4">
              <label className="block text-[11px] font-medium text-admin-muted mb-1.5 uppercase tracking-wider">
                Type <span className="text-admin-text font-bold font-mono">{actualConfirmWord}</span> to confirm
              </label>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
                placeholder={actualConfirmWord}
                className="w-full rounded-ds-md border border-admin-border px-3 py-2 text-sm text-admin-text font-mono placeholder:text-admin-muted/40 focus:outline-none focus:ring-2 focus:ring-admin-primary/30 focus:border-admin-primary transition-colors"
                disabled={loading}
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mx-5 mt-3 rounded-ds-sm bg-red-50 border border-red-200 p-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 p-5 pt-4">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-xs font-medium text-admin-muted border border-admin-border rounded-ds-md hover:bg-admin-card/5 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm || loading || !hasPermissionForAction}
              className={cn(
                'px-4 py-2 text-xs font-semibold text-white rounded-ds-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed',
                cfg.btnClass
              )}
            >
              {loading ? (
                <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Executing…</span>
              ) : (
                confirmLabel
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
