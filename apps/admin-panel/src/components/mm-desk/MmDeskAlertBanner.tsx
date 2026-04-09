'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, X, XOctagon } from 'lucide-react';
import type { DeskAlert, DeskAlertFixId } from '@/lib/mm-desk-signals';
import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';

type Props = {
  alerts: DeskAlert[];
  onDismiss?: (id: string) => void;
  dismissed?: Set<string>;
  onAlertFix?: (alertId: string, fixId: DeskAlertFixId) => void;
  fixBusy?: boolean;
};

export function MmDeskAlertBanner({ alerts, onDismiss, dismissed, onAlertFix, fixBusy }: Props) {
  const visible = alerts.filter((a) => !dismissed?.has(a.id));
  if (!visible.length) return null;

  const critical = visible.filter((a) => a.level === 'critical');
  const warnings = visible.filter((a) => a.level === 'warning');

  return (
    <div className="space-y-2" role="region" aria-label="Desk alerts">
      {critical.map((a) => (
        <AlertRow
          key={a.id}
          alert={a}
          variant="critical"
          icon={<XOctagon className="h-4 w-4 shrink-0 text-red-400" />}
          onDismiss={onDismiss}
          onAlertFix={onAlertFix}
          fixBusy={fixBusy}
        />
      ))}
      {warnings.map((a) => (
        <AlertRow
          key={a.id}
          alert={a}
          variant="warning"
          icon={<AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />}
          onDismiss={onDismiss}
          onAlertFix={onAlertFix}
          fixBusy={fixBusy}
        />
      ))}
    </div>
  );
}

function AlertRow({
  alert,
  variant,
  icon,
  onDismiss,
  onAlertFix,
  fixBusy,
}: {
  alert: DeskAlert;
  variant: 'critical' | 'warning';
  icon: ReactNode;
  onDismiss?: (id: string) => void;
  onAlertFix?: (alertId: string, fixId: DeskAlertFixId) => void;
  fixBusy?: boolean;
}) {
  const fixes = alert.fixes?.length ? alert.fixes : [];
  return (
    <div
      className={cn(
        'flex flex-wrap items-start gap-3 rounded-ds-md border px-3 py-2.5 text-sm',
        variant === 'critical'
          ? 'border-red-500/40 bg-red-500/10 text-red-100'
          : 'border-amber-500/35 bg-amber-500/10 text-amber-100'
      )}
    >
      {icon}
      <div className="min-w-0 flex-1 space-y-2">
        <p className="leading-snug">
          {alert.symbol ? (
            <span className="mr-1.5 font-mono text-xs opacity-90">{alert.symbol}</span>
          ) : null}
          {alert.message}
        </p>
        {fixes.length > 0 && onAlertFix ? (
          <div className="flex flex-wrap gap-1.5">
            {fixes.map((f) => (
              <Button
                key={f.id}
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 text-xs"
                disabled={fixBusy}
                onClick={() => onAlertFix(alert.id, f.id)}
              >
                {f.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={() => onDismiss(alert.id)}
          className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
          aria-label="Dismiss alert"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
