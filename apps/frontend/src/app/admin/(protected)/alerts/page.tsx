'use client';

import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getTradingHalt } from '@/lib/admin/trading';
import { getWithdrawals } from '@/lib/admin/wallets';
import { getP2pDisputes } from '@/lib/admin/p2p';
import { getMonitoringMmRisk, getMonitoringCounters } from '@/lib/admin/trading';
import { useAdminMetricsWs, type AdminMetricsEvent } from '@/hooks/useAdminMetricsWs';
import { SectionHeader } from '@/components/admin/control-plane';
import { AdminPanel, AdminMetricCard } from '@/components/admin/ui';
import { AlertCircle, AlertTriangle, Info, Zap } from 'lucide-react';
import Link from 'next/link';

type Severity = 'info' | 'warning' | 'critical';
type Category = 'trading_engine' | 'liquidity' | 'withdrawal' | 'wallet' | 'system';

interface AlertItem {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  message: string;
  timestamp: number;
  link?: string;
}

const SEVERITY_CONFIG: Record<Severity, { icon: React.ReactNode; bg: string; border: string; label: string }> = {
  info: {
    icon: <Info className="w-4 h-4" />,
    bg: 'bg-[#2563EB]/10',
    border: 'border-[#2563EB]/30',
    label: 'Info',
  },
  warning: {
    icon: <AlertTriangle className="w-4 h-4" />,
    bg: 'bg-[#F59E0B]/10',
    border: 'border-[#F59E0B]/30',
    label: 'Warning',
  },
  critical: {
    icon: <AlertCircle className="w-4 h-4" />,
    bg: 'bg-[#EF4444]/10',
    border: 'border-[#EF4444]/30',
    label: 'Critical',
  },
};

const CATEGORY_LABELS: Record<Category, string> = {
  trading_engine: 'Trading engine',
  liquidity: 'Liquidity',
  withdrawal: 'Withdrawal',
  wallet: 'Wallet',
  system: 'System',
};

