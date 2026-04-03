'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

type FundPasswordStatus = { enabled?: boolean; hasFundPassword?: boolean };

type CheckSameResponse = { isSame: boolean };

function inputClassName() {
  return 'w-full rounded-lg border border-border bg-muted px-4 py-3 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary';
}

export default function FundPasswordPage() {
  const { accessToken } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [enabled, setEnabled] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [sameAsLogin, setSameAsLogin] = useState<boolean | null>(null);
  const [checkingSame, setCheckingSame] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');

  const validations = {
    minLength: newPassword.length >= 8,
    maxLength: newPassword.length <= 30,
    hasUppercase: /[A-Z]/.test(newPassword),
    hasLowercase: /[a-z]/.test(newPassword),
    hasNumber: /[0-9]/.test(newPassword),
    passwordsMatch: newPassword === confirmPassword && newPassword !== '',
  };

  const isValidNewPassword =
    validations.minLength &&
    validations.maxLength &&
    validations.hasUppercase &&
    validations.hasLowercase &&
    validations.hasNumber;

  const fetchStatus = useCallback(async () => {
    setLoadError('');
    setLoading(true);
    const res = await api.get<FundPasswordStatus>('/api/v1/auth/fund-password/status', {
      notifyOnError: false,
    });
    if (res.success && res.data) {
      const d = res.data;
      setEnabled(Boolean(d.enabled ?? d.hasFundPassword));
    } else {
      setLoadError(res.error?.message ?? 'Could not load fund password status');
      setEnabled(false);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    fetchStatus();
  }, [accessToken, fetchStatus]);

  useEffect(() => {
    if (!newPassword || newPassword.length < 8) {
      setSameAsLogin(null);
      return;
    }
    const t = window.setTimeout(async () => {
      setCheckingSame(true);
      const res = await api.post<CheckSameResponse>(
        '/api/v1/auth/fund-password/check-same',
        { password: newPassword },
        { notifyOnError: false }
      );
      if (res.success && res.data) {
        setSameAsLogin(res.data.isSame);
      } else {
        setSameAsLogin(null);
      }
      setCheckingSame(false);
    }, 400);
    return () => window.clearTimeout(t);
  }, [newPassword]);

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setFormError('');
    setSameAsLogin(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSuccess('');

    if (enabled && !currentPassword.trim()) {
      setFormError('Enter your current fund password.');
      return;
    }

    if (!isValidNewPassword) {
      setFormError('Your new fund password does not meet the requirements.');
      return;
    }

    if (!validations.passwordsMatch) {
      setFormError('New password and confirmation do not match.');
      return;
    }

    if (sameAsLogin === true) {
      setFormError('Fund password must be different from your login password.');
      return;
    }

    setSubmitting(true);
    const res = await api.post<{ message?: string }>(
      '/api/v1/auth/fund-password/set',
      {
        password: newPassword,
        confirmPassword,
        fundPassword: newPassword,
        ...(enabled ? { currentPassword } : {}),
      },
      { notifyOnError: false }
    );

    if (res.success) {
      setSuccess('Fund password saved successfully.');
      setEnabled(true);
      resetForm();
    } else {
      setFormError(res.error?.message ?? 'Could not save fund password');
    }
    setSubmitting(false);
  };

  const strengthSegments = [
    validations.minLength && validations.maxLength,
    validations.hasUppercase,
    validations.hasLowercase,
    validations.hasNumber,
  ];
  const strengthCount = strengthSegments.filter(Boolean).length;

  if (!accessToken) {
    return (
      <div className="flex min-h-[400px] items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Please sign in to manage your fund password.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-4 lg:p-6">
      <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/security" className="hover:text-primary">
          Security
        </Link>
        <ChevronRight className="h-4 w-4 shrink-0" />
        <span className="text-foreground">Fund password</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="p-6">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-primary">
              <KeyRound className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Fund password</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                An extra password used for withdrawals, internal transfers, and other sensitive fund
                moves—separate from your login password.
              </p>
            </div>
          </div>

          {loadError ? (
            <div className="mb-6 flex gap-3 rounded-lg border border-border bg-muted p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <p className="text-sm text-foreground">{loadError}</p>
            </div>
          ) : null}

          <div className="mb-6 flex gap-3 rounded-lg border border-border bg-muted p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <p className="text-sm text-foreground">
              Keep this password private. Anyone with your login and fund password could move assets
              from your account if they bypass other protections.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {enabled ? (
              <div>
                <label className="mb-2 block text-sm text-muted-foreground">Current fund password</label>
                <div className="relative">
                  <input
                    type={showCurrent ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current fund password"
                    className={`${inputClassName()} pr-12`}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent(!showCurrent)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    aria-label={showCurrent ? 'Hide password' : 'Show password'}
                  >
                    {showCurrent ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
            ) : null}

            <div>
              <label className="mb-2 block text-sm text-muted-foreground">
                {enabled ? 'New fund password' : 'Fund password'}
              </label>
              <div className="relative">
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={enabled ? 'Enter new fund password' : 'Create a fund password'}
                  className={`${inputClassName()} pr-12`}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-label={showNew ? 'Hide password' : 'Show password'}
                >
                  {showNew ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>

              {newPassword ? (
                <div className="mt-3 space-y-2">
                  <div className="flex gap-1">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 rounded-full ${
                          i < strengthCount ? 'bg-primary' : 'bg-muted'
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Password strength</p>
                  <ul className="space-y-1 text-xs">
                    <li
                      className={`flex items-center gap-2 ${
                        validations.minLength && validations.maxLength
                          ? 'text-primary'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {validations.minLength && validations.maxLength ? (
                        <Check className="h-3 w-3 shrink-0" />
                      ) : (
                        <X className="h-3 w-3 shrink-0" />
                      )}
                      8–30 characters
                    </li>
                    <li
                      className={`flex items-center gap-2 ${
                        validations.hasUppercase ? 'text-primary' : 'text-muted-foreground'
                      }`}
                    >
                      {validations.hasUppercase ? (
                        <Check className="h-3 w-3 shrink-0" />
                      ) : (
                        <X className="h-3 w-3 shrink-0" />
                      )}
                      One uppercase letter
                    </li>
                    <li
                      className={`flex items-center gap-2 ${
                        validations.hasLowercase ? 'text-primary' : 'text-muted-foreground'
                      }`}
                    >
                      {validations.hasLowercase ? (
                        <Check className="h-3 w-3 shrink-0" />
                      ) : (
                        <X className="h-3 w-3 shrink-0" />
                      )}
                      One lowercase letter
                    </li>
                    <li
                      className={`flex items-center gap-2 ${
                        validations.hasNumber ? 'text-primary' : 'text-muted-foreground'
                      }`}
                    >
                      {validations.hasNumber ? (
                        <Check className="h-3 w-3 shrink-0" />
                      ) : (
                        <X className="h-3 w-3 shrink-0" />
                      )}
                      One number
                    </li>
                  </ul>
                  {checkingSame ? (
                    <p className="text-xs text-muted-foreground">Checking login password…</p>
                  ) : null}
                  {sameAsLogin === true ? (
                    <p className="text-xs text-primary">Must be different from your login password.</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div>
              <label className="mb-2 block text-sm text-muted-foreground">Confirm password</label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter fund password"
                  className={`${inputClassName()} pr-12`}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                >
                  {showConfirm ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              {confirmPassword && !validations.passwordsMatch ? (
                <p className="mt-2 text-xs text-primary">Passwords do not match</p>
              ) : null}
            </div>

            {formError ? (
              <div className="rounded-lg border border-border bg-muted p-3">
                <p className="text-sm text-foreground">{formError}</p>
              </div>
            ) : null}

            {success ? (
              <div className="rounded-lg border border-border bg-muted p-3">
                <p className="text-sm text-foreground">{success}</p>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={
                submitting ||
                !isValidNewPassword ||
                !validations.passwordsMatch ||
                sameAsLogin === true ||
                (enabled && !currentPassword.trim())
              }
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Saving…
                </>
              ) : enabled ? (
                'Update fund password'
              ) : (
                'Set fund password'
              )}
            </button>
          </form>

          <div className="mt-6 border-t border-border pt-4">
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
