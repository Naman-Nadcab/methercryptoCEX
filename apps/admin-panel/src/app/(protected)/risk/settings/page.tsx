'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getRiskSettings, patchRiskSettings, type RiskSettings } from '@/lib/risk-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FormSkeleton } from '@/components/ui';
import { ArrowLeft } from 'lucide-react';

export default function RiskSettingsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [largeWithdrawal, setLargeWithdrawal] = useState(10000);
  const [whaleTrade, setWhaleTrade] = useState(100000);
  const [cancelRate, setCancelRate] = useState(80);
  const [manipulationWindow, setManipulationWindow] = useState(300);
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'risk', 'settings', token],
    queryFn: () => getRiskSettings(token),
    enabled: !!token,
  });

  useEffect(() => {
    if (data?.data) {
      const s = data.data;
      setLargeWithdrawal(s.large_withdrawal_threshold);
      setWhaleTrade(s.whale_trade_threshold);
      setCancelRate(s.cancel_rate_threshold);
      setManipulationWindow(s.market_manipulation_window);
    }
  }, [data]);

  const patchMutation = useMutation({
    mutationFn: (body: Partial<RiskSettings>) => patchRiskSettings(token, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'risk'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    patchMutation.mutate({
      large_withdrawal_threshold: largeWithdrawal,
      whale_trade_threshold: whaleTrade,
      cancel_rate_threshold: cancelRate,
      market_manipulation_window: manipulationWindow,
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <Link href="/risk">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-lg font-semibold text-admin-text">Dynamic Risk Rules</h1>
          <p className="text-xs text-admin-muted mt-0.5">
            Configure thresholds for large withdrawals, whale trades, cancel rate, and market manipulation window.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Risk Rule Settings</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <FormSkeleton fields={5} />
          ) : (
            <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
              <div>
                <label htmlFor="large_withdrawal" className="block text-sm font-medium text-admin-text">
                  Large Withdrawal Threshold (USD)
                </label>
                <input
                  id="large_withdrawal"
                  type="number"
                  min={0}
                  value={largeWithdrawal}
                  onChange={(e) => setLargeWithdrawal(parseInt(e.target.value, 10) || 0)}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="whale_trade" className="block text-sm font-medium text-admin-text">
                  Whale Trade Threshold (USD)
                </label>
                <input
                  id="whale_trade"
                  type="number"
                  min={0}
                  value={whaleTrade}
                  onChange={(e) => setWhaleTrade(parseInt(e.target.value, 10) || 0)}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="cancel_rate" className="block text-sm font-medium text-admin-text">
                  Cancel Rate Threshold (%)
                </label>
                <input
                  id="cancel_rate"
                  type="number"
                  min={0}
                  max={100}
                  value={cancelRate}
                  onChange={(e) => setCancelRate(parseInt(e.target.value, 10) || 0)}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="manipulation_window" className="block text-sm font-medium text-admin-text">
                  Market Manipulation Window (seconds)
                </label>
                <input
                  id="manipulation_window"
                  type="number"
                  min={0}
                  value={manipulationWindow}
                  onChange={(e) => setManipulationWindow(parseInt(e.target.value, 10) || 0)}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
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
