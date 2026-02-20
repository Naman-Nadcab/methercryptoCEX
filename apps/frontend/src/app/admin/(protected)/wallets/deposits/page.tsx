'use client';

import { useState, useMemo } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
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
import {
  useAdminDeposits,
  useManualCredit,
  type DepositRow,
  type DepositsFilters,
} from '@/lib/admin-wallets-api';
import { formatAmountAdmin } from '@/lib/utils';
import { Loader2, ChevronLeft, ChevronRight, ArrowDownToLine } from 'lucide-react';

const statusOptions = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirming', label: 'Confirming' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

const statusVariant: Record<string, 'LIVE' | 'DEGRADED' | 'NEUTRAL' | 'RISK'> = {
  pending: 'DEGRADED',
  confirming: 'NEUTRAL',
  completed: 'LIVE',
  failed: 'RISK',
};

function DepositStatusBadge({ status }: { status: string }) {
  const variant = statusVariant[status] ?? 'NEUTRAL';
  const label = status.replace(/_/g, ' ');
  return <StatusBadge variant={variant} label={label} showDot={variant !== 'NEUTRAL'} />;
}

function truncateHash(h: string | null | undefined, len = 8): string {
  if (!h) return '—';
  if (h.length <= len * 2 + 2) return h;
  return `${h.slice(0, len)}…${h.slice(-len)}`;
}

