'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function PrivacyPolicyPage() {
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
              Privacy Policy
            </h1>
            <p className="text-gray-500">
              Last updated: January 30, 2026
            </p>
          </div>

          {/* Content */}
          <div className="prose prose-gray dark:prose-invert max-w-none">
            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                1. Introduction
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                Exchange ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our cryptocurrency trading platform and related services. Please read this policy carefully to understand our practices regarding your personal data.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                2. Information We Collect
              </h2>
              
              <h3 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-3 mt-6">
                2.1 Personal Information
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
                We may collect the following personal information:
              </p>
              <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 space-y-2 ml-4">
                <li>Full name and date of birth</li>
                <li>Email address and phone number</li>
                <li>Residential address</li>
                <li>Government-issued identification documents</li>
                <li>Proof of address documents</li>
                <li>Facial photographs (selfies) for identity verification</li>
                <li>Financial information, including bank account details</li>
              </ul>

              <h3 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-3 mt-6">
                2.2 Technical Information
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
                We automatically collect certain technical data:
              </p>
              <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 space-y-2 ml-4">
                <li>IP address and device identifiers</li>
                <li>Browser type and operating system</li>
                <li>Access times and pages viewed</li>
                <li>Referring website addresses</li>
                <li>Location data (if permitted)</li>
              </ul>

              <h3 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-3 mt-6">
                2.3 Transaction Information
              </h3>
              <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 space-y-2 ml-4">
                <li>Trading history and order details</li>
                <li>Deposit and withdrawal records</li>
                <li>Wallet addresses</li>
                <li>Payment method information</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                3. How We Use Your Information
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
                We use the collected information for:
              </p>
              <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 space-y-2 ml-4">
                <li><strong>Account Management:</strong> Creating, maintaining, and securing your account</li>
                <li><strong>Identity Verification:</strong> Complying with KYC/AML regulations</li>
                <li><strong>Service Provision:</strong> Processing transactions and providing platform features</li>
                <li><strong>Communication:</strong> Sending service updates, security alerts, and promotional materials</li>
                <li><strong>Security:</strong> Detecting and preventing fraud, unauthorized access, and illegal activities</li>
                <li><strong>Legal Compliance:</strong> Meeting regulatory requirements and responding to legal requests</li>
                <li><strong>Improvement:</strong> Analyzing usage patterns to enhance our services</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                4. Information Sharing
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
                We may share your information with:
              </p>
              <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 space-y-2 ml-4">
                <li><strong>Service Providers:</strong> Third parties who help us operate the platform (payment processors, KYC providers, cloud services)</li>
                <li><strong>Legal Authorities:</strong> When required by law, subpoena, or court order</li>
                <li><strong>Regulatory Bodies:</strong> To comply with financial regulations and reporting requirements</li>
                <li><strong>Business Partners:</strong> For integrated services, with your consent</li>
                <li><strong>Corporate Transactions:</strong> In connection with mergers, acquisitions, or asset sales</li>
              </ul>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed mt-4">
                We do not sell your personal information to third parties for marketing purposes.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                5. Data Security
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
                We implement industry-standard security measures to protect your data:
              </p>
              <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 space-y-2 ml-4">
                <li>AES-256 encryption for data at rest</li>
                <li>TLS 1.3 encryption for data in transit</li>
                <li>Multi-factor authentication (MFA)</li>
                <li>Regular security audits and penetration testing</li>
                <li>Cold storage for the majority of digital assets</li>
                <li>24/7 security monitoring and intrusion detection</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                6. Data Retention
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                We retain your personal information for as long as your account is active or as needed to provide services. After account closure, we may retain certain data for legal, regulatory, and legitimate business purposes, typically for a period of 5-7 years, in accordance with applicable laws and regulations.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                7. Your Rights
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
                Depending on your jurisdiction, you may have the following rights:
              </p>
              <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 space-y-2 ml-4">
                <li><strong>Access:</strong> Request a copy of your personal data</li>
                <li><strong>Rectification:</strong> Request correction of inaccurate data</li>
                <li><strong>Erasure:</strong> Request deletion of your data (subject to legal retention requirements)</li>
                <li><strong>Restriction:</strong> Request limitation of data processing</li>
                <li><strong>Portability:</strong> Request transfer of your data to another service</li>
                <li><strong>Objection:</strong> Object to certain processing activities</li>
                <li><strong>Withdraw Consent:</strong> Withdraw previously given consent</li>
              </ul>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed mt-4">
                To exercise these rights, please contact us at privacy@exchange.com.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                8. Cookies and Tracking
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
                We use cookies and similar technologies to:
              </p>
              <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 space-y-2 ml-4">
                <li>Remember your login status and preferences</li>
                <li>Analyze platform usage and performance</li>
                <li>Enhance security and detect suspicious activity</li>
                <li>Personalize your experience</li>
              </ul>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed mt-4">
                You can manage cookie preferences through your browser settings, though disabling certain cookies may affect platform functionality.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                9. International Data Transfers
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                Your information may be transferred to and processed in countries other than your country of residence. We ensure appropriate safeguards are in place for such transfers, including standard contractual clauses and adequacy decisions, to protect your data in accordance with this Privacy Policy.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                10. Children's Privacy
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                Our platform is not intended for individuals under 18 years of age. We do not knowingly collect personal information from children. If we become aware that we have collected data from a child, we will take steps to delete such information promptly.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                11. Changes to This Policy
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the new Privacy Policy on our platform and updating the "Last updated" date. We encourage you to review this policy periodically for any changes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                12. Contact Us
              </h2>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                If you have any questions or concerns about this Privacy Policy or our data practices, please contact us:
              </p>
              <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
                <p className="text-gray-600 dark:text-gray-400">
                  Privacy Team: <a href="mailto:privacy@exchange.com" className="text-purple-600 dark:text-purple-400 hover:underline">privacy@exchange.com</a>
                </p>
                <p className="text-gray-600 dark:text-gray-400 mt-2">
                  Data Protection Officer: <a href="mailto:dpo@exchange.com" className="text-purple-600 dark:text-purple-400 hover:underline">dpo@exchange.com</a>
                </p>
                <p className="text-gray-600 dark:text-gray-400 mt-2">
                  General Support: <a href="mailto:support@exchange.com" className="text-purple-600 dark:text-purple-400 hover:underline">support@exchange.com</a>
                </p>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
