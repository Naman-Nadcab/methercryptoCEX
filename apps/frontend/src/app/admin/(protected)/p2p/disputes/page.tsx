'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  SectionHeader,
  MetricWidget,
  ActionButton,
  DataTableContainer,
  DataTableHead,
  DataTableTh,
  DataTableBody,
  DataTableRow,
  DataTableCell,
  StatusBadge,
} from '@/components/admin/control-plane';
import { Loader2, Check, X, AlertTriangle } from 'lucide-react';
import { formatAmountAdmin } from '@/lib/utils';

interface DisputeStats {
  open?: number;
  under_review?: number;
  resolved?: number;
  cancelled?: number;
}

interface DisputeRow {
  id: string;
  order_id: string;
  status: string;
  buyer_email: string;
  buyer_username?: string | null;
  seller_email: string;
  seller_username?: string | null;
  crypto_amount?: string;
  fiat_amount?: string;
  fiat_currency?: string;
  created_at: string;
}

function deriveStats(disputes: DisputeRow[]): DisputeStats {
  return {
    open: disputes.filter((d) => d.status === 'open').length,
    under_review: disputes.filter((d) => d.status === 'under_review').length,
    resolved: disputes.filter((d) => d.status === 'resolved').length,
    cancelled: disputes.filter((d) => d.status === 'cancelled').length,
  };
}

const disputeStatusVariant: Record<string, 'LIVE' | 'DEGRADED' | 'NEUTRAL'> = {
  open: 'DEGRADED',
  under_review: 'DEGRADED',
  resolved: 'LIVE',
  cancelled: 'NEUTRAL',
};

