'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getRiskAutomationRules, patchRiskAutomationRules, type RiskAutomationRules } from '@/lib/risk-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ArrowLeft } from 'lucide-react';

export default function RiskAutomationPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [autoFreeze, setAutoFreeze] = useState(0);
  const [autoAlertWithdrawal, setAutoAlertWithdrawal] = useState(0);
  const [autoAlertCancelRate, setAutoAlertCancelRate] = useState(0);
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'risk', 'automation', token],
    queryFn: () => getRiskAutomationRules(token),
    enabled: !!token,
  });

  useEffect(() => {
    if (data?.data) {
      const r = data.data;
      setAutoFreeze(r.auto_freeze_risk_threshold ?? 0);
      setAutoAlertWithdrawal(r.auto_alert_withdrawal_threshold ?? 0);
      setAutoAlertCancelRate(r.auto_alert_cancel_rate_threshold ?? 0);
    }
  }, [data]);

  const patchMutation = useMutation({
    mutationFn: (body: Partial<RiskAutomationRules>) => patchRiskAutomationRules(token, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'risk'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    patchMutation.mutate({
      auto_freeze_risk_threshold: autoFreeze,
      auto_alert_withdrawal_threshold: autoAlertWithdrawal,
      auto_alert_cancel_rate_threshold: autoAlertCancelRate,
    });
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Link href="/risk">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Automatic Risk Actions</h1>
          <p className="mt-1 text-sm text-admin-muted">
            Configure automated responses: auto freeze by risk score, auto alert on withdrawal or cancel rate.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Automation Rules</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-admin-muted">Loading…</div>
          ) : (
            <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
              <div>
                <label htmlFor="auto_freeze" className="block text-sm font-medium text-gray-700">
                  Auto freeze if risk score &gt; (0 = disabled)
                </label>
                <input
                  id="auto_freeze"
                  type="number"
                  min={0}
                  value={autoFreeze}
                  onChange={(e) => setAutoFreeze(parseInt(e.target.value, 10) || 0)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="auto_alert_withdrawal" className="block text-sm font-medium text-gray-700">
                  Auto alert if withdrawal &gt; (USD, 0 = disabled)
                </label>
                <input
                  id="auto_alert_withdrawal"
                  type="number"
                  min={0}
                  value={autoAlertWithdrawal}
                  onChange={(e) => setAutoAlertWithdrawal(parseInt(e.target.value, 10) || 0)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="auto_alert_cancel_rate" className="block text-sm font-medium text-gray-700">
                  Auto alert if cancel rate exceeds (%)
                </label>
                <input
                  id="auto_alert_cancel_rate"
                  type="number"
                  min={0}
                  max={100}
                  value={autoAlertCancelRate}
                  onChange={(e) => setAutoAlertCancelRate(parseInt(e.target.value, 10) || 0)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
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
