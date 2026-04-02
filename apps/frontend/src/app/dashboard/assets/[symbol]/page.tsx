'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import { useBalancesFunding } from '@/lib/balances';
import { api } from '@/lib/api';
import { ArrowLeft, Download, Upload, FileText, HelpCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip';

/** Tolerant symbol resolver: backend may use symbol / asset / currency / coin / token_symbol */
function resolveRowSymbol(row: Record<string, unknown>): string {
  return (
    (row.symbol ?? row.asset ?? row.currency ?? row.coin ?? row.token_symbol ?? '') as string
  ).toUpperCase();
}

interface Transaction {
  id: string;
  type: 'deposit' | 'withdrawal' | 'transfer';
  symbol: string;
  amount: string;
  status: string;
  created_at: string;
}

export default function AssetSymbolPage() {
  const params = useParams();
  const { accessToken, _hasHydrated } = useAuthStore();
  const rawSymbol = typeof params?.symbol === 'string' ? params.symbol : '';
  const normalizedSymbol = rawSymbol?.toUpperCase() ?? '';

  const { data: fundingData } = useBalancesFunding(!!_hasHydrated && !!accessToken);
  const balances = fundingData?.balances ?? [];
  const coinBalance = balances.find(
    (row) => resolveRowSymbol(row as unknown as Record<string, unknown>) === normalizedSymbol
  );
  const hasBalance = !!coinBalance && parseFloat(String(coinBalance?.total_balance ?? '0')) > 0;

  const [history, setHistory] = useState<Transaction[]>([]);
  const [rawDeposits, setRawDeposits] = useState<unknown[]>([]);
  const [rawWithdrawals, setRawWithdrawals] = useState<unknown[]>([]);
  const [rawTransfers, setRawTransfers] = useState<unknown[]>([]);

  useEffect(() => {
    if (!_hasHydrated || !accessToken) return;
    const load = async () => {
      try {
        const [depositsRes, withdrawalsRes, transfersRes] = await Promise.all([
          api.get<unknown[]>('/api/v1/wallet/deposit-history?limit=50'),
          api.get<unknown[]>('/api/v1/wallet/withdrawals?limit=50'),
          api.get<unknown[]>('/api/v1/wallet/transfer/history?limit=50'),
        ]);
        const deposits = (depositsRes.success && Array.isArray(depositsRes.data) ? depositsRes.data : []) as unknown[];
        const withdrawals = (withdrawalsRes.success && Array.isArray(withdrawalsRes.data) ? withdrawalsRes.data : []) as unknown[];
        const transfers = (transfersRes.success && Array.isArray(transfersRes.data) ? transfersRes.data : []) as unknown[];
        setRawDeposits(deposits);
        setRawWithdrawals(withdrawals);
        setRawTransfers(transfers);

        const matchesSymbol = (row: Record<string, unknown>) => resolveRowSymbol(row) === normalizedSymbol;
        const filteredDeposits = deposits.filter((r) => matchesSymbol(r as Record<string, unknown>));
        const filteredWithdrawals = withdrawals.filter((r) => matchesSymbol(r as Record<string, unknown>));
        const filteredTransfers = transfers.filter((r) => matchesSymbol(r as Record<string, unknown>));

        const toDeposit = (d: Record<string, unknown>) => ({
          id: String(d.id ?? ''),
          type: 'deposit' as const,
          symbol: resolveRowSymbol(d),
          amount: String(d.amount ?? '0'),
          status: String(d.status ?? 'pending'),
          created_at: String(d.created_at ?? d.createdAt ?? ''),
        });
        const toWithdrawal = (w: Record<string, unknown>) => ({
          id: String(w.id ?? ''),
          type: 'withdrawal' as const,
          symbol: resolveRowSymbol(w),
          amount: String(w.amount ?? w.quantity ?? '0'),
          status: String(w.status ?? 'pending'),
          created_at: String(w.created_at ?? w.date_time ?? w.createdAt ?? ''),
        });
        const toTransfer = (t: Record<string, unknown>) => ({
          id: String(t.id ?? ''),
          type: 'transfer' as const,
          symbol: resolveRowSymbol(t),
          amount: String(t.amount ?? '0'),
          status: String(t.status ?? 'completed'),
          created_at: String(t.created_at ?? t.createdAt ?? ''),
        });

        const combined: Transaction[] = [
          ...filteredDeposits.map((d) => toDeposit(d as Record<string, unknown>)),
          ...filteredWithdrawals.map((w) => toWithdrawal(w as Record<string, unknown>)),
          ...filteredTransfers.map((t) => toTransfer(t as Record<string, unknown>)),
        ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setHistory(combined);
      } catch {
        setHistory([]);
        setRawDeposits([]);
        setRawWithdrawals([]);
        setRawTransfers([]);
      }
    };
    load();
  }, [_hasHydrated, accessToken, normalizedSymbol]);

  const filteredHistory = history;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    console.log('Coin wallet symbol:', normalizedSymbol);
    console.log('Funding balances raw:', balances);
    console.log('Deposits raw:', rawDeposits);
    console.log('Withdrawals raw:', rawWithdrawals);
    console.log('Transfers raw:', rawTransfers);
  }, [normalizedSymbol, balances, rawDeposits, rawWithdrawals, rawTransfers]);

  if (!normalizedSymbol) {
    return (
      <div className="p-6">
        <p className="text-gray-500 dark:text-gray-400">Invalid asset.</p>
        <Link href="/wallet" className="mt-2 inline-flex items-center gap-1 text-sm text-blue-500 dark:text-blue-400 hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to Assets
        </Link>
      </div>
    );
  }

  if (!hasBalance) {
    return (
      <div className="p-6">
        <Link
          href="/wallet"
          className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Assets
        </Link>
        <div className="bg-white dark:bg-[#1e2329] rounded-lg border border-gray-200 dark:border-gray-700 p-6 text-center">
          <p className="text-gray-900 dark:text-white font-medium">No balance for this asset</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{normalizedSymbol} — Deposit to create a balance.</p>
          <Link
            href={`/wallet/deposit/crypto?coin=${encodeURIComponent(normalizedSymbol)}`}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium"
          >
            <Download className="w-4 h-4" /> Deposit
          </Link>
        </div>
      </div>
    );
  }

  const total = coinBalance?.total_balance ?? '0';
  const available = coinBalance?.available_balance ?? '0';
  const locked = coinBalance?.locked_balance ?? '0';

  return (
    <div className="p-6 space-y-4">
      {/* Section 1 — Page header */}
      <div className="flex items-center gap-4">
        <Link
          href="/wallet"
          className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">{normalizedSymbol} Wallet</h1>
      </div>

      {/* Balance card — header row (title + actions) + metrics */}
      <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 p-5 space-y-4 transition-all duration-200 ease-out hover:bg-gray-50/80 dark:hover:bg-white/[0.07] hover:border-gray-300 dark:hover:border-white/20">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <span className="text-xs text-gray-500 dark:text-white/50 uppercase tracking-wide">{normalizedSymbol} Wallet</span>
          <div className="flex justify-center gap-3 pt-2">
            <Link
              href={`/wallet/deposit/crypto?coin=${encodeURIComponent(normalizedSymbol)}`}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-xl text-sm font-medium bg-blue-500 hover:bg-blue-600 hover:brightness-110 text-white transition-transform duration-100 active:scale-[0.97]"
            >
              <Download className="w-4 h-4" /> Deposit
            </Link>
            <Link
              href={`/wallet/withdraw/crypto?coin=${encodeURIComponent(normalizedSymbol)}`}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-xl text-sm font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 transition-transform duration-100 active:scale-[0.97]"
            >
              <Upload className="w-4 h-4" /> Withdraw
            </Link>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:divide-x sm:divide-gray-200 dark:sm:divide-white/10">
          <div className="flex-1 py-2 sm:py-0 sm:px-4 first:sm:pl-0">
            <p className="text-xs text-gray-500 dark:text-white/50 uppercase tracking-wide">Total balance</p>
            <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-white"><span className="tabular-nums tracking-tight transition-all duration-300">{total}</span></p>
            <p className="text-xs text-gray-400 dark:text-white/40">{normalizedSymbol}</p>
          </div>
          <div className="flex-1 py-2 sm:py-0 sm:px-4">
            <p className="text-xs text-gray-500 dark:text-white/50 uppercase tracking-wide inline-flex items-center gap-1">Available balance
              <Tooltip>
                <TooltipTrigger asChild><HelpCircle className="w-3.5 h-3.5 text-gray-400 cursor-help" /></TooltipTrigger>
                <TooltipContent>Amount you can use for trading, transfers, and withdrawals.</TooltipContent>
              </Tooltip>
            </p>
            <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-white"><span className="tabular-nums tracking-tight transition-all duration-300">{available}</span></p>
            <p className="text-xs text-gray-400 dark:text-white/40">{normalizedSymbol}</p>
          </div>
          <div className="flex-1 py-2 sm:py-0 sm:px-4">
            <p className="text-xs text-gray-500 dark:text-white/50 uppercase tracking-wide inline-flex items-center gap-1">Locked
              <Tooltip>
                <TooltipTrigger asChild><HelpCircle className="w-3.5 h-3.5 text-gray-400 cursor-help" /></TooltipTrigger>
                <TooltipContent>Locked balance is reserved for open orders. Released when orders fill or are cancelled.</TooltipContent>
              </Tooltip>
            </p>
            <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-white"><span className="tabular-nums tracking-tight transition-all duration-300">{locked}</span></p>
            <p className="text-xs text-gray-400 dark:text-white/40">{normalizedSymbol}</p>
          </div>
        </div>
      </div>

      {/* History panel + table */}
      <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden p-5 space-y-4 transition-all duration-200 ease-out hover:bg-gray-50/80 dark:hover:bg-white/[0.07] hover:border-gray-300 dark:hover:border-white/20">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-gray-500 dark:text-white/40" />
          <h2 className="text-sm font-medium text-gray-900 dark:text-white">History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-xs text-gray-500 dark:text-white/40 uppercase tracking-wide border-b border-gray-200 dark:border-white/10">
                <th className="py-2 px-4 font-medium">Type</th>
                <th className="py-2 px-4 font-medium">Amount</th>
                <th className="py-2 px-4 font-medium">Status</th>
                <th className="py-2 px-4 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-gray-500 dark:text-white/40 text-xs">
                    No {normalizedSymbol} transactions yet
                  </td>
                </tr>
              ) : (
                filteredHistory.map((t) => (
                  <tr key={t.id} className="border-b border-gray-100 dark:border-white/5 last:border-0 hover:bg-gray-50 dark:hover:bg-white/[0.06] transition-colors duration-150 cursor-pointer">
                    <td className="py-2 px-4 font-medium text-gray-900 dark:text-white capitalize">{t.type}</td>
                    <td className="py-2 px-4 tabular-nums text-gray-900 dark:text-white/90">
                      {t.type === 'deposit' ? '+' : t.type === 'withdrawal' ? '-' : ''}{t.amount}
                    </td>
                    <td className="py-2 px-4 text-gray-600 dark:text-white/70">{t.status}</td>
                    <td className="py-2 px-4 tabular-nums text-gray-500 dark:text-white/70">{t.created_at ? new Date(t.created_at).toLocaleString() : '—'}</td>
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
