'use client';

import { useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getMonitoringMmRisk } from '@/lib/admin/trading';
import { getWithdrawals as getWithdrawalsFromWallets } from '@/lib/admin/wallets';
import { getUsers } from '@/lib/admin/users';
import { SectionHeader } from '@/components/admin/control-plane';
import { AdminMetricCard, AdminPanel, AdminDataTable } from '@/components/admin/ui';
import { DataTableTh, DataTableRow, DataTableCell } from '@/components/admin/control-plane';
import { Loader2, AlertTriangle, ArrowUpFromLine, Users, Activity } from 'lucide-react';
import Link from 'next/link';

export default function RiskMonitoringPage() {
  const { accessToken } = useAdminAuthStore();

  const { data: mmRiskData } = useQuery({
    queryKey: ['admin', 'monitoring-mm-risk'],
    queryFn: () => getMonitoringMmRisk(accessToken),
    enabled: !!accessToken,
  });

  const { data: withdrawalsData } = useQuery({
    queryKey: ['admin', 'withdrawals', 'large'],
    queryFn: () => getWithdrawalsFromWallets(accessToken, { limit: 50 }),
    enabled: !!accessToken,
  });

  const { data: usersData } = useQuery({
    queryKey: ['admin', 'users', 'risk'],
    queryFn: () => getUsers(accessToken, { limit: 100 }),
    enabled: !!accessToken,
  });

  const mmRisk = (mmRiskData?.data ?? {}) as Record<string, unknown>;
  const withdrawals = (withdrawalsData?.data as { withdrawals?: Array<Record<string, unknown>> })?.withdrawals ?? [];
  const users = (usersData?.data as { users?: Array<Record<string, unknown>> })?.users ?? [];

  const largeWithdrawals = withdrawals.filter(
    (w: Record<string, unknown>) => parseFloat(String(w.amount ?? 0)) > 10000
  ).slice(0, 10);
  const suspiciousCount = users.filter((u: Record<string, unknown>) => u.status === 'suspended' || u.risk_score).length;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Risk Monitoring"
        subtitle="Large withdrawals, suspicious accounts, anomalies"
      />

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <AdminMetricCard
          label="Large withdrawals"
          value={largeWithdrawals.length}
          sublabel="&gt; 10k threshold"
          icon={<ArrowUpFromLine className="w-4 h-4" />}
          variant={largeWithdrawals.length > 0 ? 'warning' : 'neutral'}
          href="/admin/withdrawals"
        />
        <AdminMetricCard
          label="Suspicious / flagged"
          value={suspiciousCount}
          sublabel="accounts"
          icon={<Users className="w-4 h-4" />}
          variant={suspiciousCount > 0 ? 'warning' : 'neutral'}
          href="/admin/users"
        />
        <AdminMetricCard
          label="MM risk alerts"
          value={mmRisk.alert ? 'Yes' : 'None'}
          sublabel="Market making"
          variant={mmRisk.alert ? 'danger' : 'neutral'}
          icon={<AlertTriangle className="w-4 h-4" />}
        />
        <AdminMetricCard
          label="High volume anomalies"
          value="—"
          sublabel="From analytics"
          icon={<Activity className="w-4 h-4" />}
        />
      </section>

      <AdminPanel title="Market making risk" subtitle="From monitoring/mm-risk">
        <pre className="text-xs text-muted-foreground overflow-auto max-h-48 bg-muted/30 rounded p-3">
          {JSON.stringify(mmRisk, null, 2) || 'No data'}
        </pre>
      </AdminPanel>

      <AdminDataTable
        title="Large withdrawals"
        subtitle="Withdrawals above threshold (sample)"
        isEmpty={largeWithdrawals.length === 0}
        emptyMessage="No large withdrawals in recent list."
      >
        {largeWithdrawals.length > 0 && (
          <>
            <thead>
              <tr className="border-b border-border">
                <DataTableTh>Amount</DataTableTh>
                <DataTableTh>Status</DataTableTh>
                <DataTableTh align="right">Created</DataTableTh>
              </tr>
            </thead>
            <tbody>
              {largeWithdrawals.map((w: Record<string, unknown>, i: number) => (
                <DataTableRow key={String(w.id ?? i)}>
                  <DataTableCell mono>{String(w.amount ?? '—')}</DataTableCell>
                  <DataTableCell>{String(w.status ?? '—')}</DataTableCell>
                  <DataTableCell align="right">{w.created_at ? new Date(String(w.created_at)).toLocaleString() : '—'}</DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </>
        )}
      </AdminDataTable>

      <p className="text-xs text-muted-foreground">
        For AML alerts and STR/CTR reports, see <Link href="/admin/compliance/alerts" className="text-primary hover:underline">Compliance → Alerts</Link>.
      </p>
    </div>
  );
}
