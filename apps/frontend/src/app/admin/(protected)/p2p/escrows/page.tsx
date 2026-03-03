'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
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
  StatusBadge,
  ActionButton,
} from '@/components/admin/control-plane';
import { ReasonCaptureModal } from '@/components/admin/ReasonCaptureModal';
import { Loader2, AlertTriangle, Snowflake, Sun } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface EscrowRow {
  id: string;
  order_id: string;
  user_id: string;
  asset: string;
  amount: string;
  status: string;
  frozen?: boolean;
  created_at?: string;
  [key: string]: unknown;
}

export default function P2PEscrowsPage() {
  const { accessToken } = useAdminAuthStore();
  const [escrows, setEscrows] = useState<EscrowRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const orderIdFromUrl = searchParams.get('order_id') || undefined;
  const [frozenFilter, setFrozenFilter] = useState<string>('');
  const [page, setPage] = useState(0);
  const [freezeModal, setFreezeModal] = useState<EscrowRow | null>(null);
  const [unfreezeTarget, setUnfreezeTarget] = useState<EscrowRow | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const limit = 20;

  const fetchEscrows = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      params.set('offset', String(page * limit));
      if (frozenFilter === 'true') params.set('frozen', 'true');
      if (frozenFilter === 'false') params.set('frozen', 'false');
      if (orderIdFromUrl) params.set('order_id', orderIdFromUrl);
      const res = await fetch(`${API_URL}/api/v1/admin/escrows?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Failed to load escrows');
        return;
      }
      const raw = data?.data;
      const rows = raw?.rows ?? raw?.escrows ?? (Array.isArray(raw) ? raw : []);
      const totalCount = raw?.total ?? (Array.isArray(rows) ? rows.length : 0);
      setEscrows(Array.isArray(rows) ? rows : []);
      setTotal(totalCount);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, frozenFilter, orderIdFromUrl]);

  useEffect(() => {
    fetchEscrows();
  }, [fetchEscrows]);

  const handleFreezeConfirm = async (reason: string) => {
    if (!freezeModal || !accessToken) return;
    setActionError(null);
    setActionLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/escrows/${freezeModal.id}/freeze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data?.error?.message ?? 'Freeze failed');
        return;
      }
      setActionError(null);
      setFreezeModal(null);
      fetchEscrows();
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnfreeze = async () => {
    if (!unfreezeTarget || !accessToken) return;
    setActionError(null);
    setActionLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/escrows/${unfreezeTarget.id}/unfreeze`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data?.error?.message ?? 'Unfreeze failed');
        return;
      }
      setActionError(null);
      setUnfreezeTarget(null);
      fetchEscrows();
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Escrow Monitor"
        subtitle={`P2P escrows · ${total} total${orderIdFromUrl || frozenFilter ? ' (filtered)' : ''}${lastUpdated ? ` · Updated ${lastUpdated.toLocaleTimeString()}` : ''}. Freeze or unfreeze with required reason (audit logged).`}
      />
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 flex items-center gap-3 text-destructive">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Panel>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Frozen</label>
            <select
              value={frozenFilter}
              onChange={(e) => { setFrozenFilter(e.target.value); setPage(0); }}
              className="rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm"
            >
              <option value="">All</option>
              <option value="true">Frozen</option>
              <option value="false">Not frozen</option>
            </select>
          </div>
          {total > limit && (
            <div className="flex items-center gap-1 ml-auto">
              <button
                type="button"
                disabled={page <= 0 || loading}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="p-1.5 rounded border border-border disabled:opacity-50 text-muted-foreground hover:bg-muted"
              >
                ← Prev
              </button>
              <span className="text-xs text-muted-foreground px-2">
                {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
              </span>
              <button
                type="button"
                disabled={page >= Math.ceil(total / limit) - 1 || loading}
                onClick={() => setPage((p) => p + 1)}
                className="p-1.5 rounded border border-border disabled:opacity-50 text-muted-foreground hover:bg-muted"
              >
                Next →
              </button>
            </div>
          )}
        </div>

        {loading && !escrows.length ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
          </div>
        ) : (
          <DataTableContainer
            title="Escrows"
            subtitle={`${escrows.length} on this page · ${total} total`}
            emptyMessage="No escrows found"
            isEmpty={!loading && !error && escrows.length === 0}
            error={error}
          >
            <DataTableHead>
              <DataTableRow>
                <DataTableTh>Escrow ID</DataTableTh>
                <DataTableTh>Order ID</DataTableTh>
                <DataTableTh>User ID</DataTableTh>
                <DataTableTh>Currency ID</DataTableTh>
                <DataTableTh>Amount</DataTableTh>
                <DataTableTh>Status</DataTableTh>
                <DataTableTh>Frozen</DataTableTh>
                <DataTableTh className="w-32">Actions</DataTableTh>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {escrows.map((e) => (
                <DataTableRow key={e.id}>
                  <DataTableCell className="font-mono text-xs" title={e.id}>{e.id.slice(0, 8)}…</DataTableCell>
                  <DataTableCell className="font-mono text-xs" title={String(e.p2p_order_id ?? e.order_id ?? '')}>
                    {(e.p2p_order_id ?? e.order_id) ? (
                      <Link href={`/admin/p2p/trades`} className="text-primary hover:underline">{String(e.p2p_order_id ?? e.order_id).slice(0, 8)}…</Link>
                    ) : '—'}
                  </DataTableCell>
                  <DataTableCell className="font-mono text-xs" title={e.user_id}>
                    {e.user_id ? <Link href={`/admin/users/${e.user_id}`} className="text-primary hover:underline">{e.user_id.slice(0, 8)}…</Link> : '—'}
                  </DataTableCell>
                  <DataTableCell className="font-mono text-xs">{e.asset ?? (e.currency_id ? String(e.currency_id).slice(0, 8) + '…' : '—')}</DataTableCell>
                  <DataTableCell className="font-mono text-xs">{e.amount ?? '—'}</DataTableCell>
                  <DataTableCell>{e.status ?? '—'}</DataTableCell>
                  <DataTableCell>
                    {((e.admin_frozen_at != null || (e.frozen ?? (e as Record<string, unknown>).frozen))) ? (
                      <StatusBadge variant="RISK" label="Frozen" showDot />
                    ) : (
                      <StatusBadge variant="NEUTRAL" label="No" showDot />
                    )}
                  </DataTableCell>
                  <DataTableCell>
                    {((e.admin_frozen_at != null || (e.frozen ?? (e as Record<string, unknown>).frozen))) ? (
                      <ActionButton variant="primary" icon={<Sun className="w-3 h-3" />} onClick={() => setUnfreezeTarget(e)} disabled={actionLoading || !!error}>
                        Unfreeze
                      </ActionButton>
                    ) : (
                      <ActionButton variant="danger" icon={<Snowflake className="w-3 h-3" />} onClick={() => setFreezeModal(e)} disabled={actionLoading || !!error}>
                        Freeze
                      </ActionButton>
                    )}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTableContainer>
        )}
      </Panel>

      {freezeModal && (
        <ReasonCaptureModal
          open={!!freezeModal}
          title="Freeze escrow"
          bodyCopy="This will freeze the escrow. Provide a reason for the audit trail."
          reasonLabel="Reason (required)"
          confirmLabel="Freeze escrow"
          variant="danger"
          onClose={() => { setFreezeModal(null); setActionError(null); }}
          onConfirm={handleFreezeConfirm}
          loading={actionLoading}
          error={actionError}
          context={[
            { label: 'Escrow ID', value: freezeModal.id.slice(0, 8) + '…' },
            { label: 'Order', value: String(freezeModal.p2p_order_id ?? freezeModal.order_id ?? '—').slice(0, 12) },
            { label: 'Amount', value: String(freezeModal.amount ?? '—') },
          ]}
        />
      )}

      {unfreezeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true" aria-labelledby="unfreeze-title">
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl p-6">
            <h2 id="unfreeze-title" className="text-lg font-semibold text-foreground mb-2">Unfreeze escrow</h2>
            <p className="text-sm text-muted-foreground mb-4">Escrow {unfreezeTarget.id.slice(0, 8)}… will be unfrozen. Confirm?</p>
            {actionError && <p className="text-sm text-destructive mb-3">{actionError}</p>}
            <div className="flex justify-end gap-2">
              <ActionButton variant="secondary" onClick={() => { setUnfreezeTarget(null); setActionError(null); }}>Cancel</ActionButton>
              <ActionButton variant="primary" loading={actionLoading} onClick={handleUnfreeze}>Unfreeze</ActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
