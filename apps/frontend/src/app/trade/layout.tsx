'use client';

/**
 * Trading shell: spot terminal with above-the-fold viewport + scrollable order history.
 * Public-viewable (chart, orderbook, trades). Auth only needed for placing orders.
 * Mirrors Binance: one-screen trading band; history below the fold.
 */
import SessionManager from '@/components/SessionManager';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';

const MOBILE_NAV_PAD = 'pb-[calc(3.75rem+env(safe-area-inset-bottom,0px))] md:pb-0';

export default function TradeShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SessionManager redirectPath="/login" />
      <div className="min-h-screen bg-background">
        <main
          id="main-content"
          tabIndex={-1}
          className={`flex min-h-screen w-full flex-col overflow-y-auto overflow-x-hidden ${MOBILE_NAV_PAD}`}
        >
          {children}
        </main>
        <MobileBottomNav />
      </div>
    </>
  );
}
