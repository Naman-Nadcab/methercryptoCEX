'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getTreasurySettings, patchTreasurySettings, type TreasurySettings } from '@/lib/treasury-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FormSkeleton } from '@/components/ui';
import { ArrowLeft } from 'lucide-react';

export default function TreasurySettingsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [autoSweep, setAutoSweep] = useState(true);
  const [sweepInterval, setSweepInterval] = useState(3600);
  const [minSweepAmount, setMinSweepAmount] = useState('1000000000000000');
  const [gasReserve, setGasReserve] = useState('0');
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'treasury', 'settings', token],
    queryFn: () => getTreasurySettings(token),
    enabled: !!token,
  });

  useEffect(() => {
    if (data?.data) {
      const s = data.data;
      setAutoSweep(s.auto_sweep_enabled);
      setSweepInterval(s.sweep_interval);
      setMinSweepAmount(s.min_sweep_amount);
      setGasReserve(s.gas_reserve_threshold);
    }
  }, [data]);

  const patchMutation = useMutation({
    mutationFn: (body: Partial<TreasurySettings>) => patchTreasurySettings(token, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'treasury'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    patchMutation.mutate({
      auto_sweep_enabled: autoSweep,
      sweep_interval: sweepInterval,
      min_sweep_amount: minSweepAmount,
      gas_reserve_threshold: gasReserve,
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <Link href="/treasury">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-admin-text">Treasury Sweep Settings</h1>
          <p className="text-xs text-admin-muted mt-0.5">Configure auto-sweep and gas reserve. Changes take effect without redeploy.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dynamic Sweep Settings</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <FormSkeleton fields={5} />
          ) : (
            <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="auto_sweep"
                  checked={autoSweep}
                  onChange={(e) => setAutoSweep(e.target.checked)}
                  className="h-4 w-4 rounded border-admin-border text-admin-primary focus:ring-admin-primary"
                />
                <label htmlFor="auto_sweep" className="text-sm font-medium text-admin-text">
                  Auto Sweep Enabled
                </label>
              </div>
              <div>
                <label htmlFor="sweep_interval" className="block text-sm font-medium text-admin-text">
                  Sweep Interval (seconds)
                </label>
                <input
                  id="sweep_interval"
                  type="number"
                  min={60}
                  step={60}
                  value={sweepInterval}
                  onChange={(e) => setSweepInterval(parseInt(e.target.value, 10) || 3600)}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="min_sweep_amount" className="block text-sm font-medium text-admin-text">
                  Minimum Sweep Amount (wei)
                </label>
                <input
                  id="min_sweep_amount"
                  type="text"
                  value={minSweepAmount}
                  onChange={(e) => setMinSweepAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 font-mono text-sm"
                />
              </div>
              <div>
                <label htmlFor="gas_reserve" className="block text-sm font-medium text-admin-text">
                  Gas Reserve Threshold (wei)
                </label>
                <input
                  id="gas_reserve"
                  type="text"
                  value={gasReserve}
                  onChange={(e) => setGasReserve(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 font-mono text-sm"
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={patchMutation.isPending}>
                  {patchMutation.isPending ? 'Saving…' : saved ? 'Saved' : 'Save settings'}
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
