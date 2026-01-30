'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Globe, ChevronDown, Users, DollarSign, Coins, ExternalLink } from 'lucide-react';
import { useAuthStore } from '@/store/auth';

type Step = 'identifier' | 'otp';

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated } = useAuthStore();
  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [identifierType, setIdentifierType] = useState<'email' | 'phone'>('email');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

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

  // Format countdown display
  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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

      const data = await response.json();

      if (data.success) {
        setStep('otp');
        setCountdown(120); // 2 minutes
      } else {
        setError(data.error?.message || 'Failed to send verification code');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle OTP input
  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) {
      // Handle paste
      const digits = value.replace(/\D/g, '').slice(0, 6).split('');
      const newOtp = [...otp];
      digits.forEach((digit, i) => {
        if (index + i < 6) {
          newOtp[index + i] = digit;
        }
      });
      setOtp(newOtp);
      const nextIndex = Math.min(index + digits.length, 5);
      otpRefs.current[nextIndex]?.focus();
    } else {
      const newOtp = [...otp];
      newOtp[index] = value.replace(/\D/g, '');
      setOtp(newOtp);
      
      if (value && index < 5) {
        otpRefs.current[index + 1]?.focus();
      }
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
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

      const data = await response.json();

      if (data.success) {
        login(data.data.user, data.data.accessToken, data.data.refreshToken);
        router.push('/dashboard');
      } else {
        setError(data.error?.message || 'Login failed');
      }
    } catch (err) {
      setError('Network error. Please try again.');
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
      const response = await fetch(`${API_URL}/api/v1/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier,
          type: identifierType,
          purpose: 'login',
        }),
      });

      const data = await response.json();

      if (data.success) {
        setCountdown(120);
        setOtp(['', '', '', '', '', '']);
      } else {
        setError(data.error?.message || 'Failed to resend code');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
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
            {/* Supported Fiat */}
            <div>
              <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mb-4">
                <DollarSign className="w-6 h-6 text-blue-400" />
              </div>
              <h3 className="text-white font-medium mb-1">Supported fiat</h3>
              <p className="text-4xl font-bold text-white mb-4">60+</p>
              <div className="text-gray-400 text-sm space-y-1">
                <p>40+</p>
                <p>Countries</p>
                <p className="mt-2">100+</p>
                <p>Payment methods</p>
              </div>
            </div>

            {/* Fee */}
            <div>
              <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mb-4">
                <Users className="w-6 h-6 text-blue-400" />
              </div>
              <h3 className="text-white font-medium mb-1">Fee</h3>
              <p className="text-4xl font-bold text-white mb-4">0</p>
              <div className="text-gray-400 text-sm space-y-1">
                <p>0</p>
                <p>Transaction fee</p>
                <p className="mt-2">0</p>
                <p>Platform fee</p>
              </div>
            </div>

            {/* Cryptos */}
            <div>
              <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mb-4">
                <Coins className="w-6 h-6 text-blue-400" />
              </div>
              <h3 className="text-white font-medium mb-1">Cryptos</h3>
              <p className="text-4xl font-bold text-white mb-4">300+</p>
              <div className="text-gray-400 text-sm space-y-1">
                <p>10k+</p>
                <p>Advertisements</p>
                <p className="mt-2">100k+</p>
                <p>Daily orders</p>
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
                        // Only allow digits for phone
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

                {error && (
                  <p className="text-red-500 text-sm">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || !identifier}
                  className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Sending...' : 'Continue'}
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
                      className="text-blue-500 hover:text-yellow-700 text-sm flex items-center gap-1"
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
                      onChange={(e) => handleOtpChange(index, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(index, e)}
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
                      countdown > 0 ? 'text-gray-400 cursor-not-allowed' : 'text-blue-500 hover:text-yellow-700'
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
                  {loading ? 'Verifying...' : 'Log in'}
                </button>
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
