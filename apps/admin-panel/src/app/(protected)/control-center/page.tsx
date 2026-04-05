'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import { getHotWallets, patchHotWallet } from '@/lib/treasury-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  Shield, Zap, Wallet, CreditCard, AlertTriangle, Settings,
  ToggleLeft, ToggleRight, Globe, Lock, RefreshCw, Sliders,
} from 'lucide-react';
import { cn } from '@/lib/cn';

// --------------- Confirmation Modal ---------------
function ConfirmModal({ open, title, message, danger, onClose, onConfirm, loading }: {
  open: boolean; title: string; message: string; danger?: boolean;
  onClose: () => void; onConfirm: () => void; loading?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-admin-card border border-admin-border p-6 shadow-modal" onClick={e => e.stopPropagation()}>
        <h3 className={cn('text-lg font-semibold', danger ? 'text-admin-danger' : 'text-admin-text')}>{title}</h3>
        <p className="mt-2 text-sm text-admin-muted">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={loading}>
            {loading ? 'Processing...' : 'Confirm'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// --------------- Toggle Row ---------------
function ToggleRow({ label, description, active, onToggle, loading, danger }: {
  label: string; description?: string; active: boolean;
  onToggle: () => void; loading?: boolean; danger?: boolean;
}) {
  return (
    <div className={cn(
      'flex items-center justify-between rounded-lg border p-4 transition-colors',
      active && danger ? 'border-red-500/30 bg-red-500/5' : 'border-admin-border',
    )}>
      <div>
        <p className="font-medium text-admin-text">{label}</p>
        {description && <p className="text-xs text-admin-muted mt-0.5">{description}</p>}
        <Badge variant={active ? (danger ? 'danger' : 'success') : 'default'} className="mt-1">
          {active ? (danger ? 'DISABLED' : 'ACTIVE') : (danger ? 'Live' : 'OFF')}
        </Badge>
      </div>
      <button
        onClick={onToggle}
        disabled={loading}
        className={cn('transition-colors', loading && 'opacity-50')}
        title={active ? 'Disable' : 'Enable'}
      >
        {active ? (
          <ToggleRight className={cn('h-8 w-8', danger ? 'text-admin-danger' : 'text-admin-success')} />
        ) : (
          <ToggleLeft className="h-8 w-8 text-admin-muted" />
        )}
      </button>
    </div>
  );
}

// --------------- Section Header ---------------
function SectionHeader({ icon: Icon, title, color }: { icon: React.ElementType; title: string; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', color)}>
        <Icon className="h-4 w-4" />
      </div>
      <CardTitle>{title}</CardTitle>
    </div>
  );
}

export default function ControlCenterPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<{ title: string; message: string; danger?: boolean; action: () => void } | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const showToast = (type: 'success' | 'error', msg: string) => { setToast({ type, msg }); setTimeout(() => setToast(null), 3000); };
  const inv = useCallback((keys: string[][]) => keys.forEach(k => qc.invalidateQueries({ queryKey: k })), [qc]);

  // ---- Queries ----
  const { data: haltData } = useQuery({ queryKey: ['admin', 'trading-halt', token], queryFn: () => getTradingHalt(token), enabled: !!token });
  const { data: walletData } = useQuery({ queryKey: ['admin', 'operational', 'wallet-status', token], queryFn: () => getOperationalWalletStatus(token), enabled: !!token });
  const { data: settingsData } = useQuery({ queryKey: ['admin', 'system', 'settings', token], queryFn: () => getSystemSettings(token), enabled: !!token });
  const { data: safeModeData } = useQuery({ queryKey: ['admin', 'system', 'safe-mode', token], queryFn: () => getSystemSafeMode(token), enabled: !!token });
  const { data: featuresData } = useQuery({ queryKey: ['admin', 'system', 'features', token], queryFn: () => getSystemFeatures(token), enabled: !!token });
  const { data: riskData } = useQuery({ queryKey: ['admin', 'risk', 'settings', token], queryFn: () => getRiskSettings(token), enabled: !!token });
  const { data: hotWalletsData } = useQuery({ queryKey: ['admin', 'hot-wallets-crud', token], queryFn: () => getHotWallets(token), enabled: !!token });
  const { data: twofaData } = useQuery({ queryKey: ['admin', '2fa-policy', token], queryFn: () => adminFetch<{ require2faLogin: boolean; require2faWithdrawal: boolean; require2faApiTrading: boolean }>('/settings/2fa-enforcement', { token }), enabled: !!token });

  // ---- Derived ----
  const halted = haltData?.data?.halted ?? false;
  const walletStatus = walletData?.data ?? { depositPaused: false, withdrawalPaused: false };
  const settings = settingsData?.data?.settings ?? {};
  const safeMode = safeModeData?.data?.safe_mode ?? false;
  const features = (featuresData?.data?.features ?? []) as FeatureFlagRow[];
  const risk = riskData?.data;
  const twofa = twofaData?.data;
  const emergencyP2P = settings['emergency_disable_p2p']?.value === '1' || settings['emergency_disable_p2p']?.value === 'true';
  const hotWallets = ((hotWalletsData as any)?.data ?? []) as Array<{ chainId: string; chainName: string; address: string; balanceCache: string; coldWalletAddress: string | null; maxSingleTx: string | null; maxDailyOutflow: string | null; isActive: boolean }>;
  const geoBlocked = settings['GEO_BLOCKED_COUNTRIES']?.value ?? '';
  const kycRequired = settings['kyc_required_for_withdrawal']?.value ?? 'true';

  // ---- Mutations ----
  const haltMut = useMutation({ mutationFn: (v: boolean) => setTradingHalt(token, v), onSuccess: () => { inv([['admin', 'trading-halt', token!]]); showToast('success', 'Trading state updated'); } });
  const walletMut = useMutation({ mutationFn: (b: { depositPaused?: boolean; withdrawalPaused?: boolean }) => patchOperationalWalletStatus(token, b), onSuccess: () => { inv([['admin', 'operational', 'wallet-status', token!]]); showToast('success', 'Wallet status updated'); } });
  const emergencyMut = useMutation({ mutationFn: ({ action, enabled }: { action: string; enabled: boolean }) => postEmergencyAction(token, action, enabled), onSuccess: () => { inv([['admin', 'system', 'settings', token!]]); showToast('success', 'Emergency action applied'); } });
  const safeModeMut = useMutation({ mutationFn: (v: boolean) => postSystemSafeMode(token, v), onSuccess: () => { inv([['admin', 'system', 'safe-mode', token!], ['admin', 'trading-halt', token!]]); showToast('success', `Safe mode ${!safeMode ? 'enabled' : 'disabled'}`); } });
  const featureMut = useMutation({ mutationFn: (b: { id?: string; feature_key?: string; status?: string }) => patchSystemFeature(token, b), onSuccess: () => { inv([['admin', 'system', 'features', token!]]); showToast('success', 'Feature flag updated'); } });
  const riskMut = useMutation({ mutationFn: (b: Record<string, unknown>) => patchRiskSettings(token, b), onSuccess: () => { inv([['admin', 'risk', 'settings', token!]]); showToast('success', 'Risk settings updated'); } });
  const settingsMut = useMutation({ mutationFn: (b: Record<string, string>) => patchSystemSettings(token, b), onSuccess: () => { inv([['admin', 'system', 'settings', token!]]); showToast('success', 'Settings updated'); } });
  const twofaMut = useMutation({ mutationFn: (b: Record<string, boolean>) => adminFetch('/settings/2fa-enforcement', { method: 'PATCH', token, body: b }), onSuccess: () => { inv([['admin', '2fa-policy', token!]]); showToast('success', '2FA policy updated'); } });

  const withConfirm = (title: string, message: string, action: () => void, danger = true) => setConfirm({ title, message, danger, action });

  // ---- Fee state ----
  const [feeForm, setFeeForm] = useState({ default_maker_fee: settings['default_maker_fee']?.value ?? '0.1', default_taker_fee: settings['default_taker_fee']?.value ?? '0.1' });
  const [riskForm, setRiskForm] = useState({ large_withdrawal_threshold: risk?.large_withdrawal_threshold ?? 10000, whale_trade_threshold: risk?.whale_trade_threshold ?? 100000 });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-admin-text">Control Center</h1>
        <p className="text-xs text-admin-muted mt-0.5">Unified command center — control all critical exchange settings from one place.</p>
      </div>

      {toast && (
        <div className={cn('rounded-lg px-4 py-2 text-sm', toast.type === 'success' ? 'bg-admin-success/15 text-admin-success' : 'bg-admin-danger/15 text-admin-danger')}>
          {toast.msg}
        </div>
      )}

      {/* ====== SECTION 1: CRITICAL CONTROLS ====== */}
      <Card>
        <CardHeader>
          <SectionHeader icon={Zap} title="Critical Controls" color="bg-admin-danger/15 text-admin-danger" />
          <p className="text-xs text-admin-muted">Real-time kill switches. Changes take effect immediately.</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {/* Safe Mode */}
            <div className={cn('rounded-lg border p-4', safeMode ? 'border-red-500/40 bg-red-500/10' : 'border-admin-border')}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-admin-text flex items-center gap-2">
                    <Shield className="h-4 w-4 text-admin-danger" /> Safe Mode
                  </p>
                  <p className="text-xs text-admin-muted mt-0.5">Disables trading, withdrawals, and API trading simultaneously.</p>
                  <Badge variant={safeMode ? 'danger' : 'success'} className="mt-1">{safeMode ? 'ACTIVE' : 'Off'}</Badge>
                </div>
                <Button
                  variant={safeMode ? 'secondary' : 'danger'} size="sm"
                  onClick={() => withConfirm(safeMode ? 'Disable Safe Mode' : 'Enable Safe Mode', safeMode ? 'Resume all trading and withdrawal operations?' : 'This will halt trading, withdrawals, and API access.', () => safeModeMut.mutate(!safeMode))}
                  disabled={safeModeMut.isPending}
                >
                  {safeMode ? 'Deactivate' : 'Activate'}
                </Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <ToggleRow label="Trading" description="Spot order matching" active={!halted} danger={halted}
                onToggle={() => withConfirm(halted ? 'Resume Trading' : 'Halt Trading', halted ? 'Resume all spot trading?' : 'Halt all spot order matching?', () => haltMut.mutate(!halted))}
                loading={haltMut.isPending} />
              <ToggleRow label="Deposits" description="User deposit address generation" active={!walletStatus.depositPaused} danger={walletStatus.depositPaused}
                onToggle={() => withConfirm(walletStatus.depositPaused ? 'Resume Deposits' : 'Pause Deposits', walletStatus.depositPaused ? 'Allow deposits again?' : 'Pause all user deposits?', () => walletMut.mutate({ depositPaused: !walletStatus.depositPaused }))}
                loading={walletMut.isPending} />
              <ToggleRow label="Withdrawals" description="User withdrawal processing" active={!walletStatus.withdrawalPaused} danger={walletStatus.withdrawalPaused}
                onToggle={() => withConfirm(walletStatus.withdrawalPaused ? 'Resume Withdrawals' : 'Pause Withdrawals', walletStatus.withdrawalPaused ? 'Allow withdrawals again?' : 'Pause all user withdrawals?', () => walletMut.mutate({ withdrawalPaused: !walletStatus.withdrawalPaused }))}
                loading={walletMut.isPending} />
              <ToggleRow label="P2P Trading" description="Peer-to-peer order matching" active={!emergencyP2P} danger={emergencyP2P}
                onToggle={() => withConfirm(emergencyP2P ? 'Resume P2P' : 'Disable P2P', emergencyP2P ? 'Resume P2P trading?' : 'Disable P2P for all users?', () => emergencyMut.mutate({ action: 'disable_p2p', enabled: !emergencyP2P }))}
                loading={emergencyMut.isPending} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ====== SECTION 2: WALLET MANAGEMENT ====== */}
      <Card>
        <CardHeader>
          <SectionHeader icon={Wallet} title="Wallet Management" color="bg-amber-500/15 text-amber-500" />
          <p className="text-xs text-admin-muted">Hot wallet overview and limits. Full wallet management in <a href="/treasury" className="text-admin-primary hover:underline">Treasury</a>.</p>
        </CardHeader>
        <CardContent>
          {hotWallets.length === 0 ? (
            <p className="text-sm text-admin-muted py-4 text-center">No hot wallets configured.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-admin-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-admin-border bg-white/[0.02]">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-admin-muted uppercase">Chain</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-admin-muted uppercase">Balance</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-admin-muted uppercase">Cold Address</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-admin-muted uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {hotWallets.slice(0, 8).map((w) => (
                    <tr key={w.chainId} className="border-b border-admin-border/30 hover:bg-white/[0.03] transition-colors">
                      <td className="px-4 py-2.5 font-medium text-admin-text">{w.chainName}</td>
                      <td className="px-4 py-2.5 tabular-nums text-admin-text">{w.balanceCache || '0'}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-admin-muted">{w.coldWalletAddress ? `${w.coldWalletAddress.slice(0, 10)}…` : '—'}</td>
                      <td className="px-4 py-2.5"><Badge variant={w.isActive ? 'success' : 'danger'}>{w.isActive ? 'Active' : 'Off'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ====== SECTION 3: FEES ====== */}
      <Card>
        <CardHeader>
          <SectionHeader icon={CreditCard} title="Fee Configuration" color="bg-admin-primary/15 text-admin-primary" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-admin-muted mb-1">Default Maker Fee (%)</label>
              <input type="text" value={feeForm.default_maker_fee} onChange={e => setFeeForm(f => ({ ...f, default_maker_fee: e.target.value }))}
                className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text" />
            </div>
            <div>
              <label className="block text-xs font-medium text-admin-muted mb-1">Default Taker Fee (%)</label>
              <input type="text" value={feeForm.default_taker_fee} onChange={e => setFeeForm(f => ({ ...f, default_taker_fee: e.target.value }))}
                className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text" />
            </div>
            <div className="flex items-end">
              <Button size="sm" onClick={() => settingsMut.mutate(feeForm)} disabled={settingsMut.isPending}>
                {settingsMut.isPending ? 'Saving...' : 'Save Fees'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ====== SECTION 4: LIMITS & RISK ====== */}
      <Card>
        <CardHeader>
          <SectionHeader icon={AlertTriangle} title="Limits & Risk" color="bg-admin-warning/15 text-admin-warning" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-admin-muted mb-1">Large Withdrawal Threshold (USD)</label>
              <input type="number" value={riskForm.large_withdrawal_threshold} onChange={e => setRiskForm(f => ({ ...f, large_withdrawal_threshold: Number(e.target.value) }))}
                className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text" />
            </div>
            <div>
              <label className="block text-xs font-medium text-admin-muted mb-1">Whale Trade Threshold (USD)</label>
              <input type="number" value={riskForm.whale_trade_threshold} onChange={e => setRiskForm(f => ({ ...f, whale_trade_threshold: Number(e.target.value) }))}
                className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text" />
            </div>
            <div>
              <label className="block text-xs font-medium text-admin-muted mb-1">KYC for Withdrawals</label>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={kycRequired === 'true' ? 'success' : 'warning'}>{kycRequired === 'true' ? 'Required' : 'Optional'}</Badge>
                <Button variant="ghost" size="xs" onClick={() => settingsMut.mutate({ kyc_required_for_withdrawal: kycRequired === 'true' ? 'false' : 'true' })}>
                  Toggle
                </Button>
              </div>
            </div>
            <div className="flex items-end">
              <Button size="sm" onClick={() => riskMut.mutate(riskForm)} disabled={riskMut.isPending}>
                {riskMut.isPending ? 'Saving...' : 'Save Risk'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ====== SECTION 5: SECURITY ====== */}
      <Card>
        <CardHeader>
          <SectionHeader icon={Lock} title="Security Policies" color="bg-blue-500/15 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* 2FA Policy */}
            <div>
              <p className="text-sm font-medium text-admin-text mb-2">2FA Enforcement</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <ToggleRow label="Login 2FA" active={twofa?.require2faLogin ?? false}
                  onToggle={() => twofaMut.mutate({ require2faLogin: !twofa?.require2faLogin })} loading={twofaMut.isPending} />
                <ToggleRow label="Withdrawal 2FA" active={twofa?.require2faWithdrawal ?? false}
                  onToggle={() => twofaMut.mutate({ require2faWithdrawal: !twofa?.require2faWithdrawal })} loading={twofaMut.isPending} />
                <ToggleRow label="API Trading 2FA" active={twofa?.require2faApiTrading ?? false}
                  onToggle={() => twofaMut.mutate({ require2faApiTrading: !twofa?.require2faApiTrading })} loading={twofaMut.isPending} />
              </div>
            </div>

            {/* Geo-blocking */}
            <div>
              <p className="text-sm font-medium text-admin-text mb-2">Geo-Blocking</p>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="block text-xs text-admin-muted mb-1">Blocked Countries (ISO CSV)</label>
                  <input type="text" defaultValue={geoBlocked} id="geo-input"
                    className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text font-mono" />
                </div>
                <Button size="sm" onClick={() => {
                  const v = (document.getElementById('geo-input') as HTMLInputElement)?.value ?? '';
                  settingsMut.mutate({ GEO_BLOCKED_COUNTRIES: v });
                }}>Save</Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ====== SECTION 6: FEATURE FLAGS ====== */}
      <Card>
        <CardHeader>
          <SectionHeader icon={Settings} title="Feature Flags" color="bg-admin-muted/15 text-admin-muted" />
          <p className="text-xs text-admin-muted">Toggle features dynamically. Full config in <a href="/settings/system" className="text-admin-primary hover:underline">System Settings</a>.</p>
        </CardHeader>
        <CardContent>
          {features.length === 0 ? (
            <p className="text-sm text-admin-muted py-4 text-center">No feature flags loaded.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {features.slice(0, 12).map((f) => (
                <div key={f.id} className="flex items-center justify-between rounded-lg border border-admin-border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-admin-text truncate">{f.feature_key.replace(/_/g, ' ')}</p>
                    <Badge variant={f.status === 'enabled' ? 'success' : 'default'} className="mt-0.5">{f.status}</Badge>
                  </div>
                  <button
                    onClick={() => featureMut.mutate({ id: f.id, status: f.status === 'enabled' ? 'disabled' : 'enabled' })}
                    disabled={featureMut.isPending}
                    className="shrink-0"
                  >
                    {f.status === 'enabled' ? (
                      <ToggleRight className="h-6 w-6 text-admin-success" />
                    ) : (
                      <ToggleLeft className="h-6 w-6 text-admin-muted" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Modal */}
      <ConfirmModal
        open={!!confirm}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        danger={confirm?.danger}
        onClose={() => setConfirm(null)}
        onConfirm={() => { confirm?.action(); setConfirm(null); }}
        loading={haltMut.isPending || walletMut.isPending || emergencyMut.isPending || safeModeMut.isPending}
      />
    </div>
  );
}
