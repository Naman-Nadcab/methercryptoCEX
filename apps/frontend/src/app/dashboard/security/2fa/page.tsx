'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  ChevronRight,
  Shield,
  Check,
  Copy,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

type TwoFaStatus = { enabled: boolean };
type TwoFaSetup = { secret: string; qrCode: string; otpauthUrl: string };

export default function TwoFactorAuthPage() {
  const { accessToken, updateUser } = useAuthStore();
  const [statusLoading, setStatusLoading] = useState(true);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [statusError, setStatusError] = useState('');

  const [enablePhase, setEnablePhase] = useState<'idle' | 'setup' | 'success'>('idle');
  const [secret, setSecret] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [code, setCode] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const [enableLoading, setEnableLoading] = useState(false);
  const [enableError, setEnableError] = useState('');

  const [showDisable, setShowDisable] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [showDisablePassword, setShowDisablePassword] = useState(false);
  const [disableLoading, setDisableLoading] = useState(false);
  const [disableError, setDisableError] = useState('');

  const [copied, setCopied] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const fetchStatus = useCallback(async () => {
    setStatusError('');
    setStatusLoading(true);
    const res = await api.get<TwoFaStatus>('/api/v1/auth/2fa/status', { notifyOnError: false });
    if (res.success && res.data) {
      setEnabled(res.data.enabled);
    } else {
      setStatusError(res.error?.message ?? 'Could not load 2FA status');
      setEnabled(null);
    }
    setStatusLoading(false);
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    fetchStatus();
  }, [accessToken, fetchStatus]);

  useEffect(() => {
    if (enablePhase === 'setup' && qrCode) {
      const t = requestAnimationFrame(() => codeInputRef.current?.focus());
      return () => cancelAnimationFrame(t);
    }
  }, [enablePhase, qrCode]);

  const resetEnableFlow = () => {
    setEnablePhase('idle');
    setSecret('');
    setQrCode('');
    setOtpauthUrl('');
    setCode('');
    setEnableError('');
    setSetupLoading(false);
    setEnableLoading(false);
  };

  const handleStartEnable = async () => {
    setEnableError('');
    setSetupLoading(true);
    const res = await api.post<TwoFaSetup>('/api/v1/auth/2fa/setup', {}, { notifyOnError: false });
    if (res.success && res.data) {
      setSecret(res.data.secret);
      setQrCode(res.data.qrCode);
      setOtpauthUrl(res.data.otpauthUrl);
      setEnablePhase('setup');
      setCode('');
    } else {
      setEnableError(res.error?.message ?? 'Failed to start 2FA setup');
    }
    setSetupLoading(false);
  };

  const handleCopySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setEnableError('Could not copy to clipboard');
    }
  };

  const handleEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6 || !secret) return;
    setEnableError('');
    setEnableLoading(true);
    const res = await api.post<{ message: string }>(
      '/api/v1/auth/2fa/enable',
      { code, secret },
      { notifyOnError: false }
    );
    if (res.success) {
      setEnabled(true);
      updateUser({ twoFaEnabled: true });
      setEnablePhase('success');
      setSecret('');
      setQrCode('');
      setOtpauthUrl('');
      setCode('');
    } else {
      setEnableError(res.error?.message ?? 'Invalid code. Try again.');
    }
    setEnableLoading(false);
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disablePassword || disableCode.length !== 6) return;
    setDisableError('');
    setDisableLoading(true);
    const res = await api.post<unknown>(
      '/api/v1/auth/2fa/disable',
      { password: disablePassword, code: disableCode },
      { notifyOnError: false }
    );
    if (res.success) {
      setEnabled(false);
      updateUser({ twoFaEnabled: false });
      setShowDisable(false);
      setDisablePassword('');
      setDisableCode('');
    } else {
      setDisableError(res.error?.message ?? 'Could not disable 2FA');
    }
    setDisableLoading(false);
  };

  if (!accessToken) {
    return (
      <div className="flex min-h-[400px] items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
      </div>
    );
  }

  if (statusLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
      </div>
    );
  }

  const stepClass = (active: boolean, done: boolean) =>
    `flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-colors ${
      done
        ? 'border-primary bg-primary text-primary-foreground'
        : active
          ? 'border-primary bg-muted text-foreground ring-2 ring-primary/30'
          : 'border-border bg-muted/50 text-muted-foreground'
    }`;

  return (
    <div className="mx-auto max-w-2xl p-4 lg:p-6">
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/dashboard/security" className="hover:text-primary">
          Security
        </Link>
        <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
        <span className="text-foreground">Two-factor authentication</span>
      </nav>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-muted/40 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Shield className="h-6 w-6" aria-hidden />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Authenticator app (TOTP)</h1>
              <p className="text-sm text-muted-foreground">
                Use Google Authenticator or any compatible app for time-based codes.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-8 p-6">
          {/* Step 1: Status */}
          <section aria-labelledby="step-status-heading">
            <div className="mb-4 flex items-center gap-3">
              <span className={stepClass(true, true)} aria-hidden>
                1
              </span>
              <h2 id="step-status-heading" className="text-base font-semibold text-foreground">
                Account status
              </h2>
            </div>
            {statusError ? (
              <div className="rounded-lg border border-border bg-muted/50 p-4">
                <div className="flex gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-sell" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{statusError}</p>
                    <button
                      type="button"
                      onClick={() => fetchStatus()}
                      className="mt-2 text-sm font-medium text-primary hover:underline"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
                <p className="text-sm text-muted-foreground">Two-factor authentication</p>
                <p className="mt-1 text-lg font-medium text-foreground">
                  {enabled ? (
                    <span className="text-buy">Enabled</span>
                  ) : (
                    <span>Not enabled</span>
                  )}
                </p>
              </div>
            )}
          </section>

          {/* Enable flow */}
          {!enabled && !statusError && (
            <>
              {enablePhase === 'idle' && (
                <section>
                  <div className="mb-4 flex items-center gap-3">
                    <span className={stepClass(false, false)} aria-hidden>
                      2
                    </span>
                    <h2 className="text-base font-semibold text-muted-foreground">Scan & verify</h2>
                  </div>
                  <p className="mb-4 text-sm text-muted-foreground">
                    Add a second layer of security. You will need your authenticator app when signing in and for
                    sensitive actions.
                  </p>
                  {enableError && (
                    <div className="mb-4 flex gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm text-foreground">
                      <AlertCircle className="h-5 w-5 shrink-0 text-sell" aria-hidden />
                      <span>{enableError}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleStartEnable}
                    disabled={setupLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {setupLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        Preparing…
                      </>
                    ) : (
                      'Enable 2FA'
                    )}
                  </button>
                </section>
              )}

              {enablePhase === 'setup' && (
                <section aria-labelledby="step-setup-heading">
                  <div className="mb-6 flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-3">
                      <span className={stepClass(true, false)} aria-hidden>
                        2
                      </span>
                      <h2 id="step-setup-heading" className="text-base font-semibold text-foreground">
                        Scan & verify
                      </h2>
                    </div>
                    <span className="hidden h-px flex-1 min-w-[2rem] bg-border sm:block" aria-hidden />
                    <div className="flex items-center gap-3 sm:ml-auto">
                      <span className={stepClass(false, false)} aria-hidden>
                        3
                      </span>
                      <span className="text-sm font-medium text-muted-foreground">Confirm code</span>
                    </div>
                  </div>

                  <div className="mb-6 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                    {qrCode ? (
                      <img
                        src={qrCode}
                        alt="QR code for authenticator setup"
                        className="h-48 w-48 shrink-0 rounded-xl border border-border bg-background p-2"
                      />
                    ) : null}
                    <div className="w-full min-w-0 space-y-3 text-center sm:text-left">
                      <p className="text-sm text-foreground">
                        Scan the QR code with your authenticator app, or enter the secret key manually.
                      </p>
                      {otpauthUrl ? (
                        <p className="break-all text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">otpauth: </span>
                          {otpauthUrl.length > 120 ? `${otpauthUrl.slice(0, 120)}…` : otpauthUrl}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="mb-6 rounded-lg border border-border bg-muted/40 p-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Secret key (manual entry)
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <code className="flex-1 break-all rounded-md bg-background px-3 py-2 font-mono text-sm text-foreground">
                        {secret}
                      </code>
                      <button
                        type="button"
                        onClick={handleCopySecret}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                      >
                        {copied ? (
                          <>
                            <Check className="h-4 w-4 text-buy" aria-hidden />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4" aria-hidden />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="mb-6 flex gap-3 rounded-lg border border-border bg-muted/30 p-4">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                    <div className="text-sm text-foreground">
                      <p className="font-medium">Back up your secret</p>
                      <p className="mt-1 text-muted-foreground">
                        Store a copy in a safe place. If you lose your phone, you will need this secret to recover
                        access. We cannot show it again after you finish setup.
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handleEnable} className="space-y-4">
                    {enableError ? (
                      <div className="flex gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm text-foreground">
                        <AlertCircle className="h-5 w-5 shrink-0 text-sell" aria-hidden />
                        <span>{enableError}</span>
                      </div>
                    ) : null}
                    <div>
                      <label htmlFor="totp-code" className="mb-2 block text-sm text-muted-foreground">
                        6-digit code from your app
                      </label>
                      <input
                        id="totp-code"
                        ref={codeInputRef}
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        className="w-full max-w-xs rounded-lg border border-border bg-muted/50 px-4 py-3 text-center font-mono text-lg tracking-[0.35em] text-foreground placeholder:text-muted-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                        aria-invalid={enableError ? true : undefined}
                      />
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="submit"
                        disabled={enableLoading || code.length !== 6}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                      >
                        {enableLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                        Verify & enable
                      </button>
                      <button
                        type="button"
                        onClick={resetEnableFlow}
                        disabled={enableLoading}
                        className="rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </section>
              )}

              {enablePhase === 'success' && (
                <section className="rounded-lg border border-border bg-muted/30 p-6 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-buy">
                    <Check className="h-7 w-7" aria-hidden />
                  </div>
                  <h2 className="text-lg font-semibold text-foreground">2FA enabled successfully</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Your account is now protected with an authenticator app. Keep your backup codes or secret in a safe
                    place.
                  </p>
                  <Link
                    href="/dashboard/security"
                    className="mt-6 inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
                  >
                    Back to Security
                  </Link>
                </section>
              )}
            </>
          )}

          {/* Disable flow */}
          {enabled && !statusError && (
            <section aria-labelledby="disable-heading">
              <h2 id="disable-heading" className="sr-only">
                Disable two-factor authentication
              </h2>
              {!showDisable ? (
                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <p className="text-sm text-muted-foreground">
                    Turning off 2FA reduces account security. You will need your password and a valid app code to
                    confirm.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDisable(true);
                      setDisableError('');
                    }}
                    className="mt-4 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-sell hover:bg-muted"
                  >
                    Disable 2FA
                  </button>
                </div>
              ) : (
                <form onSubmit={handleDisable} className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
                  <p className="text-sm text-foreground">Enter your account password and a 6-digit code from your app.</p>
                  {disableError ? (
                    <div className="flex gap-2 rounded-lg border border-border bg-card p-3 text-sm text-foreground">
                      <AlertCircle className="h-5 w-5 shrink-0 text-sell" aria-hidden />
                      <span>{disableError}</span>
                    </div>
                  ) : null}
                  <div>
                    <label htmlFor="disable-password" className="mb-2 block text-sm text-muted-foreground">
                      Password
                    </label>
                    <div className="relative max-w-md">
                      <input
                        id="disable-password"
                        type={showDisablePassword ? 'text' : 'password'}
                        value={disablePassword}
                        onChange={(e) => setDisablePassword(e.target.value)}
                        autoComplete="current-password"
                        className="w-full rounded-lg border border-border bg-background px-4 py-3 pr-12 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="Account password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowDisablePassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                        aria-label={showDisablePassword ? 'Hide password' : 'Show password'}
                      >
                        {showDisablePassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="disable-code" className="mb-2 block text-sm text-muted-foreground">
                      Authenticator code
                    </label>
                    <input
                      id="disable-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={disableCode}
                      onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      className="w-full max-w-xs rounded-lg border border-border bg-background px-4 py-3 text-center font-mono text-lg tracking-[0.35em] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="submit"
                      disabled={disableLoading || !disablePassword || disableCode.length !== 6}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      {disableLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                      Confirm disable
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDisable(false);
                        setDisablePassword('');
                        setDisableCode('');
                        setDisableError('');
                      }}
                      disabled={disableLoading}
                      className="rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}

          <div className="border-t border-border pt-6">
            <Link
              href="/dashboard/security"
              className="text-sm font-medium text-primary hover:underline"
            >
              ← Back to Security
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
