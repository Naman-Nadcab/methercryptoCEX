'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ShoppingCart, Banknote } from 'lucide-react';

const CRYPTO_OPTIONS = ['USDT', 'BTC', 'ETH', 'USDC'];
const FIAT_OPTIONS = ['INR', 'USD', 'EUR', 'GBP'];

export default function DashboardP2PPage() {
  const router = useRouter();
  const [type, setType] = useState<'buy' | 'sell'>('buy');
  const [crypto, setCrypto] = useState('USDT');
  const [fiat, setFiat] = useState('INR');

  const handleGo = () => {
    router.push(`/dashboard/p2p/${type}/${crypto}/${fiat}`);
  };

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">P2P Trading</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Buy or sell crypto directly with other users. Choose your direction and pair below.
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">I want to</label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setType('buy')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg border-2 font-medium transition-colors ${
                type === 'buy'
                  ? 'border-green-500 bg-green-500/10 text-green-600 dark:text-green-400'
                  : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
              }`}
            >
              <ShoppingCart className="w-5 h-5" />
              Buy Crypto
            </button>
            <button
              type="button"
              onClick={() => setType('sell')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg border-2 font-medium transition-colors ${
                type === 'sell'
                  ? 'border-orange-500 bg-orange-500/10 text-orange-600 dark:text-orange-400'
                  : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
              }`}
            >
              <Banknote className="w-5 h-5" />
              Sell Crypto
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Crypto</label>
            <select
              value={crypto}
              onChange={(e) => setCrypto(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
            >
              {CRYPTO_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fiat</label>
            <select
              value={fiat}
              onChange={(e) => setFiat(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
            >
              {FIAT_OPTIONS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGo}
          className="w-full py-2.5 rounded-lg font-medium bg-blue-500 text-white hover:bg-blue-600 flex items-center justify-center gap-2"
        >
          {type === 'buy' ? `Buy ${crypto}` : `Sell ${crypto}`} with {fiat}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/dashboard/orders/p2p"
          className="text-sm text-blue-500 dark:text-blue-400 hover:underline"
        >
          My P2P orders
        </Link>
      </div>
    </div>
  );
}
