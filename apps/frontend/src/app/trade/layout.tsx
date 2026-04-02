'use client';

/**
 * Trading shell: full-viewport spot/P2P (no dashboard sidebar).
 * Mirrors dashboard layout behavior for /dashboard/spot when canonical routes are enabled.
 */
import RequireAuth from '@/components/RequireAuth';
import SessionManager from '@/components/SessionManager';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';

const MOBILE_NAV_PAD = 'pb-[calc(3.75rem+env(safe-area-inset-bottom,0px))] md:pb-0';

export default function TradeShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <SessionManager redirectPath="/login" />
      <div className="min-h-screen bg-gray-50 dark:bg-[#0b0e11]">
        <main
          id="main-content"
          tabIndex={-1}
          className={`flex h-screen w-full flex-col overflow-hidden ${MOBILE_NAV_PAD}`}
        >
          {children}
        </main>
        <MobileBottomNav />
      </div>
    </RequireAuth>
  );
}
