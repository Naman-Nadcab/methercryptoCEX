'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setTradingHalt } from '@/lib/admin/trading';
import { useAdminToken, useTradingHalt } from '@/hooks/admin/useAdminDashboard';
import { Switch } from '@/components/ui/switch';
import { Loader2, Pause, Play } from 'lucide-react';

export function ExchangeControls() {
  const token = useAdminToken();
  const queryClient = useQueryClient();
  const { data: haltData } = useTradingHalt();
  const halted = haltData?.data?.halted ?? false;

  const haltMutation = useMutation({
    mutationFn: (halt: boolean) => setTradingHalt(token ?? null, halt),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'trading-halt'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'control-overview'] });
    },
  });

  const onToggle = (checked: boolean) => haltMutation.mutate(checked);

  return (
    <div className="rounded-[var(--admin-radius)] border border-[var(--admin-card-border)] bg-[var(--admin-card-bg)] p-4 shadow-[var(--admin-shadow)]">
      <h3 className="text-sm font-semibold text-[var(--admin-text)] mb-3">Exchange Controls</h3>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {haltMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin text-[var(--admin-primary)]" />
            ) : halted ? (
              <Pause className="w-4 h-4 text-[var(--admin-danger)]" />
            ) : (
              <Play className="w-4 h-4 text-[var(--admin-success)]" />
            )}
            <span className="text-sm font-medium text-[var(--admin-text)]">Trading halt</span>
          </div>
          <Switch
            checked={halted}
            onCheckedChange={onToggle}
            disabled={haltMutation.isPending}
          />
        </div>
        <p className="text-xs text-[var(--admin-text-muted)]">
          Pause all spot order placement and matching. Use in emergency or maintenance.
        </p>
      </div>
    </div>
  );
}
