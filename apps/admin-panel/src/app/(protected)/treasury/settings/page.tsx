'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore, hasAdminPermission } from '@/store/auth';
import { getTreasurySettings, patchTreasurySettings, type TreasurySettings } from '@/lib/treasury-api';
import { FormSkeleton } from '@/components/ui';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Zap,
  Timer,
  Fuel,
  ArrowUpDown,
  Save,
  Info,
  Clock,
} from 'lucide-react';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { cn } from '@/lib/cn';

function isValidWei(v: string): boolean {
  const t = v.trim();
  return /^\d+$/.test(t) && t.length > 0 && t.length <= 78;
}

function weiToEth(wei: string): string {
  const n = Number(wei);
  if (!Number.isFinite(n) || n === 0) return '0';
  return (n / 1e18).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function fmtInterval(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

const INTERVAL_PRESETS = [
  { label: '30 min', value: 1800 },
  { label: '1 hr', value: 3600 },
  { label: '6 hr', value: 21600 },
  { label: '12 hr', value: 43200 },
  { label: '24 hr', value: 86400 },
];

function FieldRow({
  icon,
  label,
  hint,
  error,
  warning,
  help,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  error?: string | null;
  warning?: string | null;
  help?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 border-b border-admin-border/40 pb-6 last:border-0 last:pb-0 sm:grid-cols-5">
      {/* Label column */}
      <div className="sm:col-span-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-admin-muted">
            {icon}
          </div>
          <div>
            <p className="text-sm font-medium text-admin-text">{label}</p>
            {hint && <p className="text-xs text-admin-muted">{hint}</p>}
          </div>
        </div>
      </div>
      {/* Input column */}
      <div className="sm:col-span-3 space-y-1.5">
        {children}
        {error && (
          <p className="flex items-center gap-1 text-xs text-red-400">
            <AlertTriangle className="h-3 w-3 shrink-0" />{error}
          </p>
        )}
        {!error && warning && (
          <p className="flex items-center gap-1 text-xs text-amber-400">
            <AlertTriangle className="h-3 w-3 shrink-0" />{warning}
          </p>
        )}
        {!error && !warning && help && (
          <p className="flex items-center gap-1 text-xs text-admin-muted">
            <Info className="h-3 w-3 shrink-0" />{help}
          </p>
        )}
      </div>
    </div>
  );
}

export default function TreasurySettingsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const admin = useAdminAuthStore((s) => s.admin);
  const queryClient = useQueryClient();
  const canEdit = hasAdminPermission(admin, 'treasury:manage') || hasAdminPermission(admin, 'settings:edit');

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
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const intervalValid = Number.isFinite(sweepInterval) && sweepInterval >= 60;
  const minSweepValid = isValidWei(minSweepAmount);
  const gasReserveValid = isValidWei(gasReserve);
  const formValid = intervalValid && minSweepValid && gasReserveValid;

  const gasRiskLevel =
    !gasReserveValid || gasReserve.trim() === '0'
      ? 'none'
      : Number(gasReserve) < 1e16
      ? 'low'
      : Number(gasReserve) < 1e17
      ? 'ok'
      : 'high';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formValid || !canEdit) return;
    patchMutation.mutate({
      auto_sweep_enabled: autoSweep,
      sweep_interval: sweepInterval,
      min_sweep_amount: minSweepAmount.trim(),
      gas_reserve_threshold: gasReserve.trim(),
    });
  };

  const inputBase =
    'w-full rounded-xl border bg-white/[0.03] px-3.5 py-2.5 text-sm text-admin-text placeholder-admin-muted/50 focus:outline-none focus:ring-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed';
  const inputCls = (valid: boolean) =>
    `${inputBase} ${valid ? 'border-admin-border/60 focus:ring-blue-500/25 focus:border-blue-500/40' : 'border-red-500/40 focus:ring-red-500/25'}`;

  return (
    <AdminPageFrame
      title="Treasury Sweep Settings"
      description="Configure on-chain sweep automation and gas reserve thresholds."
      quickActions={
        <Link href="/treasury">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg border border-admin-border/60 px-3 py-1.5 text-xs text-admin-muted hover:text-admin-text hover:bg-white/[0.04] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Treasury
          </button>
        </Link>
      }
    >

      {/* Permission banner */}
      {!canEdit && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-950/15 p-4">
          <ShieldAlert className="h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <p className="text-sm font-semibold text-amber-300">View only</p>
            <p className="text-xs text-admin-muted">
              Requires <code className="rounded bg-white/[0.06] px-1 py-px font-mono text-[10px]">treasury:manage</code> or{' '}
              <code className="rounded bg-white/[0.06] px-1 py-px font-mono text-[10px]">settings:edit</code> permission.
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="rounded-2xl border border-admin-border/60 bg-admin-card p-6">
          <FormSkeleton fields={4} />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">

          {/* ── Left: Form ──────────────────────────────────── */}
          <form onSubmit={handleSubmit} className="space-y-0 rounded-2xl border border-admin-border/60 bg-admin-card lg:col-span-2">

            {/* Card header */}
            <div className="flex items-center justify-between border-b border-admin-border/50 px-6 py-4">
              <div>
                <h2 className="text-sm font-semibold text-admin-text">Sweep Configuration</h2>
                <p className="mt-0.5 text-xs text-admin-muted">Changes are applied at the next sweep cycle without restart.</p>
              </div>
              {canEdit && (
                <button
                  type="submit"
                  disabled={patchMutation.isPending || !formValid}
                  className={cn(
                    'flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-all',
                    formValid && !patchMutation.isPending
                      ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-900/30'
                      : 'bg-white/[0.05] text-admin-muted cursor-not-allowed'
                  )}
                >
                  {patchMutation.isPending ? (
                    <><Clock className="h-4 w-4 animate-spin" /> Saving…</>
                  ) : saved ? (
                    <><CheckCircle2 className="h-4 w-4 text-emerald-300" /> Saved</>
                  ) : (
                    <><Save className="h-4 w-4" /> Save changes</>
                  )}
                </button>
              )}
            </div>

            <div className="space-y-6 px-6 py-6">

              {/* Auto Sweep toggle */}
              <FieldRow
                icon={<Zap className="h-4 w-4" />}
                label="Auto Sweep"
                hint="Automated fund collection"
              >
                <div
                  onClick={() => canEdit && setAutoSweep((v) => !v)}
                  className={cn(
                    'flex items-center justify-between rounded-xl border px-4 py-3 transition-all select-none',
                    autoSweep
                      ? 'border-emerald-500/30 bg-emerald-950/15 cursor-pointer'
                      : 'border-admin-border/60 bg-white/[0.02] cursor-pointer',
                    !canEdit && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  <div>
                    <p className={cn('text-sm font-semibold', autoSweep ? 'text-emerald-300' : 'text-admin-muted')}>
                      {autoSweep ? 'Enabled' : 'Disabled'}
                    </p>
                    <p className="mt-0.5 text-xs text-admin-muted">
                      {autoSweep
                        ? 'Deposits will be swept to hot wallet automatically.'
                        : 'Manual sweep only. Deposits stay in deposit addresses.'}
                    </p>
                  </div>
                  {/* Toggle pill */}
                  <div className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', autoSweep ? 'bg-emerald-500' : 'bg-white/20')}>
                    <div className={cn('absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform', autoSweep ? 'translate-x-5' : 'translate-x-1')} />
                  </div>
                </div>
              </FieldRow>

              {/* Sweep Interval */}
              <FieldRow
                icon={<Timer className="h-4 w-4" />}
                label="Sweep Interval"
                hint="How often the sweep runs"
                error={!intervalValid ? 'Minimum is 60 seconds.' : null}
                warning={intervalValid && sweepInterval < 300 ? 'Very short interval (<5 min) increases gas costs significantly.' : null}
                help={intervalValid ? `Runs every ${fmtInterval(sweepInterval)}` : null}
              >
                <input
                  id="sweep_interval"
                  type="number"
                  min={60}
                  step={60}
                  value={sweepInterval}
                  disabled={!canEdit}
                  onChange={(e) => setSweepInterval(parseInt(e.target.value, 10) || 3600)}
                  className={inputCls(intervalValid)}
                  placeholder="3600"
                />
                {/* Quick-select presets */}
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {INTERVAL_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setSweepInterval(p.value)}
                      className={cn(
                        'rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-all',
                        sweepInterval === p.value
                          ? 'border-blue-500/40 bg-blue-950/30 text-blue-300'
                          : 'border-admin-border/50 text-admin-muted hover:border-blue-500/25 hover:text-admin-text',
                        !canEdit && 'opacity-40 cursor-not-allowed'
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </FieldRow>

              {/* Min Sweep Amount */}
              <FieldRow
                icon={<ArrowUpDown className="h-4 w-4" />}
                label="Min Sweep Amount"
                hint="Threshold to trigger a sweep"
                error={!minSweepValid ? 'Must be a positive integer (wei, no decimals).' : null}
                help={
                  minSweepValid && minSweepAmount.trim() !== '0'
                    ? `≈ ${weiToEth(minSweepAmount)} ETH — only balances above this will be swept.`
                    : null
                }
              >
                <input
                  id="min_sweep_amount"
                  type="text"
                  value={minSweepAmount}
                  disabled={!canEdit}
                  onChange={(e) => setMinSweepAmount(e.target.value)}
                  className={`${inputCls(minSweepValid)} font-mono text-xs`}
                  placeholder="e.g. 1000000000000000"
                />
              </FieldRow>

              {/* Gas Reserve */}
              <FieldRow
                icon={<Fuel className="h-4 w-4" />}
                label="Gas Reserve Threshold"
                hint="Minimum gas before pausing sweep"
                error={!gasReserveValid ? 'Must be a positive integer (wei, no decimals).' : null}
                warning={gasRiskLevel === 'low' ? 'Reserve is very low — sweep may fail if gas spikes.' : null}
                help={
                  gasReserveValid && gasReserve.trim() !== '0'
                    ? `≈ ${weiToEth(gasReserve)} ETH`
                    : null
                }
              >
                <input
                  id="gas_reserve"
                  type="text"
                  value={gasReserve}
                  disabled={!canEdit}
                  onChange={(e) => setGasReserve(e.target.value)}
                  className={`${inputCls(gasReserveValid)} font-mono text-xs`}
                  placeholder="e.g. 50000000000000000"
                />
                {/* Gas risk indicator */}
                {gasReserveValid && gasReserve.trim() !== '0' && (
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      {(['low', 'ok', 'high'] as const).map((lvl) => (
                        <div
                          key={lvl}
                          className={cn(
                            'h-1.5 w-6 rounded-full transition-colors',
                            gasRiskLevel === 'low'
                              ? lvl === 'low' ? 'bg-red-400' : 'bg-white/[0.08]'
                              : gasRiskLevel === 'ok'
                              ? lvl === 'high' ? 'bg-white/[0.08]' : 'bg-emerald-400'
                              : 'bg-emerald-400'
                          )}
                        />
                      ))}
                    </div>
                    <span className={cn(
                      'text-[10px] font-semibold uppercase tracking-wide',
                      gasRiskLevel === 'low' ? 'text-red-400' : gasRiskLevel === 'ok' ? 'text-emerald-400' : 'text-blue-400'
                    )}>
                      {gasRiskLevel === 'low' ? 'Low reserve' : gasRiskLevel === 'ok' ? 'Adequate' : 'High reserve'}
                    </span>
                  </div>
                )}
              </FieldRow>

            </div>

            {/* Footer error */}
            {patchMutation.isError && (
              <div className="mx-6 mb-5 flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-950/15 px-4 py-3">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                <p className="text-xs text-red-300">
                  {(patchMutation.error as Error)?.message ?? 'Failed to save. Check your permissions and try again.'}
                </p>
              </div>
            )}
          </form>

          {/* ── Right: Live summary ──────────────────────────── */}
          <div className="flex flex-col gap-4">

            {/* Current config summary */}
            <div className="rounded-2xl border border-admin-border/60 bg-admin-card p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-admin-muted">Live Summary</p>
              <div className="mt-4 space-y-3">
                {[
                  {
                    icon: <Zap className="h-4 w-4" />,
                    label: 'Auto Sweep',
                    value: autoSweep ? 'Enabled' : 'Disabled',
                    color: autoSweep ? 'text-emerald-400' : 'text-admin-muted',
                    dot: autoSweep ? 'bg-emerald-400' : 'bg-white/20',
                  },
                  {
                    icon: <Timer className="h-4 w-4" />,
                    label: 'Interval',
                    value: intervalValid ? fmtInterval(sweepInterval) : '—',
                    color: 'text-admin-text',
                  },
                  {
                    icon: <ArrowUpDown className="h-4 w-4" />,
                    label: 'Min Amount',
                    value: minSweepValid && minSweepAmount !== '0' ? `${weiToEth(minSweepAmount)} ETH` : '—',
                    color: 'text-admin-text',
                  },
                  {
                    icon: <Fuel className="h-4 w-4" />,
                    label: 'Gas Reserve',
                    value: gasReserveValid && gasReserve !== '0' ? `${weiToEth(gasReserve)} ETH` : '0 (no reserve)',
                    color: gasRiskLevel === 'low' ? 'text-red-400' : 'text-admin-text',
                  },
                ].map(({ icon, label, value, color, dot }) => (
                  <div key={label} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-admin-muted">
                      {icon}
                      <span className="text-xs">{label}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />}
                      <span className={cn('text-xs font-semibold tabular-nums', color)}>{value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* What is sweep? info box */}
            <div className="rounded-2xl border border-blue-500/15 bg-blue-950/10 p-5">
              <p className="text-xs font-semibold text-blue-300">How Sweep Works</p>
              <ul className="mt-3 space-y-2 text-xs text-admin-muted">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                  Every <strong className="text-admin-text">{fmtInterval(sweepInterval)}</strong>, the engine scans all deposit addresses.
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                  Balances above <strong className="text-admin-text">{minSweepValid ? weiToEth(minSweepAmount) : '?'} ETH</strong> are moved to the hot wallet.
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                  Sweep pauses if hot wallet gas drops below the reserve threshold.
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                  Changes apply at the next cycle — <strong className="text-admin-text">no restart needed.</strong>
                </li>
              </ul>
            </div>

            {/* Danger note */}
            <div className="rounded-2xl border border-amber-500/20 bg-amber-950/10 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" /> Caution
              </p>
              <p className="mt-1.5 text-xs text-admin-muted">
                Disabling auto-sweep means user deposits accumulate in deposit addresses unswept. Only disable for maintenance or incident response.
              </p>
            </div>
          </div>

        </div>
      )}
    </AdminPageFrame>
  );
}
