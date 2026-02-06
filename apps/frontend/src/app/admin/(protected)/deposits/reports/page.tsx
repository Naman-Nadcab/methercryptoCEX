'use client';

import { useState, useEffect } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import Link from 'next/link';
import { BarChart3, ArrowDownToLine, Loader2, FileText } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface DepositStats {
  total: string;
  pending: string;
  confirming: string;
  completed: string;
  failed: string;
  flagged: string;
}

export default function DepositReportsPage() {
  const { accessToken } = useAdminAuthStore();
  const [stats, setStats] = useState<DepositStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/admin/deposits?page=1&limit=1`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await res.json();
        if (!cancelled && data.success && data.data?.stats) setStats(data.data.stats);
      } catch {
        if (!cancelled) setStats(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [accessToken]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Deposit Reports</h1>
        <p className="text-gray-400 text-sm mt-1">
          Deposit analytics and summary. Use filters on All Deposits for detailed lists and export.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[200px]">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
              <p className="text-sm text-gray-500 dark:text-gray-400">Total</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{stats?.total ?? '0'}</p>
            </div>
            <div className="bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/30 rounded-xl p-4">
              <p className="text-sm text-yellow-600 dark:text-yellow-400">Pending</p>
              <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-300 mt-1">{stats?.pending ?? '0'}</p>
            </div>
            <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl p-4">
              <p className="text-sm text-blue-600 dark:text-blue-400">Confirming</p>
              <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 mt-1">{stats?.confirming ?? '0'}</p>
            </div>
            <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-xl p-4">
              <p className="text-sm text-green-600 dark:text-green-400">Completed</p>
              <p className="text-2xl font-bold text-green-700 dark:text-green-300 mt-1">{stats?.completed ?? '0'}</p>
            </div>
            <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4">
              <p className="text-sm text-red-600 dark:text-red-400">Failed</p>
              <p className="text-2xl font-bold text-red-700 dark:text-red-300 mt-1">{stats?.failed ?? '0'}</p>
            </div>
            <div className="bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/30 rounded-xl p-4">
              <p className="text-sm text-orange-600 dark:text-orange-400">Flagged</p>
              <p className="text-2xl font-bold text-orange-700 dark:text-orange-300 mt-1">{stats?.flagged ?? '0'}</p>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <BarChart3 className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Deposit overview</h2>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              For full lists, filters, and export use <strong>All Deposits</strong>. Pending and Flagged pages show filtered views for quick review.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin/deposits"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
              >
                <ArrowDownToLine className="w-4 h-4" />
                All Deposits
              </Link>
              <Link
                href="/admin/deposits/pending"
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium"
              >
                Pending
              </Link>
              <Link
                href="/admin/deposits/flagged"
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium"
              >
                Flagged
              </Link>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <FileText className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Export</h2>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Use All Deposits with date/status filters, then export from the table (CSV/Excel) when the feature is enabled. Reports are aligned with Spot and P2P operations.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
