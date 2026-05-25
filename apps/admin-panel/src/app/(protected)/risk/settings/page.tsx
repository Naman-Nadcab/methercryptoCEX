'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getRiskSettings, patchRiskSettings, type RiskSettings } from '@/lib/risk-api';
import { FormSkeleton } from '@/components/ui';
import { ArrowLeft, DollarSign, Fish, XCircle, Clock, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { cn } from '@/lib/cn';

/* ── shared primitives ─────────────────────────────────────────────── */
function FieldRow({
  id, label, hint, icon: Icon, accentColor, value, unit = '', presets, onChange,
  min = 0, max, step = 1, type = 'number',
}: {
  id: string; label: string; hint: string; icon: React.ElementType;
  accentColor: string; value: number; unit?: string;
  presets?: { label: string; value: number }[];
  onChange: (v: number) => void; min?: number; max?: number; step?: number; type?: string;
}) {
  return (
    <div className="rounded-2xl border border-admin-border/50 bg-admin-card p-5">
      <div className="flex items-start gap-3">
        <div className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border', accentColor)}>
          <Icon className="h-4.5 w-4.5" />
        </div>
        <div className="flex-1 min-w-0">
          <label htmlFor={id} className="block text-sm font-semibold text-admin-text">{label}</label>
          <p className="mt-0.5 text-xs text-admin-muted">{hint}</p>
          <div className="mt-3 flex items-center gap-2">
            <div className="relative flex-1 max-w-[200px]">
              {unit && (
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-admin-muted">{unit}</span>
              )}
              <input
                id={id} type={type} min={min} max={max} step={step} value={value}
                onChange={(e) => onChange(Number(e.target.value) || 0)}
                className={cn(
                  'w-full rounded-xl border border-admin-border/60 bg-white/[0.04] py-2.5 text-sm text-admin-text focus:outline-none focus:border-blue-500/40 focus:bg-white/[0.06] transition-colors',
                  unit ? 'pl-7 pr-3' : 'px-3',
                )}
              />
            </div>
            {presets && presets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <button
                    key={p.label} type="button" onClick={() => onChange(p.value)}
                    className={cn(
                      'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all',
                      value === p.value
                        ? 'border-blue-500/40 bg-blue-950/20 text-blue-300'
                        : 'border-admin-border/50 bg-white/[0.02] text-admin-muted hover:text-admin-text hover:border-admin-border',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-xl border border-blue-500/20 bg-blue-950/10 p-4">
      <Info className="h-4 w-4 shrink-0 text-blue-400 mt-0.5" />
      <div className="text-xs text-blue-300/80 leading-relaxed">{children}</div>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────── */
export default function RiskSettingsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [largeWithdrawal, setLargeWithdrawal] = useState(10000);
  const [whaleTrade,      setWhaleTrade]      = useState(100000);
  const [cancelRate,      setCancelRate]      = useState(80);
  const [manipWindow,     setManipWindow]     = useState(300);
  const [saveState,       setSaveState]       = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const { data, isLoading, isError, error, refetch } = useQuery({
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
      setManipWindow(s.market_manipulation_window);
    }
  }, [data]);

  const patchMutation = useMutation({
    mutationFn: (body: Partial<RiskSettings>) => patchRiskSettings(token, body),
    onMutate:  () => setSaveState('saving'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'risk'] });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2500);
    },
    onError: () => { setSaveState('error'); setTimeout(() => setSaveState('idle'), 3000); },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    patchMutation.mutate({
      large_withdrawal_threshold: largeWithdrawal,
      whale_trade_threshold: whaleTrade,
      cancel_rate_threshold: cancelRate,
      market_manipulation_window: manipWindow,
    });
  };

  const saveBtn = {
    idle:   { label: 'Save Settings',    cls: 'bg-blue-600 hover:bg-blue-500 text-white',         icon: null },
    saving: { label: 'Saving…',          cls: 'bg-blue-600/60 cursor-not-allowed text-white',      icon: null },
    saved:  { label: 'Saved',            cls: 'bg-emerald-600 text-white cursor-default',          icon: CheckCircle2 },
    error:  { label: 'Save Failed',      cls: 'bg-red-600/80 text-white',                          icon: AlertTriangle },
  }[saveState];

  return (
    <AdminPageFrame
      title="Dynamic Risk Rules"
      description="Configure thresholds that trigger AML alerts and suspicious-activity detection."
      status="active"
      error={isError ? (error instanceof Error ? error.message : 'Failed to load risk settings.') : null}
      onRetry={isError ? () => { void refetch(); } : undefined}
      quickActions={
        <Link href="/risk">
          <button type="button" className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
        </Link>
      }
    >
      {isLoading ? (
        <FormSkeleton fields={4} />
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Left: form */}
            <div className="space-y-4 lg:col-span-2">
              <FieldRow
                id="large_withdrawal" label="Large Withdrawal Threshold" unit="$"
                hint="Withdrawals above this amount (USD) will trigger a risk alert and may require manual review."
                icon={DollarSign} accentColor="border-amber-500/25 bg-amber-950/15 text-amber-400"
                value={largeWithdrawal} onChange={setLargeWithdrawal}
                presets={[{ label: '$5K', value: 5000 }, { label: '$10K', value: 10000 }, { label: '$25K', value: 25000 }, { label: '$50K', value: 50000 }]}
              />
              <FieldRow
                id="whale_trade" label="Whale Trade Threshold" unit="$"
                hint="Single trades above this notional USD value are classified as whale activity and logged for review."
                icon={Fish} accentColor="border-orange-500/25 bg-orange-950/15 text-orange-400"
                value={whaleTrade} onChange={setWhaleTrade}
                presets={[{ label: '$50K', value: 50000 }, { label: '$100K', value: 100000 }, { label: '$250K', value: 250000 }, { label: '$500K', value: 500000 }]}
              />
              <FieldRow
                id="cancel_rate" label="Cancel Rate Threshold" unit="%" type="number" min={0} max={100}
                hint="If a user's order cancel rate (%) exceeds this value within the detection window, an alert is fired."
                icon={XCircle} accentColor="border-red-500/25 bg-red-950/15 text-red-400"
                value={cancelRate} onChange={setCancelRate}
                presets={[{ label: '50%', value: 50 }, { label: '70%', value: 70 }, { label: '80%', value: 80 }, { label: '95%', value: 95 }]}
              />
              <FieldRow
                id="manipulation_window" label="Market Manipulation Window" unit="" type="number" min={30}
                hint="Rolling time window (seconds) used to calculate cancel rate and detect rapid order patterns."
                icon={Clock} accentColor="border-blue-500/25 bg-blue-950/15 text-blue-400"
                value={manipWindow} onChange={setManipWindow}
                presets={[{ label: '1 min', value: 60 }, { label: '5 min', value: 300 }, { label: '15 min', value: 900 }, { label: '30 min', value: 1800 }]}
              />
            </div>

            {/* Right: summary + help */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-admin-border/50 bg-admin-card p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-admin-muted">Current Config</p>
                <div className="space-y-3">
                  {[
                    { label: 'Large Withdrawal', value: `$${largeWithdrawal.toLocaleString()}` },
                    { label: 'Whale Trade',       value: `$${whaleTrade.toLocaleString()}` },
                    { label: 'Cancel Rate',        value: `${cancelRate}%` },
                    { label: 'Detection Window',   value: `${manipWindow}s` },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between text-sm">
                      <span className="text-admin-muted">{label}</span>
                      <span className="font-mono font-semibold text-admin-text">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <InfoBox>
                Changes take effect immediately for all new events. Existing unresolved alerts are not retroactively updated.
              </InfoBox>

              {/* Save button */}
              <button
                type="submit"
                disabled={saveState === 'saving' || saveState === 'saved'}
                className={cn('flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all', saveBtn.cls)}
              >
                {saveBtn.icon && <saveBtn.icon className="h-4 w-4" />}
                {saveBtn.label}
              </button>
            </div>
          </div>
        </form>
      )}
    </AdminPageFrame>
  );
}
