'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  useAdminUserDetail,
  useAdminUserBalances,
  useAdminUserStatusUpdate,
  useAdminDepositsByUser,
  useAdminWithdrawalsByUser,
  impersonateUser,
  type AdminUserDetail as UserDetailType,
  type AdminUserBalanceRow,
  type AdminDepositRow,
  type AdminWithdrawalRow,
} from '@/lib/admin-users-api';
import {
  SectionHeader,
  Panel,
  DataTableContainer,
  DataTableHead,
  DataTableTh,
  DataTableBody,
  DataTableRow,
  DataTableCell,
  StatusBadge,
  ActionButton,
} from '@/components/admin/control-plane';
import { AdminTabs } from '@/components/admin/ui';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  User,
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  Snowflake,
  Sun,
  X,
  LogIn,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { formatAmountAdmin } from '@/lib/utils';

const userStatusVariant: Record<string, 'LIVE' | 'DEGRADED' | 'RISK' | 'NEUTRAL'> = {
  active: 'LIVE',
  suspended: 'DEGRADED',
  locked: 'RISK',
};

function UserStatusBadge({ status }: { status: string }) {
  const variant = userStatusVariant[status] ?? 'NEUTRAL';
  return (
    <StatusBadge
      variant={variant}
      label={status.replace(/_/g, ' ')}
      showDot={variant !== 'NEUTRAL'}
    />
  );
}

function formatAmount(s: string): string {
  const n = parseFloat(s);
  if (Number.isNaN(n)) return '0';
  return n.toFixed(8);
}

// ---------------------------------------------------------------------------
// Freeze / Unfreeze modal
// ---------------------------------------------------------------------------

interface StatusModalProps {
  open: boolean;
  action: 'freeze' | 'unfreeze';
  currentStatus: string;
  userId: string;
  userEmail: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}

