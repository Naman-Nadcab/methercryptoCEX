'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  SectionHeader,
  MetricWidget,
  ActionButton,
  DataTableContainer,
  DataTableHead,
  DataTableTh,
  DataTableBody,
  DataTableRow,
  DataTableCell,
  StatusBadge,
} from '@/components/admin/control-plane';
import { Loader2, AlertTriangle } from 'lucide-react';
import { formatAmountAdmin } from '@/lib/utils';

interface WalletRow {
  id: string;
  chainId: string;
  chainName: string;
  chainSlug?: string;
  chainType?: string;
  address: string;
  balanceCache: string;
  isActive: boolean;
}

interface WalletStats {
  total_wallets: number;
  active_wallets: number;
  disabled_wallets: number;
}

function deriveStats(wallets: WalletRow[]): WalletStats {
  const active = wallets.filter((w) => w.isActive).length;
  return {
    total_wallets: wallets.length,
    active_wallets: active,
    disabled_wallets: wallets.length - active,
  };
}

function truncateAddress(addr: string, len = 6): string {
  if (!addr) return '—';
  if (addr.length <= len * 2 + 2) return addr;
  return `${addr.slice(0, len)}…${addr.slice(-len)}`;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function FundsWalletControlPlane() {
  const { accessToken } = useAdminAuthStore();
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [stats, setStats] = useState<WalletStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [actingId, setActingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<WalletRow | null>(null);

  const fetchWallets = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/hot-wallets`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await res.json();
      if (!result?.success) return;
      const raw = result.data;
      const list: WalletRow[] = Array.isArray(raw)
        ? raw.map((w: Record<string, unknown>) => ({
            id: String(w.id ?? ''),
            chainId: String(w.chainId ?? w.chain_id ?? ''),
            chainName: String(w.chainName ?? w.chain_name ?? '—'),
            chainSlug: w.chainSlug != null ? String(w.chainSlug) : undefined,
            chainType: w.chainType != null ? String(w.chainType) : undefined,
            address: String(w.address ?? ''),
            balanceCache: String(w.balanceCache ?? w.balance_cache ?? '0'),
            isActive: Boolean(w.isActive ?? w.is_active ?? true),
          }))
        : [];
      setWallets(list);
      setStats(result.data?.stats ?? deriveStats(list));
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  const filtered = wallets.filter((w) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'active') return w.isActive;
    if (statusFilter === 'disabled') return !w.isActive;
    return true;
  });

  const handleToggle = async (chainId: string, isActive: boolean) => {
    if (!accessToken) return;
    setToggleError(null);
    setActingId(chainId);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/admin/hot-wallets/${encodeURIComponent(chainId)}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ isActive }),
        }
      );
      const data = await res.json();
      if (data?.success != null) {
        setConfirmDisable(null);
        await fetchWallets();
      } else {
        setToggleError(data?.error?.message ?? data?.error?.code ?? 'Update failed');
      }
    } catch {
      setToggleError('Request failed');
    } finally {
      setActingId(null);
    }
  };

  const totalWallets = stats?.total_wallets ?? 0;
  const activeWallets = stats?.active_wallets ?? 0;
  const disabledWallets = stats?.disabled_wallets ?? 0;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Funds & Wallet Control Plane"
        subtitle="Monitor hot wallets and operational state"
        action={
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 dark:text-white"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
            <ActionButton
              variant="secondary"
              onClick={() => fetchWallets()}
              loading={loading}
              icon={!loading ? <span className="text-xs">↻</span> : undefined}
            >
              Refresh
            </ActionButton>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <MetricWidget label="Total wallets" value={totalWallets} />
        <MetricWidget
          label="Active wallets"
          value={activeWallets}
          variant="positive"
          statusBadge={activeWallets > 0 ? 'LIVE' : undefined}
        />
        <MetricWidget
          label="Disabled wallets"
          value={disabledWallets}
          variant={disabledWallets > 0 ? 'warning' : 'neutral'}
        />
      </div>

      {toggleError && !confirmDisable && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300" role="alert">
          {toggleError}
        </div>
      )}
      <DataTableContainer
        title="Hot wallets"
        subtitle={`${filtered.length} shown`}
        emptyMessage="No hot wallets"
        isEmpty={!loading && filtered.length === 0}
      >
        <DataTableHead>
          <DataTableTh>Chain</DataTableTh>
          <DataTableTh>Asset</DataTableTh>
          <DataTableTh>Address</DataTableTh>
          <DataTableTh align="right">balance_cache</DataTableTh>
          <DataTableTh>Status</DataTableTh>
          <DataTableTh align="right">Actions</DataTableTh>
        </DataTableHead>
        <DataTableBody>
          {filtered.map((w) => (
            <DataTableRow key={w.id}>
              <DataTableCell>{w.chainName}</DataTableCell>
              <DataTableCell>{w.chainSlug ?? w.chainName ?? '—'}</DataTableCell>
              <DataTableCell mono className="max-w-[140px] truncate" title={w.address || undefined}>
                {truncateAddress(w.address)}
              </DataTableCell>
              <DataTableCell align="right" mono title={(w.balanceCache ?? '0').length > 20 ? (w.balanceCache ?? '0') : undefined}>
                {formatAmountAdmin(w.balanceCache ?? '0')}
              </DataTableCell>
              <DataTableCell>
                <StatusBadge
                  variant={w.isActive ? 'LIVE' : 'HALTED'}
                  label={w.isActive ? 'Active' : 'Disabled'}
                  showDot
                />
              </DataTableCell>
              <DataTableCell align="right">
                <div className="flex items-center justify-end gap-2">
                  <Link
                    href={`/admin/wallets/hot/${encodeURIComponent(w.chainId)}`}
                    className="text-xs font-medium text-blue-500 hover:text-blue-600 dark:text-blue-400"
                  >
                    Settings
                  </Link>
                  {w.isActive ? (
                    <ActionButton
                      variant="danger"
                      onClick={() => { setToggleError(null); setConfirmDisable(w); }}
                    >
                      Disable
                    </ActionButton>
                  ) : (
                    <ActionButton
                      variant="primary"
                      loading={actingId === w.chainId}
                      disabled={actingId != null && actingId !== w.chainId}
                      onClick={() => handleToggle(w.chainId, true)}
                    >
                      Enable
                    </ActionButton>
                  )}
                </div>
              </DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTableContainer>

      {loading && wallets.length === 0 && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
        </div>
      )}

      {confirmDisable && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="disable-wallet-title"
        >
          <div className="w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              <h2 id="disable-wallet-title" className="text-sm font-semibold text-gray-900 dark:text-white">
                Confirm disable hot wallet
              </h2>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <p className="text-gray-600 dark:text-gray-400">
                Disabling this wallet will stop it from being used for withdrawals. Withdrawals for this chain will fail until the wallet is re-enabled.
              </p>
              <div className="rounded-lg bg-gray-100 dark:bg-gray-800 p-3 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Chain</span>
                  <span className="text-gray-900 dark:text-white">{confirmDisable.chainName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Asset</span>
                  <span className="text-gray-900 dark:text-white">{confirmDisable.chainSlug ?? confirmDisable.chainName ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">balance_cache</span>
                  <span className="font-mono text-gray-900 dark:text-white tabular-nums" title={(confirmDisable.balanceCache ?? '0').length > 20 ? (confirmDisable.balanceCache ?? '0') : undefined}>
                    {formatAmountAdmin(confirmDisable.balanceCache ?? '0')}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-gray-500 dark:text-gray-400">Address</span>
                  <span className="font-mono text-xs text-gray-700 dark:text-gray-300 break-all" title={confirmDisable.address}>
                    {confirmDisable.address || '—'}
                  </span>
                </div>
              </div>
              {toggleError && (
                <p className="text-xs text-red-600 dark:text-red-400" role="alert">{toggleError}</p>
              )}
              <p className="text-amber-600 dark:text-amber-400 text-xs">
                This action is reversible by re-enabling the wallet.
              </p>
            </div>
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <ActionButton variant="secondary" onClick={() => { setConfirmDisable(null); setToggleError(null); }}>
                Back
              </ActionButton>
              <ActionButton
                variant="danger"
                loading={actingId === confirmDisable.chainId}
                disabled={actingId != null && actingId !== confirmDisable.chainId}
                onClick={() => handleToggle(confirmDisable.chainId, false)}
              >
                Disable wallet
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
