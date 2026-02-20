'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { SectionHeader, Panel } from '@/components/admin/control-plane';
import { Loader2, CreditCard } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface PaymentMethodRow {
  id: string;
  name: string;
  code: string;
  method_type: string;
  is_active: boolean;
  required_fields?: unknown;
  supported_countries?: unknown;
  created_at?: string;
  updated_at?: string;
}

export default function P2PPaymentMethodsPage() {
  const { accessToken } = useAdminAuthStore();
  const [methods, setMethods] = useState<PaymentMethodRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMethods = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/p2p`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (data?.success && data?.data?.paymentMethods) {
        setMethods(Array.isArray(data.data.paymentMethods) ? data.data.paymentMethods : []);
      } else {
        setMethods([]);
      }
    } catch {
      setError('Failed to load payment methods');
      setMethods([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchMethods();
  }, [fetchMethods]);

  if (loading) {
    return (
      <div className="space-y-5">
        <SectionHeader title="Payment Methods" subtitle="P2P payment methods (active, from system config)." />
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Payment Methods"
        subtitle="Active P2P payment methods from system config. To add or edit methods, use database/backend config."
      />

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Panel>
        {methods.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center">
            <CreditCard className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No payment methods configured</p>
            <p className="text-xs text-muted-foreground mt-1">Configure in database (p2p_payment_methods) or via backend.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {methods.map((m) => (
              <div
                key={m.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">{m.name}</span>
                  <span className={`text-xs px-2 py-1 rounded ${m.is_active ? 'bg-green-500/20 text-green-600 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
                    {m.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {m.code} • {m.method_type}
                </p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
