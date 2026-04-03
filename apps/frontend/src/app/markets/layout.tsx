'use client';

/**
 * Markets shell: public-viewable with exchange header.
 * No RequireAuth — anyone can browse markets, same as Binance.
 */
import { ExchangeHeader } from '@/components/layout/ExchangeHeader';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';

const MOBILE_NAV_PAD = 'pb-[calc(3.75rem+env(safe-area-inset-bottom,0px))] md:pb-0';

export default function MarketsPublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <ExchangeHeader />
      <main id="main-content" tabIndex={-1} className={`min-h-[calc(100vh-3.5rem)] ${MOBILE_NAV_PAD}`}>
        {children}
      </main>
      <MobileBottomNav />
    </div>
  );
}
