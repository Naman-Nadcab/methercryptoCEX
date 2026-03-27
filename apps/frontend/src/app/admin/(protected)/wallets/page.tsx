'use client';

import { useState, useEffect } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Wallet, Loader2 } from 'lucide-react';
import { AdminChartCard, DepositWithdrawChart, TopMarketsChart } from '@/components/admin/charts';

interface Blockchain {
  id: string;
  chain_name: string;
  chain_symbol: string;
  is_active: boolean;
  deposit_enabled: boolean;
  withdrawal_enabled: boolean;
}

interface Currency {
  id: string;
  symbol: string;
  name: string;
  currency_type: string;
  chain_name: string;
  chain_symbol: string;
  decimals: number;
  is_active: boolean;
}

interface Balance {
  symbol: string;
  name: string;
  total_available: string;
  total_locked: string;
}

export default function WalletsPage() {
  const { accessToken } = useAdminAuthStore();
  const [blockchains, setBlockchains] = useState<Blockchain[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [totalWallets, setTotalWallets] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchWallets = async () => {
    try {
      const apiUrl = getApiBaseUrl();
      const response = await fetch(`${apiUrl}/api/v1/admin/wallets`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setBlockchains(result.data.blockchains);
        setCurrencies(result.data.currencies);
        setBalances(result.data.balances);
        setTotalWallets(result.data.totalWallets);
      }
    } catch (error) {
      console.error('Failed to fetch wallets:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWallets();
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
        <h1 className="text-xl font-bold admin-metric-value">Wallet & Treasury</h1>
        <p className="text-sm admin-metric-label mt-0.5">Deposit monitoring, withdrawal queue, reserve analytics</p>
      </div>

      <section>
        <h2 className="text-xs font-semibold admin-metric-label uppercase tracking-wider mb-3">
          Treasury analytics
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <AdminChartCard title="Deposit vs withdrawal" subtitle="7d (k USDT)">
            <DepositWithdrawChart />
          </AdminChartCard>
          <AdminChartCard title="Reserve distribution" subtitle="By asset (volume proxy)">
            <TopMarketsChart />
          </AdminChartCard>
          <AdminChartCard title="Deposit trends" subtitle="7d">
            <DepositWithdrawChart />
          </AdminChartCard>
        </div>
      </section>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Blockchains</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{blockchains.length}</p>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Currencies</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{currencies.length}</p>
        </div>
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">User Wallets</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{totalWallets}</p>
        </div>
      </div>

      {/* Blockchains */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Supported Blockchains</h2>
        </div>
        {blockchains.length === 0 ? (
          <div className="p-8 text-center">
            <Wallet className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No blockchains configured</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4">
            {blockchains.map((chain) => (
              <div key={chain.id} className="bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900 dark:text-white">{chain.chain_name}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{chain.chain_symbol}</span>
                </div>
                <div className="flex gap-2 mt-2">
                  <span className={`text-xs px-2 py-1 rounded ${chain.deposit_enabled ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    Deposit {chain.deposit_enabled ? 'ON' : 'OFF'}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded ${chain.withdrawal_enabled ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    Withdraw {chain.withdrawal_enabled ? 'ON' : 'OFF'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Currencies */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Supported Currencies</h2>
        </div>
        {currencies.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">No currencies configured</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Symbol</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Name</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Type</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Chain</th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {currencies.map((currency) => (
                  <tr key={currency.id} className="border-b border-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700/20">
                    <td className="px-6 py-4 text-gray-900 dark:text-white font-medium">{currency.symbol}</td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{currency.name}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-1 rounded ${
                        currency.currency_type === 'crypto' ? 'bg-blue-500/20 text-blue-400' :
                        currency.currency_type === 'fiat' ? 'bg-green-500/20 text-green-400' :
                        'bg-blue-500/20 text-blue-400'
                      }`}>
                        {currency.currency_type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{currency.chain_name || '-'}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2 py-1 rounded ${currency.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                        {currency.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Balances */}
      {balances.length > 0 && (
        <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Total User Balances</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left px-6 py-4 text-xs font-medium text-gray-400 uppercase">Currency</th>
                  <th className="text-right px-6 py-4 text-xs font-medium text-gray-400 uppercase">Available</th>
                  <th className="text-right px-6 py-4 text-xs font-medium text-gray-400 uppercase">Locked</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((balance) => (
                  <tr key={balance.symbol} className="border-b border-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700/20">
                    <td className="px-6 py-4">
                      <span className="text-gray-900 dark:text-white font-medium">{balance.symbol}</span>
                      <span className="text-gray-500 text-sm ml-2">{balance.name}</span>
                    </td>
                    <td className="px-6 py-4 text-right text-green-400">{parseFloat(balance.total_available).toFixed(8)}</td>
                    <td className="px-6 py-4 text-right text-yellow-400">{parseFloat(balance.total_locked).toFixed(8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
