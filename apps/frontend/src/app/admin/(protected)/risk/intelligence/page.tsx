'use client';

import Link from 'next/link';
import {
  useMmRisk,
  useAmlDashboard,
  useAmlAlerts,
  useAmlAlertsTimeSeries,
  useSecurityDashboard,
  useWithdrawalsList,
} from '@/hooks/admin/useAdminDashboard';
import { KPICard } from '@/components/admin/v2/dashboard/KPICard';
import {
  Activity,
  AlertTriangle,
  ArrowUpFromLine,
  ShieldAlert,
  TrendingUp,
  ExternalLink,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const LARGE_WITHDRAWAL_THRESHOLD = 10000;

function formatVolume(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(2);
}

/** Panel wrapper matching RiskSecurityPanel styling */
function RiskPanel({
  title,
  href,
  children,
}: { title: string; href?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--admin-radius)] border border-[var(--admin-card-border)] bg-white p-4 shadow-[var(--admin-shadow)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--admin-text)]">{title}</h3>
        {href && (
          <Link href={href} className="text-xs font-medium text-[var(--admin-primary)] hover:underline">
            View all <ExternalLink className="w-3 h-3 inline ml-0.5" />
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

export default function RiskIntelligencePage() {
  const { data: mmRiskData } = useMmRisk();
  const { data: amlDashboardData } = useAmlDashboard();
  const { data: amlAlertsData } = useAmlAlerts({ status: 'open', limit: 10 });
  const { data: amlTimeSeriesData } = useAmlAlertsTimeSeries('7d');
  const { data: securityData } = useSecurityDashboard();
  const { data: withdrawalsData } = useWithdrawalsList({ limit: 100 });

  const mmRisk = mmRiskData?.data as {
    topTraders?: { userId: string; volume24h: string }[];
    emergencyStoppedUsers?: string[];
  } | undefined;
  const amlDashboard = amlDashboardData?.data;
  const amlAlerts = (amlAlertsData?.data?.alerts ?? []) as Array<{
    id: string;
    user_id: string;
    alert_type: string;
    severity: string;
    status: string;
    created_at: string;
  }>;
  const buckets = (amlTimeSeriesData?.data?.buckets ?? []) as Array<{ bucket: string; count: string }>;
  const security = securityData?.data;
  const withdrawals = (withdrawalsData?.data?.withdrawals ?? []) as Array<{
    id: string;
    user_id: string;
    amount: string;
    currency_symbol: string;
    status: string;
    created_at: string;
    email?: string;
  }>;

  const topTraders = mmRisk?.topTraders ?? [];
  const largeWithdrawals = withdrawals.filter(
    (w) => parseFloat(String(w.amount ?? 0)) >= LARGE_WITHDRAWAL_THRESHOLD
  ).slice(0, 10);
  const suspiciousAlerts = amlAlerts.filter(
    (a) => ['wash_trade_suspected', 'spoofing_suspected', 'market_manipulation'].includes(a.alert_type)
  );

  const amlChartData = buckets.map((b) => ({
    name: b.bucket?.slice(0, 10) ?? '—',
    count: parseInt(b.count ?? '0', 10),
  }));

  const openAlertsCount = amlDashboard?.alertsOpen ?? 0;
  const highSeverityCount = amlDashboard?.alertsOpenHighSeverity ?? 0;
  const pendingApproval = security?.withdrawals?.pendingAdminApproval ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--admin-text)]">Risk Intelligence</h1>
        <p className="text-sm text-[var(--admin-text-muted)] mt-0.5">
          Whale activity, suspicious trading, large withdrawals, AML scores, and fraud alerts
        </p>
      </div>

      {/* Row 1 – KPI summary */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard
          title="Whale traders (24h)"
          value={topTraders.length}
          changeLabel="Top by volume"
          icon={<TrendingUp className="w-5 h-5" />}
          accent="primary"
        />
        <KPICard
          title="Suspicious trading"
          value={suspiciousAlerts.length}
          changeLabel="Wash / spoofing"
          icon={<Activity className="w-5 h-5" />}
          accent={suspiciousAlerts.length > 0 ? 'warning' : 'neutral'}
        />
        <KPICard
          title="Large withdrawals"
          value={largeWithdrawals.length}
          changeLabel={`≥ ${(LARGE_WITHDRAWAL_THRESHOLD / 1e3).toFixed(0)}k`}
          icon={<ArrowUpFromLine className="w-5 h-5" />}
          href="/admin/withdrawals"
          accent={largeWithdrawals.length > 0 ? 'warning' : 'neutral'}
        />
        <KPICard
          title="AML risk (open)"
          value={openAlertsCount}
          changeLabel={`${highSeverityCount} high`}
          icon={<ShieldAlert className="w-5 h-5" />}
          href="/admin/compliance/alerts"
          accent={openAlertsCount > 0 ? 'danger' : 'neutral'}
        />
        <KPICard
          title="Fraud alerts"
          value={highSeverityCount}
          changeLabel="High severity"
          icon={<AlertTriangle className="w-5 h-5" />}
          href="/admin/compliance/alerts?severity=high"
          accent={highSeverityCount > 0 ? 'danger' : 'neutral'}
        />
      </section>

      {/* Row 2 – Whale Activity */}
      <RiskPanel title="Whale Activity" href="/admin/monitoring/mm-risk">
        {topTraders.length === 0 ? (
          <p className="text-sm text-[var(--admin-text-muted)] py-4">No high-volume traders in last 24h.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--admin-card-border)] text-left text-[var(--admin-text-muted)]">
                  <th className="py-2 pr-3 font-medium">User</th>
                  <th className="py-2 pr-3 font-medium text-right">Volume 24h</th>
                  <th className="py-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {topTraders.slice(0, 8).map((t) => (
                  <tr key={t.userId} className="border-b border-[var(--admin-card-border)]/60">
                    <td className="py-2 pr-3 font-mono text-[var(--admin-text)]">{t.userId.slice(0, 8)}…</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-[var(--admin-text)]">
                      {formatVolume(parseFloat(t.volume24h || '0'))}
                    </td>
                    <td className="py-2">
                      <Link
                        href={`/admin/users/${t.userId}`}
                        className="text-[var(--admin-primary)] hover:underline text-xs"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </RiskPanel>

      {/* Row 3 – Suspicious Trading */}
      <RiskPanel title="Suspicious Trading" href="/admin/compliance/alerts">
        {suspiciousAlerts.length === 0 ? (
          <p className="text-sm text-[var(--admin-text-muted)] py-4">No wash trade or spoofing alerts.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--admin-card-border)] text-left text-[var(--admin-text-muted)]">
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">User</th>
                  <th className="py-2 pr-3 font-medium">Severity</th>
                  <th className="py-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {suspiciousAlerts.slice(0, 8).map((a) => (
                  <tr key={a.id} className="border-b border-[var(--admin-card-border)]/60">
                    <td className="py-2 pr-3 text-[var(--admin-text)]">{a.alert_type.replace(/_/g, ' ')}</td>
                    <td className="py-2 pr-3 font-mono text-[var(--admin-text)]">{a.user_id.slice(0, 8)}…</td>
                    <td className="py-2 pr-3">
                      <span
                        className={
                          a.severity === 'high' || a.severity === 'critical'
                            ? 'text-[var(--admin-danger)] font-medium'
                            : 'text-[var(--admin-text-muted)]'
                        }
                      >
                        {a.severity}
                      </span>
                    </td>
                    <td className="py-2">
                      <Link
                        href={`/admin/compliance/alerts/${a.id}`}
                        className="text-[var(--admin-primary)] hover:underline text-xs"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </RiskPanel>

      {/* Row 4 – Large Withdrawals */}
      <RiskPanel title="Large Withdrawals" href="/admin/withdrawals">
        {largeWithdrawals.length === 0 ? (
          <p className="text-sm text-[var(--admin-text-muted)] py-4">No withdrawals above threshold in recent list.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--admin-card-border)] text-left text-[var(--admin-text-muted)]">
                  <th className="py-2 pr-3 font-medium">Amount</th>
                  <th className="py-2 pr-3 font-medium">Asset</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium text-right">Created</th>
                  <th className="py-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {largeWithdrawals.slice(0, 8).map((w) => (
                  <tr key={w.id} className="border-b border-[var(--admin-card-border)]/60">
                    <td className="py-2 pr-3 font-mono tabular-nums text-[var(--admin-text)]">
                      {parseFloat(w.amount).toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 text-[var(--admin-text)]">{w.currency_symbol}</td>
                    <td className="py-2 pr-3 text-[var(--admin-text)]">{w.status}</td>
                    <td className="py-2 pr-3 text-right text-[var(--admin-text-muted)] text-xs">
                      {w.created_at ? new Date(w.created_at).toLocaleString() : '—'}
                    </td>
                    <td className="py-2">
                      <Link href="/admin/withdrawals" className="text-[var(--admin-primary)] hover:underline text-xs">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </RiskPanel>

      {/* Row 5 – AML Risk Scores + Chart */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RiskPanel title="AML Risk Scores" href="/admin/compliance/alerts">
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--admin-hover-bg)]">
              <span className="text-sm text-[var(--admin-text)]">Open alerts</span>
              <span className="text-sm font-semibold tabular-nums text-[var(--admin-text)]">{openAlertsCount}</span>
            </div>
            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--admin-hover-bg)]">
              <span className="text-sm text-[var(--admin-text)]">High severity</span>
              <span className="text-sm font-semibold tabular-nums text-[var(--admin-danger)]">{highSeverityCount}</span>
            </div>
            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--admin-hover-bg)]">
              <span className="text-sm text-[var(--admin-text)]">Pending STR</span>
              <span className="text-sm font-semibold tabular-nums text-[var(--admin-text)]">
                {amlDashboard?.strPending ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--admin-hover-bg)]">
              <span className="text-sm text-[var(--admin-text)]">Pending withdrawal approval</span>
              <span className="text-sm font-semibold tabular-nums text-[var(--admin-text)]">{pendingApproval}</span>
            </div>
          </div>
        </RiskPanel>
        <RiskPanel title="AML Alerts (7d)">
          <div className="h-[220px]">
            {amlChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={amlChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--admin-text-muted)' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--admin-text-muted)' }} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--admin-card-bg)',
                      border: '1px solid var(--admin-card-border)',
                      borderRadius: 'var(--admin-radius)',
                    }}
                  />
                  <Bar dataKey="count" fill="var(--admin-danger)" radius={[4, 4, 0, 0]} name="Alerts" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-[var(--admin-text-muted)]">
                No alert data
              </div>
            )}
          </div>
        </RiskPanel>
      </section>

      {/* Row 6 – Fraud Alerts table */}
      <RiskPanel title="Fraud Alerts" href="/admin/compliance/alerts">
        {amlAlerts.length === 0 ? (
          <p className="text-sm text-[var(--admin-text-muted)] py-4">No open alerts.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--admin-card-border)] text-left text-[var(--admin-text-muted)]">
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">User</th>
                  <th className="py-2 pr-3 font-medium">Severity</th>
                  <th className="py-2 pr-3 font-medium text-right">Created</th>
                  <th className="py-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {amlAlerts.slice(0, 10).map((a) => (
                  <tr key={a.id} className="border-b border-[var(--admin-card-border)]/60">
                    <td className="py-2 pr-3 text-[var(--admin-text)]">{a.alert_type.replace(/_/g, ' ')}</td>
                    <td className="py-2 pr-3 font-mono text-[var(--admin-text)]">{a.user_id.slice(0, 8)}…</td>
                    <td className="py-2 pr-3">
                      <span
                        className={
                          a.severity === 'high' || a.severity === 'critical'
                            ? 'text-[var(--admin-danger)] font-medium'
                            : 'text-[var(--admin-text-muted)]'
                        }
                      >
                        {a.severity}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right text-[var(--admin-text-muted)] text-xs">
                      {a.created_at ? new Date(a.created_at).toLocaleString() : '—'}
                    </td>
                    <td className="py-2">
                      <Link
                        href={`/admin/compliance/alerts/${a.id}`}
                        className="text-[var(--admin-primary)] hover:underline text-xs"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </RiskPanel>
    </div>
  );
}
