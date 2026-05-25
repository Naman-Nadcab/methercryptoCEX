'use client';

import { useState, useCallback, useMemo, useEffect, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/auth';
import { adminFetch } from '@/lib/api';
import { getTradingHalt, setTradingHalt } from '@/lib/trading-api';
import {
  getSystemSettings, patchSystemSettings,
  getOperationalWalletStatus, patchOperationalWalletStatus,
  postEmergencyAction, getSystemFeatures, patchSystemFeature,
  getSystemSafeMode, postSystemSafeMode,
  type FeatureFlagRow,
} from '@/lib/system-api';
import { getRiskSettings, patchRiskSettings } from '@/lib/risk-api';
import { getHotWallets } from '@/lib/treasury-api';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  Zap, Wallet, AlertTriangle, Settings,
  ToggleLeft, ToggleRight, Lock, ArrowRight, Sliders,
  Activity, TrendingUp, ArrowDownToLine, ArrowUpFromLine,
  ArrowLeftRight, Eye, Key, Fingerprint,
  Coins, Power, ShieldAlert, ShieldCheck,
  Layers, Box, Store, BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { ActionAuthModal, type ActionAuthPayload } from '@/components/ops/ActionAuthModal';
import { ExchangeHealthTier1Banner } from '@/components/admin-shell/ExchangeHealthTier1Banner';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';

/* ────────────────────────────────────────────────────── */
/*  Chain icon color map                                  */
/* ────────────────────────────────────────────────────── */
const CHAIN_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  arbitrum: { bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'ARB' },
  bitcoin: { bg: 'bg-orange-500/10', text: 'text-orange-400', label: 'BTC' },
  polkadot: { bg: 'bg-pink-500/10', text: 'text-pink-400', label: 'DOT' },
  solana: { bg: 'bg-purple-500/10', text: 'text-purple-400', label: 'SOL' },
  tron: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'TRX' },
  ethereum: { bg: 'bg-indigo-500/10', text: 'text-indigo-400', label: 'ETH' },
  polygon: { bg: 'bg-violet-500/10', text: 'text-violet-400', label: 'MATIC' },
  bsc: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', label: 'BNB' },
};

function getChainStyle(name: string) {
  const key = name.toLowerCase().replace(/[\s_-]+(one|mainnet|network)?$/i, '');
  return CHAIN_COLORS[key] ?? { bg: 'bg-admin-muted/10', text: 'text-admin-muted', label: name.slice(0, 3).toUpperCase() };
}

/* ────────────────────────────────────────────────────── */
/*  Feature flag descriptions & categories                */
/* ────────────────────────────────────────────────────── */
const FLAG_META: Record<string, { desc: string; cat: string; icon: React.ElementType }> = {
  deposits: { desc: 'Accept user deposits on all chains', cat: 'Finance', icon: ArrowDownToLine },
  withdrawals: { desc: 'Process user withdrawal requests', cat: 'Finance', icon: ArrowUpFromLine },
  spot_trading: { desc: 'Enable spot order matching engine', cat: 'Trading', icon: TrendingUp },
  p2p: { desc: 'Peer-to-peer trading marketplace', cat: 'P2P', icon: ArrowLeftRight },
  p2p_marketplace: { desc: 'P2P marketplace listing & discovery', cat: 'P2P', icon: Store },
  liquidity_bot: { desc: 'Automated liquidity bot for order books', cat: 'Trading', icon: Activity },
};

function getFlagMeta(key: string) {
  return FLAG_META[key] ?? { desc: `Controls the ${key.replace(/_/g, ' ')} feature`, cat: 'System', icon: Settings };
}

const FLAG_CATEGORY_ORDER = ['Finance', 'Trading', 'P2P', 'System'] as const;