function StatusConfirmModal({
  open,
  action,
  currentStatus,
  userId,
  userEmail,
  onClose,
  onConfirm,
  loading,
  error,
}: StatusModalProps) {
  const [reason, setReason] = useState('');

  if (!open) return null;

  const isFreeze = action === 'freeze';
  const title = isFreeze ? 'Freeze account' : 'Unfreeze account';
  const bodyCopy = isFreeze
    ? 'The user will not be able to trade or withdraw. Balances are not modified.'
    : 'The user will be able to trade and withdraw again.';

  const handleSubmit = () => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    onConfirm(trimmed).then(() => {
      setReason('');
      onClose();
    }).catch(() => {});
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="status-modal-title"
    >
      <div className="w-full max-w-md rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 id="status-modal-title" className="text-lg font-semibold text-gray-900 dark:text-white">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">{bodyCopy}</p>
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">User</span>
              <span className="text-gray-900 dark:text-white truncate max-w-[220px]" title={userEmail}>
                {userEmail}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">User ID</span>
              <span className="font-mono text-xs text-gray-700 dark:text-gray-300 truncate max-w-[180px]" title={userId}>
                {userId.slice(0, 8)}…
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Current status</span>
              <span className="text-gray-900 dark:text-white capitalize">{currentStatus.replace(/_/g, ' ')}</span>
            </div>
          </div>
          <div>
            <label htmlFor="status-reason" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Reason (required)
            </label>
            <textarea
              id="status-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Operator reason for this action"
              rows={3}
              className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-500 resize-none"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <ActionButton variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </ActionButton>
          <ActionButton
            variant={isFreeze ? 'danger' : 'primary'}
            onClick={handleSubmit}
            loading={loading}
            disabled={!reason.trim() || loading}
          >
            {isFreeze ? 'Freeze account' : 'Unfreeze account'}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminUserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = typeof params?.id === 'string' ? params.id : '';
  const { accessToken } = useAdminAuthStore();

  const [statusModal, setStatusModal] = useState<{
    action: 'freeze' | 'unfreeze';
  } | null>(null);
  const [impersonating, setImpersonating] = useState(false);
  const [impersonateError, setImpersonateError] = useState<string | null>(null);
  const { setUser, setTokens } = useAuthStore();

  const { data: userData, isLoading: loadingUser, isError: userError, error: userErr } = useAdminUserDetail(accessToken, userId);
  const { data: balancesData, isLoading: loadingBalances } = useAdminUserBalances(accessToken, userId);
  const { data: depositsData, isLoading: loadingDeposits } = useAdminDepositsByUser(accessToken, userId, 10);
  const { data: withdrawalsData, isLoading: loadingWithdrawals } = useAdminWithdrawalsByUser(accessToken, userId, 10);

  const updateStatus = useAdminUserStatusUpdate(accessToken, userId);
  const [statusError, setStatusError] = useState<string | null>(null);

  const user: UserDetailType | undefined = userData?.data?.user;
  const balances: AdminUserBalanceRow[] = userData?.data?.balances ?? balancesData?.data?.balances ?? [];
  const deposits: AdminDepositRow[] = depositsData?.data?.deposits ?? [];
  const withdrawals: AdminWithdrawalRow[] = withdrawalsData?.data?.withdrawals ?? [];

  const handleStatusConfirm = async (reason: string) => {
    setStatusError(null);
    if (!statusModal) return;
    const newStatus = statusModal.action === 'freeze' ? 'suspended' : 'active';
    const res = await updateStatus.mutateAsync({ status: newStatus, reason });
    if (!res.success) {
      setStatusError(res.error?.message ?? 'Update failed');
      throw new Error(res.error?.message);
    }
    setStatusModal(null);
  };

  const handleImpersonate = async () => {
    setImpersonateError(null);
    setImpersonating(true);
    try {
      const res = await impersonateUser(accessToken, userId);
      if (!res.success || !res.data?.accessToken) {
        setImpersonateError(res.error?.message ?? 'Impersonation failed');
        return;
      }
      const { accessToken: userToken, userId: targetId, email } = res.data;
      setUser({
        id: targetId,
        email: email ?? null,
        phone: null,
        username: null,
        firstName: null,
        lastName: null,
        avatarUrl: null,
        role: 'user',
        status: 'active',
        accountType: 'individual',
        emailVerified: true,
        phoneVerified: false,
        twoFaEnabled: false,
        tierLevel: 0,
        countryCode: null,
        timezone: undefined,
        language: undefined,
        referralCode: null,
      });
      setTokens(userToken, '');
      window.location.href = '/dashboard';
    } catch (e) {
      setImpersonateError(e instanceof Error ? e.message : 'Impersonation failed');
    } finally {
      setImpersonating(false);
    }
  };

  if (loadingUser && !user) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  if ((userError || !user) && !loadingUser) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to users
        </Link>
        <div className="flex items-center gap-4 p-6 rounded-xl bg-red-500/10 border border-red-500/30">
          <AlertCircle className="w-10 h-10 text-red-400 shrink-0" />
          <div>
            <p className="text-red-200 font-medium">User not found</p>
            <p className="text-sm text-red-300/80 mt-1">
              {userErr instanceof Error ? userErr.message : 'User may have been deleted or ID is invalid.'}
            </p>
            <button
              type="button"
              onClick={() => router.replace('/admin/users')}
              className="mt-3 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-200 rounded-lg text-sm font-medium"
            >
              Back to users
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isFrozen = user?.status === 'suspended' || user?.status === 'locked';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to users
        </Link>
      </div>

      <SectionHeader
        title={user?.email ?? 'User'}
        subtitle={`User detail · ${user?.id ?? userId}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton
              variant="secondary"
              icon={<LogIn className="w-4 h-4" />}
              onClick={handleImpersonate}
              loading={impersonating}
              disabled={impersonating}
            >
              Impersonate
            </ActionButton>
            {isFrozen ? (
              <ActionButton
                variant="primary"
                icon={<Sun className="w-4 h-4" />}
                onClick={() => setStatusModal({ action: 'unfreeze' })}
              >
                Unfreeze
              </ActionButton>
            ) : (
              <ActionButton
                variant="danger"
                icon={<Snowflake className="w-4 h-4" />}
                onClick={() => setStatusModal({ action: 'freeze' })}
              >
                Freeze
              </ActionButton>
            )}
            {impersonateError && (
              <span className="text-sm text-red-600 dark:text-red-400" role="alert">
                {impersonateError}
              </span>
            )}
          </div>
        }
      />

      <AdminTabs
        defaultActiveKey="overview"
        items={[
          {
            key: 'overview',
            label: 'Overview',
            children: (
              <Panel title="Profile & status" subtitle="Identity, account status, risk">
                <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Email</dt>
                    <dd className="mt-1 text-gray-900 dark:text-white">{user?.email ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Phone</dt>
                    <dd className="mt-1 text-gray-900 dark:text-white">{user?.phone ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Username</dt>
                    <dd className="mt-1 text-gray-900 dark:text-white">{user?.username ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Account status</dt>
                    <dd className="mt-1">
                      <UserStatusBadge status={user?.status ?? 'active'} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">KYC / Tier</dt>
                    <dd className="mt-1 text-gray-900 dark:text-white">
                      {user?.tier_level != null ? `Tier ${user.tier_level}` : user?.kyc_status ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Created</dt>
                    <dd className="mt-1 text-gray-500 dark:text-gray-400">
                      {user?.created_at ? new Date(user.created_at).toLocaleString() : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Last login</dt>
                    <dd className="mt-1 text-gray-500 dark:text-gray-400">
                      {user?.last_login_at ? new Date(user.last_login_at).toLocaleString() : '—'}
                    </dd>
                  </div>
                </dl>
              </Panel>
            ),
          },
          {
            key: 'wallet',
            label: 'Wallet Balances',
            children: (
              <Panel title="Balance summary" subtitle="From user_balances (read-only)">
                {loadingBalances ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
                  </div>
                ) : balances.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No balance rows.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700">
                          <th className="text-left py-2 px-3 font-medium text-gray-500 dark:text-gray-400">Token</th>
                          <th className="text-left py-2 px-3 font-medium text-gray-500 dark:text-gray-400">Chain</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-500 dark:text-gray-400">Available</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-500 dark:text-gray-400">Locked</th>
                        </tr>
                      </thead>
                      <tbody>
                        {balances.map((b, i) => (
                          <tr key={`bal-${i}-${(b as { token_id?: string }).token_id ?? b.token_symbol}`} className="border-b border-gray-100 dark:border-gray-800">
                            <td className="py-2 px-3 text-gray-900 dark:text-white">{(b as { symbol?: string }).symbol ?? b.token_symbol}</td>
                            <td className="py-2 px-3 text-gray-500 dark:text-gray-400">{b.chain_name ?? '—'}</td>
                            <td className="py-2 px-3 text-right font-mono text-gray-900 dark:text-white">{formatAmountAdmin(b.available_balance)}</td>
                            <td className="py-2 px-3 text-right font-mono text-gray-600 dark:text-gray-400">{formatAmountAdmin(b.locked_balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            ),
          },
          {
            key: 'trading',
            label: 'Trading Activity',
            children: (
              <Panel title="Trading activity" subtitle="Spot trades and volume">
                <p className="text-sm text-gray-500 dark:text-gray-400 py-4">Trading activity is available from the trading history API. Use Trading → Trade History filtered by user.</p>
              </Panel>
            ),
          },
          {
            key: 'open-orders',
            label: 'Open Orders',
            children: (
              <Panel title="Open orders" subtitle="Current open spot orders">
                <p className="text-sm text-gray-500 dark:text-gray-400 py-4">Open orders are available from Trading → Orders filtered by user.</p>
              </Panel>
            ),
          },
          {
            key: 'trade-history',
            label: 'Trade History',
            children: (
              <Panel title="Trade history" subtitle="Executed spot trades">
                <p className="text-sm text-gray-500 dark:text-gray-400 py-4">Trade history is available from Trading → Trade History.</p>
              </Panel>
            ),
          },
          {
            key: 'deposits',
            label: 'Deposits',
            children: (
              <Panel title="Recent deposits" subtitle="Last 10">
                {loadingDeposits ? (
                  <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 text-gray-400 animate-spin" /></div>
                ) : deposits.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No recent deposits.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700">
                          <DataTableTh>Amount</DataTableTh>
                          <DataTableTh>Asset</DataTableTh>
                          <DataTableTh>Status</DataTableTh>
                          <DataTableTh>Created</DataTableTh>
                        </tr>
                      </thead>
                      <tbody>
                        {deposits.map((d) => (
                          <DataTableRow key={d.deposit_id}>
                            <DataTableCell mono>{formatAmount(d.amount)}</DataTableCell>
                            <DataTableCell>{d.token_symbol ?? '—'}</DataTableCell>
                            <DataTableCell>{d.status}</DataTableCell>
                            <DataTableCell className="text-gray-500 dark:text-gray-400">{new Date(d.created_at).toLocaleString()}</DataTableCell>
                          </DataTableRow>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            ),
          },
          {
            key: 'withdrawals',
            label: 'Withdrawals',
            children: (
              <Panel title="Recent withdrawals" subtitle="Last 10">
                {loadingWithdrawals ? (
                  <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 text-gray-400 animate-spin" /></div>
                ) : withdrawals.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 py-4">No recent withdrawals.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700">
                          <DataTableTh>Amount</DataTableTh>
                          <DataTableTh>Asset</DataTableTh>
                          <DataTableTh>Status</DataTableTh>
                          <DataTableTh>Created</DataTableTh>
                        </tr>
                      </thead>
                      <tbody>
                        {withdrawals.map((w) => (
                          <DataTableRow key={w.id}>
                            <DataTableCell mono>{formatAmount(w.amount)}</DataTableCell>
                            <DataTableCell>{w.currency_symbol ?? '—'}</DataTableCell>
                            <DataTableCell>{w.status}</DataTableCell>
                            <DataTableCell className="text-gray-500 dark:text-gray-400">{new Date(w.created_at).toLocaleString()}</DataTableCell>
                          </DataTableRow>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            ),
          },
          {
            key: 'p2p',
            label: 'P2P Activity',
            children: (
              <Panel title="P2P activity" subtitle="P2P orders and ads">
                <p className="text-sm text-gray-500 dark:text-gray-400 py-4">P2P activity is available from P2P → Orders filtered by user.</p>
              </Panel>
            ),
          },
          {
            key: 'security',
            label: 'Security Logs',
            children: (
              <Panel title="Security logs" subtitle="Login history, device fingerprints">
                <p className="text-sm text-gray-500 dark:text-gray-400 py-4">Session and activity data appear here when returned by the user detail API.</p>
              </Panel>
            ),
          },
          {
            key: 'kyc',
            label: 'KYC Documents',
            children: (
              <Panel title="KYC documents" subtitle="Verification status and documents">
                <p className="text-sm text-gray-500 dark:text-gray-400 py-4">KYC status: {user?.kyc_status ?? '—'}. Full KYC list is available in KYC Verification.</p>
              </Panel>
            ),
          },
        ]}
      />

      <StatusConfirmModal
        open={!!statusModal}
        action={statusModal?.action ?? 'freeze'}
        currentStatus={user?.status ?? 'active'}
        userId={userId}
        userEmail={user?.email ?? ''}
        onClose={() => { setStatusModal(null); setStatusError(null); }}
        onConfirm={handleStatusConfirm}
        loading={updateStatus.isPending}
        error={statusError ?? (updateStatus.isError ? (updateStatus.error instanceof Error ? updateStatus.error.message : 'Update failed') : null)}
      />
    </div>
  );
}
