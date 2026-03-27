'use client';

import { useCallback, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getUserById, getUserBalances, updateUserStatus, getUserStats, getUserSecurity, getUserApiKeys } from '@/lib/users-api';
import { getUserRiskTimeline } from '@/lib/risk-api';
import { getWithdrawals } from '@/lib/api';
import { getDeposits } from '@/lib/api';
import { UserHeaderCard } from '@/components/users/UserHeaderCard';
import { UserTabs, type UserTabId } from '@/components/users/UserTabs';
import { UserWalletTable } from '@/components/users/UserWalletTable';
import { StatCard } from '@/components/dashboard/StatCard';
import { ArrowDownToLine, ArrowUpFromLine, TrendingUp, BarChart3, Repeat } from 'lucide-react';
import { useAdminWs } from '@/hooks/useAdminWs';

function formatCurrency(val: string | number | undefined): string {
  if (val === undefined || val === null) return '$0.00';
  const n = typeof val === 'string' ? parseFloat(val) : Number(val);
  if (Number.isNaN(n)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

function formatDate(s: string | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString();
  } catch {
    return '—';
  }
}

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params?.id === 'string' ? params.id : '';
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<UserTabId>('overview');

  const { data: userData, isLoading: userLoading, isError: userError } = useQuery({
    queryKey: ['admin', 'user', id, token],
    queryFn: () => getUserById(token, id),
    enabled: !!token && !!id,
  });

  const { data: balancesData, isLoading: balancesLoading } = useQuery({
    queryKey: ['admin', 'user-balances', id, token],
    queryFn: () => getUserBalances(token, id),
    enabled: !!token && !!id && activeTab === 'wallets',
  });

  const { data: withdrawalsData } = useQuery({
    queryKey: ['admin', 'withdrawals', id, token],
    queryFn: () => getWithdrawals(token, { limit: 50, user: id }),
    enabled: !!token && !!id && activeTab === 'withdrawals',
  });

  const { data: depositsData } = useQuery({
    queryKey: ['admin', 'deposits', id, token],
    queryFn: () => getDeposits(token, { limit: 50, user: id }),
    enabled: !!token && !!id && activeTab === 'deposits',
  });

  const { data: statsData } = useQuery({
    queryKey: ['admin', 'user-stats', id, token],
    queryFn: () => getUserStats(token, id),
    enabled: !!token && !!id && activeTab === 'overview',
  });

  const { data: securityData, isLoading: securityLoading } = useQuery({
    queryKey: ['admin', 'user-security', id, token],
    queryFn: () => getUserSecurity(token, id),
    enabled: !!token && !!id && activeTab === 'security',
  });

  const { data: apiKeysData, isLoading: apiKeysLoading } = useQuery({
    queryKey: ['admin', 'user-api-keys', id, token],
    queryFn: () => getUserApiKeys(token, id),
    enabled: !!token && !!id && activeTab === 'api-keys',
  });

  const { data: riskTimelineData, isLoading: riskTimelineLoading } = useQuery({
    queryKey: ['admin', 'user-risk-timeline', id, token],
    queryFn: () => getUserRiskTimeline(token, id),
    enabled: !!token && !!id && activeTab === 'risk-timeline',
  });

  const updateStatus = useMutation({
    mutationFn: ({ status, reason }: { status: 'active' | 'suspended' | 'locked'; reason?: string }) =>
      updateUserStatus(token, id, { status, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'user', id] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  const handleSuspend = useCallback(() => {
    if (confirm('Suspend this user?')) updateStatus.mutate({ status: 'suspended' });
  }, [updateStatus]);
  const handleBan = useCallback(() => {
    if (confirm('Ban this user? (Sets status to locked)')) updateStatus.mutate({ status: 'locked' });
  }, [updateStatus]);
  const handleReset2FA = useCallback(() => {
    if (confirm('Reset 2FA for this user? They will need to set it up again.')) {
      // Backend may expose POST /admin/users/:id/reset-2fa; for now just alert
      alert('Reset 2FA: backend endpoint can be wired here.');
    }
  }, []);

  useAdminWs({
    onEvent: (event) => {
      if (!id) return;
      const payload = (event?.data ?? event?.payload) as { user_id?: string; userId?: string } | undefined;
      const uid = payload?.user_id ?? payload?.userId;
      if (uid !== id) return;
      const type = (event?.type as string) ?? '';
      if (['trade_executed', 'withdrawal_requested', 'deposit_confirmed'].includes(type)) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'user', id] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'user-balances', id] });
        queryClient.invalidateQueries({ queryKey: ['admin', 'user-stats', id] });
        if (type === 'withdrawal_requested') queryClient.invalidateQueries({ queryKey: ['admin', 'withdrawals', id] });
        if (type === 'deposit_confirmed') queryClient.invalidateQueries({ queryKey: ['admin', 'deposits', id] });
      }
    },
  });

  const user = userData?.data?.user as Record<string, unknown> | undefined;
  const balances = userData?.data?.balances ?? balancesData?.data?.balances ?? [];
  const activity = (userData?.data?.activity as unknown[]) ?? [];
  const withdrawals = (withdrawalsData?.data as { withdrawals?: unknown[] })?.withdrawals ?? [];
  const deposits = (depositsData?.data as { deposits?: unknown[] } | undefined)?.deposits ?? [];

  const rawBalances = balancesData?.data?.balances ?? balances;
  const walletRows = (Array.isArray(rawBalances) ? rawBalances : []).map((b: Record<string, unknown>) => ({
    token_symbol: (b.token_symbol ?? b.symbol ?? '') as string,
    token_id: (b.token_id ?? b.currency_id) as string,
    available_balance: (b.available_balance ?? '0') as string,
    locked_balance: (b.locked_balance ?? '0') as string,
    total_balance: (b.total_balance ?? '0') as string,
    escrow_balance: (b.escrow_balance ?? '0') as string,
  }));

  if (!id) {
    return (
      <div className="p-6">
        <p className="text-admin-danger">Invalid user ID</p>
      </div>
    );
  }

  if (userLoading || !user) {
    return (
      <div className="p-6">
        {userError ? (
          <p className="text-admin-danger">Failed to load user.</p>
        ) : (
          <div className="text-admin-muted">Loading user…</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.push('/users')}
          className="text-sm text-admin-primary hover:underline"
        >
          ← Users
        </button>
      </div>

      <UserHeaderCard
        user={user}
        onSuspend={handleSuspend}
        onBan={handleBan}
        onReset2FA={handleReset2FA}
      />

      <UserTabs activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <p className="text-sm text-admin-muted">
              User ID: {user.id as string} · Email verified: {(user.email_verified as boolean) ? 'Yes' : 'No'} · Last login: {formatDate(user.last_login_at as string)}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <StatCard title="Total Deposits" value={formatCurrency(statsData?.data?.total_deposits)} icon={ArrowDownToLine} />
              <StatCard title="Total Withdrawals" value={formatCurrency(statsData?.data?.total_withdrawals)} icon={ArrowUpFromLine} />
              <StatCard title="Total Trades" value={statsData?.data?.total_trades ?? '0'} icon={BarChart3} />
              <StatCard title="30d Trading Volume" value={formatCurrency(statsData?.data?.volume_30d)} icon={TrendingUp} />
              <StatCard title="P2P Orders" value={statsData?.data?.p2p_orders_count ?? '0'} icon={Repeat} />
            </div>
            {walletRows.length > 0 && (
              <p className="text-sm text-admin-muted">Total wallets: {walletRows.length}</p>
            )}
          </div>
        )}

        {activeTab === 'wallets' && (
          <UserWalletTable balances={walletRows} isLoading={balancesLoading} />
        )}

        {activeTab === 'orders' && (
          <div className="rounded-lg border border-admin-border p-4 text-center text-admin-muted">
            Spot orders for this user. Use Trading → Orders and filter by user, or connect to orders-by-user API.
          </div>
        )}

        {activeTab === 'trades' && (
          <div className="rounded-lg border border-admin-border p-4 text-center text-admin-muted">
            Spot trades for this user. Use Trading → Trade history and filter by user, or connect to trades-by-user API.
          </div>
        )}

        {activeTab === 'deposits' && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-admin-border bg-gray-50">
                  <th className="px-4 py-2 text-left text-xs font-semibold text-admin-muted">TX Hash</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-admin-muted">Asset</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-admin-muted">Amount</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-admin-muted">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-admin-muted">Time</th>
                </tr>
              </thead>
              <tbody>
                {deposits.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-admin-muted">No deposits</td></tr>
                ) : (
                  (deposits as Array<Record<string, unknown>>).map((d, i) => (
                    <tr key={(d.id ?? i) as string} className="border-b border-admin-border/60">
                      <td className="px-4 py-2 font-mono text-sm">{(d.tx_hash as string) ?? '—'}</td>
                      <td className="px-4 py-2">{(d.token_symbol as string) ?? '—'}</td>
                      <td className="px-4 py-2 text-right">{(d.amount as string) ?? '—'}</td>
                      <td className="px-4 py-2">{(d.status as string) ?? '—'}</td>
                      <td className="px-4 py-2 text-admin-muted">{formatDate(d.created_at as string)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'withdrawals' && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-admin-border bg-gray-50">
                  <th className="px-4 py-2 text-left text-xs font-semibold text-admin-muted">Asset</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-admin-muted">Amount</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-admin-muted">Address</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-admin-muted">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-admin-muted">Time</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-admin-muted">No withdrawals</td></tr>
                ) : (
                  (withdrawals as Array<Record<string, unknown>>).map((w, i) => (
                    <tr key={(w.id ?? i) as string} className="border-b border-admin-border/60">
                      <td className="px-4 py-2">{(w.token_symbol ?? w.currency_symbol) as string ?? '—'}</td>
                      <td className="px-4 py-2 text-right">{(w.amount as string) ?? '—'}</td>
                      <td className="px-4 py-2 font-mono text-sm truncate max-w-[180px]">{(w.address ?? w.to_address) as string ?? '—'}</td>
                      <td className="px-4 py-2">{(w.status as string) ?? '—'}</td>
                      <td className="px-4 py-2 text-admin-muted">{formatDate(w.created_at as string)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'p2p' && (
          <div className="rounded-lg border border-admin-border p-4 text-center text-admin-muted">
            P2P orders for this user. Connect to P2P orders API with user filter.
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="space-y-2">
            {activity.length === 0 ? (
              <p className="text-admin-muted">No activity logs</p>
            ) : (
              (activity as Array<Record<string, unknown>>).map((a, i) => (
                <div key={(a.id ?? i) as string} className="flex items-center justify-between rounded-lg border border-admin-border/60 px-4 py-2 text-sm">
                  <span>{(a.action ?? a.event_type ?? a.type) as string ?? 'Activity'}</span>
                  <span className="text-admin-muted">{formatDate(a.created_at as string)}</span>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'security' && (
          <div className="overflow-x-auto">
            {securityLoading ? (
              <p className="text-admin-muted">Loading…</p>
            ) : !securityData?.data?.sessions?.length ? (
              <p className="text-admin-muted">No sessions</p>
            ) : (
              <table className="w-full min-w-[500px] border-collapse">
                <thead>
                  <tr className="border-b border-admin-border bg-gray-50">
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-admin-muted">Device</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-admin-muted">IP Address</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-admin-muted">Location</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-admin-muted">Last Login</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-admin-muted">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {securityData.data.sessions.map((s, i) => (
                    <tr key={i} className="border-b border-admin-border/60 hover:bg-gray-50">
                      <td className="px-4 py-2">{s.device}</td>
                      <td className="px-4 py-2 font-mono text-sm">{s.ip_address}</td>
                      <td className="px-4 py-2">{s.location}</td>
                      <td className="px-4 py-2 text-admin-muted">{formatDate(s.last_login)}</td>
                      <td className="px-4 py-2">{s.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'api-keys' && (
          <div className="overflow-x-auto">
            {apiKeysLoading ? (
              <p className="text-admin-muted">Loading…</p>
            ) : !apiKeysData?.data?.api_keys?.length ? (
              <p className="text-admin-muted">No API keys</p>
            ) : (
              <table className="w-full min-w-[500px] border-collapse">
                <thead>
                  <tr className="border-b border-admin-border bg-gray-50">
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-admin-muted">Key</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-admin-muted">Permissions</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-admin-muted">Created</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-admin-muted">Last Used</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-admin-muted">IP Whitelist</th>
                  </tr>
                </thead>
                <tbody>
                  {apiKeysData.data.api_keys.map((k, i) => (
                    <tr key={i} className="border-b border-admin-border/60 hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-sm">{k.key}</td>
                      <td className="px-4 py-2">{k.permissions}</td>
                      <td className="px-4 py-2 text-admin-muted">{formatDate(k.created)}</td>
                      <td className="px-4 py-2 text-admin-muted">{k.last_used === '—' ? '—' : formatDate(k.last_used)}</td>
                      <td className="px-4 py-2 text-sm">{k.ip_whitelist}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'risk-timeline' && (
          <div className="space-y-2">
            {riskTimelineLoading ? (
              <p className="text-admin-muted">Loading…</p>
            ) : !riskTimelineData?.data?.events?.length ? (
              <p className="text-admin-muted">No risk timeline events</p>
            ) : (
              riskTimelineData.data.events.map((ev, i) => (
                <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-admin-border/60 px-4 py-3 text-sm">
                  <span className="font-medium">{ev.event_type}</span>
                  <span className="text-admin-muted">{formatDate(ev.timestamp)}</span>
                  {ev.admin_action && <span className="w-full text-xs text-admin-muted">Admin: {ev.admin_action}</span>}
                </div>
              ))
            )}
          </div>
        )}
      </UserTabs>
    </div>
  );
}