export default function AlertsPage() {
  const { accessToken } = useAdminAuthStore();
  const [liveAlerts, setLiveAlerts] = useState<AlertItem[]>([]);

  const { data: haltData } = useQuery({
    queryKey: ['admin', 'trading-halt', 'alerts'],
    queryFn: () => getTradingHalt(accessToken),
    enabled: !!accessToken,
    refetchInterval: 10000,
  });

  const { data: withdrawalsData } = useQuery({
    queryKey: ['admin', 'withdrawals', 'alerts'],
    queryFn: () => getWithdrawals(accessToken, { limit: 1 }),
    enabled: !!accessToken,
    refetchInterval: 15000,
  });

  const { data: disputesData } = useQuery({
    queryKey: ['admin', 'p2p-disputes', 'alerts'],
    queryFn: () => getP2pDisputes(accessToken, { limit: 10 }),
    enabled: !!accessToken,
    refetchInterval: 20000,
  });

  const { data: mmRiskData } = useQuery({
    queryKey: ['admin', 'monitoring-mm-risk', 'alerts'],
    queryFn: () => getMonitoringMmRisk(accessToken),
    enabled: !!accessToken,
    refetchInterval: 15000,
  });

  const { data: countersData } = useQuery({
    queryKey: ['admin', 'monitoring-counters', 'alerts'],
    queryFn: () => getMonitoringCounters(accessToken),
    enabled: !!accessToken,
    refetchInterval: 10000,
  });

  useAdminMetricsWs({
    withdrawal_requested: (ev: AdminMetricsEvent) => {
      setLiveAlerts((prev) => [
        {
          id: `ws-${ev.timestamp}-wd`,
          category: 'withdrawal',
          severity: 'info',
          title: 'Withdrawal requested',
          message: 'New withdrawal request received.',
          timestamp: ev.timestamp,
          link: '/admin/withdrawals',
        },
        ...prev.slice(0, 49),
      ]);
    },
    aml_alert_triggered: (ev: AdminMetricsEvent) => {
      setLiveAlerts((prev) => [
        {
          id: `ws-${ev.timestamp}-aml`,
          category: 'system',
          severity: 'critical',
          title: 'AML alert',
          message: String((ev.data as { reason?: string })?.reason ?? 'AML alert triggered'),
          timestamp: ev.timestamp,
          link: '/admin/compliance/alerts',
        },
        ...prev.slice(0, 49),
      ]);
    },
    trade_executed: () => {
      // Optional: low-priority info
    },
  });

  const derivedAlerts = useMemo(() => {
    const list: AlertItem[] = [];
    const now = Date.now();
    const halted = !!haltData?.data?.halted;
    if (halted) {
      list.push({
        id: 'derived-halt',
        category: 'trading_engine',
        severity: 'critical',
        title: 'Matching engine halted',
        message: 'Trading is paused. Resume from Engine Monitor.',
        timestamp: now,
        link: '/admin/trading/engine',
      });
    }
    const pendingWd = (withdrawalsData?.data as { stats?: { pending_approval?: number } })?.stats?.pending_approval ?? 0;
    if (pendingWd > 10) {
      list.push({
        id: 'derived-wd-queue',
        category: 'withdrawal',
        severity: 'warning',
        title: 'High withdrawal queue',
        message: `${pendingWd} withdrawals pending approval.`,
        timestamp: now,
        link: '/admin/withdrawals?status=pending_approval',
      });
    } else if (pendingWd > 0) {
      list.push({
        id: 'derived-wd-pending',
        category: 'withdrawal',
        severity: 'info',
        title: 'Withdrawals pending',
        message: `${pendingWd} withdrawal(s) awaiting approval.`,
        timestamp: now,
        link: '/admin/withdrawals',
      });
    }
    const disputes = (disputesData?.data as { disputes?: { status?: string }[] })?.disputes ?? [];
    const openDisputes = disputes.filter((d) => d.status !== 'resolved').length;
    if (openDisputes > 0) {
      list.push({
        id: 'derived-disputes',
        category: 'system',
        severity: openDisputes > 3 ? 'warning' : 'info',
        title: 'P2P disputes open',
        message: `${openDisputes} dispute(s) require attention.`,
        timestamp: now,
        link: '/admin/p2p/disputes',
      });
    }
    const mmRisk = mmRiskData?.data as Record<string, unknown> | undefined;
    if (mmRisk?.alert === true || (mmRisk?.risk_level as string) === 'high') {
      list.push({
        id: 'derived-mm-risk',
        category: 'liquidity',
        severity: 'warning',
        title: 'Market making risk',
        message: 'MM risk or liquidity alert. Check Liquidity Monitor.',
        timestamp: now,
        link: '/admin/trading/liquidity',
      });
    }
    const counters = countersData?.data as Record<string, unknown> | undefined;
    const tps = Number(counters?.trades_per_second ?? counters?.tradesPerSecond ?? 0);
    if (tps > 500) {
      list.push({
        id: 'derived-engine-load',
        category: 'trading_engine',
        severity: 'warning',
        title: 'High engine load',
        message: `Trades/sec: ${tps}. Monitor for stability.`,
        timestamp: now,
        link: '/admin/trading/engine',
      });
    }
    return list;
  }, [haltData, withdrawalsData, disputesData, mmRiskData, countersData]);

  const allAlerts = useMemo(() => {
    const combined = [...liveAlerts];
    const seen = new Set(liveAlerts.map((a) => a.id));
    derivedAlerts.forEach((a) => {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        combined.push(a);
      }
    });
    return combined.sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);
  }, [liveAlerts, derivedAlerts]);

  const criticalCount = allAlerts.filter((a) => a.severity === 'critical').length;
  const warningCount = allAlerts.filter((a) => a.severity === 'warning').length;
  const infoCount = allAlerts.filter((a) => a.severity === 'info').length;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Real-time Alert Center"
        subtitle="Trading engine, liquidity, withdrawal, wallet, and system alerts"
      />

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <AdminMetricCard
          label="Critical"
          value={criticalCount}
          sublabel="alerts"
          icon={<AlertCircle className="w-4 h-4" />}
          variant={criticalCount > 0 ? 'danger' : 'neutral'}
        />
        <AdminMetricCard
          label="Warning"
          value={warningCount}
          sublabel="alerts"
          icon={<AlertTriangle className="w-4 h-4" />}
          variant={warningCount > 0 ? 'warning' : 'neutral'}
        />
        <AdminMetricCard
          label="Info"
          value={infoCount}
          sublabel="alerts"
          icon={<Info className="w-4 h-4" />}
        />
        <AdminMetricCard
          label="Total active"
          value={allAlerts.length}
          sublabel="alerts"
          icon={<Zap className="w-4 h-4" />}
        />
      </section>

      <AdminPanel title="Alert categories" subtitle="Trading engine, liquidity, withdrawal, wallet, system">
        <p className="text-sm text-[#6B7280]">
          Alerts are derived from trading halt, withdrawal queue, P2P disputes, MM risk, and engine counters. Real-time events (withdrawal requests, AML) are added via WebSocket when connected.
        </p>
      </AdminPanel>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-[#111827]">Alerts</h2>
        {allAlerts.length === 0 ? (
          <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-8 text-center text-sm text-[#6B7280]">
            No active alerts. System status normal.
          </div>
        ) : (
          <ul className="space-y-2">
            {allAlerts.map((alert) => {
              const config = SEVERITY_CONFIG[alert.severity];
              const categoryLabel = CATEGORY_LABELS[alert.category];
              return (
                <li key={alert.id}>
                  <div
                    className={`rounded-xl border p-4 ${config.bg} ${config.border} flex items-start gap-3 transition-shadow hover:shadow-sm`}
                  >
                    <span className="text-[#111827] mt-0.5">{config.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium uppercase text-muted-foreground">
                          {categoryLabel}
                        </span>
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${config.bg} ${config.border}`}>
                          {config.label}
                        </span>
                      </div>
                      <p className="font-medium text-[#111827] mt-1">{alert.title}</p>
                      <p className="text-sm text-[#6B7280] mt-0.5">{alert.message}</p>
                      <p className="text-[11px] text-[#6B7280] mt-2">
                        {new Date(alert.timestamp).toLocaleString()}
                        {alert.link && (
                          <>
                            {' · '}
                            <Link href={alert.link} className="text-[#2563EB] hover:underline">
                              View
                            </Link>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-xs text-[#6B7280]">
        Polling: trading halt, withdrawals, disputes, MM risk, counters. WebSocket: withdrawal_requested, aml_alert_triggered. RPC node and other system alerts require backend integration.
      </p>
    </div>
  );
}
