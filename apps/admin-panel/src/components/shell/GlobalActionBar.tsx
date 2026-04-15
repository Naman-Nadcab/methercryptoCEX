'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, RefreshCw, PauseCircle, Shield, Loader2 } from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import { postGlobalControlAction } from '@/lib/api';
import { Button, Input, Modal, ModalFooter } from '@/components/ui';
import { TIER1_QUERY_KEY } from '@/components/admin-shell/ExchangeHealthTier1Banner';
import { cn } from '@/lib/cn';

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
  const [reason, setReason] = useState('');
  const [twofa, setTwofa] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async (action: ActionKey) => {
      const def = ACTIONS.find((a) => a.key === action)!;
      return postGlobalControlAction(token, {
        action,
        reason: def.needsReason ? reason : reason || 'operator_action',
        twofa_code: twofa.trim() || undefined,
      });
    },
    onSuccess: async () => {
      setOpen(false);
      setReason('');
      setTwofa('');
      setPending(null);
      setErr(null);
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
    setReason('');
    setTwofa('');
    setErr(null);
    setOpen(true);
  };

  const confirm = () => {
    if (!pending) return;
    const def = ACTIONS.find((a) => a.key === pending);
    if (def?.needsReason && reason.trim().length < 8) {
      setErr('Reason must be at least 8 characters.');
      return;
    }
    mut.mutate(pending);
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

      <Modal
        open={open}
        onClose={() => !mut.isPending && setOpen(false)}
        title="Confirm global control action"
        description={
          pending
            ? `Action: ${ACTIONS.find((x) => x.key === pending)?.label}. This is audited with your admin ID and timestamp.`
            : ''
        }
      >
        <div className="space-y-3">
          {ACTIONS.find((x) => x.key === pending)?.needsReason ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-admin-text">Reason (min 8 chars)</label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Incident / change ticket reference" />
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-xs font-medium text-admin-text">2FA code (required if 2FA enabled on your account)</label>
            <Input value={twofa} onChange={(e) => setTwofa(e.target.value)} placeholder="TOTP" autoComplete="one-time-code" />
          </div>
          {err ? <p className="text-sm text-admin-danger">{err}</p> : null}
        </div>
        <ModalFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button type="button" variant="danger" size="sm" onClick={confirm} disabled={mut.isPending}>
            {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm'}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
