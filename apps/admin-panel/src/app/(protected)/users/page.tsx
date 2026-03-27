'use client';

import { useMemo, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { getUsers, updateUserStatus, type AdminUserRow } from '@/lib/users-api';
import { UserFilters, type UserFiltersValues } from '@/components/users/UserFilters';
import { UsersTable } from '@/components/users/UsersTable';

const DEFAULT_FILTERS: UserFiltersValues = {
  search: '',
  status: 'all',
  kycStatus: 'all',
  country: 'all',
  signupDate: 'all',
};

function downloadCsv(rows: AdminUserRow[]) {
  const headers = ['User Name', 'Email', 'KYC', 'Balance', 'Status', 'Country', 'Created', 'ID'];
  const escape = (v: unknown) => (v == null ? '' : String(v).replace(/"/g, '""'));
  const rowToCells = (r: AdminUserRow) => {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.username || r.email || r.id?.slice(0, 8);
    return [name, r.email ?? '', r.kyc_status ?? '', r.total_balance ?? '', r.status ?? '', r.country_code ?? '', r.created_at ?? '', r.id ?? ''];
  };
  const csv = [headers.join(','), ...rows.map((r) => rowToCells(r).map(escape).map((c) => `"${c}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `users-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function UsersPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<UserFiltersValues>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const queryParams = useMemo(() => {
    const params: Record<string, string | number> = { page, limit: pageSize };
    if (filters.search?.trim()) params.search = filters.search.trim();
    if (filters.status && filters.status !== 'all') params.status = filters.status;
    if (filters.kycStatus && filters.kycStatus !== 'all') params.kycLevel = filters.kycStatus;
    return params;
  }, [filters, page]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'users', token, queryParams],
    queryFn: () => getUsers(token, queryParams),
    enabled: !!token,
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: 'active' | 'suspended' | 'locked'; reason?: string }) =>
      updateUserStatus(token, id, { status, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  const handleSuspend = useCallback(
    (user: AdminUserRow) => {
      if (confirm(`Suspend user ${user.email ?? user.id}?`)) {
        updateStatus.mutate({ id: user.id, status: 'suspended' });
      }
    },
    [updateStatus]
  );
  const handleBan = useCallback(
    (user: AdminUserRow) => {
      if (confirm(`Ban user ${user.email ?? user.id}? This sets status to locked.`)) {
        updateStatus.mutate({ id: user.id, status: 'locked' });
      }
    },
    [updateStatus]
  );

  const users = data?.data?.users ?? [];
  const pagination = data?.data?.pagination;
  const total = pagination?.total ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Users</h1>
        <p className="mt-1 text-sm text-admin-muted">Manage all exchange users.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <UserFilters
          values={filters}
          onChange={setFilters}
          onExportCsv={() => downloadCsv(users)}
        />
      </div>

      <div className="rounded-[12px] bg-white p-6 shadow-[0_1px_3px_0_rgba(0,0,0,0.08)]">
        {isError && (
          <p className="mb-4 text-sm text-admin-danger">
            {(error as { message?: string })?.message ?? 'Failed to load users'}
          </p>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-admin-muted">Loading users…</div>
        ) : (
          <UsersTable
            data={users}
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onExportCsv={downloadCsv}
            onSuspend={handleSuspend}
            onBan={handleBan}
          />
        )}
      </div>
    </div>
  );
}
