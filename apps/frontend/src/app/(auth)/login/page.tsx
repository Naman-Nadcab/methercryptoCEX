'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, Fingerprint, Loader2 } from 'lucide-react';
import { useAuthStore, type User } from '@/store/auth';
import { useAuth } from '@/context/AuthContext';
import { getPasskeyAssertion, isPlatformAuthenticatorAvailable, isWebAuthnSupported } from '@/lib/webauthn';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { consumeOAuthRedirect, getStoredRedirect } from '@/lib/oauth';
import AuthSplitLayout from '@/components/auth/AuthSplitLayout';

type Step = 'identifier' | 'otp';
const API = getApiBaseUrl();

function toUser(d: Record<string, unknown>): User {
  const hasEmail = d.email != null && String(d.email).length > 0;
  const hasPhone = d.phone != null && String(d.phone).length > 0;
  return {
    id: String(d.id ?? ''),
    email: d.email != null ? String(d.email) : null,
    phone: d.phone != null ? String(d.phone) : null,
    username: d.username != null ? String(d.username) : null,
    status: (d.status as User['status']) ?? 'active',
    emailVerified: Boolean(d.emailVerified ?? d.email_verified ?? hasEmail),
    phoneVerified: Boolean(d.phoneVerified ?? d.phone_verified ?? hasPhone),
    tierLevel: Number(d.tierLevel ?? d.tier_level ?? 0),
  };
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuthStore();
  const { setAuthenticated } = useAuth();

  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [type, setType] = useState<'email' | 'phone'>('email');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false); // verifying OTP
  const [sendingOtp, setSendingOtp] = useState(false); // sending OTP (optimistic)
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const lastSubmitted = useRef('');

  useEffect(() => {
    const r = searchParams.get('redirect');
    if (r?.startsWith('/') && typeof sessionStorage !== 'undefined') sessionStorage.setItem('oauth_redirect', r);
  }, [searchParams]);

  useEffect(() => {
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [countdown]);

  // Prefetch dashboard when on OTP step for instant navigation after verify
  useEffect(() => {
    if (step === 'otp') router.prefetch(getStoredRedirect() || '/dashboard');
  }, [step, router]);

  useEffect(() => {
    const code = otp.join('');
    if (step === 'otp' && code.length === 6 && !loading && !sendingOtp && lastSubmitted.current !== code) {
      lastSubmitted.current = code;
      formRef.current?.requestSubmit();
    }
    if (step !== 'otp' || code.length < 6) lastSubmitted.current = '';
  }, [otp, step, loading, sendingOtp]);

  const err = (e: unknown) =>
    e instanceof TypeError && e.message === 'Failed to fetch'
      ? 'Server unreachable. Check backend is running.'
      : String(e instanceof Error ? e.message : e);

  const sendOtp = async () => {
    setError('');
    setStep('otp');
    setCountdown(120);
    setSendingOtp(true);
    try {
      const res = await fetch(`${API}/api/v1/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, type, purpose: 'login' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStep('identifier');
        setError(typeof data?.error === 'object' ? data.error?.message : data?.error ?? `Failed (${res.status})`);
        return;
      }
      if (!data?.success) {
        setStep('identifier');
        setError(data?.error?.message ?? 'Failed to send code');
        return;
      }
    } catch (e) {
      setStep('identifier');
      setError(err(e));
    } finally {
      setSendingOtp(false);
    }
  };

  const passkeyLogin = async () => {
    if (!identifier) return setError('Enter email or phone first');
    setPasskeyLoading(true);
    setError('');
    try {
      if (!isWebAuthnSupported()) return setError('Use Chrome or Safari');
      if (!(await isPlatformAuthenticatorAvailable())) return setError('Touch ID / Face ID not available');

      const optRes = await fetch(`${API}/api/v1/auth/passkey/authenticate/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [type]: identifier }),
      });
      const optData = await optRes.json();
      if (!optRes.ok || !optData?.data?.allowCredentials?.length) {
        setError(optData?.error?.message ?? 'Passkey not available');
        return;
      }

      const result = await getPasskeyAssertion(optData.data);
      if (!result.success) {
        setError(result.error?.message ?? 'Passkey failed');
        return;
      }

      const verifyRes = await fetch(`${API}/api/v1/auth/passkey/authenticate/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: result.credential, challenge: optData.data.challenge }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData?.data?.user) {
        setError(verifyData?.error?.message ?? 'Verification failed');
        return;
      }

      const { user: u, accessToken, refreshToken } = verifyData.data;
      if (u && accessToken && refreshToken) {
        login(toUser(u), accessToken, refreshToken);
        setAuthenticated(toUser(u));
        router.push(consumeOAuthRedirect() || '/dashboard');
      }
    } catch (e) {
      setError(err(e));
    } finally {
      setPasskeyLoading(false);
    }
  };

  const verifyOtp = async (code: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/v1/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, otp: code, type, purpose: 'login' }),
      });
      const data = await res.json().catch(() => ({}));
      const errMsg = typeof data?.error === 'string' ? data.error : data?.error?.message;
      if (!res.ok) {
        setError(errMsg ?? `Verification failed (${res.status})`);
        return;
      }
      if (data?.success && data?.data?.user && data?.data?.accessToken && data?.data?.refreshToken) {
        const user = toUser(data.data.user);
        login(user, data.data.accessToken, data.data.refreshToken);
        setAuthenticated(user);
        router.replace(consumeOAuthRedirect() || '/dashboard');
      } else setError('Verification failed');
    } catch (e) {
      setError(err(e));
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (i: number, v: string) => {
    if (v.length > 1) {
      const digits = v.replace(/\D/g, '').slice(0, 6).split('');
      setOtp((p) => {
        const n = [...p];
        digits.forEach((d, j) => { if (i + j < 6) n[i + j] = d; });
        return n;
      });
      otpRefs.current[Math.min(i + digits.length, 5)]?.focus();
    } else {
      setOtp((p) => { const n = [...p]; n[i] = v.replace(/\D/g, ''); return n; });
      if (v && i < 5) otpRefs.current[i + 1]?.focus();
    }
  };

  const resend = async () => {
    if (countdown > 0) return;
    setSendingOtp(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/v1/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, type, purpose: 'login' }),
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        setCountdown(120);
        setOtp(['', '', '', '', '', '']);
      } else setError(data?.error?.message ?? 'Resend failed');
    } catch (e) {
      setError(err(e));
    } finally {
      setSendingOtp(false);
    }
  };

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <AuthSplitLayout>
      {searchParams.get('reset') === 'success' && (
        <div className="p-3 mb-5 rounded-xl bg-emerald-500/10 dark:bg-emerald-500/20 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-sm">
          Password reset successful. Log in with your new password.
        </div>
      )}

      {step === 'identifier' && (
        <form onSubmit={(e) => { e.preventDefault(); sendOtp(); }} className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Welcome back</h1>
            <p className="mt-1 text-sm text-muted-foreground">Enter your email or mobile to continue</p>
          </div>

          {/* Type tabs */}
          <div className="flex p-1 rounded-xl bg-accent/80">
            <button type="button" onClick={() => setType('email')} className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${type === 'email' ? 'bg-white dark:bg-gray-700 text-foreground shadow-sm' : 'text-muted-foreground hover:text-gray-700 dark:hover:text-gray-300'}`}>Email</button>
            <button type="button" onClick={() => setType('phone')} className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${type === 'phone' ? 'bg-white dark:bg-gray-700 text-foreground shadow-sm' : 'text-muted-foreground hover:text-gray-700 dark:hover:text-gray-300'}`}>Mobile</button>
          </div>

          <div>
            <input
              type={type === 'email' ? 'email' : 'tel'}
              inputMode={type === 'phone' ? 'numeric' : undefined}
              value={identifier}
              onChange={(e) => setIdentifier(type === 'phone' ? e.target.value.replace(/\D/g, '').slice(0, 15) : e.target.value)}
              placeholder={type === 'email' ? 'Email address' : 'Phone number'}
              aria-label={type === 'email' ? 'Email address' : 'Phone number'}
              className="w-full px-4 py-3.5 rounded-xl border border-border bg-card/50 text-foreground placeholder:text-muted-foreground dark:placeholder:text-muted-foreground focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-shadow"
              required
            />
          </div>

          {identifier.length >= 5 && (
            <>
              <div className="rounded-xl p-4 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/40 border border-blue-200/50 dark:border-blue-700/30">
                <button type="button" onClick={passkeyLogin} disabled={passkeyLoading || loading} className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-all shadow-lg shadow-blue-500/20">
                  {passkeyLoading ? <><Loader2 className="w-5 h-5 animate-spin" aria-hidden /> Authenticating</> : <><Fingerprint className="w-5 h-5" aria-hidden /> Login with Passkey</>}
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-accent" />
                <span className="text-xs text-muted-foreground font-medium">or continue with OTP</span>
                <div className="flex-1 h-px bg-accent" />
              </div>
            </>
          )}

          {error && <p className="text-destructive text-sm rounded-lg bg-red-50 dark:bg-red-950/30 px-3 py-2" role="alert">{error}</p>}

          <button type="submit" disabled={sendingOtp || !identifier.trim()} className="w-full py-3.5 rounded-xl bg-gray-900 dark:bg-card text-white dark:text-gray-900 font-semibold hover:bg-gray-800 dark:hover:bg-gray-100 disabled:opacity-50 transition-colors">
            {sendingOtp ? <span className="inline-flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" aria-hidden /> Sending code…</span> : 'Continue with OTP'}
          </button>

          <p className="text-center text-sm text-muted-foreground">
            <Link href="/forgot-password" className="text-primary hover:underline font-medium">Forgot password?</Link>
            {' · '}
            <Link href="/signup" className="text-primary hover:underline font-medium">Sign up</Link>
          </p>
        </form>
      )}

      {step === 'otp' && (
        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); verifyOtp(otp.join('')); }} className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Enter verification code</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              We sent a 6-digit code to <strong className="text-foreground/80">{identifier}</strong>
              <button type="button" onClick={() => setStep('identifier')} className="ml-2 text-primary hover:underline inline-flex items-center gap-1 font-medium" aria-label="Change email or phone"><ExternalLink className="w-3.5 h-3.5" /> Change</button>
            </p>
          </div>

          {/* Connected OTP inputs - Tier 1 style */}
          <div className="flex gap-1.5 justify-center">
            {otp.map((d, i) => (
              <input
                key={i}
                ref={(el) => { otpRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={d}
                onChange={(e) => handleOtpChange(i, e.target.value)}
                onKeyDown={(e) => e.key === 'Backspace' && !otp[i] && i > 0 && otpRefs.current[i - 1]?.focus()}
                aria-label={`Digit ${i + 1} of 6`}
                className="w-11 h-14 sm:w-12 sm:h-14 text-center text-xl font-bold rounded-lg border-2 border-border bg-card/50 text-foreground focus:border-blue-500 focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              />
            ))}
          </div>

          {error && <p className="text-destructive text-sm text-center rounded-lg bg-red-50 dark:bg-red-950/30 px-3 py-2" role="alert">{error}</p>}

          <div className="flex justify-between items-center text-sm">
            <button type="button" onClick={resend} disabled={countdown > 0} className={countdown > 0 ? 'text-muted-foreground cursor-not-allowed' : 'text-primary hover:underline font-medium'}>
              Resend code
            </button>
            {countdown > 0 && <span className="text-muted-foreground tabular-nums">{fmt(countdown)}</span>}
          </div>

          <button type="submit" disabled={loading || otp.join('').length !== 6} className="w-full py-3.5 rounded-xl bg-primary hover:bg-primary/85 text-white font-semibold disabled:opacity-50 transition-colors">
            {loading ? <span className="inline-flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" aria-hidden /> Verifying…</span> : 'Verify & continue'}
          </button>
        </form>
      )}
    </AuthSplitLayout>
  );
}
