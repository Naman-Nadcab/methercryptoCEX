'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  ArrowLeft,
  Loader2,
  Wallet,
  User,
  AlertCircle,
  Coins,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type TabId = 'overview' | 'balances';

interface UserDetail {
  id: string;
  email: string;
  phone: string | null;
  username: string | null;
  status: string;
  email_verified: boolean;
  phone_verified: boolean;
  tier_level: number;
  created_at: string;
  last_login_at: string | null;
  [key: string]: unknown;
}

interface BalanceRow {
  token_id: string;
  token_symbol: string;
  token_name: string;
  chain_id: string | null;
  chain_name: string | null;
  available_balance: string;
  locked_balance: string;
  total_balance: string;
  updated_at: string;
}

export default function AdminUserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params?.id === 'string' ? params.id : '';
  const { accessToken } = useAdminAuthStore();

  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [user, setUser] = useState<UserDetail | null>(null);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [loadingUser, setLoadingUser] = useState(true);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);
  const [balancesError, setBalancesError] = useState<string | null>(null);

  const fetchUser = useCallback(async () => {
    if (!id || !accessToken) return;
    setLoadingUser(true);
    setUserError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/users/${id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (res.ok && data.success && data.data?.user) {
        setUser(data.data.user);
      } else {
        setUserError(data?.error?.message || 'User not found');
        if (res.status === 404) router.replace('/admin/users');
      }
    } catch (e) {
      setUserError(e instanceof Error ? e.message : 'Failed to load user');
    } finally {
      setLoadingUser(false);
    }
  }, [id, accessToken, router]);

  const fetchBalances = useCallback(async () => {
    if (!id || !accessToken) return;
    setLoadingBalances(true);
    setBalancesError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/users/${id}/balances`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setBalances(Array.isArray(data.data?.balances) ? data.data.balances : []);
      } else {
        setBalancesError(data?.error?.message || 'Failed to load balances');
      }
    } catch (e) {
      setBalancesError(e instanceof Error ? e.message : 'Failed to load balances');
    } finally {
      setLoadingBalances(false);
    }
  }, [id, accessToken]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    if (activeTab === 'balances') fetchBalances();
  }, [activeTab, fetchBalances]);

  if (loadingUser && !user) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (userError && !user) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to users
        </Link>
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 flex items-center gap-4">
          <AlertCircle className="w-10 h-10 text-red-400 shrink-0" />
          <p className="text-red-200">{userError}</p>
        </div>
      </div>
    );
  }

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <User className="w-4 h-4" /> },
    { id: 'balances', label: 'Balances', icon: <Wallet className="w-4 h-4" /> },
  ];

  const formatAmount = (s: string) => {
    const n = parseFloat(s);
    if (Number.isNaN(n)) return '0';
    return n.toFixed(8);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to users
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {user?.email ?? 'User'}
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          User detail · {user?.id ?? id}
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Profile</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Email</dt>
              <dd className="mt-1 text-gray-900 dark:text-white">{user?.email ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Phone</dt>
              <dd className="mt-1 text-gray-900 dark:text-white">{user?.phone ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Username</dt>
              <dd className="mt-1 text-gray-900 dark:text-white">{user?.username ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</dt>
              <dd className="mt-1">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  user?.status === 'active' ? 'bg-green-500/20 text-green-400' :
                  user?.status === 'suspended' ? 'bg-orange-500/20 text-orange-400' :
                  user?.status === 'banned' ? 'bg-red-500/20 text-red-400' :
                  'bg-gray-500/20 text-gray-400'
                }`}>
                  {user?.status ?? '—'}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tier</dt>
              <dd className="mt-1 text-gray-900 dark:text-white">{user?.tier_level ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Created</dt>
              <dd className="mt-1 text-gray-500 dark:text-gray-400">
                {user?.created_at ? new Date(user.created_at).toLocaleString() : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Last login</dt>
              <dd className="mt-1 text-gray-500 dark:text-gray-400">
                {user?.last_login_at ? new Date(user.last_login_at).toLocaleString() : '—'}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {activeTab === 'balances' && (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          {loadingBalances ? (
            <div className="flex items-center justify-center min-h-[240px]">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
          ) : balancesError ? (
            <div className="p-6 flex items-center gap-4">
              <AlertCircle className="w-10 h-10 text-amber-400 shrink-0" />
              <div>
                <p className="text-amber-200 font-medium">Failed to load balances</p>
                <p className="text-sm text-gray-400 mt-1">{balancesError}</p>
                <button
                  type="button"
                  onClick={() => fetchBalances()}
                  className="mt-2 px-3 py-1.5 text-sm bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 rounded-lg"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : balances.length === 0 ? (
            <div className="p-12 text-center">
              <Coins className="w-12 h-12 text-gray-500 dark:text-gray-500 mx-auto mb-4 opacity-60" />
              <p className="text-gray-500 dark:text-gray-400 font-medium">No balances yet</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                This user has no balance rows. Balances appear after deposits are credited.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Token</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Chain</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Available</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Locked</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Updated at</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((row) => (
                    <tr
                      key={`${row.token_id}-${row.chain_id ?? 'na'}`}
                      className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20"
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900 dark:text-white">{row.token_symbol}</span>
                        {row.token_name && row.token_name !== row.token_symbol && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">{row.token_name}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {row.chain_name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-white font-mono text-sm">
                        {formatAmount(row.available_balance)}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 font-mono text-sm">
                        {formatAmount(row.locked_balance)}
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-white font-mono text-sm font-medium">
                        {formatAmount(row.total_balance)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {row.updated_at ? new Date(row.updated_at).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
