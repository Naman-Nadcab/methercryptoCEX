'use client';

import { useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  getFundsSummary,
  getHotWallets,
  getWithdrawals,
  getDeposits,
  getEscrows,
} from '@/lib/admin/wallets';
import { SectionHeader } from '@/components/admin/control-plane';
import { AdminMetricCard, AdminPanel, AdminDataTable } from '@/components/admin/ui';
import { Wallet, ArrowDownToLine, ArrowUpFromLine, Lock, Loader2, Coins } from 'lucide-react';
import Link from 'next/link';

export default function WalletsMonitorPage() {
  const { accessToken } = useAdminAuthStore();

  const { data: funds, isLoading: loadingFunds } = useQuery({
    queryKey: ['admin', 'funds-summary'],
    queryFn: () => getFundsSummary(accessToken),
    enabled: !!accessToken,
  });

  const { data: hotData } = useQuery({
    queryKey: ['admin', 'hot-wallets'],
    queryFn: () => getHotWallets(accessToken),
    enabled: !!accessToken,
  });

  const { data: withdrawalsData } = useQuery({
    queryKey: ['admin', 'withdrawals', 'pending'],
    queryFn: () => getWithdrawals(accessToken, { limit: 20, status: 'pending' }),
    enabled: !!accessToken,
  });

  const { data: depositsData } = useQuery({
    queryKey: ['admin', 'deposits', 'pending'],
    queryFn: () => getDeposits(accessToken, { limit: 20, status: 'pending' }),
    enabled: !!accessToken,
  });

  const { data: escrowsData } = useQuery({
    queryKey: ['admin', 'escrows'],
    queryFn: () => getEscrows(accessToken),
    enabled: !!accessToken,
  });

  const summary = funds?.data as {
    ledger_totals?: Array<{ token_symbol?: string; amount?: string; chain_name?: string }>;
    on_chain_totals?: {
      hot_wallets?: Array<{ chain_id?: string; chain_name?: string; balance?: string }>;
      cold_wallets?: Array<{ chain_id?: string; chain_name?: string; balance?: string }>;
    };
    reconciliation?: { status?: string };
  } | undefined;

  const hotWallets = summary?.on_chain_totals?.hot_wallets ?? (hotData?.data as { chains?: Array<{ chainId: string }> })?.chains ?? [];
  const coldWallets = summary?.on_chain_totals?.cold_wallets ?? [];
  const withdrawals = (withdrawalsData?.data as { withdrawals?: unknown[] })?.withdrawals ?? [];
  const deposits = (depositsData?.data as { deposits?: unknown[] })?.deposits ?? [];
  const escrows = (escrowsData?.data as { escrows?: unknown[] })?.escrows ?? [];

  const totalReserves = summary?.ledger_totals?.reduce((acc, r) => acc + parseFloat(String(r.amount ?? 0)), 0) ?? 0;
  const pendingWithdrawalsCount = (withdrawalsData?.data as { stats?: { pending_approval?: number } })?.stats?.pending_approval ?? withdrawals.length;

  if (loadingFunds && !summary) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Wallet Monitoring"
        subtitle="Hot/cold balances, pending movements, escrow"
      />

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <AdminMetricCard
          label="Hot wallet balances"
          value={Array.isArray(hotWallets) ? hotWallets.length : 0}
          sublabel="chains"
          icon={<Wallet className="w-4 h-4" />}
          href="/admin/wallets/hot"
        />
        <AdminMetricCard
          label="Cold wallet monitors"
          value={Array.isArray(coldWallets) ? coldWallets.length : 0}
          sublabel="chains"
          icon={<Lock className="w-4 h-4" />}
        />
        <AdminMetricCard
          label="Pending withdrawals"
          value={pendingWithdrawalsCount}
          sublabel="awaiting approval"
          variant={pendingWithdrawalsCount > 0 ? 'warning' : 'neutral'}
          icon={<ArrowUpFromLine className="w-4 h-4" />}
          href="/admin/withdrawals?status=pending_approval"
        />
        <AdminMetricCard
          label="Pending deposits"
          value={Array.isArray(deposits) ? deposits.length : 0}
          sublabel="confirming"
          icon={<ArrowDownToLine className="w-4 h-4" />}
          href="/admin/deposits"
        />
        <AdminMetricCard
          label="Escrow funds"
          value={Array.isArray(escrows) ? escrows.length : 0}
          sublabel="P2P escrows"
          icon={<Coins className="w-4 h-4" />}
          href="/admin/p2p/escrows"
        />
        <AdminMetricCard
          label="Total exchange reserves"
          value={totalReserves > 0 ? totalReserves.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
          sublabel="ledger total"
          icon={<Wallet className="w-4 h-4" />}
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AdminPanel title="Hot wallet balances" subtitle="On-chain hot wallets">
          {Array.isArray(hotWallets) && hotWallets.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Chain</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {hotWallets.slice(0, 10).map((h: { chain_id?: string; chain_name?: string; chainId?: string; balance?: string }, i: number) => (
                    <tr key={h.chain_id ?? h.chainId ?? i} className="border-b border-border/50">
                      <td className="py-2 px-3 text-foreground">{h.chain_name ?? h.chain_id ?? h.chainId ?? '—'}</td>
                      <td className="py-2 px-3 text-right font-mono">{h.balance ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">No hot wallet data. <Link href="/admin/wallets/hot" className="text-primary hover:underline">View hot wallets</Link>.</p>
          )}
        </AdminPanel>

        <AdminPanel title="Cold wallet monitors" subtitle="Cold storage">
          {Array.isArray(coldWallets) && coldWallets.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Chain</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Address</th>
                  </tr>
                </thead>
                <tbody>
                  {coldWallets.slice(0, 5).map((c: { chain_id?: string; chain_name?: string; address?: string }, i: number) => (
                    <tr key={c.chain_id ?? i} className="border-b border-border/50">
                      <td className="py-2 px-3 text-foreground">{c.chain_name ?? c.chain_id ?? '—'}</td>
                      <td className="py-2 px-3 text-right font-mono text-xs truncate max-w-[180px]">{c.address ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">No cold wallet data.</p>
          )}
        </AdminPanel>
      </div>

      <AdminDataTable
        title="Recent pending deposits"
        subtitle="Latest pending deposits"
        isEmpty={deposits.length === 0}
        emptyMessage="No pending deposits"
      >
        {deposits.length > 0 && (
          <>
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Amount</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Status</th>
                <th className="text-right py-2 px-3 font-medium text-muted-foreground">Created</th>
              </tr>
            </thead>
            <tbody>
              {(deposits as Array<{ amount?: string; status?: string; created_at?: string }>).slice(0, 10).map((d, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-2 px-3 font-mono">{d.amount ?? '—'}</td>
                  <td className="py-2 px-3">{d.status ?? '—'}</td>
                  <td className="py-2 px-3 text-right text-muted-foreground">{d.created_at ? new Date(d.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </>
        )}
      </AdminDataTable>

      <AdminDataTable
        title="Recent pending withdrawals"
        subtitle="Awaiting approval or processing"
        isEmpty={withdrawals.length === 0}
        emptyMessage="No pending withdrawals"
      >
        {withdrawals.length > 0 && (
          <>
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Amount</th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">Status</th>
                <th className="text-right py-2 px-3 font-medium text-muted-foreground">Created</th>
              </tr>
            </thead>
            <tbody>
              {(withdrawals as Array<{ amount?: string; status?: string; created_at?: string }>).slice(0, 10).map((w, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-2 px-3 font-mono">{w.amount ?? '—'}</td>
                  <td className="py-2 px-3">{w.status ?? '—'}</td>
                  <td className="py-2 px-3 text-right text-muted-foreground">{w.created_at ? new Date(w.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </>
        )}
      </AdminDataTable>

      <AdminDataTable
        title="Escrow balances"
        subtitle="P2P escrow funds"
        isEmpty={escrows.length === 0}
        emptyMessage="No escrows"
      >
        {escrows.length > 0 && (
          <>
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">ID</th>
                <th className="text-right py-2 px-3 font-medium text-muted-foreground">Amount / Status</th>
              </tr>
            </thead>
            <tbody>
              {(escrows as Array<{ id?: string; amount?: string; status?: string }>).slice(0, 10).map((e, i) => (
                <tr key={e.id ?? i} className="border-b border-border/50">
                  <td className="py-2 px-3 font-mono text-xs">{e.id ?? '—'}</td>
                  <td className="py-2 px-3 text-right">{e.amount ?? '—'} / {e.status ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </>
        )}
      </AdminDataTable>
    </div>
  );
}
