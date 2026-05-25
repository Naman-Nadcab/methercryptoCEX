'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Mail, Lock, Shield, Loader2 } from 'lucide-react';
import { useAdminAuthStore } from '@/store/auth';
import { getDashboardSummary } from '@/lib/api';
import { cn } from '@/lib/cn';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const BRAND_NAME = process.env.NEXT_PUBLIC_ADMIN_BRAND_NAME || 'Exchange';
const IS_DEV = process.env.NODE_ENV === 'development';

/** Dev-mode defaults — ALL accounts share this password in local dev. */
const DEV_EMAIL = 'admin@example.com';
const DEV_PASSWORD = 'admin123';

const inputBase =
  'w-full rounded-xl border border-[#374151] bg-[#111827] py-3 pl-11 pr-4 text-sm text-gray-100 placeholder:text-gray-500 ' +
  'transition-all duration-200 outline-none ' +
  'focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/35 focus:shadow-[0_0_20px_rgba(99,102,241,0.18)]';

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setTokens = useAdminAuthStore((s) => s.setTokens);
  const [email, setEmail] = useState(IS_DEV ? DEV_EMAIL : '');
  const [password, setPassword] = useState(IS_DEV ? DEV_PASSWORD : '');
  const [twofaCode, setTwofaCode] = useState('');
  const [needs2FA, setNeeds2FA] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const prefetchCriticalData = useCallback(
    (token: string) => {
      queryClient.prefetchQuery({
        queryKey: ['admin', 'dashboard-summary', token],
        queryFn: () => getDashboardSummary(token),
        staleTime: 60_000,
      });
    },
    [queryClient]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const emailNorm = email.trim().toLowerCase();
      const payload: Record<string, string> = { email: emailNorm, password };
      if (needs2FA && twofaCode) payload.twofa_code = twofaCode;

      const res = await fetch(`${API_BASE.replace(/\/$/, '')}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.success) {
        const msg = data?.error?.message ?? data?.error ?? 'Login failed';
        const base = typeof msg === 'string' ? msg : (msg as { message?: string })?.message ?? 'Login failed';
        const code =
          data?.error && typeof data.error === 'object' && 'code' in data.error
            ? String((data.error as { code?: string }).code ?? '')
            : '';
        setError(code ? `${base} (${code})` : base);
        if (process.env.NODE_ENV === 'development') {
          console.warn('[admin-login] HTTP', res.status, data);
        }
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
    <div className="admin-login-shell relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0B1220] px-4 py-10">
      {/* Background: gradient mesh + soft orbs */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(99,102,241,0.22),transparent_50%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_60%_at_100%_100%,rgba(139,92,246,0.14),transparent_45%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -left-32 top-1/4 h-[420px] w-[420px] rounded-full bg-indigo-600/25 blur-[100px] animate-login-drift"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-24 bottom-1/4 h-[380px] w-[380px] rounded-full bg-violet-600/20 blur-[90px] animate-login-drift-slow"
        aria-hidden
      />

      {/* Subtle particle field */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35] animate-login-pulse-soft"
        style={{
          backgroundImage: `radial-gradient(rgba(148,163,184,0.14) 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
        }}
        aria-hidden
      />

      <main className="relative z-10 w-full max-w-[420px] animate-scale-in">
        <div
          className={cn(
            'rounded-2xl border border-white/[0.08] p-8 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.65)]',
            'bg-slate-950/45 backdrop-blur-xl backdrop-saturate-150'
          )}
        >
          {/* Header */}
          <div className="flex flex-col items-center text-center">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-indigo-500/25 bg-gradient-to-br from-indigo-500/20 to-violet-600/15 shadow-[0_0_32px_rgba(99,102,241,0.2)]">
              <Shield className="h-7 w-7 text-indigo-300" strokeWidth={1.5} aria-hidden />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300/90">Admin access only</p>
            <h1 className="mt-2 bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-2xl font-semibold tracking-tight text-transparent">
              {BRAND_NAME}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {needs2FA ? 'Two-factor verification' : 'Admin Control Panel'}
            </p>
            <p className="mt-2 max-w-[280px] text-xs leading-relaxed text-slate-500">
              All actions are monitored and audited for compliance.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            {!needs2FA ? (
              <>
                <div>
                  <label htmlFor="email" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">
                    Email
                  </label>
                  <div className="relative">
                    <Mail
                      className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-500"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    <input
                      id="email"
                      type="email"
                      autoComplete="username"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      placeholder="admin@organization.com"
                      className={inputBase}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="password" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">
                    Password
                  </label>
                  <div className="relative">
                    <Lock
                      className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-500"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    <input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="••••••••••••"
                      className={inputBase}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label htmlFor="twofa" className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">
                  Authenticator code
                </label>
                <div className="relative">
                  <Shield
                    className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-indigo-400/80"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <input
                    id="twofa"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={twofaCode}
                    onChange={(e) => setTwofaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    autoFocus
                    required
                    placeholder="000000"
                    autoComplete="one-time-code"
                    className={cn(inputBase, 'text-center font-mono text-lg tracking-[0.35em]')}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNeeds2FA(false);
                    setTwofaCode('');
                    setError('');
                  }}
                  className="mt-3 text-xs font-medium text-indigo-400/90 transition-colors hover:text-indigo-300"
                >
                  ← Back to credentials
                </button>
              </div>
            )}

            {error ? (
              <p
                className="rounded-lg border border-red-500/25 bg-red-950/40 px-3 py-2 text-sm text-red-300"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className={cn(
                'group relative flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl font-semibold text-white',
                'bg-gradient-to-r from-[#6366F1] to-[#8B5CF6]',
                'shadow-[0_8px_32px_-4px_rgba(99,102,241,0.45)]',
                'transition-all duration-200 hover:shadow-[0_12px_40px_-4px_rgba(139,92,246,0.5)] hover:scale-[1.02]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B1220]',
                'disabled:pointer-events-none disabled:opacity-55 disabled:hover:scale-100'
              )}
            >
              <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              {loading ? (
                <>
                  <Loader2 className="relative z-10 h-5 w-5 shrink-0 animate-spin" aria-hidden />
                  <span className="relative z-10">Verifying…</span>
                </>
              ) : (
                <span className="relative z-10">{needs2FA ? 'Verify & sign in' : 'Sign in'}</span>
              )}
            </button>
          </form>

          {IS_DEV && !needs2FA ? (
            <div className="mt-6 rounded-lg border border-indigo-500/20 bg-indigo-500/[0.06] px-3 py-2.5 text-left text-[11px] leading-relaxed text-slate-400">
              <p className="font-semibold text-indigo-300">Dev mode — credentials pre-filled</p>
              <p className="mt-1">
                All accounts use password&nbsp;
                <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-slate-200">admin123</code>
              </p>
              <p className="mt-1 text-slate-500">
                Other accounts:&nbsp;
                <button type="button" onClick={() => { setEmail('test@gmail.com'); setPassword('admin123'); setError(''); }} className="text-indigo-400 underline hover:text-indigo-300">test@gmail.com</button>
                &nbsp;·&nbsp;
                <button type="button" onClick={() => { setEmail('approver@example.com'); setPassword('admin123'); setError(''); }} className="text-indigo-400 underline hover:text-indigo-300">approver@example.com</button>
              </p>
              <p className="mt-1 text-slate-500">API → <code className="text-slate-300">{API_BASE}</code></p>
            </div>
          ) : null}

          <p className="mt-8 border-t border-white/[0.06] pt-6 text-center text-xs text-slate-500">
            Authorized personnel only. Unauthorized access is prohibited.
          </p>
        </div>
      </main>
    </div>
  );
}
