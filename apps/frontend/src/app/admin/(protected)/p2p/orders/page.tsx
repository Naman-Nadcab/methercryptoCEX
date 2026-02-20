'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
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
import { useP2POrders, type P2POrderRow } from '@/lib/admin-wallets-api';
import { formatAmountAdmin } from '@/lib/utils';
import { Loader2, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const statusOptions = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'payment_pending', label: 'Payment Pending' },
  { value: 'payment_confirmed', label: 'Paid' },
  { value: 'completed', label: 'Completed' },
  { value: 'disputed', label: 'Disputed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' },
];

const statusVariant: Record<string, 'LIVE' | 'DEGRADED' | 'NEUTRAL' | 'RISK'> = {
  pending: 'DEGRADED',
  payment_pending: 'DEGRADED',
  payment_confirmed: 'NEUTRAL',
  completed: 'LIVE',
  disputed: 'RISK',
  cancelled: 'NEUTRAL',
  expired: 'NEUTRAL',
};

function OrderStatusBadge({ status }: { status: string }) {
  const variant = statusVariant[status] ?? 'NEUTRAL';
  const label = (status || '').replace(/_/g, ' ');
  return <StatusBadge variant={variant} label={label || '—'} showDot={variant !== 'NEUTRAL'} />;
}

interface AdRow {
  id: string;
  user_id: string;
  email?: string;
  username?: string | null;
  ad_type: string;
  status: string;
  crypto_symbol?: string;
  price?: string;
  min_amount?: string;
  max_amount?: string;
  created_at: string;
  [key: string]: unknown;
}

