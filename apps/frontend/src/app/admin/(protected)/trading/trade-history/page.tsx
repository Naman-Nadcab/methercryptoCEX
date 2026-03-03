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

interface SpotTrade {
  id: string;
  order_id: string;
  user_id: string;
  market: string;
  side: string;
  price: string;
  quantity: string;
  fee: string;
  fee_asset: string | null;
  created_at: string;
}

export default function AdminSpotTradeHistoryPage() {
  const { accessToken } = useAdminAuthStore();
  const [trades, setTrades] = useState<SpotTrade[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [marketFilter, setMarketFilter] = useState<string>('');

  const fetchTrades = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(page * PAGE_SIZE));
      if (marketFilter.trim()) params.set('market', marketFilter.trim().toUpperCase().replace(/-/g, '_'));
      const res = await fetch(`${API_URL}/api/v1/admin/spot/trades?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Failed to load trades');
        return;
      }
      if (data?.success && data?.data) {
        setTrades(data.data.rows ?? []);
        setTotal(data.data.total ?? 0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, marketFilter]);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isEmpty = !loading && trades.length === 0;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Trade History"
        subtitle="All spot trades across users. Filter by market."
        action={
          <ActionButton icon={<RefreshCw className="w-4 h-4" />} onClick={fetchTrades} loading={loading} variant="secondary">
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
        title="Spot trades"
        subtitle={total > 0 ? `${total} total` : undefined}
        isEmpty={isEmpty && !loading}
        emptyMessage="No trades found. Try changing filters or refresh."
        wrapTable={false}
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : !isEmpty ? (
          <>
            <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-3 bg-muted/30">
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
                  <DataTableTh>Trade ID</DataTableTh>
                  <DataTableTh>Market</DataTableTh>
                  <DataTableTh>Side</DataTableTh>
                  <DataTableTh align="right">Price</DataTableTh>
                  <DataTableTh align="right">Quantity</DataTableTh>
                  <DataTableTh align="right">Fee</DataTableTh>
                  <DataTableTh>User</DataTableTh>
                </DataTableHead>
                <DataTableBody>
                  {trades.map((t) => (
                    <DataTableRow key={t.id}>
                      <DataTableCell className="text-muted-foreground">
                        {t.created_at ? new Date(t.created_at).toLocaleString() : '—'}
                      </DataTableCell>
                      <DataTableCell mono>{t.id.slice(0, 8)}…</DataTableCell>
                      <DataTableCell>{t.market}</DataTableCell>
                      <DataTableCell>
                        <span className={t.side === 'buy' ? 'text-buy' : 'text-sell'}>{t.side}</span>
                      </DataTableCell>
                      <DataTableCell align="right" mono>{t.price}</DataTableCell>
                      <DataTableCell align="right" mono>{t.quantity}</DataTableCell>
                      <DataTableCell align="right" mono>{t.fee ?? '0'}</DataTableCell>
                      <DataTableCell>
                        <Link href={`/admin/users/${t.user_id}`} className="text-primary hover:underline truncate block max-w-[120px]">
                          {t.user_id.slice(0, 8)}…
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
