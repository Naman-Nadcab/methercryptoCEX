'use client';

import { useState, useEffect } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface Dispute {
  id: string;
  order_id: string;
  reason: string;
  description: string;
  status: string;
  crypto_amount: string;
  fiat_amount: string;
  fiat_currency: string;
  buyer_email: string;
  buyer_username: string;
  seller_email: string;
  seller_username: string;
  created_at: string;
}

export default function DisputesPage() {
  const { accessToken } = useAdminAuthStore();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDisputes = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const response = await fetch(`${apiUrl}/api/v1/admin/p2p/disputes`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const result = await response.json();
      if (result.success) {
        setDisputes(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch disputes:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDisputes();
  }, [accessToken]);

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      open: 'bg-red-500/20 text-red-400',
      under_review: 'bg-yellow-500/20 text-yellow-400',
      resolved: 'bg-green-500/20 text-green-400',
      escalated: 'bg-blue-500/20 text-blue-400',
    };
    return colors[status] || 'bg-gray-500/20 text-gray-400';
  };

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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">P2P Disputes</h1>
        <p className="text-gray-400 text-sm mt-1">
          {disputes.length} open dispute{disputes.length !== 1 ? 's' : ''} requiring attention
        </p>
      </div>

      {/* Disputes List */}
      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {disputes.length === 0 ? (
          <div className="p-8 text-center">
            <AlertTriangle className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No open disputes</p>
            <p className="text-sm text-gray-500 mt-1">All disputes have been resolved</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {disputes.map((dispute) => (
              <div key={dispute.id} className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                        Order #{dispute.order_id.slice(0, 8)}
                      </h3>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusBadge(dispute.status)}`}>
                        {dispute.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400 mt-1">{dispute.reason.replace('_', ' ')}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-gray-900 dark:text-white font-medium">
                      {dispute.fiat_amount} {dispute.fiat_currency}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{dispute.crypto_amount} crypto</p>
                  </div>
                </div>

                <p className="text-gray-600 dark:text-gray-300 mb-4">{dispute.description}</p>

                <div className="grid grid-cols-2 gap-4 p-4 bg-gray-900/50 rounded-lg">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Buyer</p>
                    <p className="text-gray-900 dark:text-white">{dispute.buyer_email}</p>
                    {dispute.buyer_username && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">@{dispute.buyer_username}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Seller</p>
                    <p className="text-gray-900 dark:text-white">{dispute.seller_email}</p>
                    {dispute.seller_username && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">@{dispute.seller_username}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-gray-500">
                    Opened: {new Date(dispute.created_at).toLocaleString()}
                  </p>
                  <div className="flex gap-2">
                    <button className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-gray-900 dark:text-white rounded text-sm">
                      Favor Buyer
                    </button>
                    <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm">
                      Favor Seller
                    </button>
                    <button className="px-3 py-1.5 bg-gray-600 hover:bg-gray-100 dark:hover:bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-white rounded text-sm">
                      Cancel Order
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
