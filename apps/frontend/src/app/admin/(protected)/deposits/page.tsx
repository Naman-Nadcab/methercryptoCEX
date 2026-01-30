'use client';

import { useState, useEffect } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { ArrowDownToLine, Loader2 } from 'lucide-react';

interface DepositStats {
  total: number;
  pending: number;
  confirming: number;
  completed: number;
  failed: number;
  flagged: number;
}

interface Deposit {
  id: string;
  tx_hash: string;
  amount: string;
  status: string;
  email: string;
  username: string;
  currency_symbol: string;
  chain_name: string;
  confirmations: number;
  required_confirmations: number;
  created_at: string;
}

export default function DepositsPage() {
  const { accessToken } = useAdminAuthStore();
  const [stats, setStats] = useState<DepositStats | null>(null);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchDeposits = async () => {
    setLoading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const params = new URLSearchParams({ limit: '50' });
      if (statusFilter !== 'all') params.set('status', statusFilter);

      const response = await fetch(`${apiUrl}/api/v1/admin/deposits?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setStats(result.data.stats);
        setDeposits(result.data.deposits);
      }
    } catch (error) {
      console.error('Failed to fetch deposits:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeposits();
  }, [accessToken, statusFilter]);

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-500/20 text-yellow-400',
      confirming: 'bg-blue-500/20 text-blue-400',
      completed: 'bg-green-500/20 text-green-400',
      failed: 'bg-red-500/20 text-red-400',
    };
    return colors[status] || 'bg-gray-500/20 text-gray-400';
  };

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Deposits</h1>
        <p className="text-gray-400 text-sm mt-1">Manage user deposits</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{stats?.total || 0}</p>
        </div>
        <div className="bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/30 rounded-xl p-4">
          <p className="text-sm text-yellow-600 dark:text-yellow-400">Pending</p>
          <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-300 mt-1">{stats?.pending || 0}</p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl p-4">
          <p className="text-sm text-blue-600 dark:text-blue-400">Confirming</p>
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 mt-1">{stats?.confirming || 0}</p>
        </div>
        <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-xl p-4">
          <p className="text-sm text-green-600 dark:text-green-400">Completed</p>
          <p className="text-2xl font-bold text-green-700 dark:text-green-300 mt-1">{stats?.completed || 0}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4">
          <p className="text-sm text-red-600 dark:text-red-400">Failed</p>
          <p className="text-2xl font-bold text-red-700 dark:text-red-300 mt-1">{stats?.failed || 0}</p>
        </div>
        <div className="bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/30 rounded-xl p-4">
          <p className="text-sm text-orange-600 dark:text-orange-400">Flagged</p>
          <p className="text-2xl font-bold text-orange-700 dark:text-orange-300 mt-1">{stats?.flagged || 0}</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white"
        >
          <option value="all">All Deposits</option>
          <option value="pending">Pending</option>
          <option value="confirming">Confirming</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Deposits Table */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {deposits.length === 0 ? (
          <div className="p-8 text-center">
            <ArrowDownToLine className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No deposits found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">User</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Amount</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Chain</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Confirmations</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Status</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Date</th>
                </tr>
              </thead>
              <tbody>
                {deposits.map((deposit) => (
                  <tr key={deposit.id} className="border-b border-gray-200 dark:border-gray-100 dark:border-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700/20">
                    <td className="px-6 py-4">
                      <p className="text-gray-900 dark:text-white">{deposit.email}</p>
                      <p className="text-xs text-gray-500 truncate max-w-[200px]">{deposit.tx_hash}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-gray-900 dark:text-white font-medium">{parseFloat(deposit.amount).toFixed(8)}</span>
                      <span className="text-gray-400 ml-1">{deposit.currency_symbol}</span>
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{deposit.chain_name}</td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                      {deposit.confirmations}/{deposit.required_confirmations}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusBadge(deposit.status)}`}>
                        {deposit.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                      {new Date(deposit.created_at).toLocaleDateString()}
                    </td>
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
