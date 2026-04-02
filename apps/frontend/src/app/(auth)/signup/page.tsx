'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink, Loader2, Mail, Smartphone } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { useAuthStore, type User } from '@/store/auth';
import { useAuth } from '@/context/AuthContext';
import { initiateGoogleLogin } from '@/lib/oauth';
import AuthSplitLayout from '@/components/auth/AuthSplitLayout';

type Step = 'choose' | 'email' | 'otp' | 'password';
type IdType = 'email' | 'phone';
const API = getApiBaseUrl();

export default function SignupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuthStore();
  const { setAuthenticated } = useAuth();

  const [step, setStep] = useState<Step>('choose');
  const [idType, setIdType] = useState<IdType>('email');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [terms, setTerms] = useState(false);
  const [referral, setReferral] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref?.trim()) setReferral(ref.trim().toUpperCase());
  }, [searchParams]);

  useEffect(() => {
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [countdown]);

  const validPass = password.length >= 8 && password.length <= 30 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password);

  const sendOtp = async () => {
    if (!terms) return setError('Accept Terms & Privacy to continue');
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, type: idType, purpose: 'signup' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.error === 'object' ? data.error?.message : data?.error ?? 'Failed');
        return;
      }
      if (data?.success) {
        setStep('otp');
        setCountdown(120);
      } else setError(data?.error?.message ?? 'Failed to send code');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (code: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/v1/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, otp: code, type: idType, purpose: 'signup' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Invalid code');
        return;
      }
      if (data?.success) {
        setStep('password');
      } else setError(data?.error?.message ?? 'Invalid code');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const completeSignup = async () => {
    if (!validPass) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/v1/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [idType]: identifier,
          password,
          referralCode: referral || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Signup failed');
        return;
      }
      if (data?.success && data?.data?.user && data?.data?.accessToken && data?.data?.refreshToken) {
        const user = data.data.user as User;
        login(user, data.data.accessToken, data.data.refreshToken);
        setAuthenticated(user);
        router.replace('/dashboard');
      } else setError('Signup failed');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    if (!terms) return setError('Accept Terms & Privacy to continue');
    setError('');
    try {
      await initiateGoogleLogin(searchParams.get('redirect') ?? undefined);
    } catch {
      setError('Google sign-in failed');
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
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/v1/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, type: idType, purpose: 'signup' }),
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        setCountdown(120);
        setOtp(['', '', '', '', '', '']);
      } else setError(data?.error?.message ?? 'Resend failed');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const steps = ['choose', 'email', 'otp', 'password'];
  const stepIndex = steps.indexOf(step);

  return (
    <AuthSplitLayout>
      {/* Step progress */}
      <div className="flex gap-2 mb-6">
        {steps.map((s, i) => (
          <div key={s} className={`flex-1 h-1 rounded-full transition-colors ${i <= stepIndex ? 'bg-blue-500' : 'bg-accent'}`} aria-hidden />
        ))}
      </div>

      {step === 'choose' && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Create your account</h1>
            <p className="mt-1 text-sm text-muted-foreground">Get started with Google, email, or mobile</p>
          </div>

          <label className="flex items-start gap-3 cursor-pointer p-4 rounded-xl border border-border bg-gray-50/50 dark:bg-gray-800/30 hover:bg-accent/50 transition-colors">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 w-4 h-4 text-blue-500 rounded border-gray-300" aria-label="Accept terms and privacy" />
            <span className="text-sm text-muted-foreground">
              I agree to <Link href="/terms" className="text-primary hover:underline">Terms</Link> and <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
            </span>
          </label>

          {error && <p className="text-destructive text-sm rounded-lg bg-red-50 dark:bg-red-950/30 px-3 py-2" role="alert">{error}</p>}

          <button type="button" onClick={handleGoogle} disabled={!terms || loading} className="w-full py-3.5 px-4 rounded-xl border-2 border-border font-medium flex items-center justify-center gap-3 hover:bg-accent/50 disabled:opacity-50 transition-colors text-foreground/90">
            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" aria-hidden><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            {loading ? 'Connecting…' : 'Sign up with Google'}
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-accent" />
            <span className="text-xs text-muted-foreground font-medium">or</span>
            <div className="flex-1 h-px bg-accent" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => { setStep('email'); setIdType('email'); setError(''); }} disabled={!terms} className="py-4 px-4 rounded-xl border-2 border-border flex flex-col items-center justify-center gap-2 hover:border-blue-500/50 hover:bg-blue-50/30 dark:hover:bg-blue-950/20 disabled:opacity-50 transition-all group">
              <Mail className="w-6 h-6 text-muted-foreground group-hover:text-blue-500" />
              <span className="text-sm font-medium text-foreground/80">Email</span>
            </button>
            <button type="button" onClick={() => { setStep('email'); setIdType('phone'); setError(''); }} disabled={!terms} className="py-4 px-4 rounded-xl border-2 border-border flex flex-col items-center justify-center gap-2 hover:border-blue-500/50 hover:bg-blue-50/30 dark:hover:bg-blue-950/20 disabled:opacity-50 transition-all group">
              <Smartphone className="w-6 h-6 text-muted-foreground group-hover:text-blue-500" />
              <span className="text-sm font-medium text-foreground/80">Mobile</span>
            </button>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            Have an account? <Link href="/login" className="text-primary hover:underline font-medium">Log in</Link>
          </p>
        </div>
      )}

      {step === 'email' && (
        <form onSubmit={(e) => { e.preventDefault(); sendOtp(); }} className="space-y-5">
          <button type="button" onClick={() => setStep('choose')} className="text-primary hover:underline text-sm font-medium flex items-center gap-1">← Back</button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Sign up with {idType === 'email' ? 'Email' : 'Mobile'}</h1>
            <p className="mt-1 text-sm text-muted-foreground">We&apos;ll send you a verification code</p>
          </div>

          <input
            type={idType === 'email' ? 'email' : 'tel'}
            inputMode={idType === 'phone' ? 'numeric' : undefined}
            value={identifier}
            onChange={(e) => setIdentifier(idType === 'phone' ? e.target.value.replace(/\D/g, '').slice(0, 15) : e.target.value)}
            placeholder={idType === 'email' ? 'Email address' : 'Phone number'}
            aria-label={idType === 'email' ? 'Email address' : 'Phone number'}
            className="w-full px-4 py-3.5 rounded-xl border border-border bg-card/50 text-foreground placeholder:text-muted-foreground dark:placeholder:text-muted-foreground focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-shadow"
            required
          />

          <input value={referral} onChange={(e) => setReferral(e.target.value)} placeholder="Referral code (optional)" aria-label="Referral code" className="w-full px-4 py-3 rounded-xl border border-border bg-card/50 text-foreground placeholder:text-muted-foreground dark:placeholder:text-muted-foreground focus:ring-2 focus:ring-primary outline-none text-sm" />

          {error && <p className="text-destructive text-sm rounded-lg bg-red-50 dark:bg-red-950/30 px-3 py-2" role="alert">{error}</p>}

          <button type="submit" disabled={loading || !identifier.trim()} className="w-full py-3.5 rounded-xl bg-primary hover:bg-primary/85 text-white font-semibold disabled:opacity-50 transition-colors">
            {loading ? <span className="inline-flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" aria-hidden /> Sending code…</span> : 'Send verification code'}
          </button>
        </form>
      )}

      {step === 'otp' && (
        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); verifyOtp(otp.join('')); }} className="space-y-5">
          <button type="button" onClick={() => setStep('email')} className="text-primary hover:underline text-sm font-medium flex items-center gap-1">← Back</button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Verify your {idType}</h1>
            <p className="mt-2 text-sm text-muted-foreground">Code sent to <strong className="text-foreground/80">{identifier}</strong></p>
          </div>

          <div className="flex gap-1.5 justify-center">
            {otp.map((d, i) => (
              <input key={i} ref={(el) => { otpRefs.current[i] = el; }} type="text" inputMode="numeric" maxLength={6} value={d} onChange={(e) => handleOtpChange(i, e.target.value)} onKeyDown={(e) => e.key === 'Backspace' && !otp[i] && i > 0 && otpRefs.current[i - 1]?.focus()} aria-label={`Digit ${i + 1} of 6`} className="w-11 h-14 sm:w-12 sm:h-14 text-center text-xl font-bold rounded-lg border-2 border-border bg-card/50 text-foreground focus:border-blue-500 focus:ring-2 focus:ring-primary/20 outline-none transition-all" />
            ))}
          </div>

          {error && <p className="text-destructive text-sm text-center rounded-lg bg-red-50 dark:bg-red-950/30 px-3 py-2" role="alert">{error}</p>}

          <div className="flex justify-between items-center text-sm">
            <button type="button" onClick={resend} disabled={countdown > 0} className={countdown > 0 ? 'text-muted-foreground cursor-not-allowed' : 'text-primary hover:underline font-medium'}>Resend</button>
            {countdown > 0 && <span className="text-muted-foreground tabular-nums">{fmt(countdown)}</span>}
          </div>

          <button type="submit" disabled={loading || otp.join('').length !== 6} className="w-full py-3.5 rounded-xl bg-primary hover:bg-primary/85 text-white font-semibold disabled:opacity-50 transition-colors">
            {loading ? <span className="inline-flex items-center gap-2"><span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden /> Verifying…</span> : 'Verify'}
          </button>
        </form>
      )}

      {step === 'password' && (
        <form onSubmit={(e) => { e.preventDefault(); completeSignup(); }} className="space-y-5">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Create your password</h1>
            <p className="mt-1 text-sm text-muted-foreground">8+ chars, include upper, lower & number</p>
          </div>

          <div className="relative">
            <input type={showPass ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" aria-label="Password" className="w-full px-4 py-3.5 pr-14 rounded-xl border border-border bg-card/50 text-foreground placeholder:text-muted-foreground dark:placeholder:text-muted-foreground focus:ring-2 focus:ring-primary outline-none" required />
            <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium hover:text-gray-700 dark:hover:text-gray-200" aria-label={showPass ? 'Hide password' : 'Show password'}>{showPass ? 'Hide' : 'Show'}</button>
          </div>

          {/* Password strength indicator */}
          <div className="space-y-2">
            <div className="flex gap-1">
              <div className={`h-1 flex-1 rounded-full transition-colors ${password.length >= 8 ? 'bg-emerald-500' : 'bg-accent'}`} />
              <div className={`h-1 flex-1 rounded-full transition-colors ${/[A-Z]/.test(password) && /[a-z]/.test(password) ? 'bg-emerald-500' : 'bg-accent'}`} />
              <div className={`h-1 flex-1 rounded-full transition-colors ${/[0-9]/.test(password) ? 'bg-emerald-500' : 'bg-accent'}`} />
            </div>
            <p className="text-xs text-muted-foreground">
              {validPass ? 'Strong password' : 'Needs: 8+ chars, upper & lower case, number'}
            </p>
          </div>

          {error && <p className="text-destructive text-sm rounded-lg bg-red-50 dark:bg-red-950/30 px-3 py-2" role="alert">{error}</p>}

          <button type="submit" disabled={loading || !validPass} className="w-full py-3.5 rounded-xl bg-primary hover:bg-primary/85 text-white font-semibold disabled:opacity-50 transition-colors">
            {loading ? <span className="inline-flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" aria-hidden /> Creating account…</span> : 'Create account'}
          </button>
        </form>
      )}
    </AuthSplitLayout>
  );
}
