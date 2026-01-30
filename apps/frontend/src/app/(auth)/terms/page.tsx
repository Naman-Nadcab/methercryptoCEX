'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 dark:bg-gray-900/80 backdrop-blur-lg border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-8 md:p-12">
          {/* Title */}
          <div className="mb-10">
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              Terms of Service
            </h1>
            <p className="text-gray-500">
              Last updated: January 30, 2026
            </p>
          </div>

          {/* Content */}
          <div className="prose prose-gray dark:prose-invert max-w-none">
            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                1. Acceptance of Terms
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                By accessing or using the Exchange platform ("Platform"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, please do not use the Platform. These Terms constitute a legally binding agreement between you and Exchange.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                2. Eligibility
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
                To use our Platform, you must:
              </p>
              <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 space-y-2 ml-4">
                <li>Be at least 18 years old or the legal age of majority in your jurisdiction</li>
                <li>Have full legal capacity to enter into binding agreements</li>
                <li>Not be a resident of any jurisdiction where cryptocurrency trading is prohibited</li>
                <li>Complete our identity verification (KYC) process when required</li>
                <li>Not have been previously suspended or removed from the Platform</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                3. Account Registration and Security
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
                When creating an account, you agree to:
              </p>
              <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 space-y-2 ml-4">
                <li>Provide accurate and complete information during registration</li>
                <li>Maintain and promptly update your account information</li>
                <li>Keep your login credentials confidential</li>
                <li>Enable two-factor authentication (2FA) for enhanced security</li>
                <li>Notify us immediately of any unauthorized access to your account</li>
                <li>Accept responsibility for all activities that occur under your account</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                4. Platform Services
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
                Exchange provides the following services:
              </p>
              <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 space-y-2 ml-4">
                <li><strong>Spot Trading:</strong> Buy and sell cryptocurrencies at current market prices</li>
                <li><strong>P2P Trading:</strong> Trade directly with other users using various payment methods</li>
                <li><strong>Wallet Services:</strong> Store and manage your digital assets</li>
                <li><strong>Deposit & Withdrawal:</strong> Transfer funds to and from the Platform</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                5. Trading Rules and Restrictions
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
                You agree not to:
              </p>
              <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 space-y-2 ml-4">
                <li>Engage in market manipulation, wash trading, or any fraudulent activity</li>
                <li>Use the Platform for money laundering or terrorist financing</li>
                <li>Circumvent any trading limits or restrictions</li>
                <li>Use automated trading systems without prior authorization</li>
                <li>Interfere with or disrupt the Platform's infrastructure</li>
                <li>Attempt to gain unauthorized access to other users' accounts</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                6. Fees and Payments
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                Exchange charges fees for certain services, including trading fees, withdrawal fees, and other applicable charges. All fees are clearly displayed before you confirm any transaction. We reserve the right to modify our fee structure with advance notice to users. You are responsible for any taxes applicable to your transactions.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                7. Risk Disclosure
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                Cryptocurrency trading involves substantial risk of loss and is not suitable for every investor. The value of cryptocurrencies can be extremely volatile. You should carefully consider whether trading is appropriate for you in light of your financial condition. Past performance is not indicative of future results. You acknowledge that you trade at your own risk.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                8. Limitation of Liability
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                To the maximum extent permitted by law, Exchange shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of profits, data, or other intangible losses, resulting from your use of or inability to use the Platform.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                9. Intellectual Property
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                All content on the Platform, including but not limited to text, graphics, logos, images, and software, is the property of Exchange or its licensors and is protected by intellectual property laws. You may not reproduce, distribute, or create derivative works without our prior written consent.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                10. Termination
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                We reserve the right to suspend or terminate your account at any time for any reason, including violation of these Terms. Upon termination, you must cease all use of the Platform and may be required to withdraw your remaining funds within a specified period.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                11. Governing Law
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                These Terms shall be governed by and construed in accordance with the laws of the jurisdiction in which Exchange is incorporated, without regard to its conflict of law provisions.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                12. Changes to Terms
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                We may update these Terms from time to time. We will notify you of any material changes by posting the new Terms on the Platform and updating the "Last updated" date. Your continued use of the Platform after such changes constitutes acceptance of the new Terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                13. Contact Us
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                If you have any questions about these Terms, please contact us at:
              </p>
              <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
                <p className="text-gray-600 dark:text-gray-400">
                  Email: <a href="mailto:legal@exchange.com" className="text-purple-600 dark:text-purple-400 hover:underline">legal@exchange.com</a>
                </p>
                <p className="text-gray-600 dark:text-gray-400 mt-2">
                  Support: <a href="mailto:support@exchange.com" className="text-purple-600 dark:text-purple-400 hover:underline">support@exchange.com</a>
                </p>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
