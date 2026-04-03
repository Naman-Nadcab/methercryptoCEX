'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import { useBalancesByAccount } from '@/lib/balances';
import { api } from '@/lib/api';
import { ArrowLeft, Download, Upload, FileText } from 'lucide-react';
import { CoinIcon } from '@/components/ui/CoinIcon';

interface Transaction {
  id: string;
  type: 'deposit' | 'withdrawal';
  symbol: string;
  amount: string;
  status: string;
  created_at: string;
}

export default function WalletSymbolPage() {
  const params = useParams();
  const router = useRouter();
  const { accessToken, _hasHydrated } = useAuthStore();
  const symbol = typeof params?.symbol === 'string' ? params.symbol : '';

  // Redirect to canonical coin wallet route (Binance-style assets flow)
  useEffect(() => {
    if (symbol && _hasHydrated) {
      router.replace(`/wallet/${encodeURIComponent(symbol)}`);
    }
  }, [symbol, _hasHydrated, router]);

  const { data: balancesData } = useBalancesByAccount(!!_hasHydrated && !!accessToken);
  const balances = balancesData ?? [];
  const row = balances.find((r) => r.symbol.toUpperCase() === symbol.toUpperCase());

  const [history, setHistory] = useState<Transaction[]>([]);

  useEffect(() => {
    if (!_hasHydrated || !accessToken) return;
    const load = async () => {
      try {
        const [depositsRes, withdrawalsRes] = await Promise.all([
          api.get<unknown[]>('/api/v1/wallet/deposit-history?limit=50'),
          api.get<unknown[]>('/api/v1/wallet/withdrawals?limit=50'),
        ]);
        const deposits = (depositsRes.success && Array.isArray(depositsRes.data) ? depositsRes.data : []) as Array<{ id: string; symbol?: string; amount?: string; status?: string; created_at?: string; createdAt?: string }>;
        const withdrawals = (withdrawalsRes.success && Array.isArray(withdrawalsRes.data) ? withdrawalsRes.data : []) as Array<{ id: string; symbol?: string; coin?: string; amount?: string; quantity?: string; status?: string; created_at?: string; date_time?: string; createdAt?: string }>;
        const combined: Transaction[] = [
          ...deposits.map((d) => ({
            id: d.id,
            type: 'deposit' as const,
            symbol: d.symbol || 'Unknown',
            amount: d.amount || '0',
            status: d.status || 'pending',
            created_at: d.created_at || d.createdAt || '',
          })),
          ...withdrawals.map((w) => ({
            id: w.id,
            type: 'withdrawal' as const,
            symbol: w.symbol || w.coin || 'Unknown',
            amount: w.amount || w.quantity || '0',
            status: w.status || 'pending',
            created_at: w.created_at || w.date_time || w.createdAt || '',
          })),
        ]
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setHistory(combined);
      } catch {
        setHistory([]);
      }
    };
    load();
  }, [_hasHydrated, accessToken]);

  const filteredHistory = symbol ? history.filter((t) => t.symbol.toUpperCase() === symbol.toUpperCase()) : [];

  if (!symbol) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <p className="text-muted-foreground">Invalid asset.</p>
        <Link href="/wallet" className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to Assets
        </Link>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <Link
          href="/wallet"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Assets
        </Link>
        <div className="rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <p className="font-medium text-foreground">No balance for this asset</p>
          <p className="mt-1 text-sm text-muted-foreground">{symbol} — Deposit to create a balance.</p>
          <Link
            href={`/wallet/deposit/crypto${symbol ? `?coin=${encodeURIComponent(symbol)}` : ''}`}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Download className="h-4 w-4" /> Deposit
          </Link>
        </div>
      </div>
    );
  }

  const total = row.total || '0';
  const funding = row.funding || '0';

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <Link
          href="/wallet"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <div className="flex items-center gap-2">
          <CoinIcon symbol={typeof symbol === 'string' ? symbol : ''} size={32} />
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{symbol} Wallet</h1>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-4">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total balance</p>
            <p className="text-lg font-semibold tabular-nums text-foreground">{total}</p>
            <p className="text-xs text-muted-foreground">{symbol}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Available balance</p>
            <p className="text-lg font-semibold tabular-nums text-foreground">{funding}</p>
            <p className="text-xs text-muted-foreground">{symbol}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Locked</p>
            <p className="text-lg font-semibold tabular-nums text-foreground">0</p>
            <p className="text-xs text-muted-foreground">{symbol}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href={`/wallet/deposit/crypto?coin=${encodeURIComponent(symbol)}`}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Download className="h-4 w-4" /> Deposit
        </Link>
        <Link
          href={`/wallet/withdraw/crypto?coin=${encodeURIComponent(symbol)}`}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Upload className="h-4 w-4" /> Withdraw
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Type</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Amount</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Date</th>
              </tr>
            </thead>
            <tbody>
              {filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No history for this asset.
                  </td>
                </tr>
              ) : (
                filteredHistory.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-border transition-colors last:border-0 hover:bg-muted/50"
                  >
                    <td className="px-4 py-3 font-medium capitalize text-foreground">{t.type}</td>
                    <td
                      className={`px-4 py-3 font-mono tabular-nums ${t.type === 'deposit' ? 'text-buy' : 'text-sell'}`}
                    >
                      {t.type === 'deposit' ? '+' : '-'}
                      {t.amount}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{t.status}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {t.created_at ? new Date(t.created_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
