'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import {
  SectionHeader,
  DataTableContainer,
  DataTableHead,
  DataTableTh,
  DataTableBody,
  DataTableRow,
  DataTableCell,
  ActionButton,
} from '@/components/admin/control-plane';
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

const API_URL = getApiBaseUrl();
const PAGE_SIZE = 20;

interface SpotOrder {
  id: string;
  user_id: string;
  market: string;
  side: string;
  type: string;
  price: string | null;
  quantity: string;
  filled_quantity: string;
  status: string;
  client_order_id: string | null;
  created_at: string;
}

export default function AdminSpotOrdersPage() {
  const { accessToken } = useAdminAuthStore();
  const [orders, setOrders] = useState<SpotOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [marketFilter, setMarketFilter] = useState<string>('');

  const fetchOrders = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(page * PAGE_SIZE));
      if (statusFilter) params.set('status', statusFilter);
      if (marketFilter.trim()) params.set('market', marketFilter.trim().toUpperCase().replace(/-/g, '_'));
      const res = await fetch(`${API_URL}/api/v1/admin/spot/orders?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Failed to load orders');
        return;
      }
      if (data?.success && data?.data) {
        setOrders(data.data.rows ?? []);
        setTotal(data.data.total ?? 0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, statusFilter, marketFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isEmpty = !loading && orders.length === 0;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Order Monitoring"
        subtitle="All spot orders across users. Filter by market or status."
        action={
          <ActionButton icon={<RefreshCw className="w-4 h-4" />} onClick={fetchOrders} loading={loading} variant="secondary">
            Refresh
          </ActionButton>
        }
      />
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 flex items-center gap-3 text-destructive">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      <DataTableContainer
        title="Spot orders"
        subtitle={total > 0 ? `${total} total` : undefined}
        isEmpty={isEmpty && !loading}
        emptyMessage="No orders found. Try changing filters or refresh."
        wrapTable={false}
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : !isEmpty ? (
          <>
            <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-3 bg-muted/30">
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
                className="rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm focus:ring-2 focus:ring-ring"
              >
                <option value="">All statuses</option>
                <option value="OPEN">OPEN</option>
                <option value="PARTIALLY_FILLED">PARTIALLY_FILLED</option>
                <option value="FILLED">FILLED</option>
                <option value="CANCELLED">CANCELLED</option>
                <option value="REJECTED">REJECTED</option>
              </select>
              <input
                type="text"
                placeholder="Market (e.g. BTC_USDT)"
                value={marketFilter}
                onChange={(e) => { setMarketFilter(e.target.value); setPage(0); }}
                className="rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm w-40 placeholder-muted-foreground focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <DataTableHead>
                  <DataTableTh>Time</DataTableTh>
                  <DataTableTh>Order ID</DataTableTh>
                  <DataTableTh>Market</DataTableTh>
                  <DataTableTh>Side</DataTableTh>
                  <DataTableTh>Type</DataTableTh>
                  <DataTableTh align="right">Price</DataTableTh>
                  <DataTableTh align="right">Quantity</DataTableTh>
                  <DataTableTh align="right">Filled</DataTableTh>
                  <DataTableTh>Status</DataTableTh>
                  <DataTableTh>User</DataTableTh>
                </DataTableHead>
                <DataTableBody>
                  {orders.map((o) => (
                    <DataTableRow key={o.id}>
                      <DataTableCell className="text-muted-foreground">
                        {o.created_at ? new Date(o.created_at).toLocaleString() : '—'}
                      </DataTableCell>
                      <DataTableCell mono>
                        {o.id.slice(0, 8)}…
                      </DataTableCell>
                      <DataTableCell>{o.market}</DataTableCell>
                      <DataTableCell>
                        <span className={o.side === 'buy' ? 'text-buy' : 'text-sell'}>{o.side}</span>
                      </DataTableCell>
                      <DataTableCell>{o.type}</DataTableCell>
                      <DataTableCell align="right" mono>{o.price ?? '—'}</DataTableCell>
                      <DataTableCell align="right" mono>{o.quantity}</DataTableCell>
                      <DataTableCell align="right" mono>{o.filled_quantity}</DataTableCell>
                      <DataTableCell>
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-muted text-foreground">{o.status}</span>
                      </DataTableCell>
                      <DataTableCell>
                        <Link href={`/admin/users/${o.user_id}`} className="text-primary hover:underline truncate block max-w-[120px]">
                          {o.user_id.slice(0, 8)}…
                        </Link>
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-border flex items-center justify-between text-sm text-muted-foreground">
                <span>Page {page + 1} of {totalPages} ({total} total)</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                    className="px-3 py-1 rounded border border-border bg-background text-foreground disabled:opacity-50 hover:bg-muted"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-3 py-1 rounded border border-border bg-background text-foreground disabled:opacity-50 hover:bg-muted"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        ) : null}
      </DataTableContainer>
    </div>
  );
}
