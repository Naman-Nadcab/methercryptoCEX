'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  SectionHeader,
  MetricWidget,
  Panel,
  StatusBadge,
  ActionButton,
} from '@/components/admin/control-plane';
import { Loader2, AlertTriangle } from 'lucide-react';

interface TradingHaltData {
  halted: boolean;
}

interface DashboardStatsData {
  users?: { total?: number; active?: number };
  withdrawals?: { pending?: number };
  p2p?: { openDisputes?: number };
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function SystemHealthRiskMonitor() {
  const { accessToken } = useAdminAuthStore();
  const [halted, setHalted] = useState<boolean | null>(null);
  const [stats, setStats] = useState<DashboardStatsData | null>(null);
  const [pendingWithdrawals, setPendingWithdrawals] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggleLoading, setToggleLoading] = useState(false);
  const [haltError, setHaltError] = useState<string | null>(null);
  const [confirmHalt, setConfirmHalt] = useState(false);

  const fetchHalt = useCallback(async () => {
    if (!accessToken) return null;
    const res = await fetch(`${API_URL}/api/v1/admin/trading-halt`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const result = await res.json();
    return result?.success && result?.data ? (result.data as TradingHaltData).halted : null;
  }, [accessToken]);

  const fetchStats = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [haltRes, statsRes, withdrawalsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/admin/trading-halt`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        fetch(`${API_URL}/api/v1/admin/dashboard/stats`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        fetch(`${API_URL}/api/v1/admin/withdrawals?limit=1`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      ]);
      const haltData = await haltRes.json();
      const statsData = await statsRes.json();
      const withdrawalsData = await withdrawalsRes.json();

      if (haltData?.success && haltData?.data != null) {
        setHalted((haltData.data as TradingHaltData).halted);
      }
      if (statsData?.success && statsData?.data) {
        setStats(statsData.data as DashboardStatsData);
      }
      if (withdrawalsData?.success && withdrawalsData?.data?.stats != null) {
        const pw = withdrawalsData.data.stats.pending_approval ?? withdrawalsData.data.stats.pending;
        setPendingWithdrawals(typeof pw === 'number' ? pw : parseInt(String(pw ?? '0'), 10));
      } else if (statsData?.success && (statsData.data as DashboardStatsData)?.withdrawals?.pending != null) {
        setPendingWithdrawals((statsData.data as DashboardStatsData).withdrawals!.pending!);
      } else {
        setPendingWithdrawals(0);
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleToggleHalt = async () => {
    if (!accessToken || halted === null) return;
    if (halted === false && !confirmHalt) return;
    setHaltError(null);
    setToggleLoading(true);
    setConfirmHalt(false);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/trading-halt`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ halted: !halted }),
      });
      const result = await res.json();
      if (result?.success && result?.data != null) {
        setHalted((result.data as TradingHaltData).halted);
      } else {
        setHaltError(result?.error?.message ?? result?.error?.code ?? 'Request failed');
      }
    } catch {
      setHaltError('Request failed');
    } finally {
      setToggleLoading(false);
    }
  };

  const activeUsers = stats?.users?.active ?? 0;
  const pendingWithdrawalsVal = pendingWithdrawals ?? stats?.withdrawals?.pending ?? 0;
  const openDisputes = stats?.p2p?.openDisputes ?? 0;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="System Health & Risk Monitor"
        subtitle="Operational status and risk signals"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Trading State" subtitle="Current exchange trading status">
          {loading && halted === null ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <StatusBadge
                  variant={halted === true ? 'HALTED' : 'LIVE'}
                  label={halted === true ? 'HALTED' : 'LIVE'}
                  showDot
                />
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {halted === true
                  ? 'Trading is halted. New orders and matching are disabled. Withdrawals may still be processed depending on configuration.'
                  : 'Trading is live. Orders are accepted and matching is active.'}
              </p>
            </div>
          )}
        </Panel>

        <Panel title="Controls" subtitle="Trading halt override">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ActionButton
                variant={halted === true ? 'primary' : 'danger'}
                loading={toggleLoading}
                onClick={halted === true ? handleToggleHalt : () => { setHaltError(null); setConfirmHalt(true); }}
                disabled={loading || halted === null}
              >
                {halted === true ? 'Resume trading' : 'Halt trading'}
              </ActionButton>
            </div>
            {haltError && (
              <p className="text-xs text-red-600 dark:text-red-400" role="alert">{haltError}</p>
            )}
          </div>
        </Panel>
      </div>

      {confirmHalt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="halt-trading-title"
        >
          <div className="w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              <h2 id="halt-trading-title" className="text-sm font-semibold text-gray-900 dark:text-white">
                Confirm halt trading
              </h2>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <p className="text-gray-600 dark:text-gray-400">
                New orders will be rejected until trading is resumed. This action is reversible.
              </p>
              {haltError && (
                <p className="text-xs text-red-600 dark:text-red-400" role="alert">{haltError}</p>
              )}
            </div>
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <ActionButton variant="secondary" onClick={() => { setConfirmHalt(false); setHaltError(null); }}>
                Back
              </ActionButton>
              <ActionButton
                variant="danger"
                loading={toggleLoading}
                disabled={toggleLoading}
                onClick={handleToggleHalt}
              >
                Halt trading
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      <Panel title="Risk signals" subtitle="Operational and risk metrics from backend">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <MetricWidget
            label="Pending withdrawals"
            value={loading ? '—' : pendingWithdrawalsVal}
            variant={pendingWithdrawalsVal > 0 ? 'warning' : 'neutral'}
            statusBadge={pendingWithdrawalsVal > 0 ? 'DEGRADED' : undefined}
          />
          <MetricWidget
            label="Open disputes"
            value={loading ? '—' : openDisputes}
            variant={openDisputes > 0 ? 'danger' : 'neutral'}
            statusBadge={openDisputes > 0 ? 'RISK' : undefined}
          />
          <MetricWidget
            label="Active users"
            value={loading ? '—' : activeUsers}
            sublabel="Sessions now"
          />
        </div>
      </Panel>
    </div>
  );
}
