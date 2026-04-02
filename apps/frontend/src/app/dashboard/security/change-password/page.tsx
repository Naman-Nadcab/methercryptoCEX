'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import Link from 'next/link';
import { ChevronRight, AlertCircle, Eye, EyeOff, Check, X, Loader2 } from 'lucide-react';

export default function ChangePasswordPage() {
  const router = useRouter();
  const { accessToken } = useAuthStore();
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [passwordHistory, setPasswordHistory] = useState<string | null>(null);

  const apiUrl = getApiBaseUrl();

  // Password validation rules
  const validations = {
    minLength: newPassword.length >= 8,
    maxLength: newPassword.length <= 30,
    hasUppercase: /[A-Z]/.test(newPassword),
    hasLowercase: /[a-z]/.test(newPassword),
    hasNumber: /[0-9]/.test(newPassword),
    hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(newPassword),
    notSameAsOld: newPassword !== oldPassword || newPassword === '',
    passwordsMatch: newPassword === confirmPassword && newPassword !== '',
  };

  const isValidPassword = 
    validations.minLength && 
    validations.maxLength && 
    validations.hasUppercase && 
    validations.hasLowercase && 
    validations.hasNumber && 
    validations.notSameAsOld;

  // Check if user has password
  useEffect(() => {
    const checkPassword = async () => {
      try {
        const res = await fetch(`${apiUrl}/api/v1/auth/check-password`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await res.json();
        if (data.success) {
          setHasPassword(data.data.hasPassword);
        }
      } catch (err) {
        console.error('Failed to check password status:', err);
      } finally {
        setLoading(false);
      }
    };

    if (accessToken) {
      checkPassword();
    }
  }, [accessToken, apiUrl]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setPasswordHistory(null);

    if (!isValidPassword) {
      setError('Please ensure your password meets all requirements.');
      return;
    }

    if (!validations.passwordsMatch) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          oldPassword: hasPassword ? oldPassword : undefined,
          newPassword,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setSuccess('Password changed successfully!');
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setTimeout(() => {
          router.push('/dashboard/security');
        }, 2000);
      } else {
        if (data.error?.code === 'PASSWORD_REUSED') {
          setPasswordHistory(data.error.message);
        } else {
          setError(data.error?.message || 'Failed to change password');
        }
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
        <Link href="/dashboard/security" className="hover:text-primary">
          Security
        </Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-foreground">Change Password</span>
      </div>

      {/* Change Password Card */}
      <div className="bg-card rounded-xl shadow-sm">
        <div className="p-6">
          <h1 className="text-xl font-semibold text-foreground mb-4">
            Change Password
          </h1>

          {/* Security Warning */}
          <div className="flex gap-3 p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg mb-6">
            <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-700 dark:text-amber-300">
              For account security, please be aware that after changing your password, on-chain withdrawals, internal transfers, fiat withdrawals, Methereum Card transactions, P2P Trading, and advertising will be suspended for 24 hours.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Old Password - Only show if user has password */}
            {hasPassword && (
              <div>
                <label className="block text-sm text-muted-foreground mb-2">
                  Old Password
                </label>
                <div className="relative">
                  <input
                    type={showOld ? 'text' : 'password'}
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    placeholder="Enter your current password"
                    className="w-full px-4 py-3 bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowOld(!showOld)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground"
                  >
                    {showOld ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            )}

            {/* New Password */}
            <div>
              <label className="block text-sm text-muted-foreground mb-2">
                New Password
              </label>
              <div className="relative">
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Please enter a new password."
                  className="w-full px-4 py-3 bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground"
                >
                  {showNew ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              
              {/* Password Requirements */}
              {newPassword && (
                <div className="mt-3 space-y-1">
                  <div className={`flex items-center gap-2 text-xs ${validations.minLength ? 'text-green-500' : 'text-muted-foreground'}`}>
                    {validations.minLength ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    At least 8 characters
                  </div>
                  <div className={`flex items-center gap-2 text-xs ${validations.maxLength ? 'text-green-500' : 'text-red-500'}`}>
                    {validations.maxLength ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    Maximum 30 characters
                  </div>
                  <div className={`flex items-center gap-2 text-xs ${validations.hasUppercase ? 'text-green-500' : 'text-muted-foreground'}`}>
                    {validations.hasUppercase ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    At least one uppercase letter
                  </div>
                  <div className={`flex items-center gap-2 text-xs ${validations.hasLowercase ? 'text-green-500' : 'text-muted-foreground'}`}>
                    {validations.hasLowercase ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    At least one lowercase letter
                  </div>
                  <div className={`flex items-center gap-2 text-xs ${validations.hasNumber ? 'text-green-500' : 'text-muted-foreground'}`}>
                    {validations.hasNumber ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    At least one number
                  </div>
                  {hasPassword && oldPassword && (
                    <div className={`flex items-center gap-2 text-xs ${validations.notSameAsOld ? 'text-green-500' : 'text-red-500'}`}>
                      {validations.notSameAsOld ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                      Must be different from old password
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Confirm New Password */}
            <div>
              <label className="block text-sm text-muted-foreground mb-2">
                Confirm New Password
              </label>
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Please enter your new password again."
                  className="w-full px-4 py-3 bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground"
                >
                  {showConfirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {confirmPassword && !validations.passwordsMatch && (
                <p className="mt-2 text-xs text-red-500">Passwords do not match</p>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {/* Password History Warning */}
            {passwordHistory && (
              <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg">
                <p className="text-sm text-amber-600 dark:text-amber-400">{passwordHistory}</p>
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="p-3 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-lg">
                <p className="text-sm text-buy">{success}</p>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={Boolean(submitting || !isValidPassword || !(validations.passwordsMatch ?? false) || (hasPassword === true && !oldPassword))}
              className="w-full py-3 bg-primary hover:bg-primary/85 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing...
                </>
              ) : (
                'Confirm'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
