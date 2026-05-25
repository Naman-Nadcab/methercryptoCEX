'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getMarketsList,
  updateMarket,
  createSettingsTradingPair,
  toggleSettingsTradingPair,
  deleteSettingsTradingPair,
  type MarketRow,
} from '@/lib/markets-api';
import { postMarketHalt } from '@/lib/trading-api';
import { StatCard } from '@/components/dashboard/StatCard';
import { MarketsTable } from '@/components/markets/MarketsTable';
import { MarketControlModal, type MarketControlAction } from '@/components/markets/MarketControlModal';
import { EditFeesModal } from '@/components/markets/EditFeesModal';
import { CreatePairModal } from '@/components/markets/CreatePairModal';
import { DeletePairModal } from '@/components/markets/DeletePairModal';
import { Button } from '@/components/ui/Button';
import { TableSkeleton } from '@/components/ui';
import { useAdminWs } from '@/hooks/useAdminWs';
import { ActionAuthModal, type ActionAuthPayload } from '@/components/ops/ActionAuthModal';
import { ProtectedAction } from '@/components/rbac/ProtectedAction';
import { BarChart3, Layers, PauseCircle, Percent, Plus } from 'lucide-react';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';

export default function MarketsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [controlModal, setControlModal] = useState<{ action: MarketControlAction; market: MarketRow | null } | null>(null);
  const [editFeesMarket, setEditFeesMarket] = useState<MarketRow | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MarketRow | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'markets', token],
    staleTime: 30_000,
    queryFn: () => getMarketsList(token),
    enabled: !!token,
    refetchInterval: 15_000,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ symbol, body }: { symbol: string; body: Parameters<typeof updateMarket>[2] }) => {
      const res = await updateMarket(token, symbol, body!);
      if (!res.success) throw new Error((res as { error?: { message?: string } }).error?.message ?? 'Update failed');
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'markets'] });
      setControlModal(null);
      setEditFeesMarket(null);
    },
  });

  const haltMutation = useMutation({
    mutationFn: async ({
      symbol,
      halted,
      reason,
      admin_note,
    }: {
      symbol: string;
      halted: boolean;
      reason?: string;
      admin_note?: string;
    }) => {
      const res = await postMarketHalt(token, symbol, halted, halted ? { reason, admin_note } : undefined);
      if (!res.success) throw new Error((res as { error?: { message?: string } }).error?.message ?? 'Request failed');
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'markets'] });
      setControlModal(null);
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: Parameters<typeof createSettingsTradingPair>[1]) => {
      const res = await createSettingsTradingPair(token, body);
      if (!res.success) throw new Error((res as { error?: { message?: string } }).error?.message ?? 'Create failed');
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'markets'] });
      setShowCreateModal(false);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (row: MarketRow) => {
      const id = row.id ?? row.symbol;
      setTogglingId(id);
      const res = await toggleSettingsTradingPair(token, id!);
      if (!res.success) throw new Error((res as { error?: { message?: string } }).error?.message ?? 'Toggle failed');
      return res;
    },
    onSettled: () => setTogglingId(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'markets'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (row: MarketRow) => {
      const id = row.id ?? row.symbol;
      const res = await deleteSettingsTradingPair(token, id!);
      if (!res.success) throw new Error((res as { error?: { message?: string } }).error?.message ?? 'Delete failed');
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'markets'] });
      setDeleteTarget(null);
    },
  });

  useAdminWs({
    onEvent: (ev) => {
      if (
        ev.type === 'market_created' ||
        ev.type === 'market_updated' ||
        ev.type === 'market_halted'
      ) {
        queryClient.invalidateQueries({ queryKey: ['admin', 'markets'] });
      }
    },
  });

  const stats = data?.data?.stats;
  const markets = (data?.data?.markets ?? []) as MarketRow[];

  const handleControlConfirm = (payload?: { reason: string; admin_note?: string }) => {
    const m = controlModal?.market;
    const action = controlModal?.action;
    if (!m?.symbol || !action) return;
    const symbol = String(m.symbol);
    if (action === 'enable') {
      updateMutation.mutate({ symbol, body: { status: 'active' } });
    } else if (action === 'disable') {
      updateMutation.mutate({ symbol, body: { status: 'disabled' } });
    } else if (action === 'pause') {
      haltMutation.mutate({
        symbol,
        halted: true,
        reason: payload?.reason,
        admin_note: payload?.admin_note,
      });
    } else if (action === 'resume') {
      haltMutation.mutate({ symbol, halted: false });
    }
  };

  const handleEditFeesConfirm = (makerFee: number, takerFee: number) => {
    const m = editFeesMarket;
    if (!m?.symbol) return;
    updateMutation.mutate({
      symbol: String(m.symbol),
      body: { maker_fee: makerFee, taker_fee: takerFee },
    });
  };

  return (
    <AdminPageFrame
      title="Markets"
      description="View and manage trading pairs."
      error={isError ? (error instanceof Error ? error.message : 'Failed to load markets.') : null}
      onRetry={isError ? () => { void refetch(); } : undefined}
      quickActions={
        <ProtectedAction permission="markets:manage" fallback="disabled">
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreateModal(true)}>
            Create Pair
          </Button>
        </ProtectedAction>
      }
    >

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Markets"
          value={stats?.total_markets ?? 0}
          icon={BarChart3}
          iconBg="bg-admin-primary/10 text-admin-primary"
        />
        <StatCard
          title="Active Markets"
          value={stats?.active_markets ?? 0}
          icon={Layers}
          iconBg="bg-green-100 text-admin-success"
        />
        <StatCard
          title="Paused Markets"
          value={stats?.paused_markets ?? 0}
          icon={PauseCircle}
          iconBg="bg-amber-100 text-admin-warning"
        />
        <StatCard
          title="Average Spread"
          value={
            stats?.average_spread != null
              ? `${stats.average_spread}%`
              : '—'
          }
          icon={Percent}
          iconBg="bg-white/5 text-admin-muted"
        />
      </div>

      <div className="rounded-xl border border-admin-border bg-admin-card p-6">
        <h2 className="mb-4 text-lg font-semibold text-admin-text">Markets</h2>
        {isLoading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : (
          <MarketsTable
            rows={markets}
            onEnable={(row) => setControlModal({ action: 'enable', market: row })}
            onDisable={(row) => setControlModal({ action: 'disable', market: row })}
            onPause={(row) => setControlModal({ action: 'pause', market: row })}
            onResume={(row) => setControlModal({ action: 'resume', market: row })}
            onEditFees={(row) => setEditFeesMarket(row)}
            onToggleActive={(row) => toggleMutation.mutate(row)}
            onDelete={(row) => setDeleteTarget(row)}
            togglingId={togglingId}
          />
        )}
      </div>

      <MarketControlModal
        open={!!controlModal}
        action={controlModal?.action ?? 'enable'}
        market={controlModal?.market ?? null}
        onClose={() => setControlModal(null)}
        onConfirm={handleControlConfirm}
        isLoading={updateMutation.isPending || haltMutation.isPending}
      />

      <EditFeesModal
        open={!!editFeesMarket}
        market={editFeesMarket}
        onClose={() => setEditFeesMarket(null)}
        onConfirm={handleEditFeesConfirm}
        isLoading={updateMutation.isPending}
      />

      <CreatePairModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onConfirm={(data) => createMutation.mutate(data)}
        isLoading={createMutation.isPending}
      />

      <DeletePairModal
        open={false}
        market={null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {}}
        isLoading={deleteMutation.isPending}
      />
      <ActionAuthModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={(_payload: ActionAuthPayload) => {
          if (!deleteTarget) return;
          deleteMutation.mutate(deleteTarget);
        }}
        title="Delete trading pair"
        actionLabel={deleteTarget ? `Delete ${deleteTarget.symbol}` : 'Delete trading pair'}
        description="This action is irreversible and must be approved with reason and step-up auth."
        requireReason
        twofaRequired
        confirmationPhrase={deleteTarget ? `DELETE ${deleteTarget.symbol}` : undefined}
        externalError={deleteMutation.error instanceof Error ? deleteMutation.error.message : null}
        isPending={deleteMutation.isPending}
        confirmLabel={deleteMutation.isPending ? 'Deleting…' : 'Delete pair'}
        confirmVariant="danger"
      />
    </AdminPageFrame>
  );
}
