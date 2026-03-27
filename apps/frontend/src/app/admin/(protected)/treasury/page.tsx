'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import {
  AdminChartCard,
  DepositWithdrawChart,
  TopMarketsChart,
  SettlementThroughputChart,
} from '@/components/admin/charts';
import { AdminMetricCard } from '@/components/admin/dashboard/AdminMetricCard';
import { Wallet, ArrowUpFromLine, Loader2, RefreshCw, Shield } from 'lucide-react';
import { useAdminMetricsWs } from '@/hooks/useAdminMetricsWs';

const API_URL = getApiBaseUrl();

interface HotWalletBalance {
  chainId: string;
  chainName?: string;
  symbol: string;
  balance: string;
}

interface WithdrawalQueueItem {
  id: string;
  status: string;
  amount: string;
  created_at: string;
}

interface SweepStatus {
  count: number;
  lastRun?: string;
}

interface ColdWallet {
  chainId: string;
  chainName?: string;
  address: string | null;
  balance: string | null;
}

export default function TreasuryDashboardPage() {
  const { accessToken } = useAdminAuthStore();
  const [hotBalances, setHotBalances] = useState<HotWalletBalance[]>([]);
  const [withdrawalQueue, setWithdrawalQueue] = useState<WithdrawalQueueItem[]>([]);
  const [sweepStatus, setSweepStatus] = useState<SweepStatus | null>(null);
  const [coldWallets, setColdWallets] = useState<ColdWallet[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!accessToken) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [balRes, wdRes, sweepsRes, wdStatsRes, fundsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/admin/hot-wallets/balances`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        fetch(`${API_URL}/api/v1/admin/withdrawals?status=pending&limit=10`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        fetch(`${API_URL}/api/v1/admin/deposit-sweeps?limit=5`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        fetch(`${API_URL}/api/v1/admin/withdrawals?limit=1`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        fetch(`${API_URL}/api/v1/admin/funds/summary`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      ]);
      const balData = await balRes.json();
      const wdData = await wdRes.json();
      const sweepsData = await sweepsRes.json();
      const wdStatsData = await wdStatsRes.json();
      const fundsData = await fundsRes.json();

      if (balData?.success && Array.isArray(balData.data)) {
        const list = balData.data as { chain_id?: string; chain_name?: string; symbol?: string; balance?: string }[];
        setHotBalances(
          list.map((b) => ({
            chainId: b.chain_id ?? '',
            chainName: b.chain_name,
            symbol: b.symbol ?? '—',
            balance: b.balance ?? '0',
          }))
        );
      }
      if (wdData?.success && wdData?.data?.withdrawals) {
        setWithdrawalQueue(wdData.data.withdrawals);
      }
      if (sweepsData?.success && sweepsData?.data?.sweeps) {
        setSweepStatus({ count: sweepsData.data.sweeps.length });
      }
      if (wdStatsData?.success && wdStatsData?.data?.stats) {
        setPendingCount(wdStatsData.data.stats.pending_approval ?? wdStatsData.data.stats.pending ?? 0);
      }
      if (fundsData?.success && Array.isArray(fundsData?.data?.on_chain_totals?.cold_wallets)) {
        const list = fundsData.data.on_chain_totals.cold_wallets as { chain_id?: string; chain_name?: string; address?: string | null; balance?: string | null }[];
        setColdWallets(list.map((c) => ({
          chainId: c.chain_id ?? '',
          chainName: c.chain_name,
          address: c.address ?? null,
          balance: c.balance ?? null,
        })));
      }
    } catch (e) {
      console.error('Treasury fetch error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useAdminMetricsWs({
    deposit_confirmed: () => void fetchData(true),
    withdrawal_requested: () => void fetchData(true),
  });

  if (loading && !hotBalances.length) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 admin-accent-blue animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">Treasury Dashboard</h1>
          <p className="text-sm admin-metric-label mt-0.5">
            Hot wallet balances, withdrawal queue, deposit sweep status
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 hover:bg-white/5 transition-colors admin-metric-value text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <section>
        <h2 className="text-xs font-semibold admin-metric-label uppercase tracking-wider mb-3">
          Overview
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <AdminMetricCard
            label="Hot wallets"
            value={hotBalances.length}
            sublabel="chains"
            icon={<Wallet className="w-5 h-5" />}
            href="/admin/wallets/hot"
          />
          <AdminMetricCard
            label="Pending approvals"
            value={pendingCount}
            sublabel="withdrawals"
            icon={<ArrowUpFromLine className="w-5 h-5" />}
            variant={pendingCount > 0 ? 'warning' : 'default'}
            href="/admin/withdrawals/pending-approval"
          />
          <AdminMetricCard
            label="Withdrawal queue"
            value={withdrawalQueue.length}
            sublabel="recent"
            icon={<ArrowUpFromLine className="w-5 h-5" />}
            href="/admin/withdrawals"
          />
          <AdminMetricCard
            label="Sweep status"
            value={sweepStatus?.count ?? 0}
            sublabel="recent sweeps"
            icon={<Shield className="w-5 h-5" />}
            href="/admin/wallets/deposit-sweeps"
          />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="admin-card p-4">
          <h3 className="text-sm font-semibold admin-metric-value mb-3">Hot wallet balances</h3>
          {hotBalances.length === 0 ? (
            <p className="text-sm admin-metric-label py-4">No balances loaded</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {hotBalances.map((b) => (
                <div
                  key={`${b.chainId}-${b.symbol}`}
                  className="flex justify-between items-center py-2 border-b border-white/5 last:border-0"
                >
                  <span className="admin-metric-value text-sm">
                    {b.chainName ?? b.chainId} · {b.symbol}
                  </span>
                  <span className="admin-accent-green font-mono text-sm">{b.balance}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="admin-card p-4">
          <h3 className="text-sm font-semibold admin-metric-value mb-3">Cold wallet reserves</h3>
          {coldWallets.length === 0 ? (
            <p className="text-sm admin-metric-label py-4">No cold wallet data</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {coldWallets.map((c, i) => (
                <div
                  key={`${c.chainId}-${i}`}
                  className="flex justify-between items-center py-2 border-b border-white/5 last:border-0"
                >
                  <span className="admin-metric-value text-sm">
                    {c.chainName ?? c.chainId} · {c.address ? `${c.address.slice(0, 6)}…` : '—'}
                  </span>
                  <span className="admin-accent-blue font-mono text-sm">{c.balance ?? '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="admin-card p-4">
          <h3 className="text-sm font-semibold admin-metric-value mb-3">Recent withdrawal queue</h3>
          {withdrawalQueue.length === 0 ? (
            <p className="text-sm admin-metric-label py-4">No pending withdrawals</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {withdrawalQueue.slice(0, 5).map((w) => (
                <div
                  key={w.id}
                  className="flex justify-between items-center py-2 border-b border-white/5 last:border-0"
                >
                  <span className="admin-metric-label text-xs font-mono">{w.id.slice(0, 8)}…</span>
                  <span className="admin-metric-value text-sm">{w.amount}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <section>
        <h2 className="text-xs font-semibold admin-metric-label uppercase tracking-wider mb-3">
          Treasury analytics
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <AdminChartCard title="Deposit vs withdrawal" subtitle="7d">
            <DepositWithdrawChart />
          </AdminChartCard>
          <AdminChartCard title="Reserve distribution" subtitle="By asset">
            <TopMarketsChart />
          </AdminChartCard>
          <AdminChartCard title="Settlement throughput" subtitle="24h">
            <SettlementThroughputChart />
          </AdminChartCard>
        </div>
      </section>
    </div>
  );
}
