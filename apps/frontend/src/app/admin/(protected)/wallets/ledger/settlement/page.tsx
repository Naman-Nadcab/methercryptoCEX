'use client';

import { useState, useEffect, useCallback } from 'react';
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
  ActionButton,
} from '@/components/admin/control-plane';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface SettlementLedgerEntry {
  id: number;
  settlement_event_id: number;
  user_id: string;
  asset: string;
  delta: string;
  prev_hash: string | null;
  entry_hash: string | null;
  created_at: string;
}

export default function SettlementLedgerPage() {
  const { accessToken } = useAdminAuthStore();
  const [entries, setEntries] = useState<SettlementLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<{ page: number; limit: number; total: number; totalPages: number } | null>(null);
  const [userId, setUserId] = useState('');
  const [settlementEventId, setSettlementEventId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchEntries = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (userId.trim()) params.set('user_id', userId.trim());
      if (settlementEventId.trim()) params.set('settlement_event_id', settlementEventId.trim());
      if (dateFrom.trim()) params.set('date_from', dateFrom.trim());
      if (dateTo.trim()) params.set('date_to', dateTo.trim());
      const res = await fetch(`${API_URL}/api/v1/admin/ledger/settlement?${params}`, {
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
  }, [accessToken, page, userId, settlementEventId, dateFrom, dateTo]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Settlement Ledger"
        subtitle="Read-only audit trail of settlement (trading) ledger entries"
        action={<ActionButton variant="secondary" onClick={() => fetchEntries()} loading={loading}>Refresh</ActionButton>}
      />
      <Panel title="Filters" subtitle="Filter by user, settlement event, date range">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <input
            type="text"
            placeholder="User ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
          />
          <input
            type="text"
            placeholder="Settlement event ID"
            value={settlementEventId}
            onChange={(e) => setSettlementEventId(e.target.value)}
            className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white"
          />
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
        emptyMessage="No settlement ledger entries"
        isEmpty={!loading && entries.length === 0}
      >
        <DataTableHead>
          <DataTableTh>ID</DataTableTh>
          <DataTableTh>Event ID</DataTableTh>
          <DataTableTh>User</DataTableTh>
          <DataTableTh>Asset</DataTableTh>
          <DataTableTh align="right">Delta</DataTableTh>
          <DataTableTh>Entry hash</DataTableTh>
          <DataTableTh>Created</DataTableTh>
        </DataTableHead>
        <DataTableBody>
          {entries.map((e) => (
            <DataTableRow key={e.id}>
              <DataTableCell mono className="text-xs">{e.id}</DataTableCell>
              <DataTableCell mono>{e.settlement_event_id}</DataTableCell>
              <DataTableCell mono className="text-xs max-w-[100px] truncate" title={e.user_id}>{e.user_id}</DataTableCell>
              <DataTableCell>{e.asset}</DataTableCell>
              <DataTableCell align="right" mono>{e.delta}</DataTableCell>
              <DataTableCell mono className="text-xs max-w-[80px] truncate" title={e.entry_hash ?? ''}>{e.entry_hash ? `${e.entry_hash.slice(0, 8)}…` : '—'}</DataTableCell>
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