export default function WalletsDepositsPage() {
  const { accessToken } = useAdminAuthStore();
  const [page, setPage] = useState(1);
  const [userFilter, setUserFilter] = useState('');
  const [assetFilter, setAssetFilter] = useState('');
  const [txOrIdFilter, setTxOrIdFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [forceCreditRow, setForceCreditRow] = useState<DepositRow | null>(null);
  const [creditReason, setCreditReason] = useState('');
  const [creditUser, setCreditUser] = useState('');
  const [creditCurrency, setCreditCurrency] = useState('');
  const [creditAmount, setCreditAmount] = useState('');

  const filters: DepositsFilters = useMemo(
    () => ({
      page,
      limit: 20,
      user: userFilter.trim() || undefined,
      token: assetFilter.trim() || undefined,
      status: statusFilter === 'all' ? undefined : statusFilter,
    }),
    [page, userFilter, assetFilter, statusFilter]
  );

  const { data, isLoading, isFetching, refetch } = useAdminDeposits(accessToken, filters);
  const manualCreditMutation = useManualCredit(accessToken);

  const rawDeposits = data?.data?.deposits ?? [];
  const deposits = useMemo(() => {
    if (!txOrIdFilter.trim()) return rawDeposits;
    const q = txOrIdFilter.trim().toLowerCase();
    return rawDeposits.filter(
      (d) =>
        (d.deposit_id && d.deposit_id.toLowerCase().includes(q)) ||
        (d.tx_hash && d.tx_hash.toLowerCase().includes(q))
    );
  }, [rawDeposits, txOrIdFilter]);
  const pagination = data?.data?.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 1 };

  const openForceCredit = (row: DepositRow) => {
    setForceCreditRow(row);
    setCreditUser(row.user_email ?? row.user_id);
    setCreditCurrency(row.token_symbol ?? '');
    setCreditAmount(row.amount ?? '');
    setCreditReason('');
  };

  const handleForceCredit = () => {
    if (!creditReason.trim() || !creditUser.trim() || !creditCurrency.trim() || !creditAmount.trim()) return;
    const idempotencyKey = `manual-credit-${forceCreditRow?.deposit_id ?? Date.now()}-${Math.random().toString(36).slice(2)}`;
    manualCreditMutation.mutate(
      {
        user: creditUser.trim(),
        currency: creditCurrency.trim(),
        amount: creditAmount.trim(),
        reason: creditReason.trim(),
        idempotencyKey,
      },
      {
        onSuccess: (res) => {
          if (res?.success) {
            setForceCreditRow(null);
            setCreditReason('');
            refetch();
          }
        },
      }
    );
  };

  const creditError = manualCreditMutation.data && !manualCreditMutation.data.success
    ? manualCreditMutation.data.error?.message ?? manualCreditMutation.data.error?.code ?? 'Failed'
    : null;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Deposits Operations Panel"
        subtitle="View deposits and force-credit via backend logic only. No direct balance writes."
        action={
          <ActionButton variant="secondary" onClick={() => refetch()} loading={isFetching} icon={!isFetching ? <span className="text-xs">↻</span> : undefined}>
            Refresh
          </ActionButton>
        }
      />

      <Panel className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">User ID / Email</label>
            <input
              type="text"
              value={userFilter}
              onChange={(e) => { setUserFilter(e.target.value); setPage(1); }}
              placeholder="UUID or email"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Asset (token)</label>
            <input
              type="text"
              value={assetFilter}
              onChange={(e) => { setAssetFilter(e.target.value); setPage(1); }}
              placeholder="Token UUID or symbol"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tx Hash / Deposit ID</label>
            <input
              type="text"
              value={txOrIdFilter}
              onChange={(e) => setTxOrIdFilter(e.target.value)}
              placeholder="Client-side filter"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
            >
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
      </Panel>

      <DataTableContainer
        title="Deposits"
        subtitle={`${deposits.length} shown${txOrIdFilter.trim() ? ' (filtered)' : ''}`}
        headerAction={
          pagination.totalPages > 1 && !txOrIdFilter.trim() ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1 || isLoading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-50 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-gray-500 dark:text-gray-400 px-2">{pagination.page} / {pagination.totalPages}</span>
              <button
                type="button"
                disabled={page >= pagination.totalPages || isLoading}
                onClick={() => setPage((p) => p + 1)}
                className="p-1.5 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-50 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : null
        }
        emptyMessage="No deposits found"
        isEmpty={!isLoading && deposits.length === 0}
      >
        <DataTableHead>
          <DataTableTh>Deposit ID</DataTableTh>
          <DataTableTh>User ID</DataTableTh>
          <DataTableTh>Asset</DataTableTh>
          <DataTableTh align="right">Amount</DataTableTh>
          <DataTableTh>Tx Hash</DataTableTh>
          <DataTableTh>Confirmations</DataTableTh>
          <DataTableTh>Status</DataTableTh>
          <DataTableTh>Created At</DataTableTh>
          <DataTableTh align="right">Actions</DataTableTh>
        </DataTableHead>
        <DataTableBody>
          {deposits.map((d) => (
            <DataTableRow key={d.deposit_id}>
              <DataTableCell mono className="text-gray-700 dark:text-gray-300" title={d.deposit_id}>
                {d.deposit_id.slice(0, 8)}…
              </DataTableCell>
              <DataTableCell>
                <span className="text-gray-900 dark:text-white">{d.user_id}</span>
                {d.user_email && <span className="text-gray-500 dark:text-gray-400 text-xs block truncate max-w-[140px]" title={d.user_email}>{d.user_email}</span>}
              </DataTableCell>
              <DataTableCell>{d.token_symbol ?? d.token_id ?? '—'}</DataTableCell>
              <DataTableCell align="right" mono>{formatAmountAdmin(d.amount)}</DataTableCell>
              <DataTableCell mono className="max-w-[100px] truncate" title={d.tx_hash ?? undefined}>
                {truncateHash(d.tx_hash)}
              </DataTableCell>
              <DataTableCell>
                {d.confirmations != null && d.required_confirmations != null
                  ? `${d.confirmations} / ${d.required_confirmations}`
                  : d.confirmations ?? '—'}
              </DataTableCell>
              <DataTableCell><DepositStatusBadge status={d.status} /></DataTableCell>
              <DataTableCell className="text-xs text-gray-500 dark:text-gray-400">
                {new Date(d.created_at).toLocaleString()}
              </DataTableCell>
              <DataTableCell align="right">
                {!d.credited && (
                  <ActionButton
                    variant="primary"
                    icon={<ArrowDownToLine className="w-3.5 h-3.5" />}
                    onClick={() => openForceCredit(d)}
                    loading={manualCreditMutation.isPending && forceCreditRow?.deposit_id === d.deposit_id}
                    disabled={manualCreditMutation.isPending && forceCreditRow?.deposit_id !== d.deposit_id}
                  >
                    Force Credit
                  </ActionButton>
                )}
                {d.credited && <span className="text-xs text-gray-500">Credited</span>}
                <span className="ml-1 text-xs text-gray-400" title="Backend has no force-ignore endpoint">Force Ignore N/A</span>
              </DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTableContainer>

      {isLoading && rawDeposits.length > 0 && (
        <div className="flex justify-center py-4">
          <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      )}

      {forceCreditRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="force-credit-title">
          <div className="w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <ArrowDownToLine className="w-5 h-5 text-emerald-500 shrink-0" />
              <h2 id="force-credit-title" className="text-sm font-semibold text-gray-900 dark:text-white">Force Credit (Manual Credit)</h2>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <p className="text-gray-600 dark:text-gray-400">Uses backend manual-credit (ledger). Idempotency key is sent. Operator reason is required.</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">User (email or ID)</label>
                  <input type="text" value={creditUser} onChange={(e) => setCreditUser(e.target.value)} className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Currency</label>
                  <input type="text" value={creditCurrency} onChange={(e) => setCreditCurrency(e.target.value)} className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Amount</label>
                  <input type="text" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Reason (required)</label>
                <textarea value={creditReason} onChange={(e) => setCreditReason(e.target.value)} placeholder="Operator reason" rows={3} className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm" />
              </div>
              {creditError && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{creditError}</p>}
            </div>
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <ActionButton variant="secondary" onClick={() => { setForceCreditRow(null); manualCreditMutation.reset(); }}>Cancel</ActionButton>
              <ActionButton variant="primary" loading={manualCreditMutation.isPending} disabled={!creditReason.trim() || !creditUser.trim() || !creditCurrency.trim() || !creditAmount.trim()} onClick={handleForceCredit}>
                Confirm Force Credit
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
