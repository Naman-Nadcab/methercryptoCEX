'use client';

import Link from 'next/link';
import { DollarSign, Users, Coins } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import { ROUTES } from '@/lib/routes';

/** Shared P2P banner + form layout — Tier 1 design with dark mode */
export default function AuthSplitLayout({
  children,
  showCookieBanner = true,
}: {
  children: React.ReactNode;
  showCookieBanner?: boolean;
}) {
  return (
    <div className="min-h-screen flex bg-background">
      {/* Left - Brand panel with subtle grid pattern */}
      <div className="hidden lg:flex lg:w-[48%] relative overflow-hidden bg-gradient-to-br from-gray-900 via-[#0f172a] to-blue-950/40 p-12 flex-col justify-between">
        {/* Subtle grid overlay */}
        <div className="absolute inset-0 opacity-[0.07]" style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
        }} />
        <Link href={ROUTES.home} className="relative text-2xl font-bold text-white flex items-center gap-1.5 transition-opacity hover:opacity-90">
          <span className="w-9 h-9 rounded-lg bg-blue-500 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-blue-500/30">M</span>
          Methereum
        </Link>
        <div className="relative flex-1 flex flex-col justify-center">
          <h1 className="text-3xl xl:text-4xl font-semibold text-white leading-tight mb-3">
            Trade crypto with <span className="text-blue-400">confidence</span>
          </h1>
          <p className="text-gray-400 text-lg mb-12 max-w-sm">
            Secure spot trading and P2P — built for speed and reliability.
          </p>
          <div className="grid grid-cols-3 gap-6">
            {[
              { icon: DollarSign, label: 'Fiat', value: '60+', sub: '40+ countries' },
              { icon: Users, label: 'Fee', value: '0', sub: '0% platform fee' },
              { icon: Coins, label: 'Assets', value: '300+', sub: '10k+ daily orders' },
            ].map(({ icon: Icon, label, value, sub }) => (
              <div key={label} className="group">
                <div className="w-11 h-11 rounded-xl bg-card/5 border border-white/10 flex items-center justify-center mb-3 group-hover:bg-blue-500/20 group-hover:border-blue-500/30 transition-colors">
                  <Icon className="w-5 h-5 text-blue-400" />
                </div>
                <p className="text-gray-500 text-xs font-medium uppercase tracking-wider mb-0.5">{label}</p>
                <p className="text-2xl font-bold text-white">{value}</p>
                <p className="text-gray-500 text-xs mt-0.5">{sub}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-gray-500 text-xs">© 2018-2026 Methereum. All rights reserved.</p>
      </div>

      {/* Right - Form area */}
      <div className="flex-1 flex flex-col bg-white dark:bg-background min-w-0">
        <div className="flex items-center justify-between p-5 lg:p-6">
          <Link href={ROUTES.home} className="text-xl font-bold text-foreground lg:hidden flex items-center gap-1.5">
            <span className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center text-white font-bold text-sm">M</span>
            Methereum
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle variant="icon" size="sm" />
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-5 lg:p-8">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
        {showCookieBanner && (
          <div className="p-4 border-t border-border bg-gray-50/50 dark:bg-background">
            <div className="flex items-center justify-between max-w-4xl mx-auto gap-4 flex-wrap">
              <p className="text-xs text-muted-foreground">
                We use cookies. <Link href={ROUTES.cookies} className="text-primary hover:underline">Cookie Policy</Link>
              </p>
              <button type="button" className="px-4 py-2 rounded-lg bg-accent text-foreground/80 text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-700 transition-colors">
                Accept All
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