function DisputeStatusBadge({ status }: { status: string }) {
  const variant = disputeStatusVariant[status] ?? 'DEGRADED';
  const label = status.replace(/_/g, ' ');
  return <StatusBadge variant={variant} label={label} showDot={variant !== 'NEUTRAL'} />;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function EscrowDisputesCommandCenter() {
  const searchParams = useSearchParams();
  const statusFromUrl = searchParams.get('status') || 'all';
  const { accessToken } = useAdminAuthStore();
  const [disputes, setDisputes] = useState<DisputeRow[]>([]);
  const [stats, setStats] = useState<DisputeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>(statusFromUrl);

  useEffect(() => {
    setStatusFilter(statusFromUrl);
  }, [statusFromUrl]);
  const [actingId, setActingId] = useState<string | null>(null);
  const [confirmDispute, setConfirmDispute] = useState<DisputeRow | null>(null);
  const [resolveChoice, setResolveChoice] = useState<'favor_buyer' | 'favor_seller' | 'cancelled' | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const fetchDisputes = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/p2p/disputes`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await res.json();
      if (!result?.success) {
        setFetchError(result?.error?.message ?? 'Failed to load disputes');
        setDisputes([]);
        return;
      }
      const raw = result.data;
      const list: DisputeRow[] = Array.isArray(raw) ? raw : raw?.disputes ?? [];
      setDisputes(list);
      setStats(raw?.stats ?? deriveStats(list));
      setLastUpdated(new Date());
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Failed to load disputes');
      setDisputes([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  const filtered = disputes.filter((d) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'open') return d.status === 'open';
    if (statusFilter === 'under_review') return d.status === 'under_review';
    if (statusFilter === 'resolved') return d.status === 'resolved';
    if (statusFilter === 'cancelled') return d.status === 'cancelled';
    return true;
  });

  const handleResolve = async (id: string, resolution: 'favor_buyer' | 'favor_seller' | 'cancelled', notes: string) => {
    if (!accessToken) return;
    setResolveError(null);
    setActingId(id);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/p2p/disputes/${id}/resolve`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ resolution, notes: notes || 'Resolved by operator' }),
      });
      const data = await res.json();
      if (data?.success) {
        setConfirmDispute(null);
        setResolveChoice(null);
        await fetchDisputes();
      } else {
        setResolveError(data?.error?.message ?? data?.error?.code ?? 'Resolve failed');
      }
    } catch {
      setResolveError('Request failed');
    } finally {
      setActingId(null);
    }
  };

  const openCount = stats?.open ?? 0;
  const underReviewCount = stats?.under_review ?? 0;
  const resolvedCount = stats?.resolved ?? 0;
  const cancelledCount = stats?.cancelled ?? 0;
  const canAct = (d: DisputeRow) => d.status === 'open' || d.status === 'under_review';

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Escrow & Disputes Command Center"
        subtitle={`Monitor escrow risk and dispute resolutions${lastUpdated ? ` · Last updated ${lastUpdated.toLocaleTimeString()}` : ''}`}
        action={
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 dark:text-white"
            >
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="under_review">Under Review</option>
              <option value="resolved">Resolved</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <ActionButton
              variant="secondary"
              onClick={() => fetchDisputes()}
              loading={loading}
              icon={!loading ? <span className="text-xs">↻</span> : undefined}
            >
              Refresh
            </ActionButton>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricWidget
          label="Open disputes"
          value={openCount}
          variant={openCount > 0 ? 'warning' : 'neutral'}
          statusBadge={openCount > 0 ? 'RISK' : undefined}
        />
        <MetricWidget
          label="Under review"
          value={underReviewCount}
          variant={underReviewCount > 0 ? 'warning' : 'neutral'}
        />
        <MetricWidget label="Resolved" value={resolvedCount} variant="positive" />
        <MetricWidget label="Cancelled" value={cancelledCount} />
      </div>

      {fetchError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 flex items-center gap-3 text-red-400">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{fetchError}</span>
        </div>
      )}
      <DataTableContainer
        title="Disputes"
        subtitle={`${filtered.length} shown${statusFilter !== 'all' ? ` (status: ${statusFilter})` : ''}`}
        emptyMessage={fetchError ? undefined : 'No disputes found'}
        isEmpty={!loading && !fetchError && filtered.length === 0}
        error={fetchError}
      >
        <DataTableHead>
          <DataTableTh>Dispute ID</DataTableTh>
          <DataTableTh>Order</DataTableTh>
          <DataTableTh>Buyer</DataTableTh>
          <DataTableTh>Seller</DataTableTh>
          <DataTableTh>Asset</DataTableTh>
          <DataTableTh align="right">Amount</DataTableTh>
          <DataTableTh>Status</DataTableTh>
          <DataTableTh>Created</DataTableTh>
          <DataTableTh align="right">Actions</DataTableTh>
        </DataTableHead>
        <DataTableBody>
          {filtered.map((d) => (
            <DataTableRow key={d.id}>
              <DataTableCell mono className="max-w-[100px] truncate" title={d.id}>
                {d.id.slice(0, 8)}…
              </DataTableCell>
              <DataTableCell mono className="max-w-[100px] truncate" title={d.order_id}>
                {d.order_id.slice(0, 8)}…
              </DataTableCell>
              <DataTableCell className="max-w-[140px] truncate" title={d.buyer_email}>
                {d.buyer_email}
              </DataTableCell>
              <DataTableCell className="max-w-[140px] truncate" title={d.seller_email}>
                {d.seller_email}
              </DataTableCell>
              <DataTableCell>{d.fiat_currency ?? '—'}</DataTableCell>
              <DataTableCell align="right" mono>
                {d.crypto_amount != null || d.fiat_amount != null
                  ? formatAmountAdmin(String(d.crypto_amount ?? d.fiat_amount ?? '0'))
                  : '—'}
              </DataTableCell>
              <DataTableCell>
                <DisputeStatusBadge status={d.status} />
              </DataTableCell>
              <DataTableCell className="text-xs text-gray-500 dark:text-gray-400">
                {new Date(d.created_at).toLocaleString()}
              </DataTableCell>
              <DataTableCell align="right">
                {canAct(d) && (
                  <div className="flex items-center justify-end gap-1">
                    <ActionButton
                      variant="primary"
                      icon={<Check className="w-3.5 h-3.5" />}
                      disabled={actingId != null && actingId !== d.id}
                      onClick={() => { setConfirmDispute(d); setResolveChoice(null); setResolveError(null); }}
                    >
                      Resolve
                    </ActionButton>
                    <ActionButton
                      variant="danger"
                      icon={<X className="w-3.5 h-3.5" />}
                      disabled={actingId != null && actingId !== d.id}
                      onClick={() => { setConfirmDispute(d); setResolveChoice('cancelled'); setResolveError(null); }}
                    >
                      Cancel
                    </ActionButton>
                  </div>
                )}
              </DataTableCell>
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTableContainer>

      {loading && disputes.length === 0 && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
        </div>
      )}

      {confirmDispute && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="resolve-dialog-title"
        >
          <div className="w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              <h2 id="resolve-dialog-title" className="text-sm font-semibold text-gray-900 dark:text-white">
                Confirm dispute resolution
              </h2>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <p className="text-gray-600 dark:text-gray-400">
                This action will move escrow funds. It cannot be undone.
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Favor buyer: release escrow to buyer. Favor seller: refund escrow to seller. Cancel dispute: refund to seller.
              </p>
              <div className="rounded-lg bg-gray-100 dark:bg-gray-800 p-3 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Buyer</span>
                  <span className="text-gray-900 dark:text-white truncate max-w-[200px]" title={confirmDispute.buyer_email}>
                    {confirmDispute.buyer_email}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Seller</span>
                  <span className="text-gray-900 dark:text-white truncate max-w-[200px]" title={confirmDispute.seller_email}>
                    {confirmDispute.seller_email}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Amount</span>
                  <span className="font-mono text-gray-900 dark:text-white tabular-nums">
                    {confirmDispute.crypto_amount != null || confirmDispute.fiat_amount != null
                      ? formatAmountAdmin(String(confirmDispute.crypto_amount ?? confirmDispute.fiat_amount ?? '0'))
                      : '—'}{' '}
                    {confirmDispute.fiat_currency ?? ''}
                  </span>
                </div>
              </div>
              {resolveChoice === null ? (
                <div className="flex flex-wrap gap-2 pt-2">
                  <ActionButton
                    variant="primary"
                    onClick={() => setResolveChoice('favor_buyer')}
                  >
                    Favor buyer
                  </ActionButton>
                  <ActionButton
                    variant="secondary"
                    onClick={() => setResolveChoice('favor_seller')}
                  >
                    Favor seller
                  </ActionButton>
                  <ActionButton
                    variant="danger"
                    onClick={() => setResolveChoice('cancelled')}
                  >
                    Cancel dispute
                  </ActionButton>
                </div>
              ) : (
                <>
                  <p className="text-amber-600 dark:text-amber-400 text-xs">
                    {resolveChoice === 'cancelled' ? 'Cancel dispute (refund to seller)' : resolveChoice === 'favor_buyer' ? 'Release escrow to buyer' : 'Refund escrow to seller'}.
                  </p>
                  {resolveError && (
                    <p className="text-xs text-red-600 dark:text-red-400" role="alert">{resolveError}</p>
                  )}
                  <div className="flex justify-end gap-2 pt-2">
                    <ActionButton variant="secondary" onClick={() => { setResolveChoice(null); setResolveError(null); }}>
                      Back
                    </ActionButton>
                    <ActionButton
                      variant={resolveChoice === 'cancelled' ? 'danger' : 'primary'}
                      loading={actingId === confirmDispute.id}
                      disabled={actingId != null && actingId !== confirmDispute.id}
                      onClick={() =>
                        handleResolve(confirmDispute.id, resolveChoice, 'Resolved by operator')
                      }
                    >
                      Confirm
                    </ActionButton>
                  </div>
                </>
              )}
            </div>
            {resolveChoice === null && (
              <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                <ActionButton variant="ghost" onClick={() => { setConfirmDispute(null); setResolveChoice(null); setResolveError(null); }}>
                  Close
                </ActionButton>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