export default function P2POrdersPage() {
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get('ad_id') ? 'orders' : (searchParams.get('tab') === 'ads' ? 'ads' : 'orders');
  const statusFromUrl = searchParams.get('status') || 'all';
  const adIdFromUrl = searchParams.get('ad_id') || undefined;
  const { accessToken } = useAdminAuthStore();
  const [tab, setTab] = useState<'orders' | 'ads'>(tabFromUrl);
  const [statusFilter, setStatusFilter] = useState(statusFromUrl);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setTab(tabFromUrl);
  }, [tabFromUrl]);
  useEffect(() => {
    setStatusFilter(statusFromUrl);
    setPage(1);
  }, [statusFromUrl]);

  const ordersParams = { page, limit: 20, status: statusFilter === 'all' ? undefined : statusFilter, ad_id: adIdFromUrl };
  const { data: ordersData, isLoading: ordersLoading, isError: ordersError } = useP2POrders(accessToken, ordersParams, true);
  const orders = ordersData?.data?.orders ?? [];
  const ordersPagination = ordersData?.data?.pagination ?? { page: 1, limit: 20, total: 0 };
  const ordersErrorMsg = ordersError || (ordersData && !ordersData.success) ? (ordersData?.error?.message ?? 'Failed to load orders') : undefined;

  const [ads, setAds] = useState<AdRow[]>([]);
  const [adsError, setAdsError] = useState<string | null>(null);
  const [adsPagination, setAdsPagination] = useState({ page: 1, limit: 20, total: 0 });
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsPage, setAdsPage] = useState(1);
  const [adsStatusFilter, setAdsStatusFilter] = useState('all');
  const [adsTypeFilter, setAdsTypeFilter] = useState('all');

  const fetchAds = useCallback(async () => {
    if (!accessToken) return;
    setAdsLoading(true);
    setAdsError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(adsPage));
      params.set('limit', '20');
      if (adsStatusFilter !== 'all') params.set('status', adsStatusFilter);
      if (adsTypeFilter !== 'all') params.set('type', adsTypeFilter);
      const res = await fetch(`${API_URL}/api/v1/admin/p2p/ads?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (data?.success && data?.data) {
        setAds(Array.isArray(data.data.ads) ? data.data.ads : []);
        const p = data.data.pagination ?? {};
        setAdsPagination({ page: p.page ?? 1, limit: p.limit ?? 20, total: p.total ?? 0 });
      } else {
        setAdsError(data?.error?.message ?? 'Failed to load ads');
        setAds([]);
      }
    } catch (e) {
      setAdsError(e instanceof Error ? e.message : 'Failed to load ads');
      setAds([]);
    } finally {
      setAdsLoading(false);
    }
  }, [accessToken, adsPage, adsStatusFilter, adsTypeFilter]);

  useEffect(() => {
    if (tab === 'ads') fetchAds();
  }, [tab, fetchAds]);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Orders / Ads"
        subtitle="P2P orders and advertisements. Resolve disputes from Disputes or from a trade row in Active Trades."
      />

      <Panel>
        <div className="flex gap-2 border-b border-border mb-4">
          <button
            type="button"
            onClick={() => setTab('orders')}
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${tab === 'orders' ? 'bg-muted text-foreground border border-b-0 border-border' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Orders
          </button>
          <button
            type="button"
            onClick={() => setTab('ads')}
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${tab === 'ads' ? 'bg-muted text-foreground border border-b-0 border-border' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Ads
          </button>
        </div>

        {tab === 'orders' && (
          <>
            <div className="flex flex-wrap gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  {statusOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <DataTableContainer
              title="P2P Orders"
              subtitle={`${ordersPagination.total} total${statusFilter !== 'all' || adIdFromUrl ? ' (filtered)' : ''}`}
              emptyMessage="No orders found"
              isEmpty={!ordersLoading && !ordersErrorMsg && orders.length === 0}
              error={ordersErrorMsg}
              headerAction={
                ordersPagination.total > 20 ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={page <= 1 || ordersLoading}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="p-1.5 rounded border border-border disabled:opacity-50 text-muted-foreground hover:bg-muted"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs text-muted-foreground px-2">{page} / {Math.ceil(ordersPagination.total / 20) || 1}</span>
                    <button
                      type="button"
                      disabled={page >= Math.ceil(ordersPagination.total / 20) || ordersLoading}
                      onClick={() => setPage((p) => p + 1)}
                      className="p-1.5 rounded border border-border disabled:opacity-50 text-muted-foreground hover:bg-muted"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                ) : null
              }
            >
              <DataTableHead>
                <DataTableTh>Order ID</DataTableTh>
                <DataTableTh>Buyer</DataTableTh>
                <DataTableTh>Seller</DataTableTh>
                <DataTableTh>Asset</DataTableTh>
                <DataTableTh align="right">Amount</DataTableTh>
                <DataTableTh>Status</DataTableTh>
                <DataTableTh>Created</DataTableTh>
                <DataTableTh align="right">Actions</DataTableTh>
              </DataTableHead>
              <DataTableBody>
                {(orders as P2POrderRow[]).map((o) => (
                  <DataTableRow key={o.id}>
                    <DataTableCell mono className="text-foreground" title={o.id}>{o.id.slice(0, 8)}…</DataTableCell>
                    <DataTableCell>{o.buyer_email ?? o.buyer_id ?? '—'}</DataTableCell>
                    <DataTableCell>{o.seller_email ?? o.seller_id ?? '—'}</DataTableCell>
                    <DataTableCell>{o.crypto_symbol ?? '—'}</DataTableCell>
                    <DataTableCell align="right" mono>{formatAmountAdmin(o.crypto_amount ?? '0')}</DataTableCell>
                    <DataTableCell><OrderStatusBadge status={o.status} /></DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleString()}</DataTableCell>
                    <DataTableCell align="right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {(o as unknown as { ad_id?: string }).ad_id && (
                          <Link href={`/admin/p2p/orders?ad_id=${(o as unknown as { ad_id: string }).ad_id}`} className="text-sm text-primary hover:underline">Source Ad</Link>
                        )}
                        <Link href={`/admin/users/${o.buyer_id}`} className="text-sm text-primary hover:underline">Buyer</Link>
                        <Link href={`/admin/users/${o.seller_id}`} className="text-sm text-primary hover:underline">Seller</Link>
                        <Link href={`/admin/p2p/disputes`} className="text-sm text-primary hover:underline">Disputes</Link>
                      </div>
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTableContainer>
            {ordersLoading && <div className="flex justify-center py-4"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}
          </>
        )}

        {tab === 'ads' && (
          <>
            <div className="flex flex-wrap gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
                <select
                  value={adsStatusFilter}
                  onChange={(e) => { setAdsStatusFilter(e.target.value); setAdsPage(1); }}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="paused">Paused</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Type</label>
                <select
                  value={adsTypeFilter}
                  onChange={(e) => { setAdsTypeFilter(e.target.value); setAdsPage(1); }}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="all">All</option>
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                </select>
              </div>
            </div>
            <DataTableContainer
              title="P2P Ads"
              subtitle={`${adsPagination.total} total${adsStatusFilter !== 'all' || adsTypeFilter !== 'all' ? ' (filtered)' : ''}`}
              emptyMessage="No ads found"
              isEmpty={!adsLoading && !adsError && ads.length === 0}
              error={adsError}
              headerAction={
                adsPagination.total > 20 ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={adsPage <= 1 || adsLoading}
                      onClick={() => setAdsPage((p) => Math.max(1, p - 1))}
                      className="p-1.5 rounded border border-border disabled:opacity-50 text-muted-foreground hover:bg-muted"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs text-muted-foreground px-2">{adsPage} / {Math.ceil(adsPagination.total / 20) || 1}</span>
                    <button
                      type="button"
                      disabled={adsPage >= Math.ceil(adsPagination.total / 20) || adsLoading}
                      onClick={() => setAdsPage((p) => p + 1)}
                      className="p-1.5 rounded border border-border disabled:opacity-50 text-muted-foreground hover:bg-muted"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                ) : null
              }
            >
              <DataTableHead>
                <DataTableTh>Ad ID</DataTableTh>
                <DataTableTh>User</DataTableTh>
                <DataTableTh>Type</DataTableTh>
                <DataTableTh>Asset</DataTableTh>
                <DataTableTh align="right">Price</DataTableTh>
                <DataTableTh align="right">Min / Max</DataTableTh>
                <DataTableTh>Status</DataTableTh>
                <DataTableTh>Created</DataTableTh>
                <DataTableTh align="right">Actions</DataTableTh>
              </DataTableHead>
              <DataTableBody>
                {ads.map((a) => (
                  <DataTableRow key={a.id}>
                    <DataTableCell mono className="text-foreground" title={a.id}>{String(a.id).slice(0, 8)}…</DataTableCell>
                    <DataTableCell>{a.email ?? a.user_id ?? '—'}</DataTableCell>
                    <DataTableCell className="capitalize">{String(a.ad_type ?? '—')}</DataTableCell>
                    <DataTableCell>{a.crypto_symbol ?? '—'}</DataTableCell>
                    <DataTableCell align="right" mono>{a.price != null ? formatAmountAdmin(String(a.price)) : '—'}</DataTableCell>
                    <DataTableCell align="right" mono>
                      {a.min_amount != null || a.max_amount != null ? `${formatAmountAdmin(String(a.min_amount ?? '0'))} / ${formatAmountAdmin(String(a.max_amount ?? '0'))}` : '—'}
                    </DataTableCell>
                    <DataTableCell><StatusBadge variant={a.status === 'active' ? 'LIVE' : 'NEUTRAL'} label={String(a.status ?? '—')} /></DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">{a.created_at ? new Date(a.created_at).toLocaleString() : '—'}</DataTableCell>
                    <DataTableCell align="right">
                      <Link href={`/admin/p2p/orders?ad_id=${a.id}`} className="text-sm text-primary hover:underline">
                        View Orders <ExternalLink className="w-3.5 h-3.5 inline" />
                      </Link>
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTableContainer>
            {adsLoading && <div className="flex justify-center py-4"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}
          </>
        )}
      </Panel>
    </div>
  );
}
