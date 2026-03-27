'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { ChevronRight, Loader2, X, CheckSquare, Square } from 'lucide-react';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { toast } from '@/components/ui/toaster';

interface WithdrawalLimits {
  dailyLimit: number;
  monthlyLimit: number;
  dailyUsed: number;
  monthlyUsed: number;
  maxDailyLimit: number;
  maxMonthlyLimit: number;
}

export default function WithdrawalLimitsPage() {
  const router = useRouter();
  const { user, accessToken } = useAuthStore();
  const apiUrl = getApiBaseUrl();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [limits, setLimits] = useState<WithdrawalLimits>({
    dailyLimit: 20000,
    monthlyLimit: 100000,
    dailyUsed: 0,
    monthlyUsed: 0,
    maxDailyLimit: 20000,
    maxMonthlyLimit: 100000
  });

  const [dailyInput, setDailyInput] = useState('20000');
  const [monthlyInput, setMonthlyInput] = useState('100000');

  // Security Verification Modal States
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [smsOtp, setSmsOtp] = useState('');
  const [smsOtpTimer, setSmsOtpTimer] = useState(0);
  const [sendingSmsOtp, setSendingSmsOtp] = useState(false);
  const [google2faCode, setGoogle2faCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [user2faEnabled, setUser2faEnabled] = useState(false);
  const [userPhone, setUserPhone] = useState('');
  const [smsCheckbox, setSmsCheckbox] = useState(false);

  useEffect(() => {
    fetchLimits();
    fetch2faStatus();
  }, [accessToken]);

  // Timer for SMS OTP
  useEffect(() => {
    if (smsOtpTimer > 0) {
      const timer = setTimeout(() => setSmsOtpTimer(smsOtpTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [smsOtpTimer]);

  const fetchLimits = async () => {
    if (!accessToken) return;

    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/withdrawal-limits`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const result = await response.json();

      if (result.success && result.data) {
        setLimits(result.data);
        setDailyInput(result.data.dailyLimit?.toString() || '20000');
        setMonthlyInput(result.data.monthlyLimit?.toString() || '100000');
      }
    } catch (error) {
      console.error('Failed to fetch limits:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetch2faStatus = async () => {
    if (!accessToken) return;
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/2fa/status`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const result = await response.json();
      if (result.success) {
        setUser2faEnabled(result.data.enabled || false);
      }

      // Also get user phone
      const profileRes = await fetch(`${apiUrl}/api/v1/auth/profile`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const profileResult = await profileRes.json();
      if (profileResult.success && profileResult.data?.phone) {
        setUserPhone(profileResult.data.phone);
      }
    } catch (error) {
      console.error('Failed to fetch 2FA status:', error);
    }
  };

  const maskPhone = (phone: string) => {
    if (!phone) return '***';
    // Mask middle digits: 884****443
    if (phone.length > 6) {
      return phone.slice(0, 3) + '****' + phone.slice(-3);
    }
    return phone.slice(0, 2) + '****';
  };

  const handleSubmitClick = () => {
    const daily = parseFloat(dailyInput) || 0;
    const monthly = parseFloat(monthlyInput) || 0;

    if (daily < 0 || daily > limits.maxDailyLimit) {
      toast({ title: 'Validation', description: `Daily limit must be between 0 and ${limits.maxDailyLimit.toLocaleString()}`, variant: 'destructive' });
      return;
    }

    if (monthly < 0 || monthly > limits.maxMonthlyLimit) {
      toast({ title: 'Validation', description: `Monthly limit must be between 0 and ${limits.maxMonthlyLimit.toLocaleString()}`, variant: 'destructive' });
      return;
    }

    // Open verification modal
    setShowVerifyModal(true);
  };

  const sendSmsOtp = async () => {
    if (smsOtpTimer > 0 || sendingSmsOtp) return;

    setSendingSmsOtp(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/send-security-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ type: 'phone', purpose: 'withdrawal_limit_change' })
      });
      const result = await response.json();

      if (result.success) {
        setSmsOtpTimer(60);
        setSmsCheckbox(true);
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to send verification code', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to send SMS OTP:', error);
      toast({ title: 'Error', description: 'Failed to send verification code', variant: 'destructive' });
    } finally {
      setSendingSmsOtp(false);
    }
  };

  const verifyAndSubmit = async () => {
    if (!smsOtp) {
      toast({ title: 'Validation', description: 'Please enter the SMS verification code', variant: 'destructive' });
      return;
    }

    if (user2faEnabled && !google2faCode) {
      toast({ title: 'Validation', description: 'Please enter the Google 2FA code', variant: 'destructive' });
      return;
    }

    setVerifying(true);
    try {
      // Verify SMS OTP first
      const verifyRes = await fetch(`${apiUrl}/api/v1/auth/verify-security-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          otp: smsOtp,
          type: 'phone',
          purpose: 'withdrawal_limit_change'
        })
      });
      const verifyResult = await verifyRes.json();

      if (!verifyResult.success) {
        toast({ title: 'Error', description: verifyResult.error?.message || 'Invalid verification code', variant: 'destructive' });
        setVerifying(false);
        return;
      }

      // Verify 2FA if enabled
      if (user2faEnabled) {
        const twoFaRes = await fetch(`${apiUrl}/api/v1/auth/2fa/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
          },
          body: JSON.stringify({ code: google2faCode })
        });
        const twoFaResult = await twoFaRes.json();

        if (!twoFaResult.success) {
          toast({ title: 'Error', description: twoFaResult.error?.message || 'Invalid 2FA code', variant: 'destructive' });
          setVerifying(false);
          return;
        }
      }

      // Now submit the limits
      const daily = parseFloat(dailyInput) || 0;
      const monthly = parseFloat(monthlyInput) || 0;

      const response = await fetch(`${apiUrl}/api/v1/auth/withdrawal-limits`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          dailyLimit: daily,
          monthlyLimit: monthly
        })
      });
      const result = await response.json();

      if (result.success) {
        toast({ title: 'Success', description: 'Withdrawal limits updated successfully', variant: 'success' });
        setLimits({
          ...limits,
          dailyLimit: daily,
          monthlyLimit: monthly
        });
        closeModal();
      } else {
        toast({ title: 'Error', description: result.error?.message || 'Failed to update limits', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to update limits:', error);
      toast({ title: 'Error', description: 'Failed to update withdrawal limits', variant: 'destructive' });
    } finally {
      setVerifying(false);
    }
  };

  const closeModal = () => {
    setShowVerifyModal(false);
    setSmsOtp('');
    setGoogle2faCode('');
    setSmsCheckbox(false);
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const canSubmit = smsOtp && (!user2faEnabled || google2faCode);

  return (
    <div className="p-4 lg:p-6 bg-gray-50 dark:bg-[#0b0e11] min-h-full">
      <div className="max-w-6xl mx-auto">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm mb-6">
          <span 
            className="text-gray-500 dark:text-gray-400 hover:text-blue-500 cursor-pointer"
            onClick={() => router.push('/dashboard/security')}
          >
            Security
          </span>
          <ChevronRight className="w-4 h-4 text-gray-400" />
          <span className="text-gray-900 dark:text-white font-medium">Manage Crypto Withdrawal Limits</span>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Change Limit Card */}
            <div className="bg-white dark:bg-[#181a20] rounded-lg p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                Change Limit
              </h2>

              {/* Warning Notice */}
              <div className="flex items-start gap-3 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg mb-6">
                <div className="w-5 h-5 rounded-full bg-yellow-400 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-white text-xs font-bold">!</span>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Adjusting the withdrawal limit will not impact any withdrawal requests that are currently being processed.
                </p>
              </div>

              {/* Daily Withdrawal Amount */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
                    Daily Withdrawal Amount <InfoTooltip content="Maximum amount you can withdraw in 24 hours. Higher limits may require additional verification." />
                  </label>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Used {formatNumber(limits.dailyUsed)}/{formatNumber(limits.maxDailyLimit)}
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={dailyInput}
                    onChange={e => setDailyInput(e.target.value.replace(/[^0-9.]/g, ''))}
                    className="w-full px-4 py-3 pr-16 bg-white dark:bg-[#1e2329] border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white text-lg outline-none focus:border-blue-500"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
                    USDT
                  </span>
                </div>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
                  Withdrawal Limit 0-{limits.maxDailyLimit.toLocaleString()}
                </p>
              </div>

              {/* Monthly Withdrawal Amount */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
                    Monthly Withdrawal Amount <InfoTooltip content="Maximum amount you can withdraw per calendar month. Resets at the start of each month." />
                  </label>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Used {formatNumber(limits.monthlyUsed)}/{formatNumber(limits.maxMonthlyLimit)}
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={monthlyInput}
                    onChange={e => setMonthlyInput(e.target.value.replace(/[^0-9.]/g, ''))}
                    className="w-full px-4 py-3 pr-16 bg-white dark:bg-[#1e2329] border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white text-lg outline-none focus:border-blue-500"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
                    USDT
                  </span>
                </div>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
                  Withdrawal Limit 0-{limits.maxMonthlyLimit.toLocaleString()}
                </p>
              </div>

              {/* Submit Button */}
              <button
                onClick={handleSubmitClick}
                disabled={submitting}
                className="w-full py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                Submit
              </button>
            </div>

            {/* Withdrawal Limit Info Card */}
            <div className="bg-white dark:bg-[#181a20] rounded-lg p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">
                Withdrawal Limit Info
              </h2>

              {/* Table Header */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  Identity Verification
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  VIP
                </div>
              </div>

              {/* Table Row */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="flex items-center gap-3">
                  <span className="text-gray-900 dark:text-white font-medium">Basic</span>
                  <button 
                    onClick={() => router.push('/dashboard/identity')}
                    className="text-blue-500 hover:text-blue-600 text-sm"
                  >
                    Upgrade Now
                  </button>
                </div>
                <div>
                  <button className="text-blue-500 hover:text-blue-600 text-sm">
                    Apply for VIP
                  </button>
                </div>
              </div>

              {/* Info Text */}
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                The withdrawal limits associated with the VIP level will only be valid after completing Identity Verification at Lv. 1 or above.
              </p>

              {/* View More Link */}
              <button className="text-blue-500 hover:text-blue-600 text-sm flex items-center gap-1">
                View More
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Security Verification Modal */}
      {showVerifyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-[#1e2329] rounded-xl w-full max-w-md shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Security Verification
              </h2>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* SMS Verification */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <button onClick={() => setSmsCheckbox(!smsCheckbox)}>
                    {smsCheckbox ? (
                      <CheckSquare className="w-5 h-5 text-gray-400" />
                    ) : (
                      <Square className="w-5 h-5 text-gray-400" />
                    )}
                  </button>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    A verification code will be sent to <span className="font-semibold text-gray-900 dark:text-white">{maskPhone(userPhone)}</span>
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={smsOtp}
                    onChange={e => setSmsOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Please enter the SMS verification code"
                    className="w-full px-4 py-3 pr-40 bg-gray-50 dark:bg-[#181a20] border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={sendSmsOtp}
                    disabled={smsOtpTimer > 0 || sendingSmsOtp}
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 text-blue-500 hover:text-blue-600 disabled:text-gray-400 font-medium text-sm"
                  >
                    {sendingSmsOtp ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : smsOtpTimer > 0 ? (
                      `${smsOtpTimer}s`
                    ) : (
                      'Send Verification Code'
                    )}
                  </button>
                </div>
              </div>

              {/* Google 2FA */}
              {user2faEnabled && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <svg className="w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                    </svg>
                    <span className="text-sm text-gray-600 dark:text-gray-400">Google 2FA Code</span>
                  </div>
                  <input
                    type="text"
                    value={google2faCode}
                    onChange={e => setGoogle2faCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Please enter the Google Authenticator code"
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-[#181a20] border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 outline-none focus:border-blue-500"
                  />
                </div>
              )}

              {/* Next Step Button */}
              <button
                onClick={verifyAndSubmit}
                disabled={!canSubmit || verifying}
                className={`w-full py-3 font-medium rounded-lg transition-colors flex items-center justify-center gap-2 ${
                  canSubmit && !verifying
                    ? 'bg-blue-500 hover:bg-blue-600 text-white'
                    : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-500 cursor-not-allowed'
                }`}
              >
                {verifying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Next Step'
                )}
              </button>

              {/* Help Link */}
              <div className="text-center">
                <button className="text-blue-500 hover:text-blue-600 text-sm">
                  Having problems with verification?
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
