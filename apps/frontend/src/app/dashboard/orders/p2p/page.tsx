'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchMyOrders, type P2POrderRow } from '@/lib/p2pApi';
import { Loader2, ShoppingCart } from 'lucide-react';
import { CoinIcon } from '@/components/ui/CoinIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';

export default function P2POrdersViewPage() {
  const [orders, setOrders] = useState<P2POrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = () => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchMyOrders()
      .then((data) => {
        if (!cancelled) setOrders(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) {
          setOrders([]);
          setError('Could not load your P2P orders right now.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  };

  useEffect(() => {
    const cleanup = loadOrders();
    return cleanup;
  }, []);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-foreground">P2P Orders</h1>
        <Link href="/p2p" className="text-sm text-primary hover:underline">P2P Trading →</Link>
      </div>
      <div className="bg-card/50 border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : error ? (
          <div className="p-4">
            <ErrorState title="Failed to load P2P orders" message={error} onRetry={() => loadOrders()} />
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
              <tr className="text-left text-muted-foreground border-b border-border">
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
                <tr key={o.id} className="border-b border-border">
                  <td className="p-3 font-mono text-foreground/80">{o.id.slice(0, 8)}…</td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5">
                      {o.crypto_symbol && <CoinIcon symbol={o.crypto_symbol} size={20} />}
                      <span className="text-foreground">{o.crypto_symbol || '—'} / {o.fiat_currency || '—'}</span>
                    </div>
                  </td>
                  <td className="p-3 font-mono text-foreground/80">{o.quantity}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-primary">{o.status}</span>
                  </td>
                  <td className="p-3 text-muted-foreground">{o.created_at ? new Date(o.created_at).toLocaleString() : '—'}</td>
                  <td className="p-3">
                    <Link href={`/p2p/orders/${o.id}`} className="text-primary hover:underline">
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
