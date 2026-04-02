'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  getTradingHalt,
  setTradingHalt,
  getMonitoringCounters,
  getMonitoringMmRisk,
  getTradingOverview,
} from '@/lib/admin/trading';
import { SectionHeader, ActionButton } from '@/components/admin/control-plane';
import { AdminMetricCard, AdminPanel, AdminStatusBadge } from '@/components/admin/ui';
import { Loader2, Play, Pause, Activity, BarChart3, AlertTriangle } from 'lucide-react';

export default function TradingEngineMonitorPage() {
  const { accessToken } = useAdminAuthStore();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: haltData, isLoading: loadingHalt } = useQuery({
    queryKey: ['admin', 'trading-halt'],
    queryFn: () => getTradingHalt(accessToken),
    enabled: !!accessToken,
  });

  const { data: countersData } = useQuery({
    queryKey: ['admin', 'monitoring-counters'],
    queryFn: () => getMonitoringCounters(accessToken),
    enabled: !!accessToken,
  });

  const { data: mmRiskData } = useQuery({
    queryKey: ['admin', 'monitoring-mm-risk'],
    queryFn: () => getMonitoringMmRisk(accessToken),
    enabled: !!accessToken,
  });

  const { data: overviewData } = useQuery({
    queryKey: ['admin', 'trading-overview'],
    queryFn: () => getTradingOverview(accessToken),
    enabled: !!accessToken,
  });

  const haltMutation = useMutation({
    mutationFn: (halted: boolean) => setTradingHalt(accessToken, halted),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'trading-halt'] });
      setActionError(null);
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : 'Action failed'),
  });

  const halted = !!haltData?.data?.halted;
  const counters = (countersData?.data ?? {}) as Record<string, unknown>;
  const mmRisk = (mmRiskData?.data ?? {}) as Record<string, unknown>;
  const overview = (overviewData?.data ?? {}) as Record<string, unknown>;

  const metricOrDash = (v: unknown): string | number =>
    typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' ? v : '—';

  if (loadingHalt && !haltData) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Trading Engine Monitor"
        subtitle="Status, latency, queues, market health"
        action={
          <div className="flex items-center gap-2">
            {halted ? (
              <ActionButton
                variant="primary"
                icon={<Play className="w-4 h-4" />}
                onClick={() => haltMutation.mutate(false)}
                loading={haltMutation.isPending}
              >
                Resume trading
              </ActionButton>
            ) : (
              <ActionButton
                variant="danger"
                icon={<Pause className="w-4 h-4" />}
                onClick={() => haltMutation.mutate(true)}
                loading={haltMutation.isPending}
              >
                Pause trading
              </ActionButton>
            )}
          </div>
        }
      />

      {actionError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-400">
          {actionError}
        </div>
      )}

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <AdminMetricCard
          label="Trading status"
          value={halted ? 'Halted' : 'Live'}
          sublabel="Engine"
          icon={<Activity className="w-4 h-4" />}
          variant={halted ? 'danger' : 'positive'}
        />
        <AdminMetricCard
          label="Trades per second"
          value={typeof counters.tps === 'number' ? counters.tps : metricOrDash(counters.trades_per_sec)}
          sublabel="TPS"
          icon={<Activity className="w-4 h-4" />}
        />
        <AdminMetricCard
          label="Orders per second"
          value={typeof counters.ops === 'number' ? counters.ops : metricOrDash(counters.orders_per_sec)}
          sublabel="OPS"
          icon={<BarChart3 className="w-4 h-4" />}
        />
        <AdminMetricCard
          label="Market making risk"
          value={metricOrDash(mmRisk.status !== undefined ? mmRisk.status : mmRisk.alert)}
          sublabel="MM risk"
          variant={mmRisk.alert ? 'warning' : 'neutral'}
          icon={<AlertTriangle className="w-4 h-4" />}
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AdminPanel title="Engine status" subtitle="Live / Halted">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Current state</span>
            <AdminStatusBadge variant={halted ? 'HALTED' : 'LIVE'} showDot />
          </div>
          <p className="text-sm text-foreground mt-2">
            {halted ? 'Trading is paused. Use "Resume trading" to re-enable.' : 'Trading engine is live.'}
          </p>
        </AdminPanel>

        <AdminPanel title="Market liquidity health" subtitle="From monitoring">
          <pre className="text-xs text-muted-foreground overflow-auto max-h-32 bg-muted/30 rounded p-3">
            {JSON.stringify({ ...overview, ...mmRisk }, null, 2) || 'No data'}
          </pre>
        </AdminPanel>
      </div>
    </div>
  );
}
