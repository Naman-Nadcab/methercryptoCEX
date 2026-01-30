'use client';

import { useState, useEffect } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { Receipt, Loader2 } from 'lucide-react';

interface FeeTier {
  id: string;
  tier_name: string;
  tier_level: number;
  min_trading_volume: string;
  min_token_holding: string;
  spot_maker_fee: string;
  spot_taker_fee: string;
  withdrawal_fee_discount: string;
}

export default function FeesPage() {
  const { accessToken } = useAdminAuthStore();
  const [tiers, setTiers] = useState<FeeTier[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFees = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const response = await fetch(`${apiUrl}/api/v1/admin/fees`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setTiers(result.data.tiers);
      }
    } catch (error) {
      console.error('Failed to fetch fees:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFees();
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Fee Management</h1>
        <p className="text-gray-400 text-sm mt-1">Configure trading fee tiers</p>
      </div>

      {/* Fee Tiers */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Fee Tiers</h2>
        </div>
        {tiers.length === 0 ? (
          <div className="p-8 text-center">
            <Receipt className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No fee tiers configured</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Tier</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Min Volume (30d)</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Maker Fee</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Taker Fee</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Withdrawal Discount</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((tier) => (
                  <tr key={tier.id} className="border-b border-gray-200 dark:border-gray-100 dark:border-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700/20">
                    <td className="px-6 py-4">
                      <span className={`font-medium ${
                        tier.tier_level === 0 ? 'text-gray-400' :
                        tier.tier_level <= 2 ? 'text-blue-400' :
                        tier.tier_level <= 4 ? 'text-blue-400' :
                        'text-yellow-400'
                      }`}>
                        {tier.tier_name}
                      </span>
                      <p className="text-xs text-gray-500">Level {tier.tier_level}</p>
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                      ${parseFloat(tier.min_trading_volume).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-green-400">
                      {(parseFloat(tier.spot_maker_fee) * 100).toFixed(2)}%
                    </td>
                    <td className="px-6 py-4 text-yellow-400">
                      {(parseFloat(tier.spot_taker_fee) * 100).toFixed(2)}%
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                      {(parseFloat(tier.withdrawal_fee_discount) * 100).toFixed(0)}%
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
