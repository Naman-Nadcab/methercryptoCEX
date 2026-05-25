'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getRiskAutomationRules, patchRiskAutomationRules, type RiskAutomationRules } from '@/lib/risk-api';
import { FormSkeleton } from '@/components/ui';
import {
  ArrowLeft, Lock, ArrowDownCircle, XCircle,
  CheckCircle2, AlertTriangle, Info, Zap,
} from 'lucide-react';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { cn } from '@/lib/cn';

/* ── rule card ─────────────────────────────────────────────────────── */
function RuleCard({
  id, title, subtitle, icon: Icon, accentColor,
  value, unit = '', min = 0, max, step = 1,
  presets, disableLabel, onChange,
}: {
  id: string; title: string; subtitle: string; icon: React.ElementType;
  accentColor: string; value: number; unit?: string; min?: number; max?: number; step?: number;
  presets?: { label: string; value: number }[];
  disableLabel?: string;
  onChange: (v: number) => void;
}) {
  const enabled = value > 0;

  return (
    <div className={cn(
      'rounded-2xl border bg-admin-card p-5 transition-all',
      enabled ? accentColor : 'border-admin-border/40',
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-all',
            enabled
              ? accentColor.replace('border-', 'border-').replace('/20', '/30')
              : 'border-admin-border/40 bg-white/[0.03] text-admin-muted',
          )}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-admin-text">{title}</p>
            <p className="mt-0.5 text-xs text-admin-muted">{subtitle}</p>
          </div>
        </div>
        {/* enabled badge */}
        <span className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
          enabled ? 'bg-emerald-950/30 border border-emerald-500/30 text-emerald-400' : 'bg-white/[0.04] border border-admin-border/40 text-admin-muted',
        )}>
          {enabled ? 'Active' : 'Off'}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          {unit && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-admin-muted">{unit}</span>
          )}
          <input
            id={id} type="number" min={min} max={max} step={step} value={value}
            onChange={(e) => onChange(Number(e.target.value) || 0)}
            className={cn(
              'w-28 rounded-xl border border-admin-border/60 bg-white/[0.04] py-2 text-sm text-admin-text focus:outline-none focus:border-blue-500/40 transition-colors',
              unit ? 'pl-7 pr-3' : 'px-3',
            )}
          />
        </div>
        {presets?.map((p) => (
          <button
            key={p.label} type="button" onClick={() => onChange(p.value)}
            className={cn(
              'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all',
              value === p.value
                ? 'border-blue-500/40 bg-blue-950/20 text-blue-300'
                : 'border-admin-border/50 bg-white/[0.02] text-admin-muted hover:text-admin-text',
            )}
          >
            {p.label}
          </button>
        ))}
        {disableLabel && (
          <button
            type="button" onClick={() => onChange(0)}
            className={cn(
              'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all',
              value === 0
                ? 'border-red-500/30 bg-red-950/15 text-red-400'
                : 'border-admin-border/50 bg-white/[0.02] text-admin-muted hover:text-red-400 hover:border-red-500/30',
            )}
          >
            {disableLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────── */
export default function RiskAutomationPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [autoFreeze,      setAutoFreeze]      = useState(0);
  const [autoWithdrawal,  setAutoWithdrawal]  = useState(0);
  const [autoCancelRate,  setAutoCancelRate]  = useState(0);
  const [saveState,       setSaveState]       = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'risk', 'automation', token],
    queryFn: () => getRiskAutomationRules(token),
    enabled: !!token,
  });

  useEffect(() => {
    if (data?.data) {
      const r = data.data;
      setAutoFreeze(r.auto_freeze_risk_threshold ?? 0);
      setAutoWithdrawal(r.auto_alert_withdrawal_threshold ?? 0);
      setAutoCancelRate(r.auto_alert_cancel_rate_threshold ?? 0);
    }
  }, [data]);

  const patchMutation = useMutation({
    mutationFn: (body: Partial<RiskAutomationRules>) => patchRiskAutomationRules(token, body),
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
      auto_freeze_risk_threshold: autoFreeze,
      auto_alert_withdrawal_threshold: autoWithdrawal,
      auto_alert_cancel_rate_threshold: autoCancelRate,
    });
  };

  const activeRules = [autoFreeze > 0, autoWithdrawal > 0, autoCancelRate > 0].filter(Boolean).length;

  const saveBtn = {
    idle:   { label: 'Save Rules',    cls: 'bg-blue-600 hover:bg-blue-500 text-white' },
    saving: { label: 'Saving…',       cls: 'bg-blue-600/60 cursor-not-allowed text-white' },
    saved:  { label: 'Saved',         cls: 'bg-emerald-600 text-white cursor-default' },
    error:  { label: 'Save Failed',   cls: 'bg-red-600/80 text-white' },
  }[saveState];

  return (
    <AdminPageFrame
      title="Risk Automation Rules"
      description="Define when the engine should automatically act — freeze accounts, fire alerts, or block actions."
      status="active"
      error={isError ? (error instanceof Error ? error.message : 'Failed to load risk automation settings.') : null}
      onRetry={isError ? () => { void refetch(); } : undefined}
      quickActions={
        <>
          {/* Active rules badge */}
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-950/10 px-2.5 py-1.5">
            <Zap className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-xs font-semibold text-emerald-400">{activeRules} / 3 rules active</span>
          </div>
          <Link href="/risk">
            <button type="button" className="flex items-center gap-1.5 rounded-lg border border-admin-border/50 bg-white/[0.02] px-2.5 py-1.5 text-xs font-medium text-admin-muted hover:text-admin-text transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </button>
          </Link>
        </>
      }
    >
      {isLoading ? (
        <FormSkeleton fields={3} />
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Rules */}
            <div className="space-y-4 lg:col-span-2">
              <RuleCard
                id="auto_freeze" title="Auto-Freeze Account"
                subtitle="Automatically freeze a user's account when their risk score exceeds this threshold. Set 0 to disable."
                icon={Lock} accentColor="border-red-500/20"
                value={autoFreeze} onChange={setAutoFreeze}
                presets={[{ label: 'Score 50', value: 50 }, { label: 'Score 75', value: 75 }, { label: 'Score 90', value: 90 }]}
                disableLabel="Disable"
              />
              <RuleCard
                id="auto_alert_withdrawal" title="Auto-Alert on Large Withdrawal"
                subtitle="Trigger an AML alert whenever a withdrawal exceeds this USD amount. Set 0 to disable."
                icon={ArrowDownCircle} accentColor="border-amber-500/20"
                value={autoWithdrawal} onChange={setAutoWithdrawal} unit="$"
                presets={[{ label: '$5K', value: 5000 }, { label: '$10K', value: 10000 }, { label: '$25K', value: 25000 }]}
                disableLabel="Disable"
              />
              <RuleCard
                id="auto_alert_cancel_rate" title="Auto-Alert on Cancel Rate"
                subtitle="Fire an alert when a user's order cancel rate (%) exceeds this value within the detection window. Set 0 to disable."
                icon={XCircle} accentColor="border-orange-500/20"
                value={autoCancelRate} onChange={setAutoCancelRate} unit="%" max={100}
                presets={[{ label: '60%', value: 60 }, { label: '80%', value: 80 }, { label: '95%', value: 95 }]}
                disableLabel="Disable"
              />
            </div>

            {/* Right sidebar */}
            <div className="space-y-4">
              {/* Summary */}
              <div className="rounded-2xl border border-admin-border/50 bg-admin-card p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-admin-muted">Automation Summary</p>
                <div className="space-y-3">
                  {[
                    { label: 'Account freeze at',    value: autoFreeze > 0 ? `Score ${autoFreeze}` : 'Disabled' },
                    { label: 'Alert on withdrawal >',value: autoWithdrawal > 0 ? `$${autoWithdrawal.toLocaleString()}` : 'Disabled' },
                    { label: 'Alert on cancel rate >',value: autoCancelRate > 0 ? `${autoCancelRate}%` : 'Disabled' },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-start justify-between gap-2 text-sm">
                      <span className="text-admin-muted">{label}</span>
                      <span className={cn(
                        'text-right text-xs font-semibold',
                        value === 'Disabled' ? 'text-admin-muted/60' : 'text-admin-text',
                      )}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Info */}
              <div className="flex gap-2.5 rounded-xl border border-blue-500/20 bg-blue-950/10 p-4">
                <Info className="h-4 w-4 shrink-0 text-blue-400 mt-0.5" />
                <p className="text-xs text-blue-300/80 leading-relaxed">
                  Auto-actions are logged in the audit trail. Frozen accounts can be manually unfrozen from the user detail page.
                </p>
              </div>

              {/* Warning */}
              <div className="flex gap-2.5 rounded-xl border border-amber-500/20 bg-amber-950/10 p-4">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                <p className="text-xs text-amber-300/80 leading-relaxed">
                  Setting thresholds too low can cause false positives and impact legitimate users. Test values in staging first.
                </p>
              </div>

              {/* Save */}
              <button
                type="submit"
                disabled={saveState === 'saving' || saveState === 'saved'}
                className={cn('flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all', saveBtn.cls)}
              >
                {saveState === 'saved' && <CheckCircle2 className="h-4 w-4" />}
                {saveState === 'error' && <AlertTriangle className="h-4 w-4" />}
                {saveBtn.label}
              </button>
            </div>
          </div>
        </form>
      )}
    </AdminPageFrame>
  );
}
