'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getSettingsTradingPairs, getFeesTrading } from '@/lib/admin/trading';
import { adminFetch } from '@/lib/admin';
import { SectionHeader } from '@/components/admin/control-plane';
import { AdminPanel, AdminDataTable, AdminStatusBadge } from '@/components/admin/ui';
import { DataTableTh, DataTableRow, DataTableCell } from '@/components/admin/control-plane';
import { Loader2 } from 'lucide-react';

export default function TradingPairsPage() {
  const { accessToken } = useAdminAuthStore();
  const queryClient = useQueryClient();

  const { data: pairsRes, isLoading } = useQuery({
    queryKey: ['admin', 'settings', 'trading-pairs'],
    queryFn: () => getSettingsTradingPairs(accessToken, { limit: 100 }),
    enabled: !!accessToken,
  });

  const { data: feesRes } = useQuery({
    queryKey: ['admin', 'fees', 'trading'],
    queryFn: () => getFeesTrading(accessToken),
    enabled: !!accessToken,
  });

  const toggleMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await adminFetch(`/settings/trading-pairs/${id}/toggle`, { method: 'PATCH', token: accessToken });
      if (!r.success) throw new Error((r.error as { message?: string })?.message ?? 'Toggle failed');
      return r;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'trading-pairs'] });
    },
  });

  const rawPairs = (pairsRes?.data as { trading_pairs?: Array<Record<string, unknown>> })?.trading_pairs ?? [];
  const pairList = Array.isArray(rawPairs) ? rawPairs : [];
  const feeByPair = (feesRes?.data as { pairs?: Array<{ id?: string; symbol?: string; maker_fee?: number; taker_fee?: number }> })?.pairs ?? [];

  if (isLoading && pairList.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Market Management"
        subtitle="Trading pairs: enable/disable, view fees and liquidity"
      />

      <AdminPanel title="Trading pairs" subtitle="Volume, spread, liquidity, status">
        <AdminDataTable
          isEmpty={pairList.length === 0}
          emptyMessage="No trading pairs. Configure in Settings → Trading Pairs."
          wrapTable={false}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <DataTableTh>Pair / Symbol</DataTableTh>
                  <DataTableTh>Status</DataTableTh>
                  <DataTableTh align="right">Maker fee</DataTableTh>
                  <DataTableTh align="right">Taker fee</DataTableTh>
                  <DataTableTh align="right">Volume</DataTableTh>
                  <DataTableTh align="right">Actions</DataTableTh>
                </tr>
              </thead>
              <tbody>
                {pairList.map((p: Record<string, unknown>) => {
                  const id = String(p.id ?? p.symbol ?? '');
                  const symbol = p.symbol ?? (p.base_symbol && p.quote_symbol ? `${p.base_symbol}/${p.quote_symbol}` : p.base_symbol ?? id);
                  const isActive = p.is_active !== false && p.status !== 'disabled';
                  const fees = feeByPair.find((f) => f.symbol === symbol || f.id === id);
                  return (
                    <DataTableRow key={id}>
                      <DataTableCell mono>{String(symbol || id || '—')}</DataTableCell>
                      <DataTableCell>
                        <AdminStatusBadge variant={isActive ? 'LIVE' : 'DEGRADED'} label={isActive ? 'Active' : 'Disabled'} />
                      </DataTableCell>
                      <DataTableCell align="right" mono>{fees?.maker_fee != null ? `${Number(fees.maker_fee) * 100}%` : '—'}</DataTableCell>
                      <DataTableCell align="right" mono>{fees?.taker_fee != null ? `${Number(fees.taker_fee) * 100}%` : '—'}</DataTableCell>
                      <DataTableCell align="right" mono>{p.volume_24h != null ? String(p.volume_24h) : '—'}</DataTableCell>
                      <DataTableCell align="right">
                        <button
                          type="button"
                          onClick={() => toggleMutation.mutate(id)}
                          disabled={toggleMutation.isPending}
                          className="text-xs text-primary hover:underline disabled:opacity-50"
                        >
                          {isActive ? 'Disable' : 'Enable'}
                        </button>
                      </DataTableCell>
                    </DataTableRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        </AdminDataTable>
      </AdminPanel>

      <p className="text-xs text-muted-foreground">
        To update maker/taker fees per pair, use Fees → Trading. To add pairs or set tick size, use Settings → Trading Pairs.
      </p>
    </div>
  );
}
