'use client';

import { useState, useEffect } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import Link from 'next/link';
import { ArrowUpFromLine, Loader2 } from 'lucide-react';

interface Withdrawal {
  id: string;
  to_address: string;
  amount: string;
  fee: string;
  status: string;
  email: string;
  currency_symbol: string;
  chain_name: string;
  tx_hash: string | null;
  created_at: string;
}

export default function ProcessingWithdrawalsPage() {
  const { accessToken } = useAdminAuthStore();
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    fetch(`${apiUrl}/api/v1/admin/withdrawals?status=processing&limit=100`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json(), () => ({ success: false }))
      .then((result) => {
        if (result.success) setWithdrawals(result.data?.withdrawals ?? []);
      })
      .finally(() => setLoading(false));
  }, [accessToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Processing Withdrawals</h1>
        <p className="text-gray-400 text-sm mt-1">Withdrawals currently being broadcast on-chain.</p>
        <Link href="/admin/withdrawals" className="text-sm text-blue-500 hover:underline mt-2 inline-block">View all withdrawals</Link>
      </div>
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {withdrawals.length === 0 ? (
          <div className="p-8 text-center">
            <ArrowUpFromLine className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No withdrawals in processing</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">User</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Amount</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Chain</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">To Address</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Date</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((w) => (
                  <tr key={w.id} className="border-b border-gray-200 dark:border-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700/20">
                    <td className="px-6 py-4 text-gray-900 dark:text-white">{w.email}</td>
                    <td className="px-6 py-4">
                      <span className="font-medium">{parseFloat(w.amount).toFixed(8)}</span>
                      <span className="text-gray-400 ml-1">{w.currency_symbol}</span>
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{w.chain_name}</td>
                    <td className="px-6 py-4 text-gray-400 truncate max-w-[200px]">{w.to_address}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{new Date(w.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
