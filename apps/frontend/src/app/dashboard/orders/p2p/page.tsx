'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchMyOrders, type P2POrderRow } from '@/lib/p2pApi';
import { Loader2, ShoppingCart } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';

export default function P2POrdersViewPage() {
  const [orders, setOrders] = useState<P2POrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMyOrders()
      .then((data) => {
        if (!cancelled) setOrders(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setOrders([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">P2P Orders</h1>
        <Link href="/p2p" className="text-sm text-blue-500 dark:text-blue-400 hover:underline">P2P Trading →</Link>
      </div>
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="No P2P orders yet"
            description="Buy or sell crypto with other users. Start a trade to see your orders here."
            action={{ label: 'Start P2P trade', href: '/p2p' }}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="p-3 font-medium">Order</th>
                <th className="p-3 font-medium">Pair</th>
                <th className="p-3 font-medium">Quantity</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Created</th>
                <th className="p-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="p-3 font-mono text-gray-700 dark:text-gray-300">{o.id.slice(0, 8)}…</td>
                  <td className="p-3 text-gray-900 dark:text-white">{o.crypto_symbol || '—'} / {o.fiat_currency || '—'}</td>
                  <td className="p-3 font-mono text-gray-700 dark:text-gray-300">{o.quantity}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-600 dark:text-blue-400">{o.status}</span>
                  </td>
                  <td className="p-3 text-gray-500 dark:text-gray-400">{o.created_at ? new Date(o.created_at).toLocaleString() : '—'}</td>
                  <td className="p-3">
                    <Link href={`/p2p/orders/${o.id}`} className="text-blue-500 dark:text-blue-400 hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
