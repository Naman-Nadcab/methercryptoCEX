'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { createAd, fetchMyPaymentMethods, P2P_ADS_QUERY_KEY, P2P_PAYMENT_METHODS_QUERY_KEY } from '@/lib/p2pApi';
import { useAuthStore } from '@/store/auth';
import { useQueryClient } from '@tanstack/react-query';

const CRYPTO_OPTIONS = ['USDT', 'BTC', 'ETH', 'USDC'];
const FIAT_OPTIONS = ['USD', 'INR', 'EUR', 'GBP'];

export default function P2PCreateAdPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, _hasHydrated } = useAuthStore();

  const type = (params?.type as string) || 'buy';
  const crypto = (params?.crypto as string) || 'USDT';
  const fiat = (params?.fiat as string) || 'INR';

  const typeSafe = type === 'sell' ? 'sell' : 'buy';
  const cryptoSafe = CRYPTO_OPTIONS.includes(crypto) ? crypto : 'USDT';
  const fiatSafe = FIAT_OPTIONS.includes(fiat) ? fiat : 'INR';

  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [paymentMethodIds, setPaymentMethodIds] = useState<string[]>([]);
  const [paymentTimeLimit, setPaymentTimeLimit] = useState(15);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: myMethods = [], isError: methodsError } = useQuery({
    queryKey: P2P_PAYMENT_METHODS_QUERY_KEY,
    queryFn: () => fetchMyPaymentMethods(),
    enabled: !!_hasHydrated && !!accessToken,
  });

  useEffect(() => {
    if (_hasHydrated && !accessToken) {
      router.replace('/login');
    }
  }, [_hasHydrated, accessToken, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const p = parseFloat(price);
    const q = parseFloat(quantity);
    if (Number.isNaN(p) || p <= 0) {
      setError('Please enter a valid positive price.');
      return;
    }
    if (Number.isNaN(q) || q <= 0) {
      setError('Please enter a valid positive quantity.');
      return;
    }
    if (paymentMethodIds.length === 0) {
      setError('Select at least one payment method.');
      return;
    }

    const qtyStr = quantity.trim();
    setSubmitLoading(true);
    try {
      const res = await createAd({
        type: typeSafe as 'buy' | 'sell',
        currency: cryptoSafe,
        fiat: fiatSafe,
        price: price.trim(),
        min_amount: qtyStr,
        max_amount: qtyStr,
        available_amount: qtyStr,
        payment_method_ids: paymentMethodIds,
        payment_time_limit: paymentTimeLimit,
      });
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: P2P_ADS_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: ['p2p', 'my-ads'] });
        router.push(`/dashboard/p2p/${typeSafe}/${cryptoSafe}/${fiatSafe}`);
        return;
      }
      setError(res.error?.message ?? 'Failed to create ad.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitLoading(false);
    }
  };

  const togglePaymentMethod = (id: string) => {
    setPaymentMethodIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="min-h-screen bg-[#0b0e11]">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="flex items-center gap-4 mb-6">
          <Link
            href={`/dashboard/p2p/${typeSafe}/${cryptoSafe}/${fiatSafe}`}
            className="text-sm text-gray-400 hover:text-white"
          >
            ← Back to P2P
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-white">
          Create {typeSafe === 'buy' ? 'Buy' : 'Sell'} Ad — {cryptoSafe} / {fiatSafe}
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          No funds are locked at ad creation. Funds move to escrow when a buyer creates an order.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 rounded-xl border border-gray-800 bg-[#181a20] p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Type</label>
              <div className="rounded-lg border border-gray-700 bg-[#0b0e11] px-3 py-2.5 text-gray-400 text-sm">
                {typeSafe === 'buy' ? 'Buy' : 'Sell'}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Fiat</label>
              <div className="rounded-lg border border-gray-700 bg-[#0b0e11] px-3 py-2.5 text-gray-400 text-sm">
                {fiatSafe}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Price ({fiatSafe} per {cryptoSafe})</label>
            <input
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="e.g. 90.5"
              className="w-full rounded-lg border border-gray-700 bg-[#0b0e11] px-3 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Quantity ({cryptoSafe})</label>
            <input
              type="text"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Amount to sell or buy"
              className="w-full rounded-lg border border-gray-700 bg-[#0b0e11] px-3 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Min, max and available are set to this quantity.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Payment time limit (minutes)</label>
            <select
              value={paymentTimeLimit}
              onChange={(e) => setPaymentTimeLimit(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-700 bg-[#0b0e11] px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              <option value={15}>15</option>
              <option value={30}>30</option>
              <option value={45}>45</option>
              <option value={60}>60</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Accepted payment methods (select at least one)</label>
            <div className="flex flex-wrap gap-2">
              {myMethods.map((pm) => (
                <button
                  key={pm.id}
                  type="button"
                  onClick={() => togglePaymentMethod(pm.id)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    paymentMethodIds.includes(pm.id)
                      ? 'bg-blue-500/20 text-blue-400 border-blue-500/50'
                      : 'bg-[#0b0e11] text-gray-400 border-gray-700 hover:border-gray-600'
                  }`}
                >
                  {pm.method_name ?? pm.method_code ?? pm.display_name ?? pm.id.slice(0, 8)}
                </button>
              ))}
            </div>
            {methodsError && (
              <p className="text-xs text-red-400 mt-1">Failed to load payment methods</p>
            )}
            {!methodsError && myMethods.length === 0 && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-amber-500">No payment methods configured</p>
                <Link
                  href="/dashboard/p2p/payment-methods"
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-blue-500 hover:bg-blue-600 text-white"
                >
                  Add Payment Method
                </Link>
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={submitLoading || myMethods.length === 0}
              className="flex-1 px-4 py-2.5 rounded-lg font-medium bg-blue-500 hover:bg-blue-600 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitLoading ? 'Creating…' : 'Create Ad'}
            </button>
            <Link
              href={`/dashboard/p2p/${typeSafe}/${cryptoSafe}/${fiatSafe}`}
              className="px-4 py-2.5 rounded-lg font-medium bg-[#0b0e11] text-gray-300 border border-gray-700 hover:bg-[#1e2026] text-sm transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
