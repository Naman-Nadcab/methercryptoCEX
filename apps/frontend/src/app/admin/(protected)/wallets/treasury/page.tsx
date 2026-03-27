'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  getFundsSummary,
  getHotWallets,
  getEscrows,
  getWithdrawals,
} from '@/lib/admin/wallets';
import { SectionHeader } from '@/components/admin/control-plane';
import { AdminMetricCard, AdminChartCard, AdminPanel, AdminDataTable } from '@/components/admin/ui';
import { DataTableTh, DataTableRow, DataTableCell } from '@/components/admin/control-plane';
import { Wallet, Lock, Coins, Loader2 } from 'lucide-react';
import Link from 'next/link';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

export default function TreasuryPage() {
  const { accessToken } = useAdminAuthStore();

  const { data: fundsData, isLoading } = useQuery({
    queryKey: ['admin', 'funds-summary', 'treasury'],
    queryFn: () => getFundsSummary(accessToken),
    enabled: !!accessToken,
  });

  const { data: hotData } = useQuery({
    queryKey: ['admin', 'hot-wallets', 'treasury'],
    queryFn: () => getHotWallets(accessToken),
    enabled: !!accessToken,
  });

  const { data: escrowsData } = useQuery({
    queryKey: ['admin', 'escrows', 'treasury'],
    queryFn: () => getEscrows(accessToken),
    enabled: !!accessToken,
  });

  const { data: withdrawalsData } = useQuery({
    queryKey: ['admin', 'withdrawals', 'treasury'],
    queryFn: () => getWithdrawals(accessToken, { limit: 50 }),
    enabled: !!accessToken,
  });

  const summary = fundsData?.data as {
    ledger_totals?: Array<{ token_symbol?: string; amount?: string; chain_name?: string }>;
    on_chain_totals?: {
      hot_wallets?: Array<{ chain_id?: string; chain_name?: string; balance?: string }>;
      cold_wallets?: Array<{ chain_id?: string; chain_name?: string; balance?: string; address?: string }>;
    };
  } | undefined;

  const hotWallets = summary?.on_chain_totals?.hot_wallets ?? (hotData?.data as { chains?: Array<{ chainId: string; balance?: string }> })?.chains ?? [];
  const coldWallets = summary?.on_chain_totals?.cold_wallets ?? [];
  const escrows = (escrowsData?.data as { escrows?: Array<Record<string, unknown>> })?.escrows ?? [];
  const withdrawals = (withdrawalsData?.data as { withdrawals?: Array<Record<string, unknown>> })?.withdrawals ?? [];

  const ledgerTotals = summary?.ledger_totals ?? [];
  const totalReserves = ledgerTotals.reduce((acc, r) => acc + parseFloat(String(r.amount ?? 0)), 0);
  const hotTotal = Array.isArray(hotWallets)
    ? hotWallets.reduce((acc, h) => acc + parseFloat(String((h as { balance?: string }).balance ?? 0)), 0)
    : 0;
  const coldTotal = Array.isArray(coldWallets)
    ? coldWallets.reduce((acc, c) => acc + parseFloat(String((c as { balance?: string }).balance ?? 0)), 0)
    : 0;
  const escrowTotal = Array.isArray(escrows)
    ? escrows.reduce((acc, e) => acc + parseFloat(String(e.amount ?? e.balance ?? 0)), 0)
    : 0;
  const reserveRatio = totalReserves > 0 ? (hotTotal + coldTotal) / totalReserves : 0;

  const reserveTrendData = useMemo(() => {
    const byToken = (ledgerTotals as Array<{ token_symbol?: string; amount?: string }>).map((r) => ({
      name: r.token_symbol ?? '—',
      amount: parseFloat(String(r.amount ?? 0)),
    }));
    return byToken.filter((d) => d.amount > 0).slice(0, 10);
  }, [ledgerTotals]);

  const hotVsColdData = useMemo(
    () => [
      { name: 'Hot', value: hotTotal, color: 'hsl(var(--primary))' },
      { name: 'Cold', value: coldTotal, color: 'hsl(var(--muted-foreground))' },
      { name: 'Escrow', value: escrowTotal, color: 'hsl(var(--muted-foreground))' },
    ].filter((d) => d.value > 0),
    [hotTotal, coldTotal, escrowTotal]
  );

  const tableRows = useMemo(() => {
    const rows: Array<{ wallet: string; token: string; balance: string; type: string; status: string }> = [];
    (hotWallets as Array<{ chain_id?: string; chain_name?: string; chainId?: string; balance?: string }>).forEach((h, i) => {
      rows.push({
        wallet: h.chain_name ?? h.chain_id ?? h.chainId ?? `Hot-${i}`,
        token: '—',
        balance: String(h.balance ?? '0'),
        type: 'Hot',
        status: 'Active',
      });
    });
    (coldWallets as Array<{ chain_id?: string; chain_name?: string; balance?: string; address?: string }>).forEach((c, i) => {
      rows.push({
        wallet: c.chain_name ?? c.chain_id ?? `Cold-${i}`,
        token: '—',
        balance: String(c.balance ?? '0'),
        type: 'Cold',
        status: 'Active',
      });
    });
    ledgerTotals.forEach((l) => {
      rows.push({
        wallet: 'Ledger',
        token: l.token_symbol ?? '—',
        balance: String(l.amount ?? '0'),
        type: 'Reserve',
        status: 'Active',
      });
    });
    return rows.slice(0, 30);
  }, [hotWallets, coldWallets, ledgerTotals]);

  if (isLoading && !summary) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Treasury / Cold Wallet Management"
        subtitle="Cold & hot wallet balances, reserve ratio, treasury allocation"
      />

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <AdminMetricCard
          label="Cold wallet balances"
          value={Array.isArray(coldWallets) ? coldWallets.length : 0}
          sublabel="chains"
          icon={<Lock className="w-4 h-4" />}
        />
        <AdminMetricCard
          label="Hot wallet balances"
          value={Array.isArray(hotWallets) ? hotWallets.length : 0}
          sublabel="chains"
          icon={<Wallet className="w-4 h-4" />}
          href="/admin/wallets/hot"
        />
        <AdminMetricCard
          label="Reserve ratio"
          value={totalReserves > 0 ? `${(reserveRatio * 100).toFixed(1)}%` : '—'}
          sublabel="on-chain / ledger"
          icon={<Coins className="w-4 h-4" />}
        />
        <AdminMetricCard
          label="Treasury (ledger total)"
          value={totalReserves > 0 ? totalReserves.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
          sublabel="reserves"
          icon={<Wallet className="w-4 h-4" />}
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AdminChartCard title="Reserve trend" subtitle="By token (ledger totals)">
          {reserveTrendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={reserveTrendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground py-4">No ledger totals. Data from funds/summary.</p>
          )}
        </AdminChartCard>
        <AdminChartCard title="Hot vs cold wallet distribution" subtitle="On-chain + escrow">
          {hotVsColdData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={hotVsColdData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  label={({ name, value }) => `${name}: ${value.toFixed(0)}`}
                >
                  {hotVsColdData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground py-4">No balance data.</p>
          )}
        </AdminChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AdminPanel title="Cold wallet balances" subtitle="Cold storage by chain">
          {Array.isArray(coldWallets) && coldWallets.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Chain</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {coldWallets.slice(0, 10).map((c: Record<string, unknown>, i: number) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-2 px-3">{String(c.chain_name ?? c.chain_id ?? '—')}</td>
                      <td className="py-2 px-3 text-right font-mono">{String(c.balance ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">No cold wallet data from funds/summary.</p>
          )}
        </AdminPanel>
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
                  {hotWallets.slice(0, 10).map((h: Record<string, unknown>, i: number) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-2 px-3">{String(h.chain_name ?? h.chain_id ?? h.chainId ?? '—')}</td>
                      <td className="py-2 px-3 text-right font-mono">{String(h.balance ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4"><Link href="/admin/wallets/hot" className="text-primary hover:underline">View hot wallets</Link>.</p>
          )}
        </AdminPanel>
      </div>

      <AdminDataTable
        title="Wallet overview"
        subtitle="Wallet, token, balance, type (Hot / Cold), status"
        isEmpty={tableRows.length === 0}
        emptyMessage="No wallet data."
        wrapTable={false}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <DataTableTh>Wallet</DataTableTh>
                <DataTableTh>Token</DataTableTh>
                <DataTableTh align="right">Balance</DataTableTh>
                <DataTableTh>Type</DataTableTh>
                <DataTableTh>Status</DataTableTh>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, i) => (
                <DataTableRow key={i}>
                  <DataTableCell>{row.wallet}</DataTableCell>
                  <DataTableCell mono>{row.token}</DataTableCell>
                  <DataTableCell align="right" mono>{row.balance}</DataTableCell>
                  <DataTableCell>{row.type}</DataTableCell>
                  <DataTableCell>{row.status}</DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </table>
        </div>
      </AdminDataTable>

      {withdrawals.length > 0 && (
        <AdminPanel title="Recent withdrawal queue" subtitle="Pending or recent">
          <p className="text-sm text-muted-foreground">
            <Link href="/admin/withdrawals" className="text-primary hover:underline">{withdrawals.length} withdrawals</Link> in queue. Use Withdrawals for approve/delay/freeze.
          </p>
        </AdminPanel>
      )}

      <p className="text-xs text-muted-foreground">
        Data from <code className="bg-muted px-1 rounded">funds/summary</code>, <code className="bg-muted px-1 rounded">hot-wallets</code>, <code className="bg-muted px-1 rounded">escrows</code>, <code className="bg-muted px-1 rounded">withdrawals</code>.
      </p>
    </div>
  );
}
