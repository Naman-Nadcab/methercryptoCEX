'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import RequireAuth from '@/components/RequireAuth';
import {
  fetchMyPaymentMethods,
  fetchPlatformPaymentMethods,
  addPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
  P2P_PAYMENT_METHODS_QUERY_KEY,
} from '@/lib/p2pApi';
import { Skeleton } from '@/components/ui/Skeleton';

export default function P2PV2PaymentMethodsPage() {
  return (
    <RequireAuth>
      <PmInner />
    </RequireAuth>
  );
}

function PmInner() {
  const qc = useQueryClient();
  const [platformId, setPlatformId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [detailsJson, setDetailsJson] = useState('{}');
  const [err, setErr] = useState<string | null>(null);

  const { data: list = [], isLoading } = useQuery({
    queryKey: P2P_PAYMENT_METHODS_QUERY_KEY,
    queryFn: () => fetchMyPaymentMethods({ includeInactive: true }),
  });

  const { data: platform = [] } = useQuery({
    queryKey: ['p2p-v2', 'platform-pm'],
    queryFn: fetchPlatformPaymentMethods,
  });

  const addMut = useMutation({
    mutationFn: () => {
      let details: Record<string, unknown> = {};
      try {
        details = JSON.parse(detailsJson) as Record<string, unknown>;
      } catch {
        throw new Error('Invalid JSON for payment details');
      }
      return addPaymentMethod({
        payment_method_id: platformId,
        display_name: displayName.trim() || undefined,
        payment_details: details,
      });
    },
    onSuccess: (res) => {
      if (res.success) {
        qc.invalidateQueries({ queryKey: P2P_PAYMENT_METHODS_QUERY_KEY });
        setErr(null);
        setDetailsJson('{}');
        setDisplayName('');
      } else {
        setErr(res.error?.message ?? 'Add failed');
      }
    },
    onError: (e: Error) => setErr(e.message),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => updatePaymentMethod(id, { is_active: active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: P2P_PAYMENT_METHODS_QUERY_KEY }),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deletePaymentMethod(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: P2P_PAYMENT_METHODS_QUERY_KEY }),
  });

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Payment methods</h1>

      <div className="rounded-xl border border-gray-200 bg-card p-4 dark:border-gray-800 dark:bg-card">
        <h2 className="mb-3 text-sm font-medium text-foreground">Add method</h2>
        <label className="text-xs text-gray-500">Type</label>
        <select
          value={platformId}
          onChange={(e) => setPlatformId(e.target.value)}
          className="mb-2 mt-1 w-full rounded border border-gray-200 px-2 py-2 text-sm dark:border-gray-700 dark:bg-background dark:text-white"
        >
          <option value="">Select…</option>
          {platform.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.code})
            </option>
          ))}
        </select>
        <label className="text-xs text-gray-500">Display name</label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="mb-2 mt-1 w-full rounded border px-2 py-2 text-sm dark:bg-background"
        />
        <label className="text-xs text-gray-500">Details (JSON)</label>
        <textarea
          value={detailsJson}
          onChange={(e) => setDetailsJson(e.target.value)}
          rows={4}
          className="mt-1 w-full rounded border px-2 py-2 font-mono text-xs dark:bg-background"
        />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button
          type="button"
          disabled={!platformId || addMut.isPending}
          onClick={() => {
            setErr(null);
            addMut.mutate();
          }}
          className="mt-2 w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Add
        </button>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">Your methods</h2>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-card p-3 dark:border-gray-800 dark:bg-card"
              >
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </div>
        ) : null}
        {!isLoading && list.map((m) => (
          <div
            key={m.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-card p-3 dark:border-gray-800 dark:bg-card"
          >
            <div>
              <p className="text-sm font-medium text-foreground">{m.display_name || m.method_name}</p>
              <p className="text-xs text-gray-500">{m.method_code}</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => toggleMut.mutate({ id: m.id, active: !(m as { is_active?: boolean }).is_active })}
                className="text-xs text-primary"
              >
                {(m as { is_active?: boolean }).is_active === false ? 'Enable' : 'Disable'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm('Remove this payment method?')) delMut.mutate(m.id);
                }}
                className="text-xs text-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
