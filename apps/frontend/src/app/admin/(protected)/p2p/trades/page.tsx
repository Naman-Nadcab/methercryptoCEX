'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
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
} from '@/components/admin/control-plane';
import { useP2POrders, useP2PDisputes, type P2POrderRow, type P2PDisputeRow } from '@/lib/admin-wallets-api';
import { formatAmountAdmin } from '@/lib/utils';
import { Loader2, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';

const statusOptions = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'released', label: 'Released' },
  { value: 'disputed', label: 'Disputed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const statusVariant: Record<string, 'LIVE' | 'DEGRADED' | 'NEUTRAL' | 'RISK'> = {
  pending: 'DEGRADED',
  paid: 'NEUTRAL',
  released: 'LIVE',
  disputed: 'RISK',
  cancelled: 'NEUTRAL',
};

function OrderStatusBadge({ status }: { status: string }) {
  const variant = statusVariant[status] ?? 'NEUTRAL';
  const label = status.replace(/_/g, ' ');
  return <StatusBadge variant={variant} label={label} showDot={variant !== 'NEUTRAL'} />;
}

export default function P2PTradesPage() {
  const { accessToken } = useAdminAuthStore();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('');
  const [disputeFilter, setDisputeFilter] = useState('all');

  const ordersParams = useMemo(() => ({ page, limit: 20, status: statusFilter === 'all' ? undefined : statusFilter }), [page, statusFilter]);
  const { data: ordersData, isLoading: ordersLoading, isFetching, refetch, isError: ordersFetchError, error: ordersFetchErr } = useP2POrders(accessToken, ordersParams);
  const ordersError = ordersFetchError || (ordersData && !ordersData.success);
  const ordersErrorMsg = ordersError ? (ordersFetchErr instanceof Error ? ordersFetchErr.message : (ordersData?.error?.message ?? 'Failed to load orders')) : undefined;
  const { data: disputesData } = useP2PDisputes(accessToken);

  const orders = ordersData?.data?.orders ?? [];
  const disputes = (disputesData?.data ?? []) as P2PDisputeRow[];
  const disputeByOrderId = useMemo(() => {
    const m = new Map<string, P2PDisputeRow>();
    disputes.forEach((d) => m.set(d.order_id, d));
    return m;
  }, [disputes]);

  const pagination = ordersData?.data?.pagination ?? { page: 1, limit: 20, total: 0 };
  const filteredOrders = useMemo(() => {
    let list = orders;
    if (userFilter.trim()) {
      const q = userFilter.trim().toLowerCase();
      list = list.filter(
        (o) =>
          (o.buyer_email && o.buyer_email.toLowerCase().includes(q)) ||
          (o.seller_email && o.seller_email.toLowerCase().includes(q)) ||
          (o.buyer_id?.toLowerCase().includes(q)) ||
          (o.seller_id?.toLowerCase().includes(q))
      );
    }
    if (disputeFilter === 'disputed') list = list.filter((o) => disputeByOrderId.has(o.id));
    if (disputeFilter === 'no_dispute') list = list.filter((o) => !disputeByOrderId.has(o.id));
    return list;
  }, [orders, userFilter, disputeFilter, disputeByOrderId]);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="P2P Trades Explorer"
        subtitle="View orders and open disputes. Actions are on the dispute detail page."
        action={
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin inline" /> : '↻ Refresh'}
          </button>
        }
      />

      <Panel className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">User (buyer/seller email or ID)</label>
            <input
              type="text"
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
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
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Has dispute</label>
            <select
              value={disputeFilter}
              onChange={(e) => setDisputeFilter(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
            >
              <option value="all">All</option>
              <option value="disputed">Has dispute</option>
              <option value="no_dispute">No dispute</option>
            </select>
          </div>
        </div>
      </Panel>

      <DataTableContainer
        title="P2P Orders"
        subtitle={`${filteredOrders.length} of ${pagination.total} orders${statusFilter !== 'all' || disputeFilter !== 'all' || userFilter.trim() ? ` (filtered)` : ''}`}
        emptyMessage="No trades found"
        isEmpty={!ordersLoading && !ordersError && filteredOrders.length === 0}
        error={ordersErrorMsg}
        headerAction={
          pagination.total > 20 && disputeFilter === 'all' && !userFilter.trim() ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1 || ordersLoading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-50 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-gray-500 dark:text-gray-400 px-2">{page} / {Math.ceil(pagination.total / 20) || 1}</span>
              <button
                type="button"
                disabled={page >= Math.ceil(pagination.total / 20) || ordersLoading}
                onClick={() => setPage((p) => p + 1)}
                className="p-1.5 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-50 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : null
        }
      >
        <DataTableHead>
          <DataTableTh>Trade ID</DataTableTh>
          <DataTableTh>Buyer</DataTableTh>
          <DataTableTh>Seller</DataTableTh>
          <DataTableTh>Asset</DataTableTh>
          <DataTableTh align="right">Amount</DataTableTh>
          <DataTableTh>Status</DataTableTh>
          <DataTableTh>Escrow state</DataTableTh>
          <DataTableTh>Created At</DataTableTh>
          <DataTableTh align="right">Actions</DataTableTh>
        </DataTableHead>
        <DataTableBody>
          {filteredOrders.map((o) => {
            const dispute = disputeByOrderId.get(o.id);
            return (
              <DataTableRow key={o.id}>
                <DataTableCell mono className="text-gray-700 dark:text-gray-300" title={o.id}>
                  {o.id.slice(0, 8)}…
                </DataTableCell>
                <DataTableCell>
                  <Link href={`/admin/users/${o.buyer_id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                    {o.buyer_email ?? o.buyer_id}
                  </Link>
                  {o.buyer_username ? <span className="text-gray-500 dark:text-gray-400 text-xs block">{String(o.buyer_username)}</span> : null}
                </DataTableCell>
                <DataTableCell>
                  <Link href={`/admin/users/${o.seller_id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                    {o.seller_email ?? o.seller_id}
                  </Link>
                  {o.seller_username ? <span className="text-gray-500 dark:text-gray-400 text-xs block">{String(o.seller_username)}</span> : null}
                </DataTableCell>
                <DataTableCell>{o.crypto_symbol ?? '—'}</DataTableCell>
                <DataTableCell align="right" mono>
                  {formatAmountAdmin(o.crypto_amount ?? '0')}
                </DataTableCell>
                <DataTableCell><OrderStatusBadge status={o.status} /></DataTableCell>
                <DataTableCell>
                  {dispute ? <StatusBadge variant="RISK" label="In dispute" showDot /> : <span className="text-gray-500 text-xs">—</span>}
                </DataTableCell>
                <DataTableCell className="text-xs text-gray-500 dark:text-gray-400">
                  {new Date(o.created_at).toLocaleString()}
                </DataTableCell>
                <DataTableCell align="right">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {(o as unknown as { ad_id?: string }).ad_id && (
                      <Link href={`/admin/p2p/orders?ad_id=${(o as unknown as { ad_id: string }).ad_id}`} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Source Ad</Link>
                    )}
                    <Link href={`/admin/p2p/orders`} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Order</Link>
                    {dispute ? (
                      <Link href={`/admin/p2p/disputes/${dispute.id}`} className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline">
                        Dispute <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    ) : null}
                  </div>
                </DataTableCell>
              </DataTableRow>
            );
          })}
        </DataTableBody>
      </DataTableContainer>

      {ordersLoading && orders.length > 0 && (
        <div className="flex justify-center py-4">
          <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      )}
    </div>
  );
}
