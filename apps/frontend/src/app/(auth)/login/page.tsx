'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Globe, ChevronDown, Users, DollarSign, Coins, ExternalLink, Shield, Smartphone, Mail, Key, Fingerprint, Loader2 } from 'lucide-react';
import { useAuthStore, type User } from '@/store/auth';
import { 
  getPasskeyAssertion,
  isPlatformAuthenticatorAvailable,
  isWebAuthnSupported,
} from '@/lib/webauthn';
import { getApiBaseUrl } from '@/lib/getApiUrl';

type Step = 'identifier' | 'otp' | 'verification';
type VerificationStep = 'sms' | 'email' | '2fa';

interface VerificationState {
  token: string;
  stepsRequired: VerificationStep[];
  currentStep: number;
  nextStep: VerificationStep | null;
  maskedPhone: string | null;
  maskedEmail: string | null;
}

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated } = useAuthStore();
  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [identifierType, setIdentifierType] = useState<'email' | 'phone'>('email');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [verificationCode, setVerificationCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [verificationState, setVerificationState] = useState<VerificationState | null>(null);
  const [passkeysAvailable, setPasskeysAvailable] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const verificationRefs = useRef<(HTMLInputElement | null)[]>([]);
  const API_URL = getApiBaseUrl();

  /** Log and return user-facing message for login network/response errors. */
  const getLoginErrorMessage = (err: unknown, context: string): string => {
    if (err instanceof TypeError && err.message === 'Failed to fetch') {
      return `Cannot reach server at ${API_URL}. Check NEXT_PUBLIC_API_URL or NEXT_PUBLIC_API_BASE_URL and ensure the backend is running.`;
    }
    const msg = err instanceof Error ? err.message : String(err);
    return msg || 'Network error. Please try again.';
  };

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, router]);

  // Countdown timer for OTP resend
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // Check if passkeys are available when identifier changes
  useEffect(() => {
    const checkPasskeys = async () => {
      if (!identifier || identifier.length < 5) {
        setPasskeysAvailable(false);
        return;
      }

      try {
        const response = await fetch(`${API_URL}/api/v1/auth/login/check-passkeys`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            [identifierType]: identifier,
          }),
        });

        const data = await response.json();
        setPasskeysAvailable(data.success && data.data?.passkeysEnabled);
      } catch (err) {
        console.error('[Login] check-passkeys', err);
        setPasskeysAvailable(false);
      }
    };

    const debounce = setTimeout(checkPasskeys, 500);
    return () => clearTimeout(debounce);
  }, [identifier, identifierType, API_URL]);

  // Format countdown display
  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle Passkey Login
  const handlePasskeyLogin = async () => {
    if (!identifier) {
      setError('Please enter your email or phone first');
      return;
    }

    setPasskeyLoading(true);
    setError('');

    try {
      // Check WebAuthn support
      if (!isWebAuthnSupported()) {
        setError('WebAuthn is not supported in this browser. Please use Chrome or Safari.');
        setPasskeyLoading(false);
        return;
      }
      
      // Check platform authenticator
      const platformAvailable = await isPlatformAuthenticatorAvailable();
      if (!platformAvailable) {
        setError('Touch ID / Face ID is not available on this device.');
        setPasskeyLoading(false);
        return;
      }

      // Step 1: Get authentication options from server
      const optionsResponse = await fetch(`${API_URL}/api/v1/auth/passkey/authenticate/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [identifierType]: identifier }),
      });

      const optionsData = await optionsResponse.json();

      if (!optionsData.success) {
        setError(optionsData.error?.message || 'Passkeys not enabled for this account');
        setPasskeyLoading(false);
        return;
      }

      // Validate allowCredentials is present
      if (!optionsData.data.allowCredentials || optionsData.data.allowCredentials.length === 0) {
        setError('No passkeys found for this account');
        setPasskeyLoading(false);
        return;
      }

      console.log('[Passkey] Authentication options received, credentials:', optionsData.data.allowCredentials.length);

      // Step 2: Get passkey assertion using NATIVE WebAuthn API
      // This should NEVER show QR code for same-device authentication
      const result = await getPasskeyAssertion(optionsData.data);

      if (!result.success) {
        setError(result.error?.message || 'Passkey authentication failed');
        setPasskeyLoading(false);
        return;
      }

      console.log('[Passkey] Assertion received, verifying with server');

      // Step 3: Verify with server
      const verifyResponse = await fetch(`${API_URL}/api/v1/auth/passkey/authenticate/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: result.credential,
          challenge: optionsData.data.challenge,
        }),
      });

      const verifyData = await verifyResponse.json();

      if (verifyData.success) {
        login(verifyData.data.accessToken, verifyData.data.refreshToken, verifyData.data.user);
        router.push('/dashboard');
      } else {
        setError(verifyData.error?.message || 'Passkey verification failed');
      }
    } catch (err) {
      console.error('[Login] passkey', err);
      setError(getLoginErrorMessage(err, 'passkey'));
    } finally {
      setPasskeyLoading(false);
    }
  };

  // Handle email/phone submission
  const handleIdentifierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/v1/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier,
          type: identifierType,
          purpose: 'login',
        }),
      });

      const raw = await response.text();
      if (!response.ok) {
        console.error('[Login] send-otp failed', response.status, response.statusText, raw);
        try {
          const data = JSON.parse(raw);
          setError(data.error?.message || `Request failed (${response.status})`);
        } catch {
          setError(`Request failed (${response.status}). ${raw.slice(0, 80)}`);
        }
        return;
      }

      const data = JSON.parse(raw);
      if (data.success) {
        setStep('otp');
        setCountdown(120);
      } else {
        setError(data.error?.message || 'Failed to send verification code');
      }
    } catch (err) {
      console.error('[Login] send-otp', err);
      setError(getLoginErrorMessage(err, 'send-otp'));
    } finally {
      setLoading(false);
    }
  };

  // Handle OTP input
  const handleOtpChange = (index: number, value: string, refs: React.MutableRefObject<(HTMLInputElement | null)[]>, setState: React.Dispatch<React.SetStateAction<string[]>>) => {
    if (value.length > 1) {
      const digits = value.replace(/\D/g, '').slice(0, 6).split('');
      setState(prev => {
        const newOtp = [...prev];
        digits.forEach((digit, i) => {
          if (index + i < 6) {
            newOtp[index + i] = digit;
          }
        });
        return newOtp;
      });
      const nextIndex = Math.min(index + digits.length, 5);
      refs.current[nextIndex]?.focus();
    } else {
      setState(prev => {
        const newOtp = [...prev];
        newOtp[index] = value.replace(/\D/g, '');
        return newOtp;
      });
      
      if (value && index < 5) {
        refs.current[index + 1]?.focus();
      }
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent, refs: React.MutableRefObject<(HTMLInputElement | null)[]>, state: string[]) => {
    if (e.key === 'Backspace' && !state[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  // Handle OTP verification and login
  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const otpCode = otp.join('');
    if (otpCode.length !== 6) {
      setError('Please enter a valid 6-digit code');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [identifierType]: identifier,
          otp: otpCode,
        }),
      });

      const raw = await response.text();
      if (!response.ok) {
        console.error('[Login] login failed', response.status, response.statusText, raw);
        try {
          const parsed = JSON.parse(raw);
          setError(parsed.error?.message || `Login failed (${response.status})`);
        } catch {
          setError(`Login failed (${response.status}). ${raw.slice(0, 80)}`);
        }
        return;
      }

      let data: { success?: boolean; data?: { requiresVerification?: boolean; user?: unknown; accessToken?: string; refreshToken?: string; verificationToken?: string; stepsRequired?: string[]; currentStep?: number; nextStep?: string; maskedPhone?: string | null; maskedEmail?: string | null }; error?: { message?: string } };
      try {
        data = JSON.parse(raw);
      } catch {
        console.error('[Login] login invalid JSON', raw.slice(0, 200));
        setError('Invalid response from server. Please try again.');
        return;
      }

      if (data.success && data.data) {
        if (data.data.requiresVerification) {
          // Multi-step verification required
          setVerificationState({
            token: data.data.verificationToken!,
            stepsRequired: data.data.stepsRequired ?? [],
            currentStep: data.data.currentStep ?? 0,
            nextStep: data.data.nextStep ?? null,
            maskedPhone: data.data.maskedPhone ?? null,
            maskedEmail: data.data.maskedEmail ?? null,
          });
          setStep('verification');
          setVerificationCode(['', '', '', '', '', '']);
          setCountdown(120);
        } else if (data.data.user && data.data.accessToken && data.data.refreshToken) {
          // No additional verification needed
          login(data.data.user as User, data.data.accessToken, data.data.refreshToken);
          router.push('/dashboard');
        } else {
          setError('Invalid login response. Please try again.');
        }
      } else {
        setError(data.error?.message || 'Login failed');
      }
    } catch (err) {
      console.error('[Login] login', err);
      setError(getLoginErrorMessage(err, 'login'));
    } finally {
      setLoading(false);
    }
  };

  // Handle verification step
  const handleVerificationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = verificationCode.join('');
    if (code.length !== 6) {
      setError('Please enter a valid 6-digit code');
      return;
    }

    if (!verificationState) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/v1/auth/login/verify-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verificationToken: verificationState.token,
          step: verificationState.nextStep,
          code,
        }),
      });

      const raw = await response.text();
      if (!response.ok) {
        console.error('[Login] verify-step failed', response.status, response.statusText, raw);
        try {
          const parsed = JSON.parse(raw);
          setError(parsed.error?.message || `Verification failed (${response.status})`);
        } catch {
          setError(`Verification failed (${response.status}). ${raw.slice(0, 80)}`);
        }
        return;
      }

      const data = JSON.parse(raw);
      if (data.success) {
        if (data.data.allStepsCompleted) {
          // All steps completed, login successful
          login(data.data.user, data.data.accessToken, data.data.refreshToken);
          router.push('/dashboard');
        } else {
          // Move to next step
          setVerificationState(prev => prev ? {
            ...prev,
            currentStep: prev.currentStep + 1,
            nextStep: data.data.nextStep,
          } : null);
          setVerificationCode(['', '', '', '', '', '']);
          setCountdown(120);
        }
      } else {
        setError(data.error?.message || 'Verification failed');
      }
    } catch (err) {
      console.error('[Login] verify-step', err);
      setError(getLoginErrorMessage(err, 'verify-step'));
    } finally {
      setLoading(false);
    }
  };

  // Resend OTP
  const handleResendOtp = async () => {
    if (countdown > 0) return;

    setLoading(true);
    setError('');

    try {
      let response;
      
      if (step === 'otp') {
        // Resend initial OTP
        response = await fetch(`${API_URL}/api/v1/auth/send-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identifier,
            type: identifierType,
            purpose: 'login',
          }),
        });
      } else if (step === 'verification' && verificationState) {
        // Resend verification OTP
        response = await fetch(`${API_URL}/api/v1/auth/login/resend-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            verificationToken: verificationState.token,
            step: verificationState.nextStep,
          }),
        });
      }

      if (response) {
        const raw = await response.text();
        if (!response.ok) {
          console.error('[Login] resend failed', response.status, response.statusText, raw);
          try {
            const parsed = JSON.parse(raw);
            setError(parsed.error?.message || `Resend failed (${response.status})`);
          } catch {
            setError(`Resend failed (${response.status}). ${raw.slice(0, 80)}`);
          }
          return;
        }
        const data = JSON.parse(raw);
        if (data.success) {
          setCountdown(120);
          if (step === 'otp') {
            setOtp(['', '', '', '', '', '']);
          } else {
            setVerificationCode(['', '', '', '', '', '']);
          }
        } else {
          setError(data.error?.message || 'Failed to resend code');
        }
      }
    } catch (err) {
      console.error('[Login] resend', err);
      setError(getLoginErrorMessage(err, 'resend'));
    } finally {
      setLoading(false);
    }
  };

  // Get step icon and title
  const getVerificationStepInfo = (stepType: VerificationStep | null) => {
    switch (stepType) {
      case 'sms':
        return { icon: Smartphone, title: 'SMS Verification', description: 'Enter the code sent to your phone' };
      case 'email':
        return { icon: Mail, title: 'Email Verification', description: 'Enter the code sent to your email' };
      case '2fa':
        return { icon: Shield, title: 'Two-Factor Authentication', description: 'Enter your authenticator code' };
      default:
        return { icon: Key, title: 'Verification', description: 'Complete verification to continue' };
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Side - P2P Banner */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-b from-gray-900 via-gray-900 to-blue-900/30 p-12 flex-col justify-between">
        <div>
          <Link href="/" className="text-2xl font-bold text-white">
            <span className="bg-blue-500 text-white px-2 py-1 rounded mr-1">M</span>
            Methereum
          </Link>
        </div>

        <div className="flex-1 flex flex-col justify-center">
          <h1 className="text-4xl lg:text-5xl font-light text-blue-400 mb-16">
            Buy & sell directly with Methereum P2P
          </h1>

          <div className="grid grid-cols-3 gap-8">
            <div>
              <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mb-4">
                <DollarSign className="w-6 h-6 text-blue-400" />
              </div>
              <h3 className="text-white font-medium mb-1">Supported fiat</h3>
              <p className="text-4xl font-bold text-white mb-4">60+</p>
              <div className="text-gray-400 text-sm space-y-1">
                <p>40+ Countries</p>
                <p>100+ Payment methods</p>
              </div>
            </div>

            <div>
              <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mb-4">
                <Users className="w-6 h-6 text-blue-400" />
              </div>
              <h3 className="text-white font-medium mb-1">Fee</h3>
              <p className="text-4xl font-bold text-white mb-4">0</p>
              <div className="text-gray-400 text-sm space-y-1">
                <p>0 Transaction fee</p>
                <p>0 Platform fee</p>
              </div>
            </div>

            <div>
              <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mb-4">
                <Coins className="w-6 h-6 text-blue-400" />
              </div>
              <h3 className="text-white font-medium mb-1">Cryptos</h3>
              <p className="text-4xl font-bold text-white mb-4">300+</p>
              <div className="text-gray-400 text-sm space-y-1">
                <p>10k+ Advertisements</p>
                <p>100k+ Daily orders</p>
              </div>
            </div>
          </div>
        </div>

        <div className="text-gray-500 text-sm">
          © 2018-2026 Methereum.com. All rights reserved.
        </div>
      </div>

      {/* Right Side - Form */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Header */}
        <div className="flex items-center justify-between p-6">
          <Link href="/" className="text-2xl font-bold text-gray-900 lg:hidden">
            <span className="bg-blue-500 text-white px-2 py-1 rounded mr-1">M</span>
            Methereum
          </Link>
          <div className="lg:ml-auto">
            <button className="flex items-center gap-2 text-gray-600 hover:text-gray-900">
              <Globe className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Form Content */}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md">
            {/* Step 1: Email/Phone Input */}
            {step === 'identifier' && (
              <form onSubmit={handleIdentifierSubmit} className="space-y-6">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 mb-2">Log in to Methereum</h1>
                  <p className="text-gray-500">Enter your email or phone number</p>
                </div>

                {/* Tab Switch */}
                <div className="flex border-b border-gray-200">
                  <button
                    type="button"
                    onClick={() => setIdentifierType('email')}
                    className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                      identifierType === 'email'
                        ? 'text-gray-900 border-gray-900'
                        : 'text-gray-500 border-transparent hover:text-gray-700'
                    }`}
                  >
                    Email
                  </button>
                  <button
                    type="button"
                    onClick={() => setIdentifierType('phone')}
                    className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                      identifierType === 'phone'
                        ? 'text-gray-900 border-gray-900'
                        : 'text-gray-500 border-transparent hover:text-gray-700'
                    }`}
                  >
                    Mobile
                  </button>
                </div>

                {/* Input Field */}
                <div>
                  <input
                    type={identifierType === 'email' ? 'email' : 'tel'}
                    inputMode={identifierType === 'phone' ? 'numeric' : undefined}
                    pattern={identifierType === 'phone' ? '[0-9]*' : undefined}
                    value={identifier}
                    onChange={(e) => {
                      if (identifierType === 'phone') {
                        setIdentifier(e.target.value.replace(/\D/g, '').slice(0, 15));
                      } else {
                        setIdentifier(e.target.value);
                      }
                    }}
                    placeholder={identifierType === 'email' ? 'Email address' : 'Mobile number'}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                    required
                  />
                </div>

                {/* Passkey Login Option */}
                {passkeysAvailable && (
                  <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl border-2 border-blue-300 dark:border-blue-700">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg">
                          <Fingerprint className="w-6 h-6 text-white" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">Touch ID / Face ID Available</p>
                          <p className="text-xs text-blue-700 dark:text-blue-300">Login instantly with biometrics</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handlePasskeyLogin();
                        }}
                        disabled={passkeyLoading || loading}
                        className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {passkeyLoading ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Authenticating...
                          </>
                        ) : (
                          <>
                            <Fingerprint className="w-5 h-5" />
                            Login with Passkey
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {error && (
                  <p className="text-red-500 text-sm">{error}</p>
                )}

                {passkeysAvailable && (
                  <div className="flex items-center gap-3 text-gray-400 text-sm">
                    <div className="flex-1 h-px bg-gray-300 dark:bg-gray-700" />
                    <span>or continue with OTP</span>
                    <div className="flex-1 h-px bg-gray-300 dark:bg-gray-700" />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || passkeyLoading || !identifier}
                  className="w-full py-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Sending...' : 'Continue with OTP'}
                </button>

                <p className="text-center text-sm text-gray-500">
                  Don't have an account?{' '}
                  <Link href="/signup" className="text-blue-500 hover:underline font-medium">
                    Sign up
                  </Link>
                </p>
              </form>
            )}

            {/* Step 2: OTP Verification */}
            {step === 'otp' && (
              <form onSubmit={handleOtpSubmit} className="space-y-6">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 mb-2">Verify your {identifierType}</h1>
                  <p className="text-gray-500">
                    A 6-digit code has been sent to:
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-gray-900 font-medium">{identifier}</span>
                    <button
                      type="button"
                      onClick={() => setStep('identifier')}
                      className="text-blue-500 hover:text-blue-700 text-sm flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Modify
                    </button>
                  </div>
                  <p className="text-sm text-gray-500 mt-2">
                    Your verification code is valid for five (5) minutes.
                  </p>
                </div>

                {/* OTP Input Boxes */}
                <div className="flex gap-3 justify-center">
                  {otp.map((digit, index) => (
                    <input
                      key={index}
                      ref={(el) => { otpRefs.current[index] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={digit}
                      onChange={(e) => handleOtpChange(index, e.target.value, otpRefs, setOtp)}
                      onKeyDown={(e) => handleOtpKeyDown(index, e, otpRefs, otp)}
                      className="w-12 h-14 text-center text-xl font-bold border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                    />
                  ))}
                </div>

                {error && (
                  <p className="text-red-500 text-sm text-center">{error}</p>
                )}

                {/* Resend Section */}
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={countdown > 0}
                    className={`flex items-center gap-1 ${
                      countdown > 0 ? 'text-gray-400 cursor-not-allowed' : 'text-blue-500 hover:text-blue-700'
                    }`}
                  >
                    <span className="text-blue-500">⏱</span>
                    Didn't receive {identifierType === 'email' ? 'email' : 'SMS'}
                  </button>
                  <span className={countdown > 0 ? 'text-gray-400' : 'text-blue-500'}>
                    {countdown > 0 ? formatCountdown(countdown) : ''} {countdown === 0 && 'Resend'}
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={loading || otp.join('').length !== 6}
                  className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Verifying...' : 'Continue'}
                </button>
              </form>
            )}

            {/* Step 3: Additional Verification */}
            {step === 'verification' && verificationState && (
              <form onSubmit={handleVerificationSubmit} className="space-y-6">
                {(() => {
                  const stepInfo = getVerificationStepInfo(verificationState.nextStep);
                  const StepIcon = stepInfo.icon;
                  return (
                    <>
                      {/* Progress indicator */}
                      <div className="flex items-center justify-center gap-2 mb-4">
                        {verificationState.stepsRequired.map((s, i) => (
                          <div
                            key={s}
                            className={`w-3 h-3 rounded-full ${
                              i < verificationState.currentStep
                                ? 'bg-green-500'
                                : i === verificationState.currentStep
                                ? 'bg-blue-500'
                                : 'bg-gray-300'
                            }`}
                          />
                        ))}
                      </div>

                      <div className="text-center">
                        <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
                          <StepIcon className="w-8 h-8 text-blue-600" />
                        </div>
                        <h1 className="text-2xl font-bold text-gray-900 mb-2">{stepInfo.title}</h1>
                        <p className="text-gray-500">{stepInfo.description}</p>
                        
                        {verificationState.nextStep === 'sms' && verificationState.maskedPhone && (
                          <p className="text-gray-700 font-medium mt-2">{verificationState.maskedPhone}</p>
                        )}
                        {verificationState.nextStep === 'email' && verificationState.maskedEmail && (
                          <p className="text-gray-700 font-medium mt-2">{verificationState.maskedEmail}</p>
                        )}
                      </div>

                      {/* Verification Code Input */}
                      <div className="flex gap-3 justify-center">
                        {verificationCode.map((digit, index) => (
                          <input
                            key={index}
                            ref={(el) => { verificationRefs.current[index] = el; }}
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={digit}
                            onChange={(e) => handleOtpChange(index, e.target.value, verificationRefs, setVerificationCode)}
                            onKeyDown={(e) => handleOtpKeyDown(index, e, verificationRefs, verificationCode)}
                            className="w-12 h-14 text-center text-xl font-bold border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-gray-900"
                          />
                        ))}
                      </div>

                      {error && (
                        <p className="text-red-500 text-sm text-center">{error}</p>
                      )}

                      {/* Resend for SMS/Email only */}
                      {verificationState.nextStep !== '2fa' && (
                        <div className="flex items-center justify-between text-sm">
                          <button
                            type="button"
                            onClick={handleResendOtp}
                            disabled={countdown > 0}
                            className={`flex items-center gap-1 ${
                              countdown > 0 ? 'text-gray-400 cursor-not-allowed' : 'text-blue-500 hover:text-blue-700'
                            }`}
                          >
                            <span className="text-blue-500">⏱</span>
                            Didn't receive code
                          </button>
                          <span className={countdown > 0 ? 'text-gray-400' : 'text-blue-500'}>
                            {countdown > 0 ? formatCountdown(countdown) : ''} {countdown === 0 && 'Resend'}
                          </span>
                        </div>
                      )}

                      {verificationState.nextStep === '2fa' && (
                        <p className="text-sm text-gray-500 text-center">
                          Open your authenticator app and enter the 6-digit code
                        </p>
                      )}

                      <button
                        type="submit"
                        disabled={loading || verificationCode.join('').length !== 6}
                        className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {loading ? 'Verifying...' : 'Verify & Continue'}
                      </button>

                      {/* Steps remaining info */}
                      {verificationState.stepsRequired.length > 1 && (
                        <p className="text-xs text-gray-400 text-center">
                          Step {verificationState.currentStep + 1} of {verificationState.stepsRequired.length}
                        </p>
                      )}
                    </>
                  );
                })()}
              </form>
            )}
          </div>
        </div>

        {/* Cookie Banner */}
        <div className="p-4 bg-gray-50 border-t border-gray-200">
          <div className="flex items-center justify-between max-w-4xl mx-auto">
            <p className="text-xs text-gray-500">
              This website uses cookies to improve mobile app functionality and your in-app experiences. 
              You may review our <Link href="/cookies" className="text-blue-500 hover:underline">Cookie Policy</Link> and accept the default setting.
            </p>
            <button className="ml-4 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 whitespace-nowrap">
              Accept All
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
