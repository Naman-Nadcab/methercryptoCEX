'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getRiskSeveritySettings, patchRiskSeveritySettings, type RiskSeveritySettings } from '@/lib/risk-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FormSkeleton } from '@/components/ui';
import { ArrowLeft } from 'lucide-react';

const SEVERITY_OPTIONS = ['low', 'medium', 'high'] as const;

export default function RiskSeveritySettingsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [whale100k, setWhale100k] = useState<string>('medium');
  const [whale500k, setWhale500k] = useState<string>('high');
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'risk', 'severity', token],
    queryFn: () => getRiskSeveritySettings(token),
    enabled: !!token,
  });

  useEffect(() => {
    if (data?.data) {
      setWhale100k(data.data.whale_trade_100k_severity ?? 'medium');
      setWhale500k(data.data.whale_trade_500k_severity ?? 'high');
    }
  }, [data]);

  const patchMutation = useMutation({
    mutationFn: (body: Partial<RiskSeveritySettings>) => patchRiskSeveritySettings(token, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'risk'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    patchMutation.mutate({
      whale_trade_100k_severity: whale100k,
      whale_trade_500k_severity: whale500k,
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
          <h1 className="text-lg font-semibold text-admin-text">Alert Severity Configuration</h1>
          <p className="text-xs text-admin-muted mt-0.5">
            Map thresholds to severity levels (e.g. whale trade &gt; $100K → Medium, &gt; $500K → High).
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Severity Settings</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <FormSkeleton fields={4} />
          ) : (
            <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
              <div>
                <label htmlFor="whale_100k" className="block text-sm font-medium text-admin-text">
                  Whale trade &gt; $100K → severity
                </label>
                <select
                  id="whale_100k"
                  value={whale100k}
                  onChange={(e) => setWhale100k(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                >
                  {SEVERITY_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="whale_500k" className="block text-sm font-medium text-admin-text">
                  Whale trade &gt; $500K → severity
                </label>
                <select
                  id="whale_500k"
                  value={whale500k}
                  onChange={(e) => setWhale500k(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                >
                  {SEVERITY_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
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
