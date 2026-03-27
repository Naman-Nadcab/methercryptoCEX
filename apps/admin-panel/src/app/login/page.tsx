'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/Button';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function LoginPage() {
  const router = useRouter();
  const setTokens = useAdminAuthStore((s) => s.setTokens);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE.replace(/\/$/, '')}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        const msg = data?.error?.message ?? data?.error ?? 'Login failed';
        setError(typeof msg === 'string' ? msg : msg?.message ?? 'Login failed');
        return;
      }
      const d = data?.data ?? data;
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
        router.push('/dashboard');
        router.refresh();
      } else {
        setError('Invalid response from server');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-admin-bg">
      <div className="w-full max-w-md rounded-[12px] bg-white p-8 shadow-[0_1px_3px_0_rgba(0,0,0,0.08)]">
        <h1 className="text-2xl font-semibold text-gray-900">Exchange Admin</h1>
        <p className="mt-1 text-sm text-admin-muted">Sign in to the admin panel</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
            />
          </div>
          {error && <p className="text-sm text-admin-danger">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
