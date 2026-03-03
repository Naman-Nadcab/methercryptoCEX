'use client';

import { useState, useEffect } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Gift, Loader2 } from 'lucide-react';

interface ReferralCode {
  id: string;
  code: string;
  code_type: string;
  referrer_commission_rate: string;
  referee_discount_rate: string;
  is_active: boolean;
  current_referrals: number;
  total_earnings: string;
  email: string;
  username: string;
  created_at: string;
}

interface ReferralStats {
  total_codes: number;
  active_codes: number;
  total_earnings: string;
  total_referrals: string;
}

export default function ReferralsPage() {
  const { accessToken } = useAdminAuthStore();
  const [codes, setCodes] = useState<ReferralCode[]>([]);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchReferrals = async () => {
    try {
      const apiUrl = getApiBaseUrl();
      const response = await fetch(`${apiUrl}/api/v1/admin/referrals`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setCodes(result.data.codes);
        setStats(result.data.stats);
      }
    } catch (error) {
      console.error('Failed to fetch referrals:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReferrals();
  }, [accessToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Referral System</h1>
        <p className="text-gray-400 text-sm mt-1">Manage referral codes and commissions</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Codes</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{stats?.total_codes || 0}</p>
        </div>
        <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-xl p-4">
          <p className="text-sm text-green-600 dark:text-green-400">Active Codes</p>
          <p className="text-2xl font-bold text-green-700 dark:text-green-300 mt-1">{stats?.active_codes || 0}</p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-xl p-4">
          <p className="text-sm text-blue-600 dark:text-blue-400">Total Referrals</p>
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 mt-1">{stats?.total_referrals || 0}</p>
        </div>
        <div className="bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/30 rounded-xl p-4">
          <p className="text-sm text-yellow-600 dark:text-yellow-400">Total Earnings</p>
          <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-300 mt-1">${parseFloat(stats?.total_earnings || '0').toFixed(2)}</p>
        </div>
      </div>

      {/* Referral Codes */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Referral Codes</h2>
        </div>
        {codes.length === 0 ? (
          <div className="p-8 text-center">
            <Gift className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No referral codes found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Code</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Owner</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Type</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Commission</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Referrals</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Earnings</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((code) => (
                  <tr key={code.id} className="border-b border-gray-200 dark:border-gray-100 dark:border-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700/20">
                    <td className="px-6 py-4">
                      <span className="font-mono text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">{code.code}</span>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-gray-900 dark:text-white">{code.email}</p>
                      {code.username && <p className="text-xs text-gray-500">@{code.username}</p>}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-1 rounded ${
                        code.code_type === 'influencer' ? 'bg-blue-500/20 text-blue-400' :
                        code.code_type === 'affiliate' ? 'bg-blue-500/20 text-blue-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>
                        {code.code_type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                      {(parseFloat(code.referrer_commission_rate) * 100).toFixed(0)}%
                    </td>
                    <td className="px-6 py-4 text-gray-900 dark:text-white">{code.current_referrals}</td>
                    <td className="px-6 py-4 text-green-400">${parseFloat(code.total_earnings).toFixed(2)}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-1 rounded ${code.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                        {code.is_active ? 'Active' : 'Inactive'}
                      </span>
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
