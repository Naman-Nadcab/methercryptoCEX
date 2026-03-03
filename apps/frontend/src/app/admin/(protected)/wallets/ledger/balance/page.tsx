'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import {
  SectionHeader,
  Panel,
  DataTableContainer,
  DataTableHead,
  DataTableTh,
  DataTableBody,
  DataTableRow,
  DataTableCell,
  ActionButton,
} from '@/components/admin/control-plane';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface BalanceLedgerEntry {
  id: number;
  user_id: string;
  currency_id: string;
  reference_type: string;
  reference_id: string;
  debit: string;
  credit: string;
  balance_before: string;
  balance_after: string;
  balance_type: string;
  description: string | null;
  created_at: string;
}

export default function BalanceLedgerPage() {
  const { accessToken } = useAdminAuthStore();
  const [entries, setEntries] = useState<BalanceLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<{ page: number; limit: number; total: number; totalPages: number } | null>(null);
  const [userId, setUserId] = useState('');
  const [currencyId, setCurrencyId] = useState('');
  const [referenceType, setReferenceType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchEntries = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (userId.trim()) params.set('user_id', userId.trim());
      if (currencyId.trim()) params.set('currency_id', currencyId.trim());
      if (referenceType.trim()) params.set('reference_type', referenceType.trim());
      if (dateFrom.trim()) params.set('date_from', dateFrom.trim());
      if (dateTo.trim()) params.set('date_to', dateTo.trim());
      const res = await fetch(`${API_URL}/api/v1/admin/ledger/balance?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (data?.success && data?.data) {
        setEntries(data.data.entries ?? []);
        setPagination(data.data.pagination ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, userId, currencyId, referenceType, dateFrom, dateTo]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Balance Ledger"
        subtitle="Read-only audit trail of funding account balance mutations"
        action={<ActionButton variant="secondary" onClick={() => fetchEntries()} loading={loading}>Refresh</ActionButton>}
      />
      <Panel title="Filters" subtitle="Filter by user, currency, reference type, date range">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <input
            type="text"
            placeholder="User ID (UUID)"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
          />
          <input
            type="text"
            placeholder="Currency ID"
            value={currencyId}
            onChange={(e) => setCurrencyId(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
          />
          <select
            value={referenceType}
            onChange={(e) => setReferenceType(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
          >
            <option value="">All types</option>
            <option value="deposit">deposit</option>
            <option value="withdrawal">withdrawal</option>
            <option value="trade_buy">trade_buy</option>
            <option value="trade_sell">trade_sell</option>
            <option value="trade_fee">trade_fee</option>
            <option value="p2p_escrow_lock">p2p_escrow_lock</option>
            <option value="p2p_escrow_release">p2p_escrow_release</option>
            <option value="internal_transfer">internal_transfer</option>
            <option value="adjustment">adjustment</option>
          </select>
          <input
            type="datetime-local"
            placeholder="From"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
          />
          <input
            type="datetime-local"
            placeholder="To"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
          />
          <button
            type="button"
            onClick={() => { setPage(1); fetchEntries(); }}
            className="px-3 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Apply
          </button>
        </div>
      </Panel>
      <DataTableContainer
        title="Entries"
        subtitle={pagination ? `${pagination.total} total` : ''}
        headerAction={
          pagination && pagination.totalPages > 1 ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={pagination.page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-50 text-gray-600 dark:text-gray-400"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-gray-500 px-2">{pagination.page} / {pagination.totalPages}</span>
              <button
                type="button"
                disabled={pagination.page >= pagination.totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="p-1.5 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-50 text-gray-600 dark:text-gray-400"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : null
        }
        emptyMessage="No ledger entries"
        isEmpty={!loading && entries.length === 0}
      >
        <DataTableHead>
          <DataTableTh>ID</DataTableTh>
          <DataTableTh>User</DataTableTh>
          <DataTableTh>Ref type</DataTableTh>
          <DataTableTh>Ref ID</DataTableTh>
          <DataTableTh align="right">Debit</DataTableTh>
          <DataTableTh align="right">Credit</DataTableTh>
          <DataTableTh>Balance type</DataTableTh>
          <DataTableTh>Created</DataTableTh>
        </DataTableHead>
        <DataTableBody>
          {entries.map((e) => (
            <DataTableRow key={e.id}>
              <DataTableCell mono className="text-xs">{e.id}</DataTableCell>
              <DataTableCell mono className="text-xs max-w-[100px] truncate" title={e.user_id}>{e.user_id?.slice(0, 8)}…</DataTableCell>
              <DataTableCell>{e.reference_type}</DataTableCell>
              <DataTableCell mono className="text-xs max-w-[100px] truncate" title={e.reference_id}>{e.reference_id?.slice(0, 8)}…</DataTableCell>
              <DataTableCell align="right" mono>{e.debit}</DataTableCell>
              <DataTableCell align="right" mono>{e.credit}</DataTableCell>
              <DataTableCell>{e.balance_type}</DataTableCell>
              <DataTableCell className="text-xs text-gray-500">{new Date(e.created_at).toLocaleString()}</DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTableContainer>
      {loading && entries.length > 0 && (
        <div className="flex justify-center py-4">
          <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      )}
    </div>
  );
}
