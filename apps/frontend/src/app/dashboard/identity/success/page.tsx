'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, ArrowRight, Shield, Gift } from 'lucide-react';

export default function IdentityVerificationSuccessPage() {
  const router = useRouter();

  // Auto redirect after 5 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      router.push('/dashboard');
    }, 5000);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
        <Link href="/dashboard" className="text-2xl font-bold text-gray-900 dark:text-white">
          <span className="bg-blue-500 text-white px-2 py-1 rounded mr-1">M</span>
          Methereum
        </Link>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          {/* Success Icon */}
          <div className="w-24 h-24 mx-auto mb-6 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center">
              <Check className="w-8 h-8 text-white" />
            </div>
          </div>

          {/* Success Message */}
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">
            Verification Successful!
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mb-8">
            Your identity has been verified. You now have full access to all platform features.
          </p>

          {/* Benefits */}
          <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 mb-8 text-left">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Gift className="w-5 h-5 text-blue-500" />
              Your Rewards
            </h3>
            <ul className="space-y-3">
              <li className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                  <span className="text-blue-600">💰</span>
                </div>
                <span>$20 USDT bonus credited to your account</span>
              </li>
              <li className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                  <Shield className="w-4 h-4 text-blue-600" />
                </div>
                <span>Increased withdrawal limits</span>
              </li>
              <li className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                <div className="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                  <Check className="w-4 h-4 text-green-600" />
                </div>
                <span>Access to all trading features</span>
              </li>
            </ul>
          </div>

          {/* CTA Buttons */}
          <div className="space-y-3">
            <Link
              href="/dashboard/deposit/crypto"
              className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              Make a Deposit
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/dashboard"
              className="w-full py-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-medium rounded-xl transition-colors block"
            >
              Go to Dashboard
            </Link>
          </div>

          <p className="mt-6 text-sm text-gray-400">
            Redirecting to dashboard in 5 seconds...
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
        <p>© 2018-2026 Methereum.com. All rights reserved.</p>
      </footer>
    </div>
  );
}
