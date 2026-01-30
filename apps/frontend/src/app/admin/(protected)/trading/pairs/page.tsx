'use client';

export default function TradingPairsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Trading Pairs</h1>
      <p className="text-gray-400 text-sm">Manage trading pairs</p>
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400">Pair</th>
              <th className="text-left px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400">Status</th>
              <th className="text-right px-6 py-4 text-xs font-medium text-gray-500 dark:text-gray-400">Volume 24h</th>
            </tr>
          </thead>
          <tbody>
            {['BTC/USDT', 'ETH/USDT', 'BNB/USDT'].map((pair) => (
              <tr key={pair} className="border-b border-gray-700/50">
                <td className="px-6 py-4 text-gray-900 dark:text-white">{pair}</td>
                <td className="px-6 py-4"><span className="px-2 py-1 rounded-full text-xs bg-green-500/20 text-green-400">Active</span></td>
                <td className="px-6 py-4 text-right text-gray-500 dark:text-gray-400">$1.2M</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
