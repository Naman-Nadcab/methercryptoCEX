'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getWithdrawals } from '@/lib/admin/wallets';
import { getUsers } from '@/lib/admin/users';
import { adminFetch } from '@/lib/admin';
import { SectionHeader } from '@/components/admin/control-plane';
import { AdminMetricCard, AdminPanel, AdminDataTable, AdminStatusBadge } from '@/components/admin/ui';
import { DataTableTh, DataTableRow, DataTableCell } from '@/components/admin/control-plane';
import { AlertTriangle, ArrowUpFromLine, Loader2, Check, X } from 'lucide-react';
import Link from 'next/link';

const LARGE_AMOUNT_THRESHOLD = 50000;
const HIGH_RISK_COUNTRIES = ['XX']; // Placeholder: extend from backend if available

function computeRiskScore(w: Record<string, unknown>, recentCount: number): number {
  let score = 0;
  const amount = parseFloat(String(w.amount ?? w.net_amount ?? 0));
  if (amount >= LARGE_AMOUNT_THRESHOLD) score += 40;
  else if (amount >= LARGE_AMOUNT_THRESHOLD / 2) score += 20;
  if (recentCount > 3) score += 30;
  const country = String(w.country ?? w.user_country ?? '').toUpperCase();
  if (HIGH_RISK_COUNTRIES.includes(country)) score += 30;
  if (w.new_device === true || w.is_new_device === true) score += 20;
  return Math.min(100, score);
}

