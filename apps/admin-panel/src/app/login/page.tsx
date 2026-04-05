'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/Button';
import { getDashboardSummary } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setTokens = useAdminAuthStore((s) => s.setTokens);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twofaCode, setTwofaCode] = useState('');
  const [needs2FA, setNeeds2FA] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const prefetchCriticalData = useCallback((token: string) => {
    queryClient.prefetchQuery({
      queryKey: ['admin', 'dashboard-summary', token],
      queryFn: () => getDashboardSummary(token),
      staleTime: 60_000,
    });
  }, [queryClient]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload: Record<string, string> = { email, password };
      if (needs2FA && twofaCode) payload.twofa_code = twofaCode;

      const res = await fetch(`${API_BASE.replace(/\/$/, '')}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.success) {
        const msg = data?.error?.message ?? data?.error ?? 'Login failed';
        setError(typeof msg === 'string' ? msg : (msg as { message?: string })?.message ?? 'Login failed');
        return;
      }

      const d = data?.data ?? data;

      if (d?.requires2FA) {
        setNeeds2FA(true);
        setTwofaCode('');
        return;
      }

      const accessToken = d?.accessToken;
      const admin = d?.admin;
      if (accessToken && admin) {
        setTokens(accessToken, {
          id: admin.id,
          email: admin.email ?? email,
          name: admin.name ?? 'Admin',
          role: admin.role ?? 'admin',
          permissions: Array.isArray(admin.permissions) ? admin.permissions : [],
        });
        prefetchCriticalData(accessToken);
        router.prefetch('/dashboard');
        router.push('/dashboard');
      } else {
        setError('Invalid response from server');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-admin-bg">
      <div className="w-full max-w-md rounded-[12px] bg-white p-8 shadow-[0_1px_3px_0_rgba(0,0,0,0.08)]">
        <h1 className="text-2xl font-semibold text-gray-900">Exchange Admin</h1>
        <p className="mt-1 text-sm text-admin-muted">
          {needs2FA ? 'Enter your 2FA verification code' : 'Sign in to the admin panel'}
        </p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {!needs2FA ? (
            <>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email</label>
                <input
                  id="email" type="email" value={email}
                  onChange={(e) => setEmail(e.target.value)} required
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label>
                <input
                  id="password" type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)} required
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
                />
              </div>
            </>
          ) : (
            <div>
              <label htmlFor="twofa" className="block text-sm font-medium text-gray-700">2FA Code</label>
              <input
                id="twofa" type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
                value={twofaCode}
                onChange={(e) => setTwofaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus required
                placeholder="000000"
                className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-center text-lg font-mono tracking-[0.3em] focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
              />
              <button
                type="button"
                onClick={() => { setNeeds2FA(false); setTwofaCode(''); setError(''); }}
                className="mt-2 text-xs text-admin-primary hover:underline"
              >
                Back to login
              </button>
            </div>
          )}
          {error && <p className="text-sm text-admin-danger">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Verifying...' : needs2FA ? 'Verify & Sign in' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
