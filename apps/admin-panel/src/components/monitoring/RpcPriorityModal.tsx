'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import type { RpcProviderRow } from '@/lib/monitoring-api';

export interface RpcPriorityModalProps {
  open: boolean;
  provider: RpcProviderRow | null;
  onClose: () => void;
  onSave: (id: string, failover_priority: number) => void | Promise<void>;
  isLoading?: boolean;
}

export function RpcPriorityModal({ open, provider, onClose, onSave, isLoading }: RpcPriorityModalProps) {
  const [priority, setPriority] = useState(1);

  useEffect(() => {
    if (provider) setPriority(provider.failover_priority ?? 1);
  }, [provider]);

  if (!open || !provider) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(provider.id, priority);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl bg-admin-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-admin-text">Edit Failover Priority</h3>
        <p className="mt-1 text-sm text-admin-muted">
          {provider.provider} — {provider.network}
        </p>
        <form onSubmit={handleSubmit} className="mt-4">
          <label htmlFor="priority" className="block text-sm font-medium text-admin-text">
            Failover Priority (1 = first)
          </label>
          <input
            id="priority"
            type="number"
            min={1}
            max={99}
            value={priority}
            onChange={(e) => setPriority(parseInt(e.target.value, 10) || 1)}
            className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
