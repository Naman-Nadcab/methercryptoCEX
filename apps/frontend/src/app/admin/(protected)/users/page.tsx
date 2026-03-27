'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  useAdminUsersList,
  type AdminUserListItem,
  type ListFilters,
} from '@/lib/admin-users-api';
import {
  getUserGrowth,
  getRevenue,
  getDepositsBuckets,
  getWithdrawalsBuckets,
} from '@/lib/admin/analytics';
import {
  SectionHeader,
  Panel,
  StatusBadge,
} from '@/components/admin/control-plane';
import { ChartCard } from '@/components/admin/v2/dashboard';
import { UserGrowthChart, RevenueChart, DepositWithdrawChart } from '@/components/admin/charts';
import { DataTable } from '@/components/admin/v2/tables';
import type { ColumnDef } from '@tanstack/react-table';
import { Eye } from 'lucide-react';

function formatBucketDay(bucket: string): string {
  try {
    return new Date(bucket).toLocaleDateString('en-US', { weekday: 'short' });
  } catch {
    return bucket?.slice(0, 10) ?? '—';
  }
}

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

export default function AdminUsersPage() {
  const { accessToken } = useAdminAuthStore();
  const [search, setSearch] = useState('');
  const [accountStatus, setAccountStatus] = useState('all');
  const [kycStatus, setKycStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const filters: ListFilters = {
    page,
    limit: pageSize,
    search: search.trim() || undefined,
    status: accountStatus === 'all' ? undefined : accountStatus,
    kycLevel: kycStatus === 'all' ? undefined : kycStatus,
  };

  const { data, isLoading, isError, error } = useAdminUsersList(accessToken, filters);

  const { data: userGrowthRes } = useQuery({
    queryKey: ['admin', 'analytics', 'user-growth', accessToken],
    queryFn: () => getUserGrowth(accessToken, '7d'),
    enabled: !!accessToken,
  });
  const { data: revenueRes } = useQuery({
    queryKey: ['admin', 'analytics', 'revenue', accessToken],
    queryFn: () => getRevenue(accessToken, '7d'),
    enabled: !!accessToken,
  });
  const { data: depositsRes } = useQuery({
    queryKey: ['admin', 'analytics', 'deposits', accessToken],
    queryFn: () => getDepositsBuckets(accessToken, '7d'),
    enabled: !!accessToken,
  });
  const { data: withdrawalsRes } = useQuery({
    queryKey: ['admin', 'analytics', 'withdrawals', accessToken],
    queryFn: () => getWithdrawalsBuckets(accessToken, '7d'),
    enabled: !!accessToken,
  });

  const userGrowthChartData = useMemo(() => {
    const buckets = (userGrowthRes?.data as { buckets?: Array<{ bucket?: string; count?: number }> })?.buckets ?? [];
    let cumulative = 0;
    return buckets.map((b) => {
      const count = Number(b.count ?? 0);
      cumulative += count;
      return { date: formatBucketDay(b.bucket ?? ''), users: cumulative, new: count };
    });
  }, [userGrowthRes?.data]);

  const revenueChartData = useMemo(() => {
    const buckets = (revenueRes?.data as { buckets?: Array<{ bucket?: string; revenue?: number }> })?.buckets ?? [];
    return buckets.map((b) => ({ day: formatBucketDay(b.bucket ?? ''), revenue: Number(b.revenue ?? 0) }));
  }, [revenueRes?.data]);

  const depositWithdrawChartData = useMemo(() => {
    const depBuckets = (depositsRes?.data as { buckets?: Array<{ bucket?: string; volume?: number }> })?.buckets ?? [];
    const witBuckets = (withdrawalsRes?.data as { buckets?: Array<{ bucket?: string; volume?: number }> })?.buckets ?? [];
    const byDate: Record<string, { day: string; deposit: number; withdraw: number }> = {};
    depBuckets.forEach((b) => {
      const key = (b.bucket ?? '').slice(0, 10);
      const day = formatBucketDay(b.bucket ?? '');
      if (!byDate[key]) byDate[key] = { day, deposit: 0, withdraw: 0 };
      byDate[key].deposit = Number(b.volume ?? 0) / 1000;
    });
    witBuckets.forEach((b) => {
      const key = (b.bucket ?? '').slice(0, 10);
      const day = formatBucketDay(b.bucket ?? '');
      if (!byDate[key]) byDate[key] = { day, deposit: 0, withdraw: 0 };
      byDate[key].withdraw = Number(b.volume ?? 0) / 1000;
    });
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);
  }, [depositsRes?.data, withdrawalsRes?.data]);

  const users: AdminUserListItem[] = data?.data?.users ?? [];
  const pagination = data?.data?.pagination ?? { page: 1, limit: 20, total: 0 };
  const total = pagination.total;

  const columns = useMemo<ColumnDef<AdminUserListItem>[]>(
    () => [
      {
        id: 'id',
        header: 'User ID',
        accessorKey: 'id',
        cell: ({ getValue }) => {
          const id = getValue() as string;
          return (
            <span className="max-w-[120px] truncate block font-mono text-[var(--admin-text)]" title={id}>
              {id?.slice(0, 8)}…
            </span>
          );
        },
        enableSorting: true,
      },
      {
        id: 'email',
        header: 'Email / Identifier',
        accessorKey: 'email',
        cell: ({ row }) => {
          const u = row.original;
          return (
            <div className="max-w-[200px]">
              <span className="truncate block text-[var(--admin-text)]" title={u.email}>
                {u.email || '—'}
              </span>
              {u.username && (
                <span className="text-xs text-[var(--admin-text-muted)] truncate block">@{u.username}</span>
              )}
            </div>
          );
        },
        enableSorting: true,
      },
      {
        id: 'kyc',
        header: 'KYC Status',
        cell: ({ row }) => {
          const u = row.original;
          const display = u.kyc_status ?? (u.kyc_level != null ? `Tier ${u.kyc_level}` : null);
          return display ? (
            <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-[var(--admin-input-bg)] text-[var(--admin-text)]">
              {display}
            </span>
          ) : (
            '—'
          );
        },
      },
      {
        id: 'status',
        header: 'Account Status',
        accessorKey: 'status',
        cell: ({ getValue }) => <UserStatusBadge status={String(getValue() ?? '')} />,
        enableSorting: true,
      },
      {
        id: 'created_at',
        header: 'Created At',
        accessorKey: 'created_at',
        cell: ({ getValue }) => (
          <span className="text-xs text-[var(--admin-text-muted)]">
            {getValue() ? new Date(String(getValue())).toLocaleString() : '—'}
          </span>
        ),
        enableSorting: true,
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => (
          <Link
            href={`/admin/users/${row.original.id}`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[var(--admin-primary)] hover:bg-[var(--admin-active-bg)] rounded-lg border border-transparent"
          >
            <Eye className="w-3.5 h-3.5" />
            View Details
          </Link>
        ),
        enableSorting: false,
      },
    ],
    []
  );

  return (
    <div className="space-y-5">
      <SectionHeader
        title="User Management"
        subtitle="Explore and manage user accounts — analytics and controls"
      />

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <ChartCard title="User growth" subtitle="Cumulative — 7d" accent="primary">
          <div className="h-[220px]">
            <UserGrowthChart data={userGrowthChartData.length > 0 ? userGrowthChartData : undefined} />
          </div>
        </ChartCard>
        <ChartCard title="Revenue trend" subtitle="7d" accent="success">
          <div className="h-[220px]">
            <RevenueChart data={revenueChartData.length > 0 ? revenueChartData : undefined} />
          </div>
        </ChartCard>
        <ChartCard title="Deposit trends" subtitle="7d (k USDT)" accent="success">
          <div className="h-[220px]">
            <DepositWithdrawChart data={depositWithdrawChartData.length > 0 ? depositWithdrawChartData : undefined} />
          </div>
        </ChartCard>
        <ChartCard title="Withdraw trends" subtitle="7d (k USDT)" accent="warning">
          <div className="h-[220px]">
            <DepositWithdrawChart data={depositWithdrawChartData.length > 0 ? depositWithdrawChartData : undefined} />
          </div>
        </ChartCard>
      </section>

      <Panel title="Filters" subtitle="Search by email, phone, or username. Filter by account and KYC." accent="primary">
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

      <DataTable<AdminUserListItem>
        data={users}
        columns={columns}
        rowCount={total}
        manualPagination
        manualSorting={false}
        pageSize={pageSize}
        pagination={{ pageIndex: page - 1, pageSize }}
        onPaginationChange={(updater) => {
          const next = updater({ pageIndex: page - 1, pageSize });
          setPage(next.pageIndex + 1);
          setPageSize(next.pageSize);
        }}
        searchValue={search}
        onSearchChange={(v) => { setSearch(v); setPage(1); }}
        showSearch
        showExport
        exportFilename="admin-users"
        title="User explorer"
        subtitle={`${total} total`}
        emptyMessage={isError ? (error instanceof Error ? error.message : 'Failed to load users') : 'No users found'}
        isLoading={isLoading}
      />
    </div>
  );
}
