'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import { useBalancesByAccount } from '@/lib/balances';
import { api } from '@/lib/api';
import { ArrowLeft, Download, Upload, FileText } from 'lucide-react';

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
      <div className="p-6">
        <p className="text-gray-500 dark:text-gray-400">Invalid asset.</p>
        <Link href="/wallet" className="mt-2 inline-flex items-center gap-1 text-sm text-blue-500 dark:text-blue-400 hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to Assets
        </Link>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="p-6 max-w-2xl">
        <Link
          href="/wallet"
          className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Assets
        </Link>
        <div className="bg-white dark:bg-[#1e2329] rounded-lg border border-gray-200 dark:border-gray-700 p-6 text-center">
          <p className="text-gray-900 dark:text-white font-medium">No balance for this asset</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{symbol} — Deposit to create a balance.</p>
          <Link
            href={`/wallet/deposit/crypto${symbol ? `?coin=${encodeURIComponent(symbol)}` : ''}`}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium"
          >
            <Download className="w-4 h-4" /> Deposit
          </Link>
        </div>
      </div>
    );
  }

  const total = row.total || '0';
  const funding = row.funding || '0';

  return (
    <div className="p-6 max-w-3xl">
      {/* Top bar */}
      <div className="flex items-center gap-4 mb-6">
        <Link
          href="/wallet"
          className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{symbol} Wallet</h1>
      </div>

      {/* Balance summary card */}
      <div className="bg-white dark:bg-[#1e2329] rounded-lg border border-gray-200 dark:border-gray-700 p-5 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total balance</p>
            <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white tabular-nums">{total}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{symbol}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Available balance</p>
            <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white tabular-nums">{funding}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{symbol}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Locked</p>
            <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white tabular-nums">0</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{symbol}</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3 mb-6">
        <Link
          href={`/wallet/deposit/crypto?coin=${encodeURIComponent(symbol)}`}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors"
        >
          <Download className="w-4 h-4" /> Deposit
        </Link>
        <Link
          href={`/wallet/withdraw/crypto?coin=${encodeURIComponent(symbol)}`}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white dark:bg-[#1e2329] border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium transition-colors"
        >
          <Upload className="w-4 h-4" /> Withdraw
        </Link>
      </div>

      {/* History */}
      <div className="bg-white dark:bg-[#1e2329] rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <FileText className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <h2 className="text-sm font-medium text-gray-900 dark:text-white">History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-3 px-4 font-medium uppercase tracking-wide">Type</th>
                <th className="py-3 px-4 font-medium uppercase tracking-wide">Amount</th>
                <th className="py-3 px-4 font-medium uppercase tracking-wide">Status</th>
                <th className="py-3 px-4 font-medium uppercase tracking-wide">Date</th>
              </tr>
            </thead>
            <tbody>
              {filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-500 dark:text-gray-400 text-sm">No history for this asset.</td>
                </tr>
              ) : (
                filteredHistory.map((t) => (
                  <tr key={t.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/50 dark:hover:bg-white/5">
                    <td className="py-3 px-4 font-medium text-gray-900 dark:text-white capitalize">{t.type}</td>
                    <td className="py-3 px-4 tabular-nums text-gray-700 dark:text-gray-300">{t.type === 'deposit' ? '+' : '-'}{t.amount}</td>
                    <td className="py-3 px-4 text-gray-600 dark:text-gray-400">{t.status}</td>
                    <td className="py-3 px-4 text-gray-500 dark:text-gray-400">{t.created_at ? new Date(t.created_at).toLocaleString() : '—'}</td>
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
