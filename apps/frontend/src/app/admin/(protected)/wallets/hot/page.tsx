'use client';

export default function HotWalletsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Hot Wallets</h1>
      <p className="text-gray-400 text-sm">Manage hot wallet balances</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { chain: 'Ethereum', balance: '125.5 ETH', usd: '$400,000' },
          { chain: 'Bitcoin', balance: '5.2 BTC', usd: '$220,000' },
          { chain: 'Tron', balance: '500,000 TRX', usd: '$50,000' },
        ].map((wallet) => (
          <div key={wallet.chain} className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">{wallet.chain}</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white mt-1">{wallet.balance}</p>
            <p className="text-sm text-green-400">{wallet.usd}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
