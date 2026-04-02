'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function CookiePolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="sticky top-0 z-10 bg-card/80 dark:bg-gray-900/80 backdrop-blur-lg border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="bg-card rounded-xl border border-border p-8 md:p-12">
          <div className="mb-10">
            <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Cookie Policy
            </h1>
            <p className="text-gray-500">Last updated: February 2026</p>
          </div>

          <div className="prose prose-gray dark:prose-invert max-w-none space-y-6">
            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">1. What Are Cookies</h2>
              <p className="text-muted-foreground leading-relaxed">
                Cookies are small text files stored on your device when you visit our platform. They help us provide a better experience for spot trading and P2P transactions.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">2. How We Use Cookies</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                We use cookies to:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>Keep you logged in and maintain your session</li>
                <li>Remember your preferences (e.g. theme, language)</li>
                <li>Improve platform performance and security</li>
                <li>Analyze usage to enhance the trading experience</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">3. Managing Cookies</h2>
              <p className="text-muted-foreground leading-relaxed">
                You can manage cookie preferences through your browser settings. Disabling certain cookies may affect platform functionality, including login and trading features.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-foreground mb-3">4. Contact</h2>
              <p className="text-muted-foreground leading-relaxed">
                For questions about this Cookie Policy, see our <Link href="/privacy" className="text-blue-500 hover:underline">Privacy Policy</Link> and <Link href="/terms" className="text-blue-500 hover:underline">Terms of Service</Link>.
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
