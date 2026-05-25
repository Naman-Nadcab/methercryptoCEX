'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, RefreshCw, PauseCircle, Shield } from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import { postGlobalControlAction } from '@/lib/api';
import { Button } from '@/components/ui';
import { TIER1_QUERY_KEY } from '@/components/admin-shell/ExchangeHealthTier1Banner';
import { cn } from '@/lib/cn';
import { ActionAuthModal, type ActionAuthPayload } from '@/components/ops/ActionAuthModal';

type ActionKey =
  | 'halt_trading'
  | 'resume_trading'
  | 'cancel_all_orders'
  | 'disable_withdrawals'
  | 'enable_withdrawals'
  | 'pause_p2p'
  | 'resume_p2p'
  | 'pause_market_making'
  | 'resume_market_making';

const ACTIONS: { key: ActionKey; label: string; variant: 'danger' | 'default' | 'warning'; needsReason: boolean }[] = [
  { key: 'halt_trading', label: 'Halt trading', variant: 'danger', needsReason: true },
  { key: 'resume_trading', label: 'Resume trading', variant: 'default', needsReason: false },
  { key: 'cancel_all_orders', label: 'Cancel all orders', variant: 'danger', needsReason: true },
  { key: 'disable_withdrawals', label: 'Disable withdrawals', variant: 'danger', needsReason: true },
  { key: 'enable_withdrawals', label: 'Enable withdrawals', variant: 'default', needsReason: false },
  { key: 'pause_p2p', label: 'Pause P2P', variant: 'warning', needsReason: true },
  { key: 'resume_p2p', label: 'Resume P2P', variant: 'default', needsReason: false },
  { key: 'pause_market_making', label: 'Pause MM', variant: 'warning', needsReason: true },
  { key: 'resume_market_making', label: 'Resume MM', variant: 'default', needsReason: false },
];

export function GlobalActionBar() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<ActionKey | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async ({
      action,
      reason,
      twofa_code,
      submit_for_approval,
    }: {
      action: ActionKey;
      reason: string;
      twofa_code?: string;
      submit_for_approval?: boolean;
    }) => {
      const def = ACTIONS.find((a) => a.key === action)!;
      return postGlobalControlAction(token, {
        action,
        reason: def.needsReason ? reason : reason || 'operator_action',
        twofa_code,
        submit_for_approval,
      });
    },
    onSuccess: async (res, vars) => {
      setOpen(false);
      setPending(null);
      setErr(null);
      const queued = Boolean((res?.data as { queued_for_approval?: boolean } | undefined)?.queued_for_approval);
      if (queued) {
        setNotice(`Action ${vars.action} queued for maker-checker approval.`);
        await queryClient.invalidateQueries({ queryKey: ['admin', 'approval-requests'] });
      } else {
        setNotice(`Action ${vars.action} executed.`);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin', 'trading-halt'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'control'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'system-health'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', TIER1_QUERY_KEY] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'treasury'] }),
      ]);
    },
    onError: (e: Error) => {
      setErr(e.message || 'Request failed');
    },
  });

  const startAction = (key: ActionKey) => {
    setPending(key);
    setErr(null);
    setNotice(null);
    setOpen(true);
  };
  const pendingDef = pending ? ACTIONS.find((a) => a.key === pending) : undefined;

  const confirm = async (payload: ActionAuthPayload) => {
    if (!pending) return;
    setErr(null);
    mut.mutate({
      action: pending,
      reason: payload.reason,
      twofa_code: payload.twofa_code,
      submit_for_approval: pendingDef?.needsReason ?? false,
    });
  };

  if (!token) return null;

  return (
    <>
      <div
        className={cn(
          'border-b border-admin-border bg-admin-surface/80 backdrop-blur-sm',
          'px-4 py-2 flex flex-wrap items-center gap-2'
        )}
      >
        <span className="mr-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-admin-muted">
          <Shield className="h-3.5 w-3.5" />
          Global
        </span>
        {ACTIONS.map((a) => (
          <Button
            key={a.key}
            type="button"
            variant={a.variant === 'danger' ? 'danger' : a.variant === 'warning' ? 'secondary' : 'secondary'}
            size="sm"
            className="h-8 text-xs"
            onClick={() => startAction(a.key)}
          >
            {a.key.includes('cancel') ? (
              <Ban className="mr-1 h-3.5 w-3.5" />
            ) : a.key.startsWith('resume') || a.key === 'enable_withdrawals' ? (
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
            ) : (
              <PauseCircle className="mr-1 h-3.5 w-3.5" />
            )}
            {a.label}
          </Button>
        ))}
      </div>
      {notice ? (
        <div className="border-b border-admin-border/60 bg-white/[0.02] px-4 py-1.5 text-xs text-admin-muted">
          {notice}
        </div>
      ) : null}

      <ActionAuthModal
        open={open}
        onClose={() => !mut.isPending && setOpen(false)}
        onConfirm={confirm}
        title="Confirm global control action"
        actionLabel={pendingDef?.label ?? ''}
        description="This action is audited with your admin ID and timestamp."
        externalError={err}
        isPending={mut.isPending}
        requireReason={pendingDef?.needsReason ?? false}
        twofaRequired
        confirmationPhrase={pendingDef?.needsReason && pending ? `CONFIRM ${pending}` : undefined}
        confirmLabel={mut.isPending ? 'Working…' : 'Confirm'}
        confirmVariant={pendingDef?.variant === 'danger' ? 'danger' : 'primary'}
      />
    </>
  );
}
