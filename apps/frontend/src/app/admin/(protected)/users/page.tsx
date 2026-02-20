'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  useAdminUsersList,
  type AdminUserListItem,
  type ListFilters,
} from '@/lib/admin-users-api';
import {
  SectionHeader,
  DataTableContainer,
  DataTableHead,
  DataTableTh,
  DataTableBody,
  DataTableRow,
  DataTableCell,
  StatusBadge,
  ActionButton,
  Panel,
} from '@/components/admin/control-plane';
import { Loader2, ChevronLeft, ChevronRight, Eye } from 'lucide-react';

const ACCOUNT_STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'locked', label: 'Locked' },
];

const KYC_STATUS_OPTIONS = [
  { value: 'all', label: 'All KYC' },
  { value: '1', label: 'Tier 1' },
  { value: '2', label: 'Tier 2' },
  { value: '3', label: 'Tier 3' },
];

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

function KycStatusCell({ kyc_status, kyc_level }: { kyc_status?: string | null; kyc_level?: number | null }) {
  const display = kyc_status ?? (kyc_level != null ? `Tier ${kyc_level}` : null);
  return (
    <DataTableCell>
      {display ? (
        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
          {display}
        </span>
      ) : (
        '—'
      )}
    </DataTableCell>
  );
}

export default function AdminUsersPage() {
  const { accessToken } = useAdminAuthStore();
  const [search, setSearch] = useState('');
  const [accountStatus, setAccountStatus] = useState('all');
  const [kycStatus, setKycStatus] = useState('all');
  const [page, setPage] = useState(1);
  const limit = 20;

  const filters: ListFilters = {
    page,
    limit,
    search: search.trim() || undefined,
    status: accountStatus === 'all' ? undefined : accountStatus,
    kycLevel: kycStatus === 'all' ? undefined : kycStatus,
  };

  const { data, isLoading, isError, error, isFetching } = useAdminUsersList(accessToken, filters);

  const users: AdminUserListItem[] = data?.data?.users ?? [];
  const pagination = data?.data?.pagination ?? { page: 1, limit: 20, total: 0 };
  const totalPages = Math.ceil(pagination.total / pagination.limit) || 1;
  const total = pagination.total;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Users"
        subtitle="Explore and manage user accounts (read-only except status controls)"
      />

      <Panel title="Filters" subtitle="Search by email, phone, or username. Filter by account and KYC.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <input
            type="text"
            placeholder="User ID / Email / Username"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setPage(1)}
            className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-500"
          />
          <select
            value={accountStatus}
            onChange={(e) => {
              setAccountStatus(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
          >
            {ACCOUNT_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={kycStatus}
            onChange={(e) => {
              setKycStatus(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
          >
            {KYC_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setPage(1)}
            className="px-3 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Apply
          </button>
        </div>
      </Panel>

      <DataTableContainer
        title="User explorer"
        subtitle={`${total} total · page ${pagination.page} of ${totalPages}`}
        headerAction={
          totalPages > 1 ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1 || isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-50 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-gray-500 dark:text-gray-400 px-2">
                {pagination.page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages || isFetching}
                onClick={() => setPage((p) => p + 1)}
                className="p-1.5 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-50 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : null
        }
        emptyMessage={isError ? (error instanceof Error ? error.message : 'Failed to load users') : 'No users found'}
        isEmpty={!isLoading && !isError && users.length === 0}
      >
        <DataTableHead>
          <DataTableTh>User ID</DataTableTh>
          <DataTableTh>Email / Identifier</DataTableTh>
          <DataTableTh>KYC Status</DataTableTh>
          <DataTableTh>Account Status</DataTableTh>
          <DataTableTh>Created At</DataTableTh>
          <DataTableTh align="right">Actions</DataTableTh>
        </DataTableHead>
        <DataTableBody>
          {users.map((u) => (
            <DataTableRow key={u.id}>
              <DataTableCell mono className="max-w-[120px] truncate" title={u.id}>
                {u.id.slice(0, 8)}…
              </DataTableCell>
              <DataTableCell>
                <div className="max-w-[200px]">
                  <span className="truncate block text-gray-900 dark:text-white" title={u.email}>
                    {u.email || '—'}
                  </span>
                  {u.username && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 truncate block">
                      @{u.username}
                    </span>
                  )}
                </div>
              </DataTableCell>
              <KycStatusCell kyc_status={u.kyc_status} kyc_level={u.kyc_level} />
              <DataTableCell>
                <UserStatusBadge status={u.status} />
              </DataTableCell>
              <DataTableCell className="text-xs text-gray-500 dark:text-gray-400">
                {u.created_at ? new Date(u.created_at).toLocaleString() : '—'}
              </DataTableCell>
              <DataTableCell align="right">
                <Link
                  href={`/admin/users/${u.id}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg border border-transparent hover:border-blue-200 dark:hover:border-blue-800"
                >
                  <Eye className="w-3.5 h-3.5" />
                  View Details
                </Link>
              </DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTableContainer>

      {isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
        </div>
      )}
    </div>
  );
}
