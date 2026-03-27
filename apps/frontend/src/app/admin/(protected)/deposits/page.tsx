'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { Search, AlertCircle, CheckCircle2, Copy } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader } from '@/components/admin/control-plane';
import { DataTable } from '@/components/admin/v2/tables';
import { useDepositsList } from '@/hooks/admin/useAdminDashboard';
import type { ColumnDef } from '@tanstack/react-table';

interface DepositRow {
  deposit_id: string;
  user_id: string;
  user_email: string;
  chain_id: string;
  chain_name: string;
  chain_symbol: string;
  token_id: string;
  token_symbol: string;
  token_name: string;
  amount: string;
  tx_hash: string | null;
  confirmations: number;
  required_confirmations: number;
  status: string;
  credited: boolean;
  credited_at: string | null;
  created_at: string;
  is_flagged: boolean;
}

interface BlockchainOption {
  id: string;
  chain_name: string;
  chain_symbol: string;
  currencies?: { id: string; symbol: string; name: string }[];
}

export default function DepositsPage() {
  const { accessToken } = useAdminAuthStore();
  const [userSearch, setUserSearch] = useState('');
  const [chainId, setChainId] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [chainOptions, setChainOptions] = useState<BlockchainOption[]>([]);

  const params = useMemo(
    () => ({
      page,
      limit: pageSize,
      user: userSearch.trim() || undefined,
      chain: chainId || undefined,
      token: tokenId || undefined,
      status: statusFilter === 'all' ? undefined : statusFilter,
      flagged: flaggedOnly || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    [page, pageSize, userSearch, chainId, tokenId, statusFilter, flaggedOnly, dateFrom, dateTo]
  );

  const { data, isLoading, isError, error } = useDepositsList(params);

  useEffect(() => {
    if (!accessToken) return;
    const apiUrl = getApiBaseUrl();
    fetch(`${apiUrl}/api/v1/admin/settings/blockchains`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((d) => {
        if (d?.success && d?.data?.blockchains) setChainOptions(d.data.blockchains);
      })
      .catch(() => {});
  }, [accessToken]);

  const tokenOptions = useMemo(() => {
    const tokens: { id: string; symbol: string; name: string; chain_name?: string }[] = [];
    chainOptions.forEach((b) => {
      (b.currencies || []).forEach((c) => {
        tokens.push({ id: c.id, symbol: c.symbol, name: c.name, chain_name: b.chain_name });
      });
    });
    return tokens;
  }, [chainOptions]);

  const stats = data?.data?.stats as Record<string, string> | undefined;
  const deposits = (data?.data?.deposits ?? []) as DepositRow[];
  const pagination = data?.data?.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 1 };
  const total = pagination.total;

  const applyFilters = useCallback(() => setPage(1), []);

  const copyTxHash = (tx: string) => navigator.clipboard.writeText(tx);

  const getStatusBadge = (status: string, credited: boolean) => {
    if (credited) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-[var(--admin-success)]/20 text-[var(--admin-success)] border border-[var(--admin-success)]/30">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Credited
        </span>
      );
    }
    const colors: Record<string, string> = {
      pending: 'bg-yellow-500/20 text-yellow-600 border-yellow-500/30',
      confirming: 'bg-blue-500/20 text-blue-600 border-blue-500/30',
      completed: 'bg-gray-500/20 text-gray-600 border-gray-500/30',
      failed: 'bg-red-500/20 text-red-600 border-red-500/30',
    };
    const style = colors[status] || 'bg-gray-500/20 text-gray-600 border-gray-500/30';
    return (
      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium border ${style}`}>
        {status}
      </span>
    );
  };

  const shortenHash = (hash: string | null) => {
    if (!hash) return '—';
    if (hash.length <= 14) return hash;
    return `${hash.slice(0, 6)}…${hash.slice(-6)}`;
  };

  const columns = useMemo<ColumnDef<DepositRow>[]>(
    () => [
      {
        id: 'user_email',
        header: 'User',
        accessorKey: 'user_email',
        cell: ({ getValue }) => (
          <span className="font-medium text-[var(--admin-text)]">{String(getValue() ?? '—')}</span>
        ),
        enableSorting: false,
      },
      {
        id: 'chain',
        header: 'Chain',
        cell: ({ row }) => (
          <span className="text-[var(--admin-text-muted)]">{row.original.chain_name || row.original.chain_symbol}</span>
        ),
        enableSorting: false,
      },
      {
        id: 'token_symbol',
        header: 'Token',
        accessorKey: 'token_symbol',
        cell: ({ getValue }) => (
          <span className="text-[var(--admin-text-muted)]">{String(getValue() ?? '—')}</span>
        ),
        enableSorting: false,
      },
      {
        id: 'amount',
        header: 'Amount',
        cell: ({ row }) => {
          const d = row.original;
          const amt = typeof d.amount === 'string' ? parseFloat(d.amount).toFixed(8) : Number(d.amount).toFixed(8);
          return (
            <span className="text-[var(--admin-text)] font-medium">
              {amt} <span className="text-[var(--admin-text-muted)] ml-1">{d.token_symbol}</span>
            </span>
          );
        },
        enableSorting: false,
      },
      {
        id: 'tx_hash',
        header: 'Tx Hash',
        cell: ({ row }) => {
          const hash = row.original.tx_hash;
          if (!hash)
            return <span className="text-[var(--admin-text-muted)]">—</span>;
          return (
            <button
              type="button"
              onClick={() => copyTxHash(hash)}
              className="inline-flex items-center gap-1 text-[var(--admin-primary)] hover:underline font-mono text-xs"
              title={hash}
            >
              {shortenHash(hash)}
              <Copy className="w-3.5 h-3.5" />
            </button>
          );
        },
        enableSorting: false,
      },
      {
        id: 'confirmations',
        header: 'Confirmations',
        cell: ({ row }) => (
          <span className="text-[var(--admin-text-muted)]">
            {row.original.confirmations} / {row.original.required_confirmations}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => getStatusBadge(row.original.status, row.original.credited),
        enableSorting: false,
      },
      {
        id: 'credited_at',
        header: 'Credited at',
        cell: ({ row }) => (
          <span className="text-sm text-[var(--admin-text-muted)]">
            {row.original.credited_at ? new Date(row.original.credited_at).toLocaleString() : '—'}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: 'created_at',
        header: 'Created at',
        accessorKey: 'created_at',
        cell: ({ getValue }) => (
          <span className="text-sm text-[var(--admin-text-muted)]">
            {getValue() ? new Date(String(getValue())).toLocaleString() : '—'}
          </span>
        ),
        enableSorting: false,
      },
    ],
    []
  );

  if (isError && !deposits.length && !isLoading) {
    return (
      <div className="space-y-6">
        <SectionHeader title="Deposits" subtitle="Manage user deposits" />
        <div className="admin-card p-6 flex items-center gap-4 border-[var(--admin-danger)]/30 bg-[var(--admin-danger)]/10">
          <AlertCircle className="w-10 h-10 text-[var(--admin-danger)] shrink-0" />
          <div>
            <p className="font-medium text-[var(--admin-text)]">Failed to load deposits</p>
            <p className="text-sm text-[var(--admin-text-muted)] mt-1">{error instanceof Error ? error.message : 'Unknown error'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="Deposits" subtitle="View and filter user deposits. Credited rows are highlighted." />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {[
          { label: 'Total', value: stats?.total ?? 0, className: 'admin-card' },
          { label: 'Pending', value: stats?.pending ?? 0, className: 'admin-card border-l-[var(--admin-warning)]' },
          { label: 'Confirming', value: stats?.confirming ?? 0, className: 'admin-card border-l-[var(--admin-primary)]' },
          { label: 'Completed', value: stats?.completed ?? 0, className: 'admin-card border-l-[var(--admin-success)]' },
          { label: 'Failed', value: stats?.failed ?? 0, className: 'admin-card border-l-[var(--admin-danger)]' },
          { label: 'Flagged', value: stats?.flagged ?? 0, className: 'admin-card border-l-orange-500' },
        ].map(({ label, value, className }) => (
          <div key={label} className={`p-4 ${className}`}>
            <p className="text-sm text-[var(--admin-text-muted)]">{label}</p>
            <p className="text-2xl font-bold text-[var(--admin-text)] mt-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="admin-card p-4">
        <p className="text-sm font-medium text-[var(--admin-text)] mb-3">Filters</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--admin-text-muted)]" />
            <input
              type="text"
              placeholder="User (email)"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--admin-card-border)] bg-[var(--admin-input-bg)] text-sm text-[var(--admin-text)] placeholder-[var(--admin-text-muted)]"
            />
          </div>
          <select
            value={chainId}
            onChange={(e) => { setChainId(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg border border-[var(--admin-card-border)] bg-[var(--admin-input-bg)] text-sm text-[var(--admin-text)]"
          >
            <option value="">All chains</option>
            {chainOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.chain_name} ({c.chain_symbol})</option>
            ))}
          </select>
          <select
            value={tokenId}
            onChange={(e) => { setTokenId(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg border border-[var(--admin-card-border)] bg-[var(--admin-input-bg)] text-sm text-[var(--admin-text)]"
          >
            <option value="">All tokens</option>
            {tokenOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.symbol}{t.chain_name ? ` (${t.chain_name})` : ''}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg border border-[var(--admin-card-border)] bg-[var(--admin-input-bg)] text-sm text-[var(--admin-text)]"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="confirming">Confirming</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--admin-card-border)] bg-[var(--admin-input-bg)] text-sm text-[var(--admin-text)] cursor-pointer">
            <input
              type="checkbox"
              checked={flaggedOnly}
              onChange={(e) => { setFlaggedOnly(e.target.checked); setPage(1); }}
              className="rounded border-[var(--admin-card-border)] text-amber-500 focus:ring-amber-500"
            />
            Flagged only
          </label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 rounded-lg border border-[var(--admin-card-border)] bg-[var(--admin-input-bg)] text-sm text-[var(--admin-text)]"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 rounded-lg border border-[var(--admin-card-border)] bg-[var(--admin-input-bg)] text-sm text-[var(--admin-text)]"
          />
        </div>
        <div className="mt-3 flex justify-end">
          <button
            onClick={applyFilters}
            disabled={isLoading}
            className="px-4 py-2 rounded-lg bg-[var(--admin-primary)] hover:opacity-90 disabled:opacity-50 text-white text-sm font-medium"
          >
            Apply filters
          </button>
        </div>
      </div>

      <DataTable<DepositRow>
        data={deposits}
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
        showSearch={false}
        showExport
        exportFilename="admin-deposits"
        title="Deposits"
        subtitle={`${total} total`}
        emptyMessage="No deposits found. Try adjusting filters or date range."
        isLoading={isLoading}
        getRowClassName={(row) => (row.credited ? 'bg-[var(--admin-success)]/5' : undefined)}
      />
    </div>
  );
}
