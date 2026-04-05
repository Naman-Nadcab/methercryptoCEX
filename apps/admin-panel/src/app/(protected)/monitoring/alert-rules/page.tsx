'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getMonitoringAlertRules, patchMonitoringAlertRules, type AlertRules } from '@/lib/monitoring-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FormSkeleton } from '@/components/ui';
import { ArrowLeft } from 'lucide-react';

export default function MonitoringAlertRulesPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [apiLatency, setApiLatency] = useState(500);
  const [queueSize, setQueueSize] = useState(100);
  const [rpcFailureRate, setRpcFailureRate] = useState(5);
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'monitoring', 'alert-rules', token],
    queryFn: () => getMonitoringAlertRules(token),
    enabled: !!token,
  });

  useEffect(() => {
    if (data?.data) {
      setApiLatency(data.data.api_latency_threshold_ms);
      setQueueSize(data.data.queue_size_threshold);
      setRpcFailureRate(data.data.rpc_failure_rate_threshold);
    }
  }, [data]);

  const patchMutation = useMutation({
    mutationFn: (body: Partial<AlertRules>) => patchMonitoringAlertRules(token, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'monitoring'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    patchMutation.mutate({
      api_latency_threshold_ms: apiLatency,
      queue_size_threshold: queueSize,
      rpc_failure_rate_threshold: rpcFailureRate,
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <Link href="/monitoring">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-admin-text">Alert Escalation Rules</h1>
          <p className="text-xs text-admin-muted mt-0.5">
            Configure thresholds to trigger alerts: API latency, queue size, RPC failure rate.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Thresholds</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <FormSkeleton fields={6} />
          ) : (
            <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
              <div>
                <label htmlFor="api_latency" className="block text-sm font-medium text-admin-text">
                  Trigger alert if API latency &gt; (ms)
                </label>
                <input
                  id="api_latency"
                  type="number"
                  min={100}
                  max={10000}
                  value={apiLatency}
                  onChange={(e) => setApiLatency(parseInt(e.target.value, 10) || 500)}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="queue_size" className="block text-sm font-medium text-admin-text">
                  Trigger alert if queue size &gt;
                </label>
                <input
                  id="queue_size"
                  type="number"
                  min={1}
                  value={queueSize}
                  onChange={(e) => setQueueSize(parseInt(e.target.value, 10) || 100)}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="rpc_failure" className="block text-sm font-medium text-admin-text">
                  Trigger alert if RPC failure rate &gt; (%)
                </label>
                <input
                  id="rpc_failure"
                  type="number"
                  min={0}
                  max={100}
                  value={rpcFailureRate}
                  onChange={(e) => setRpcFailureRate(parseInt(e.target.value, 10) || 5)}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={patchMutation.isPending}>
                  {patchMutation.isPending ? 'Saving…' : saved ? 'Saved' : 'Save rules'}
                </Button>
                {patchMutation.isError && (
                  <span className="text-sm text-red-600">Failed to save</span>
                )}
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
