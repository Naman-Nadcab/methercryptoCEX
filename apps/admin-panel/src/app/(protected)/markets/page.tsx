'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getMarketsList,
  updateMarket,
  type MarketRow,
} from '@/lib/markets-api';
import { postMarketHalt } from '@/lib/trading-api';
import { StatCard } from '@/components/dashboard/StatCard';
import { MarketsTable } from '@/components/markets/MarketsTable';
import { MarketControlModal, type MarketControlAction } from '@/components/markets/MarketControlModal';
import { EditFeesModal } from '@/components/markets/EditFeesModal';
import { useAdminWs } from '@/hooks/useAdminWs';
import { BarChart3, Layers, PauseCircle, Percent } from 'lucide-react';

export default function MarketsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [controlModal, setControlModal] = useState<{ action: MarketControlAction; market: MarketRow | null } | null>(null);
  const [editFeesMarket, setEditFeesMarket] = useState<MarketRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'markets', token],
    queryFn: () => getMarketsList(token),
    enabled: !!token,
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
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Markets Management</h1>
        <p className="mt-1 text-sm text-admin-muted">View and manage trading pairs.</p>
      </div>

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
          iconBg="bg-gray-100 text-admin-muted"
        />
      </div>

      <div className="rounded-xl border border-admin-border bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Markets</h2>
        {isLoading ? (
          <div className="py-8 text-center text-admin-muted">Loading…</div>
        ) : (
          <MarketsTable
            rows={markets}
            onEnable={(row) => setControlModal({ action: 'enable', market: row })}
            onDisable={(row) => setControlModal({ action: 'disable', market: row })}
            onPause={(row) => setControlModal({ action: 'pause', market: row })}
            onResume={(row) => setControlModal({ action: 'resume', market: row })}
            onEditFees={(row) => setEditFeesMarket(row)}
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
    </div>
  );
}
