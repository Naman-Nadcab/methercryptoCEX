'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMyPaymentMethods,
  fetchPlatformPaymentMethods,
  addPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
  P2P_PAYMENT_METHODS_QUERY_KEY,
  type P2PPaymentMethodRow,
  type PlatformPaymentMethod,
} from '@/lib/p2pApi';
import { useAuthStore } from '@/store/auth';
import { CreditCard, Plus, Loader2, Trash2, Power, PowerOff } from 'lucide-react';

export default function P2PPaymentMethodsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, _hasHydrated } = useAuthStore();

  const [addOpen, setAddOpen] = useState(false);
  const [selectedPlatformId, setSelectedPlatformId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [paymentDetails, setPaymentDetails] = useState<Record<string, string>>({});
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const { data: methods = [], isLoading, isError, error } = useQuery({
    queryKey: [...P2P_PAYMENT_METHODS_QUERY_KEY, 'all'],
    queryFn: () => fetchMyPaymentMethods({ includeInactive: true }),
    enabled: !!_hasHydrated && !!accessToken,
  });

  const {
    data: platformMethods = [],
    isLoading: platformMethodsLoading,
    isError: platformMethodsError,
    error: platformMethodsErr,
  } = useQuery({
    queryKey: ['p2p', 'payment-methods'],
    queryFn: () => fetchPlatformPaymentMethods(),
    enabled: addOpen,
  });

  useEffect(() => {
    if (_hasHydrated && !accessToken) {
      router.replace('/login');
    }
  }, [_hasHydrated, accessToken, router]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlatformId || !displayName.trim()) return;
    setAddError(null);
    setAddLoading(true);
    try {
      const res = await addPaymentMethod({
        payment_method_id: selectedPlatformId,
        display_name: displayName.trim(),
        payment_details: paymentDetails,
      });
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: P2P_PAYMENT_METHODS_QUERY_KEY });
        setAddOpen(false);
        setSelectedPlatformId('');
        setDisplayName('');
        setPaymentDetails({});
      } else {
        setAddError(res.error?.message ?? 'Failed to add payment method');
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add payment method');
    } finally {
      setAddLoading(false);
    }
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    setActionLoading(id);
    try {
      const res = await updatePaymentMethod(id, { is_active: !isActive });
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: P2P_PAYMENT_METHODS_QUERY_KEY });
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this payment method?')) return;
    setActionLoading(id);
    try {
      const res = await deletePaymentMethod(id);
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: P2P_PAYMENT_METHODS_QUERY_KEY });
      }
    } finally {
      setActionLoading(null);
    }
  };

  if (!_hasHydrated) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b0e11]">
      <div className="py-6 px-4 max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Link
            href="/dashboard/p2p"
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            ← Back to P2P
          </Link>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">P2P Payment Methods</h1>
        <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
          Manage your payment methods for P2P trading. Add bank accounts, UPI, or other methods.
        </p>

        {isError && (
          <div className="mt-4 p-4 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/10 text-red-700 dark:text-red-400 text-sm">
            {error instanceof Error ? error.message : 'Failed to load payment methods'}
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-blue-500 hover:bg-blue-600 text-white text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Payment Method
          </button>
        </div>

        {isLoading ? (
          <div className="mt-8 flex justify-center">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : methods.length === 0 ? (
          <div className="mt-8 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#181a20] p-12 text-center">
            <CreditCard className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
            <p className="text-gray-600 dark:text-gray-400 font-medium">No payment methods configured</p>
            <p className="text-gray-500 dark:text-gray-500 text-sm mt-1">Add a payment method to place P2P orders.</p>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-blue-500 hover:bg-blue-600 text-white text-sm"
            >
              <Plus className="w-4 h-4" />
              Add Payment Method
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {(methods as (P2PPaymentMethodRow & { is_active?: boolean })[]).map((m) => (
              <div
                key={m.id}
                className={`rounded-xl border p-4 ${
                  m.is_active === false
                    ? 'border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#1e2026] opacity-75'
                    : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-[#181a20]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {m.display_name || m.method_name || m.method_code || 'Unnamed'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {m.method_name ?? m.method_code ?? ''}
                      {m.is_active === false && (
                        <span className="ml-2 text-amber-600 dark:text-amber-400">(Inactive)</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(m.id, m.is_active !== false)}
                      disabled={actionLoading === m.id}
                      className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                      title={m.is_active === false ? 'Activate' : 'Deactivate'}
                    >
                      {actionLoading === m.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : m.is_active === false ? (
                        <Power className="w-4 h-4" />
                      ) : (
                        <PowerOff className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(m.id)}
                      disabled={actionLoading === m.id}
                      className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                      title="Delete"
                    >
                      {actionLoading === m.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {addOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 dark:bg-black/60" onClick={() => !addLoading && setAddOpen(false)}>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#181a20] w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Add Payment Method</h2>
            </div>
            <form onSubmit={handleAdd} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
                <select
                  value={selectedPlatformId}
                  onChange={(e) => setSelectedPlatformId(e.target.value)}
                  required
                  disabled={platformMethods.length === 0}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0b0e11] px-3 py-2.5 text-gray-900 dark:text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">Select payment type</option>
                  {(platformMethods as PlatformPaymentMethod[]).map((pm) => (
                    <option key={pm.id} value={pm.id}>
                      {pm.name ?? pm.code ?? pm.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
                {platformMethodsLoading && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Loading payment types…</p>
                )}
                {platformMethodsError && (
                  <p className="text-xs text-red-500 dark:text-red-400 mt-1">
                    {platformMethodsErr instanceof Error ? platformMethodsErr.message : 'Failed to load payment types'}
                  </p>
                )}
                {!platformMethodsError && !platformMethodsLoading && platformMethods.length === 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">No payment types configured</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Display name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. My Bank Account"
                  required
                  maxLength={100}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0b0e11] px-3 py-2.5 text-gray-900 dark:text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Account / UPI ID / Details</label>
                <input
                  type="text"
                  value={paymentDetails['account_number'] ?? paymentDetails['upi_id'] ?? paymentDetails['email'] ?? ''}
                  onChange={(e) => {
                    const pm = platformMethods.find((p: PlatformPaymentMethod) => p.id === selectedPlatformId);
                    const key = pm?.code === 'upi' ? 'upi_id' : pm?.code === 'paypal' ? 'email' : 'account_number';
                    setPaymentDetails((prev) => ({ ...prev, [key]: e.target.value }));
                  }}
                  placeholder="Account number, UPI ID, or email"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0b0e11] px-3 py-2.5 text-gray-900 dark:text-white text-sm"
                />
              </div>
              {addError && <p className="text-sm text-red-400">{addError}</p>}
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={addLoading || platformMethods.length === 0 || !selectedPlatformId || !displayName.trim()}
                  className="flex-1 px-4 py-2.5 rounded-lg font-medium bg-blue-500 hover:bg-blue-600 text-white text-sm disabled:opacity-50"
                >
                  {addLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Add'}
                </button>
                <button
                  type="button"
                  onClick={() => setAddOpen(false)}
                  disabled={addLoading}
                  className="px-4 py-2.5 rounded-lg font-medium border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