/* ────────────────────────────────────────────────────── */
/*  Confirmation Modal                                    */
/* ────────────────────────────────────────────────────── */
function ConfirmModal({ open, title, message, danger, onClose, onConfirm, loading }: {
  open: boolean; title: string; message: string; danger?: boolean;
  onClose: () => void; onConfirm: () => void; loading?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-admin-card border border-admin-border p-6 shadow-modal animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          {danger && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10">
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </div>
          )}
          <div>
            <h3 className={cn('text-base font-bold', danger ? 'text-red-400' : 'text-admin-text')}>{title}</h3>
            <p className="mt-1 text-sm text-admin-muted leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-admin-border">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={loading}>
            {loading ? 'Processing…' : 'Confirm'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────── */
/*  Zone header — clear hierarchy (Tier-1 layout)           */
/* ────────────────────────────────────────────────────── */
function ZoneHeader({ step, title, subtitle }: { step: string; title: string; subtitle?: string }) {
  return (
    <header className="flex gap-4 items-start">
      <div
        className="mt-0.5 w-1 shrink-0 self-stretch min-h-[2.5rem] rounded-full bg-gradient-to-b from-admin-primary to-admin-primary/30"
        aria-hidden
      />
      <div className="min-w-0 pt-0.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-admin-primary">{step}</p>
        <h2 className="text-base font-bold tracking-tight text-admin-text mt-1">{title}</h2>
        {subtitle ? <p className="text-xs text-admin-muted mt-1 max-w-2xl leading-relaxed">{subtitle}</p> : null}
      </div>
    </header>
  );
}

/* ────────────────────────────────────────────────────── */
/*  Section card                                          */
/* ────────────────────────────────────────────────────── */
function Section({ icon: Icon, title, description, iconBg, children, action, className, bodyClassName }: {
  icon: React.ElementType; title: string; description?: string;
  iconBg: string; children: React.ReactNode; action?: React.ReactNode;
  className?: string; bodyClassName?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-admin-border bg-admin-card overflow-hidden flex flex-col h-full', className)}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-admin-border bg-white/[0.02]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', iconBg)}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-admin-text leading-tight">{title}</h3>
            {description && <p className="text-[11px] text-admin-muted mt-0.5 line-clamp-2">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className={cn('p-4 flex-1 flex flex-col', bodyClassName)}>{children}</div>
    </div>
  );
}

/* ────────────────────────────────────────────────────── */
/*  Main Page                                             */
/* ────────────────────────────────────────────────────── */
export default function ControlCenterPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<{ title: string; message: string; danger?: boolean; action: () => void } | null>(null);
  const [haltAuthOpen, setHaltAuthOpen] = useState(false);
  const [safeModeAuthTarget, setSafeModeAuthTarget] = useState<boolean | null>(null);
  const [featureAuthTarget, setFeatureAuthTarget] = useState<FeatureFlagRow | null>(null);
  const [serviceAuthTarget, setServiceAuthTarget] = useState<
    | { kind: 'deposits'; nextPaused: boolean }
    | { kind: 'withdrawals'; nextPaused: boolean }
    | { kind: 'p2p'; nextDisabled: boolean }
    | null
  >(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const showToast = (type: 'success' | 'error', msg: string) => { setToast({ type, msg }); setTimeout(() => setToast(null), 3000); };
  const inv = useCallback((keys: string[][]) => keys.forEach(k => qc.invalidateQueries({ queryKey: k })), [qc]);

  /* ── Queries ── */
  const { data: haltData } = useQuery({ queryKey: ['admin', 'trading-halt', token], queryFn: () => getTradingHalt(token), enabled: !!token });
  const { data: walletData } = useQuery({ queryKey: ['admin', 'operational', 'wallet-status', token], queryFn: () => getOperationalWalletStatus(token), enabled: !!token });
  const { data: settingsData } = useQuery({ queryKey: ['admin', 'system', 'settings', token], queryFn: () => getSystemSettings(token), enabled: !!token });
  const { data: safeModeData } = useQuery({ queryKey: ['admin', 'system', 'safe-mode', token], queryFn: () => getSystemSafeMode(token), enabled: !!token });
  const { data: featuresData } = useQuery({ queryKey: ['admin', 'system', 'features', token], queryFn: () => getSystemFeatures(token), enabled: !!token });
  const { data: riskData } = useQuery({ queryKey: ['admin', 'risk', 'settings', token], queryFn: () => getRiskSettings(token), enabled: !!token });
  const { data: hotWalletsData } = useQuery({ queryKey: ['admin', 'hot-wallets-crud', token], queryFn: () => getHotWallets(token), enabled: !!token });
  const { data: twofaData } = useQuery({ queryKey: ['admin', '2fa-policy', token], queryFn: () => adminFetch<{ require2faLogin: boolean; require2faWithdrawal: boolean; require2faApiTrading: boolean }>('/settings/2fa-enforcement', { token }), enabled: !!token });

  /* ── Derived ── */
  const halted = haltData?.data?.halted ?? false;
  const walletStatus = walletData?.data ?? { depositPaused: false, withdrawalPaused: false };
  const settings = settingsData?.data?.settings ?? {};
  const safeMode = safeModeData?.data?.safe_mode ?? false;
  const features = (featuresData?.data?.features ?? []) as FeatureFlagRow[];
  const risk = riskData?.data;
  const twofa = twofaData?.data;
  const emergencyP2P = settings['emergency_disable_p2p']?.value === '1' || settings['emergency_disable_p2p']?.value === 'true';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hotWallets = ((hotWalletsData as any)?.data ?? []) as Array<{ chainId: string; chainName: string; address: string; balanceCache: string; coldWalletAddress: string | null; maxSingleTx: string | null; maxDailyOutflow: string | null; isActive: boolean }>;
  const geoBlocked = settings['GEO_BLOCKED_COUNTRIES']?.value ?? '';
  const kycRequired = settings['kyc_required_for_withdrawal']?.value ?? 'true';

  /* ── Mutations ── */
  const haltMut = useMutation({
    mutationFn: ({ halted, reason, twofa_code }: { halted: boolean; reason?: string; twofa_code?: string }) =>
      setTradingHalt(token, halted, reason ? { reason, twofa_code } : { twofa_code }),
    onSuccess: (res, vars) => {
      inv([['admin', 'trading-halt', token!]]);
      const queued = Boolean((res?.data as { queued_for_approval?: boolean } | undefined)?.queued_for_approval);
      if (queued) inv([['admin', 'approval-requests', token!]]);
      showToast('success', queued ? 'Trading halt queued for approval' : `Trading ${vars.halted ? 'paused' : 'resumed'}`);
      setHaltAuthOpen(false);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to update trading state';
      showToast('error', message);
    },
  });
  const walletMut = useMutation({
    mutationFn: (b: { depositPaused?: boolean; withdrawalPaused?: boolean; reason?: string; twofa_code?: string }) =>
      patchOperationalWalletStatus(
        token,
        { depositPaused: b.depositPaused, withdrawalPaused: b.withdrawalPaused },
        { reason: b.reason, twofa_code: b.twofa_code }
      ),
    onSuccess: () => { inv([['admin', 'operational', 'wallet-status', token!]]); showToast('success', 'Wallet status updated'); },
  });
  const emergencyMut = useMutation({
    mutationFn: ({ action, enabled, reason, twofa_code }: { action: string; enabled: boolean; reason?: string; twofa_code?: string }) =>
      postEmergencyAction(token, action, enabled, { reason, twofa_code }),
    onSuccess: () => { inv([['admin', 'system', 'settings', token!]]); showToast('success', 'Emergency action applied'); },
  });
  const safeModeMut = useMutation({
    mutationFn: ({ enabled, reason, twofa_code }: { enabled: boolean; reason?: string; twofa_code?: string }) =>
      postSystemSafeMode(token, enabled, { reason, twofa_code }),
    onSuccess: () => {
      inv([['admin', 'system', 'safe-mode', token!], ['admin', 'trading-halt', token!]]);
      showToast('success', `Safe mode ${!safeMode ? 'enabled' : 'disabled'}`);
      setSafeModeAuthTarget(null);
    },
  });
  const featureMut = useMutation({
    mutationFn: (b: { id?: string; feature_key?: string; status?: string; reason?: string; twofa_code?: string }) => patchSystemFeature(token, b),
    onSuccess: () => {
      inv([['admin', 'system', 'features', token!]]);
      showToast('success', 'Feature flag updated');
      setFeatureAuthTarget(null);
    },
  });
  const riskMut = useMutation({ mutationFn: (b: Record<string, unknown>) => patchRiskSettings(token, b), onSuccess: () => { inv([['admin', 'risk', 'settings', token!]]); showToast('success', 'Risk settings updated'); } });
  const settingsMut = useMutation({ mutationFn: (b: Record<string, string>) => patchSystemSettings(token, b), onSuccess: () => { inv([['admin', 'system', 'settings', token!]]); showToast('success', 'Settings updated'); } });
  const twofaMut = useMutation({ mutationFn: (b: Record<string, boolean>) => adminFetch('/settings/2fa-enforcement', { method: 'PATCH', token, body: b }), onSuccess: () => { inv([['admin', '2fa-policy', token!]]); showToast('success', '2FA policy updated'); } });

  const withConfirm = (title: string, message: string, action: () => void, danger = true) => setConfirm({ title, message, danger, action });

  /* ── Fee + Risk form state (synced with server) ── */
  const [feeForm, setFeeForm] = useState({ default_maker_fee: '0.1', default_taker_fee: '0.1' });
  const [riskForm, setRiskForm] = useState({ large_withdrawal_threshold: 10000, whale_trade_threshold: 100000 });
  const [geoValue, setGeoValue] = useState('');

  useEffect(() => {
    if (settings['default_maker_fee']?.value || settings['default_taker_fee']?.value) {
      setFeeForm({
        default_maker_fee: settings['default_maker_fee']?.value ?? '0.1',
        default_taker_fee: settings['default_taker_fee']?.value ?? '0.1',
      });
    }
  }, [settings]);

  useEffect(() => {
    if (risk) {
      setRiskForm({
        large_withdrawal_threshold: risk.large_withdrawal_threshold ?? 10000,
        whale_trade_threshold: risk.whale_trade_threshold ?? 100000,
      });
    }
  }, [risk]);

  useEffect(() => {
    setGeoValue(geoBlocked);
  }, [geoBlocked]);

  /* ── Categorized feature flags (stable order) ── */
  const flagsByCategory = useMemo(() => {
    const cats: Record<string, (FeatureFlagRow & { meta: ReturnType<typeof getFlagMeta> })[]> = {};
    features.forEach(f => {
      const meta = getFlagMeta(f.feature_key);
      const cat = meta.cat;
      if (!cats[cat]) cats[cat] = [];
      cats[cat].push({ ...f, meta });
    });
    return cats;
  }, [features]);

  const sortedFlagCategories = useMemo(() => {
    const keys = Object.keys(flagsByCategory);
    return [...keys].sort((a, b) => {
      const ia = FLAG_CATEGORY_ORDER.indexOf(a as (typeof FLAG_CATEGORY_ORDER)[number]);
      const ib = FLAG_CATEGORY_ORDER.indexOf(b as (typeof FLAG_CATEGORY_ORDER)[number]);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [flagsByCategory]);

  /* ── Active systems count ── */
  const activeSystems = [!halted, !walletStatus.depositPaused, !walletStatus.withdrawalPaused, !emergencyP2P].filter(Boolean).length;

  return (
    <AdminPageFrame title="Control Center" description="Unified command center — critical settings in a single, structured layout.">

      <div className="mx-auto max-w-[1440px] space-y-8">
        {/* Toast */}
        {toast && (
          <div className={cn(
            'rounded-lg px-4 py-2.5 text-sm font-medium flex items-center gap-2 animate-fade-in',
            toast.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20',
          )}>
            {toast.type === 'success' ? <ShieldCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {toast.msg}
          </div>
        )}

        <ExchangeHealthTier1Banner token={token} />

        {/* ── Zone 1: Emergency + live toggles (one row on xl) ── */}
        <section className="space-y-4">
          <ZoneHeader
            step="01 · Emergency"
            title="Safe mode & live services"
            subtitle="Kill switch first, then per-service toggles. Changes apply immediately."
          />
          <div className="grid gap-4 xl:grid-cols-12 xl:items-stretch">
            <div className="xl:col-span-4 flex">
              <div className={cn(
                'rounded-xl border-2 p-4 relative overflow-hidden transition-all duration-500 w-full flex flex-col',
                safeMode
                  ? 'border-red-500/40 bg-gradient-to-br from-red-500/10 via-red-900/5 to-admin-card shadow-glow-danger'
                  : 'border-admin-border bg-admin-card',
              )}>
                {safeMode && (
                  <div className="absolute inset-0 bg-gradient-to-r from-red-500/5 to-transparent subtle-pulse pointer-events-none" />
                )}
                <div className="relative z-10 flex flex-col flex-1 justify-between gap-4">
                  <div className="flex gap-3">
                    <div className={cn(
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors',
                      safeMode ? 'bg-red-500/15' : 'bg-admin-muted/10',
                    )}>
                      <ShieldAlert className={cn('h-5 w-5', safeMode ? 'text-red-400 subtle-pulse' : 'text-admin-muted')} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-admin-text">Safe mode</h3>
                      <p className="text-[11px] text-admin-muted mt-1 leading-relaxed">
                        Halts trading, withdrawals, and API access in one action.
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <Badge variant={safeMode ? 'danger' : 'success'}>{safeMode ? 'ON' : 'Off'}</Badge>
                        {safeMode && <span className="text-[10px] text-red-400/80">All ops suspended</span>}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant={safeMode ? 'secondary' : 'danger'}
                    size="sm"
                    className={cn('w-full sm:w-auto shrink-0', !safeMode && 'shadow-glow-danger')}
                    onClick={() => setSafeModeAuthTarget(!safeMode)}
                    disabled={safeModeMut.isPending}
                  >
                    <Power className="h-4 w-4 mr-1.5" />
                    {safeMode ? 'Deactivate' : 'Activate safe mode'}
                  </Button>
                </div>
              </div>
            </div>

            <div className="xl:col-span-8 flex min-h-0">
              <Section
                className="w-full"
                icon={Zap}
                title="Live system controls"
                description={`${activeSystems}/4 channels operational`}
                iconBg="bg-admin-danger/10 text-red-400"
                action={
                  <div className="flex items-center gap-1" title="Per-service status">
                    {[!halted, !walletStatus.depositPaused, !walletStatus.withdrawalPaused, !emergencyP2P].map((active, i) => (
                      <span key={i} className={cn('h-2 w-2 rounded-full', active ? 'bg-emerald-400' : 'bg-red-400')} />
                    ))}
                  </div>
                }
                bodyClassName="!pt-3"
              >
                <div className="grid gap-2.5 sm:grid-cols-2 flex-1">
                  <SystemToggleCard
                    icon={TrendingUp}
                    label="Spot trading"
                    description="Order matching"
                    active={!halted}
                    onToggle={() => {
                      if (halted) withConfirm('Resume Trading', 'Resume spot trading on all markets?', () => haltMut.mutate({ halted: false }));
                      else setHaltAuthOpen(true);
                    }}
                    loading={haltMut.isPending}
                  />
                  <SystemToggleCard
                    icon={ArrowDownToLine}
                    label="Deposits"
                    description="Address gen & crediting"
                    active={!walletStatus.depositPaused}
                    onToggle={() => setServiceAuthTarget({ kind: 'deposits', nextPaused: !walletStatus.depositPaused })}
                    loading={walletMut.isPending}
                  />
                  <SystemToggleCard
                    icon={ArrowUpFromLine}
                    label="Withdrawals"
                    description="Payout processing"
                    active={!walletStatus.withdrawalPaused}
                    onToggle={() => setServiceAuthTarget({ kind: 'withdrawals', nextPaused: !walletStatus.withdrawalPaused })}
                    loading={walletMut.isPending}
                  />
                  <SystemToggleCard
                    icon={ArrowLeftRight}
                    label="P2P trading"
                    description="Peer-to-peer"
                    active={!emergencyP2P}
                    onToggle={() => setServiceAuthTarget({ kind: 'p2p', nextDisabled: !emergencyP2P })}
                    loading={emergencyMut.isPending}
                  />
                </div>
              </Section>
            </div>
          </div>
        </section>

        {/* ── Zone 2: Treasury + configuration (two columns on xl) ── */}
        <section className="space-y-4">
          <ZoneHeader
            step="02 · Treasury & policy"
            title="Hot wallets, fees, and risk limits"
            subtitle="Balances at a glance; fee and risk settings stay grouped for faster updates."
          />
          <div className="grid gap-4 xl:grid-cols-12 xl:items-start">
            <div className="xl:col-span-7">
              <Section
                icon={Wallet}
                title="Hot wallet status"
                description="Per-chain hot balance & cold routing"
                iconBg="bg-amber-500/10 text-amber-400"
                action={
                  <Link href="/treasury" className="text-[11px] font-semibold text-admin-primary hover:text-admin-primary-hover whitespace-nowrap">
                    Treasury <ArrowRight className="inline h-3 w-3" />
                  </Link>
                }
                bodyClassName="!p-0 flex flex-col"
              >
                {hotWallets.length === 0 ? (
                  <div className="text-center py-10 px-4">
                    <Wallet className="h-8 w-8 text-admin-muted/25 mx-auto mb-2" />
                    <p className="text-sm text-admin-muted">No hot wallets configured</p>
                    <Link href="/treasury" className="text-xs text-admin-primary hover:underline mt-2 inline-block">Configure in Treasury →</Link>
                  </div>
                ) : (
                  <div className="max-h-[min(22rem,50vh)] overflow-y-auto overscroll-contain border-t border-admin-border">
                    <div className="divide-y divide-admin-border/40">
                      {hotWallets.slice(0, 12).map((w) => {
                        const chain = getChainStyle(w.chainName);
                        const bal = parseFloat(w.balanceCache || '0');
                        const isEmpty = bal === 0;
                        return (
                          <div key={w.chainId} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
                            <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[9px] font-bold', chain.bg, chain.text)}>
                              {chain.label}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-admin-text">{w.chainName}</p>
                              <p className="text-[10px] text-admin-muted font-mono truncate">
                                {w.coldWalletAddress ? `${w.coldWalletAddress.slice(0, 6)}…${w.coldWalletAddress.slice(-4)}` : (
                                  <span className="text-admin-muted/50 italic">Cold not set</span>
                                )}
                              </p>
                            </div>
                            <p className={cn('text-xs font-bold tabular-nums shrink-0 w-24 text-right', isEmpty ? 'text-admin-muted/40' : 'text-admin-text')}>
                              {isEmpty ? '—' : bal.toFixed(4)}
                            </p>
                            <Badge variant={w.isActive ? 'success' : 'danger'} className="shrink-0 text-[10px]">
                              {w.isActive ? 'Active' : 'Off'}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </Section>
            </div>

            <div className="xl:col-span-5 space-y-4">
              <Section
                icon={Sliders}
                title="Fees & risk"
                description="Default fees and withdrawal / whale thresholds"
                iconBg="bg-admin-primary/10 text-admin-primary"
                bodyClassName="!p-0"
              >
                <div className="grid sm:grid-cols-2 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-admin-border border-t border-admin-border">
                  <div className="p-4 space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-admin-muted">Trading fees</p>
                    <div className="grid grid-cols-2 gap-2">
                      <FeeCardCompact
                        label="Maker"
                        value={feeForm.default_maker_fee}
                        onChange={(v) => setFeeForm(f => ({ ...f, default_maker_fee: v }))}
                        accent="emerald"
                      />
                      <FeeCardCompact
                        label="Taker"
                        value={feeForm.default_taker_fee}
                        onChange={(v) => setFeeForm(f => ({ ...f, default_taker_fee: v }))}
                        accent="blue"
                      />
                    </div>
                    <Button size="sm" className="w-full" onClick={() => settingsMut.mutate(feeForm)} disabled={settingsMut.isPending}>
                      {settingsMut.isPending ? 'Saving…' : 'Save fees'}
                    </Button>
                  </div>
                  <div className="p-4 space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-admin-muted">Risk limits</p>
                    <RiskFieldCompact
                      label="Large withdrawal (USD)"
                      value={riskForm.large_withdrawal_threshold}
                      onChange={(v) => setRiskForm(f => ({ ...f, large_withdrawal_threshold: v }))}
                      max={100000}
                    />
                    <RiskFieldCompact
                      label="Whale trade (USD)"
                      value={riskForm.whale_trade_threshold}
                      onChange={(v) => setRiskForm(f => ({ ...f, whale_trade_threshold: v }))}
                      max={1000000}
                    />
                    <div className="flex items-center justify-between rounded-lg border border-admin-border bg-white/[0.02] px-3 py-2">
                      <span className="text-[11px] text-admin-text font-medium">KYC for withdrawals</span>
                      <div className="flex items-center gap-2">
                        <Badge variant={kycRequired === 'true' ? 'success' : 'warning'} className="text-[10px]">
                          {kycRequired === 'true' ? 'On' : 'Off'}
                        </Badge>
                        <button
                          type="button"
                          onClick={() => settingsMut.mutate({ kyc_required_for_withdrawal: kycRequired === 'true' ? 'false' : 'true' })}
                          className="transition-opacity hover:opacity-90"
                        >
                          {kycRequired === 'true' ? (
                            <ToggleRight className="h-5 w-5 text-emerald-400" />
                          ) : (
                            <ToggleLeft className="h-5 w-5 text-admin-muted" />
                          )}
                        </button>
                      </div>
                    </div>
                    <Button size="sm" variant="secondary" className="w-full" onClick={() => riskMut.mutate(riskForm)} disabled={riskMut.isPending}>
                      {riskMut.isPending ? 'Saving…' : 'Save risk'}
                    </Button>
                  </div>
                </div>
              </Section>
            </div>
          </div>
        </section>

        {/* ── Zone 3: Security + features (two columns on lg+) ── */}
        <section className="space-y-4">
          <ZoneHeader
            step="03 · Security & features"
            title="Access policy and product flags"
            subtitle="2FA, geo rules, and feature toggles in aligned columns."
          />
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <Section
              icon={Lock}
              title="Security policies"
              description="Multi-factor auth and geo-blocking"
              iconBg="bg-blue-500/10 text-blue-400"
              bodyClassName="space-y-4"
            >
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-admin-muted mb-2">Multi-factor authentication</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <SecurityPolicyCard
                    icon={Key}
                    label="Login 2FA"
                    description="Admin login"
                    active={twofa?.require2faLogin ?? false}
                    onToggle={() => twofaMut.mutate({ require2faLogin: !twofa?.require2faLogin })}
                    loading={twofaMut.isPending}
                  />
                  <SecurityPolicyCard
                    icon={Fingerprint}
                    label="Withdrawal 2FA"
                    description="Payout approval"
                    active={twofa?.require2faWithdrawal ?? false}
                    onToggle={() => twofaMut.mutate({ require2faWithdrawal: !twofa?.require2faWithdrawal })}
                    loading={twofaMut.isPending}
                  />
                  <SecurityPolicyCard
                    icon={Eye}
                    label="API trading 2FA"
                    description="API keys"
                    active={twofa?.require2faApiTrading ?? false}
                    onToggle={() => twofaMut.mutate({ require2faApiTrading: !twofa?.require2faApiTrading })}
                    loading={twofaMut.isPending}
                  />
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-admin-muted mb-2">Geo-blocking</p>
                <div className="rounded-lg border border-admin-border bg-white/[0.02] p-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={geoValue}
                      onChange={(e) => setGeoValue(e.target.value)}
                      placeholder="US,CN,IR,KP"
                      className="flex-1 min-w-0 rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-xs text-admin-text font-mono placeholder:text-admin-muted/30 focus:border-admin-primary/50 outline-none"
                    />
                    <Button size="sm" onClick={() => settingsMut.mutate({ GEO_BLOCKED_COUNTRIES: geoValue })} disabled={settingsMut.isPending}>Save</Button>
                  </div>
                  {geoValue ? (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {geoValue.split(',').filter(Boolean).map((c, i) => (
                        <span key={`${c.trim()}-${i}`} className="rounded bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 text-[9px] font-bold text-red-400 uppercase">
                          {c.trim()}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </Section>

            <Section
              icon={Settings}
              title="Feature flags"
              description="Product modules by category"
              iconBg="bg-admin-muted/10 text-admin-muted"
              action={
                <Link href="/settings/system" className="text-[11px] font-semibold text-admin-primary hover:text-admin-primary-hover whitespace-nowrap">
                  System settings <ArrowRight className="inline h-3 w-3" />
                </Link>
              }
              bodyClassName="max-h-[min(28rem,55vh)] overflow-y-auto overscroll-contain pr-1 -mr-1"
            >
              {features.length === 0 ? (
                <div className="text-center py-8">
                  <Settings className="h-8 w-8 text-admin-muted/25 mx-auto mb-2" />
                  <p className="text-sm text-admin-muted">No flags loaded</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {sortedFlagCategories.map((cat) => {
                    const flags = flagsByCategory[cat];
                    if (!flags?.length) return null;
                    return (
                      <div key={cat}>
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-admin-muted mb-2 flex items-center gap-1.5">
                          <CategoryIcon cat={cat} />
                          {cat}
                        </p>
                        <div className="grid gap-2 sm:grid-cols-1">
                          {flags.map(f => (
                            <FeatureFlagCard
                              key={f.id}
                              icon={f.meta.icon}
                              label={f.feature_key.replace(/_/g, ' ')}
                              description={f.meta.desc}
                              enabled={f.status === 'enabled'}
                              onToggle={() => setFeatureAuthTarget(f)}
                              loading={featureMut.isPending}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
          </div>
        </section>
      </div>

      {/* ── Modals ── */}
      <ActionAuthModal
        open={haltAuthOpen}
        onClose={() => setHaltAuthOpen(false)}
        onConfirm={(payload: ActionAuthPayload) =>
          haltMut.mutate({ halted: true, reason: payload.reason, twofa_code: payload.twofa_code })
        }
        title="Halt all spot trading"
        actionLabel="Halt all spot trading"
        description="Stops order matching exchange-wide. Reason and operator identity are stored in audit logs."
        requireReason
        twofaRequired
        confirmationPhrase="CONFIRM HALT_TRADING"
        externalError={haltMut.error instanceof Error ? haltMut.error.message : null}
        isPending={haltMut.isPending}
        confirmLabel={haltMut.isPending ? 'Halting…' : 'Halt trading'}
        confirmVariant="danger"
      />
      <ActionAuthModal
        open={safeModeAuthTarget !== null}
        onClose={() => setSafeModeAuthTarget(null)}
        onConfirm={(payload: ActionAuthPayload) => {
          if (safeModeAuthTarget === null) return;
          safeModeMut.mutate({ enabled: safeModeAuthTarget, reason: payload.reason, twofa_code: payload.twofa_code });
        }}
        title={safeModeAuthTarget ? 'Enable safe mode' : 'Disable safe mode'}
        actionLabel={safeModeAuthTarget ? 'Enable global safe mode' : 'Disable global safe mode'}
        description="Safe mode is exchange-wide and impacts trading, withdrawals, and external API behavior."
        requireReason
        twofaRequired
        confirmationPhrase={safeModeAuthTarget ? 'CONFIRM SAFE_MODE_ON' : 'CONFIRM SAFE_MODE_OFF'}
        externalError={safeModeMut.error instanceof Error ? safeModeMut.error.message : null}
        isPending={safeModeMut.isPending}
        confirmLabel={safeModeMut.isPending ? 'Processing…' : (safeModeAuthTarget ? 'Enable safe mode' : 'Disable safe mode')}
        confirmVariant={safeModeAuthTarget ? 'danger' : 'primary'}
      />
      <ActionAuthModal
        open={!!featureAuthTarget}
        onClose={() => setFeatureAuthTarget(null)}
        onConfirm={(payload: ActionAuthPayload) => {
          if (!featureAuthTarget) return;
          featureMut.mutate({
            id: featureAuthTarget.id,
            status: featureAuthTarget.status === 'enabled' ? 'disabled' : 'enabled',
            reason: payload.reason,
            twofa_code: payload.twofa_code,
          });
        }}
        title="Update feature flag"
        actionLabel={
          featureAuthTarget
            ? `${featureAuthTarget.status === 'enabled' ? 'Disable' : 'Enable'} ${featureAuthTarget.feature_key}`
            : 'Update feature'
        }
        description="Feature flags affect production behavior instantly. Provide an operational reason."
        requireReason
        twofaRequired
        confirmationPhrase={featureAuthTarget?.status === 'enabled' ? 'CONFIRM DISABLE_FLAG' : undefined}
        externalError={featureMut.error instanceof Error ? featureMut.error.message : null}
        isPending={featureMut.isPending}
        confirmLabel={featureMut.isPending ? 'Updating…' : 'Apply change'}
        confirmVariant={featureAuthTarget?.status === 'enabled' ? 'danger' : 'primary'}
      />
      <ActionAuthModal
        open={serviceAuthTarget !== null}
        onClose={() => setServiceAuthTarget(null)}
        onConfirm={(payload: ActionAuthPayload) => {
          if (!serviceAuthTarget) return;
          if (serviceAuthTarget.kind === 'deposits') {
            walletMut.mutate({ depositPaused: serviceAuthTarget.nextPaused, reason: payload.reason, twofa_code: payload.twofa_code });
          } else if (serviceAuthTarget.kind === 'withdrawals') {
            walletMut.mutate({ withdrawalPaused: serviceAuthTarget.nextPaused, reason: payload.reason, twofa_code: payload.twofa_code });
          } else {
            emergencyMut.mutate({ action: 'disable_p2p', enabled: serviceAuthTarget.nextDisabled, reason: payload.reason, twofa_code: payload.twofa_code });
          }
          setServiceAuthTarget(null);
        }}
        title="Confirm service control change"
        actionLabel={
          serviceAuthTarget
            ? serviceAuthTarget.kind === 'deposits'
              ? `${serviceAuthTarget.nextPaused ? 'Pause' : 'Resume'} deposits`
              : serviceAuthTarget.kind === 'withdrawals'
                ? `${serviceAuthTarget.nextPaused ? 'Pause' : 'Resume'} withdrawals`
                : `${serviceAuthTarget.nextDisabled ? 'Disable' : 'Resume'} P2P trading`
            : 'Service control'
        }
        description="These service controls are high-impact and require reason + 2FA."
        requireReason
        twofaRequired
        confirmationPhrase="CONFIRM SERVICE_CONTROL"
        externalError={
          walletMut.error instanceof Error
            ? walletMut.error.message
            : emergencyMut.error instanceof Error
              ? emergencyMut.error.message
              : null
        }
        isPending={walletMut.isPending || emergencyMut.isPending}
        confirmLabel={walletMut.isPending || emergencyMut.isPending ? 'Applying…' : 'Apply'}
        confirmVariant="danger"
      />

      <ConfirmModal
        open={!!confirm}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        danger={confirm?.danger}
        onClose={() => setConfirm(null)}
        onConfirm={() => { confirm?.action(); setConfirm(null); }}
        loading={haltMut.isPending || walletMut.isPending || emergencyMut.isPending || safeModeMut.isPending}
      />
    </AdminPageFrame>
  );
}

/* ────────────────────────────────────────────────────── */
/*  Sub-components                                        */
/* ────────────────────────────────────────────────────── */

/* ── System Toggle Card ── */
const SystemToggleCard = memo(function SystemToggleCard({ icon: Icon, label, description, active, onToggle, loading }: {
  icon: React.ElementType; label: string; description: string;
  active: boolean; onToggle: () => void; loading?: boolean;
}) {
  return (
    <div className={cn(
      'rounded-lg border p-3 transition-all duration-200',
      active
        ? 'border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.06] to-transparent'
        : 'border-red-500/15 bg-gradient-to-br from-red-500/[0.06] to-transparent',
    )}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
            active ? 'bg-emerald-500/10' : 'bg-red-500/10',
          )}>
            <Icon className={cn('h-3.5 w-3.5', active ? 'text-emerald-400' : 'text-red-400')} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-admin-text leading-tight">{label}</p>
            <p className="text-[10px] text-admin-muted mt-0.5 leading-snug">{description}</p>
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', active ? 'bg-emerald-400' : 'bg-red-400')} />
              <span className={cn('text-[9px] font-bold uppercase tracking-wider', active ? 'text-emerald-400' : 'text-red-400')}>
                {active ? 'Live' : 'Off'}
              </span>
            </div>
          </div>
        </div>
        <button type="button" onClick={onToggle} disabled={loading} className={cn('shrink-0 transition-all', loading && 'opacity-40')}>
          {active ? <ToggleRight className="h-6 w-6 text-emerald-400" /> : <ToggleLeft className="h-6 w-6 text-red-400" />}
        </button>
      </div>
    </div>
  );
});

function FeeCardCompact({ label, value, onChange, accent }: {
  label: string; value: string; onChange: (v: string) => void;
  accent: 'emerald' | 'blue';
}) {
  const shell = accent === 'emerald'
    ? 'border-emerald-500/15 bg-emerald-500/[0.04]'
    : 'border-blue-500/15 bg-blue-500/[0.04]';
  const lbl = accent === 'emerald' ? 'text-emerald-400' : 'text-blue-400';
  return (
    <div className={cn('rounded-lg border p-2.5', shell)}>
      <p className={cn('text-[9px] font-bold uppercase tracking-wider mb-1.5', lbl)}>{label}</p>
      <div className="flex items-baseline gap-0.5">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full min-w-0 bg-transparent border-b border-admin-border/40 text-lg font-black tabular-nums text-admin-text outline-none focus:border-admin-primary/60 transition-colors"
        />
        <span className="text-xs text-admin-muted shrink-0">%</span>
      </div>
    </div>
  );
}

function RiskFieldCompact({ label, value, onChange, max }: {
  label: string; value: number; onChange: (v: number) => void; max: number;
}) {
  const pct = Math.min(100, (value / max) * 100);
  const level = pct > 80 ? 'high' : pct > 40 ? 'medium' : 'low';
  return (
    <div>
      <label className="block text-[10px] text-admin-muted mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full rounded-md border border-admin-border bg-admin-surface px-2.5 py-1.5 text-xs text-admin-text font-mono tabular-nums outline-none focus:border-admin-primary/50"
      />
      <div className="mt-1.5 h-1 rounded-full bg-admin-border/30 overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            level === 'high' ? 'bg-red-500' : level === 'medium' ? 'bg-amber-500' : 'bg-emerald-500',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ── Security Policy Card ── */
const SecurityPolicyCard = memo(function SecurityPolicyCard({ icon: Icon, label, description, active, onToggle, loading }: {
  icon: React.ElementType; label: string; description: string;
  active: boolean; onToggle: () => void; loading?: boolean;
}) {
  return (
    <div className={cn(
      'rounded-lg border p-3 transition-all duration-200',
      active ? 'border-blue-500/20 bg-blue-500/5' : 'border-admin-border bg-white/[0.01]',
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', active ? 'bg-blue-500/15' : 'bg-white/[0.03]')}>
            <Icon className={cn('h-3.5 w-3.5', active ? 'text-blue-400' : 'text-admin-muted')} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-admin-text leading-tight">{label}</p>
            <p className="text-[9px] text-admin-muted mt-0.5 leading-snug">{description}</p>
          </div>
        </div>
        <button type="button" onClick={onToggle} disabled={loading} className={cn('shrink-0', loading && 'opacity-40')}>
          {active ? <ToggleRight className="h-5 w-5 text-blue-400" /> : <ToggleLeft className="h-5 w-5 text-admin-muted" />}
        </button>
      </div>
    </div>
  );
});

/* ── Feature Flag Card ── */
const FeatureFlagCard = memo(function FeatureFlagCard({ icon: Icon, label, description, enabled, onToggle, loading }: {
  icon: React.ElementType; label: string; description: string;
  enabled: boolean; onToggle: () => void; loading?: boolean;
}) {
  return (
    <div className={cn(
      'rounded-lg border p-3 flex items-center gap-3 transition-all duration-200',
      enabled ? 'border-emerald-500/15 bg-emerald-500/5' : 'border-admin-border hover:bg-white/[0.01]',
    )}>
      <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', enabled ? 'bg-emerald-500/10' : 'bg-white/[0.03]')}>
        <Icon className={cn('h-3.5 w-3.5', enabled ? 'text-emerald-400' : 'text-admin-muted')} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-admin-text capitalize truncate">{label}</p>
        <p className="text-[9px] text-admin-muted truncate">{description}</p>
      </div>
      <button onClick={onToggle} disabled={loading} className={cn('shrink-0', loading && 'opacity-40')}>
        {enabled ? <ToggleRight className="h-5 w-5 text-emerald-400" /> : <ToggleLeft className="h-5 w-5 text-admin-muted" />}
      </button>
    </div>
  );
});

/* ── Category icon helper ── */
function CategoryIcon({ cat }: { cat: string }) {
  const map: Record<string, React.ElementType> = {
    Trading: BarChart3, Finance: Coins, P2P: ArrowLeftRight, System: Layers,
  };
  const Icon = map[cat] ?? Box;
  return <Icon className="h-3 w-3" />;
}