export default function WithdrawalRiskPage() {
  const { accessToken } = useAdminAuthStore();
  const queryClient = useQueryClient();
  const [actingId, setActingId] = useState<string | null>(null);

  const { data: withdrawalsRes, isLoading } = useQuery({
    queryKey: ['admin', 'withdrawals', 'risk'],
    queryFn: () => getWithdrawals(accessToken, { limit: 100, status: 'pending_approval' }),
    enabled: !!accessToken,
  });

  const { data: allWithdrawalsRes } = useQuery({
    queryKey: ['admin', 'withdrawals', 'all-for-risk'],
    queryFn: () => getWithdrawals(accessToken, { limit: 200 }),
    enabled: !!accessToken,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => adminFetch(`/withdrawals/${id}/approve`, { method: 'POST', token: accessToken }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'withdrawals'] });
      setActingId(null);
    },
    onSettled: () => setActingId(null),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminFetch(`/withdrawals/${id}/reject`, { method: 'POST', token: accessToken, body: { reason } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'withdrawals'] });
      setActingId(null);
    },
    onSettled: () => setActingId(null),
  });

  const withdrawals = (withdrawalsRes?.data as { withdrawals?: Array<Record<string, unknown>> })?.withdrawals ?? [];
  const allWithdrawals = (allWithdrawalsRes?.data as { withdrawals?: Array<Record<string, unknown>> })?.withdrawals ?? [];
  const pendingCount = withdrawals.length;
  const byUser = useMemo(() => {
    const m = new Map<string, number>();
    allWithdrawals.forEach((w) => {
      const uid = String(w.user_id ?? w.userId ?? '');
      m.set(uid, (m.get(uid) ?? 0) + 1);
    });
    return m;
  }, [allWithdrawals]);

  const rows = useMemo(() => {
    return withdrawals.map((w) => {
      const userId = String(w.user_id ?? w.userId ?? '');
      const recentCount = byUser.get(userId) ?? 1;
      const riskScore = computeRiskScore(w, recentCount);
      return {
        id: String(w.id ?? ''),
        user: String(w.email ?? w.username ?? userId),
        userId,
        token: String(w.currency_symbol ?? w.asset ?? w.token_symbol ?? '—'),
        amount: String(w.amount ?? w.net_amount ?? '0'),
        country: String(w.country ?? w.user_country ?? '—'),
        device: String(w.device ?? w.user_agent ?? '—').slice(0, 20),
        riskScore,
        status: String(w.status ?? 'pending_approval'),
        isHighRisk: riskScore >= 50,
      };
    });
  }, [withdrawals, byUser]);

  const highRiskCount = rows.filter((r) => r.isHighRisk).length;
  const stats = (withdrawalsRes?.data as { stats?: { pending_approval?: number } })?.stats;

  if (isLoading && rows.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Withdrawal Risk Engine"
        subtitle="Detect high-risk withdrawals — large amount, new device, multiple in short time, high-risk country"
      />

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <AdminMetricCard
          label="Pending approval"
          value={stats?.pending_approval ?? pendingCount}
          sublabel="withdrawals"
          icon={<ArrowUpFromLine className="w-4 h-4" />}
          variant={pendingCount > 0 ? 'warning' : 'neutral'}
          href="/admin/withdrawals?status=pending_approval"
        />
        <AdminMetricCard
          label="High risk flagged"
          value={highRiskCount}
          sublabel="score ≥ 50"
          icon={<AlertTriangle className="w-4 h-4" />}
          variant={highRiskCount > 0 ? 'danger' : 'neutral'}
        />
        <AdminMetricCard
          label="Large amount threshold"
          value={LARGE_AMOUNT_THRESHOLD.toLocaleString()}
          sublabel="per withdrawal"
          icon={<AlertTriangle className="w-4 h-4" />}
        />
        <AdminMetricCard
          label="Multiple withdrawals"
          value="User count"
          sublabel="Same user, short time"
          icon={<AlertTriangle className="w-4 h-4" />}
        />
      </section>

      <AdminPanel title="Risk rules" subtitle="Detection patterns">
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>• Large withdrawals: amount ≥ {LARGE_AMOUNT_THRESHOLD.toLocaleString()}</li>
          <li>• New device: first withdrawal from new device (when backend provides)</li>
          <li>• Multiple withdrawals in short time: same user, multiple pending</li>
          <li>• High-risk country: geo-based (configure in backend)</li>
        </ul>
      </AdminPanel>

      <AdminDataTable
        title="Withdrawal risk queue"
        subtitle={`User, token, amount, country, device, risk score, status — ${rows.length} pending`}
        isEmpty={rows.length === 0}
        emptyMessage="No pending withdrawals. Risk scores are derived from amount, count, and metadata."
        wrapTable={false}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <DataTableTh>User</DataTableTh>
                <DataTableTh>Token</DataTableTh>
                <DataTableTh align="right">Amount</DataTableTh>
                <DataTableTh>Country</DataTableTh>
                <DataTableTh>Device</DataTableTh>
                <DataTableTh align="right">Risk score</DataTableTh>
                <DataTableTh>Status</DataTableTh>
                <DataTableTh align="right">Actions</DataTableTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <DataTableRow key={row.id}>
                  <DataTableCell>
                    <Link href={`/admin/users/${row.userId}`} className="text-primary hover:underline">
                      {row.user}
                    </Link>
                  </DataTableCell>
                  <DataTableCell mono>{row.token}</DataTableCell>
                  <DataTableCell align="right" mono>{row.amount}</DataTableCell>
                  <DataTableCell>{row.country}</DataTableCell>
                  <DataTableCell className="max-w-[120px] truncate" title={row.device}>{row.device}</DataTableCell>
                  <DataTableCell align="right">
                    <span className={row.isHighRisk ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}>
                      {row.riskScore}
                    </span>
                  </DataTableCell>
                  <DataTableCell>
                    <AdminStatusBadge
                      variant={row.status === 'pending_approval' ? 'DEGRADED' : 'NEUTRAL'}
                      label={row.status.replace(/_/g, ' ')}
                    />
                  </DataTableCell>
                  <DataTableCell align="right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setActingId(row.id);
                          approveMutation.mutate(row.id);
                        }}
                        disabled={actingId !== null}
                        className="p-1.5 rounded text-green-600 dark:text-green-400 hover:bg-green-500/10 disabled:opacity-50"
                        title="Approve"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActingId(row.id);
                          rejectMutation.mutate({ id: row.id, reason: 'Rejected by risk engine operator' });
                        }}
                        disabled={actingId !== null}
                        className="p-1.5 rounded text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                        title="Reject / Freeze"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </table>
        </div>
      </AdminDataTable>

      <p className="text-xs text-muted-foreground">
        Approve uses <code className="bg-muted px-1 rounded">POST /admin/withdrawals/:id/approve</code>. Reject (Freeze) uses <code className="bg-muted px-1 rounded">POST /admin/withdrawals/:id/reject</code>. Full queue: <Link href="/admin/withdrawals" className="text-primary hover:underline">Withdrawals</Link>.
      </p>
    </div>
  );
}
