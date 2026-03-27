'use client';

import { Button } from '@/components/ui/Button';

export type InfrastructureAction =
  | 'restart_worker'
  | 'flush_queue'
  | 'reset_circuit_breaker'
  | 'restart_liquidity_bot'
  | 'restart_settlement_worker'
  | 'restart_matching_engine'
  | 'restart_websocket_service';

const LABELS: Record<InfrastructureAction, { title: string; message: string; confirm: string }> = {
  restart_worker: {
    title: 'Restart Worker',
    message: 'This will trigger a restart of the background worker process. Confirm only if required by operations.',
    confirm: 'Restart Worker',
  },
  flush_queue: {
    title: 'Flush Queue',
    message: 'This will flush the selected queue. Pending jobs may be lost. Confirm only if necessary.',
    confirm: 'Flush Queue',
  },
  reset_circuit_breaker: {
    title: 'Reset Circuit Breaker',
    message: 'This will reset the circuit breaker state. Confirm to allow operations to resume.',
    confirm: 'Reset Circuit Breaker',
  },
  restart_liquidity_bot: {
    title: 'Restart Liquidity Bot',
    message: 'This will restart the liquidity bot service. Order placement may be briefly interrupted.',
    confirm: 'Restart Liquidity Bot',
  },
  restart_settlement_worker: {
    title: 'Restart Settlement Worker',
    message: 'This will restart the settlement worker process. Pending settlements may be delayed.',
    confirm: 'Restart Settlement Worker',
  },
  restart_matching_engine: {
    title: 'Restart Matching Engine',
    message: 'This will restart the matching engine. Trading will be briefly interrupted.',
    confirm: 'Restart Matching Engine',
  },
  restart_websocket_service: {
    title: 'Restart WebSocket Service',
    message: 'This will restart the WebSocket service. Real-time feeds will reconnect automatically.',
    confirm: 'Restart WebSocket Service',
  },
};

export interface InfrastructureControlModalProps {
  open: boolean;
  action: InfrastructureAction | null;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
}

export function InfrastructureControlModal({
  open,
  action,
  onClose,
  onConfirm,
  isLoading,
}: InfrastructureControlModalProps) {
  if (!open || !action) return null;
  const { title, message, confirm } = LABELS[action];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <p className="mt-2 text-sm text-admin-muted">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isLoading}>
            {isLoading ? 'Processing…' : confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}
