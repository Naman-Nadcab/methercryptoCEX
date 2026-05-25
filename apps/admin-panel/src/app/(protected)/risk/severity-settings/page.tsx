'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getRiskSeveritySettings, patchRiskSeveritySettings, type RiskSeveritySettings } from '@/lib/risk-api';
import { FormSkeleton } from '@/components/ui';
import { ArrowLeft, Fish, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { cn } from '@/lib/cn';

const SEVERITY_OPTIONS = ['low', 'medium', 'high'] as const;
type Severity = typeof SEVERITY_OPTIONS[number];

const SEV_STYLES: Record<Severity, { pill: string; dot: string; label: string }> = {
  low:    { pill: 'border-blue-500/30   bg-blue-950/20   text-blue-300',    dot: 'bg-blue-400',    label: 'Low' },
  medium: { pill: 'border-amber-500/30  bg-amber-950/20  text-amber-300',   dot: 'bg-amber-400',   label: 'Medium' },
  high:   { pill: 'border-red-500/30    bg-red-950/20    text-red-300',     dot: 'bg-red-400',     label: 'High' },
};

function SeverityPicker({
  label, value, onChange, description,
}: { label: string; value: Severity; onChange: (v: Severity) => void; description: string }) {
  return (
    <div className="rounded-2xl border border-admin-border/50 bg-admin-card p-5">
      <div className="flex items-center gap-2 mb-1">
        <Fish className="h-4.5 w-4.5 text-orange-400" />
        <p className="text-sm font-semibold text-admin-text">{label}</p>
      </div>
      <p className="text-xs text-admin-muted mb-4">{description}</p>

      {/* Visual selector */}
      <div className="grid grid-cols-3 gap-2">
        {SEVERITY_OPTIONS.map((s) => {
          const styles = SEV_STYLES[s];
          const selected = value === s;
          return (
            <button
              key={s} type="button" onClick={() => onChange(s)}
              className={cn(
                'flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-xs font-semibold transition-all',
                selected
                  ? cn(styles.pill, 'ring-1 ring-offset-1 ring-offset-admin-card', s === 'high' ? 'ring-red-500/40' : s === 'medium' ? 'ring-amber-500/40' : 'ring-blue-500/40')
                  : 'border-admin-border/40 bg-white/[0.02] text-admin-muted hover:border-admin-border hover:bg-white/[0.04]',
              )}
            >
              <span className={cn('h-3 w-3 rounded-full', selected ? styles.dot : 'bg-admin-muted/30')} />
              <span className="capitalize">{s}</span>
            </button>
          );
        })}
      </div>

      {/* Selected preview */}
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-admin-border/30 bg-white/[0.02] px-3 py-2">
        <span className="text-xs text-admin-muted">→ Will generate a</span>
        <span className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase', SEV_STYLES[value].pill)}>
          <span className={cn('h-1.5 w-1.5 rounded-full', SEV_STYLES[value].dot)} />
          {SEV_STYLES[value].label}
        </span>
        <span className="text-xs text-admin-muted">alert</span>
      </div>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────── */
export default function RiskSeveritySettingsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [whale100k, setWhale100k] = useState<Severity>('medium');
  const [whale500k, setWhale500k] = useState<Severity>('high');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'risk', 'severity', token],
    queryFn: () => getRiskSeveritySettings(token),
    enabled: !!token,
  });

  useEffect(() => {
    if (data?.data) {
      setWhale100k((data.data.whale_trade_100k_severity ?? 'medium') as Severity);
      setWhale500k((data.data.whale_trade_500k_severity ?? 'high') as Severity);
    }
  }, [data]);

  const patchMutation = useMutation({
    mutationFn: (body: Partial<RiskSeveritySettings>) => patchRiskSeveritySettings(token, body),
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
      whale_trade_100k_severity: whale100k,
      whale_trade_500k_severity: whale500k,
    });
  };

  const saveBtn = {
    idle:   { label: 'Save Severity Config', cls: 'bg-blue-600 hover:bg-blue-500 text-white' },
    saving: { label: 'Saving…',              cls: 'bg-blue-600/60 cursor-not-allowed text-white' },
    saved:  { label: 'Saved',               cls: 'bg-emerald-600 text-white cursor-default' },
    error:  { label: 'Save Failed',          cls: 'bg-red-600/80 text-white' },
  }[saveState];

  return (
    <AdminPageFrame
      title="Alert Severity Configuration"
      description="Map trade size thresholds to alert severity levels. Affects how operators triage incoming whale-trade alerts."
      status="active"
      error={isError ? (error instanceof Error ? error.message : 'Failed to load severity configuration.') : null}
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
        <FormSkeleton fields={2} />
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <SeverityPicker
                label="Whale Trade > $100K"
                description="A single trade with notional value above $100,000 will generate an alert at this severity level."
                value={whale100k} onChange={setWhale100k}
              />
              <SeverityPicker
                label="Whale Trade > $500K"
                description="A single trade with notional value above $500,000 will generate an alert at this severity level. Should typically be higher than the $100K tier."
                value={whale500k} onChange={setWhale500k}
              />

              {/* Validation hint */}
              {SEVERITY_OPTIONS.indexOf(whale500k) < SEVERITY_OPTIONS.indexOf(whale100k) && (
                <div className="flex gap-2.5 rounded-xl border border-amber-500/20 bg-amber-950/10 p-4">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                  <p className="text-xs text-amber-300/80">
                    Warning: the $500K tier has a lower severity than the $100K tier. This is unusual — consider setting $500K to a higher or equal severity.
                  </p>
                </div>
              )}
            </div>

            {/* Right: summary */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-admin-border/50 bg-admin-card p-5">
                <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-admin-muted">Severity Map Preview</p>
                <div className="space-y-3">
                  {[
                    { range: '$100K – $499K', sev: whale100k },
                    { range: '≥ $500K',       sev: whale500k },
                  ].map(({ range, sev }) => (
                    <div key={range} className="flex items-center gap-2">
                      <span className="flex-1 text-xs text-admin-muted">{range}</span>
                      <ArrowRight className="h-3 w-3 text-admin-muted/40" />
                      <span className={cn(
                        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase',
                        SEV_STYLES[sev].pill,
                      )}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', SEV_STYLES[sev].dot)} />
                        {SEV_STYLES[sev].label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2.5 rounded-xl border border-blue-500/20 bg-blue-950/10 p-4">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-blue-400 mt-0.5" />
                <p className="text-xs text-blue-300/80 leading-relaxed">
                  These settings affect how new whale-trade alerts are classified. Existing alerts retain their original severity.
                </p>
              </div>

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
