'use client';

import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { classifyPage } from '@/lib/pageClassification';
import { ADMIN_FEATURE_FLAGS } from '@/lib/admin/featureFlags';
import { SidebarProvider, useSidebarState } from './SidebarContext';
import { UnifiedSidebar } from './UnifiedSidebar';
import { UnifiedTopbar } from './UnifiedTopbar';
import { GlobalActionBar } from './GlobalActionBar';
import { LegacyWrapper } from './LegacyWrapper';
import { NewPageWrapper } from './NewPageWrapper';
import { cn } from '@/lib/cn';

/**
 * Lazy-load shell chrome that only appears on user interaction (Cmd+K, alert
 * bell, side panel toggle). Previously these were eager-loaded inside every
 * page's initial bundle — now they ship as separate chunks that download
 * only when needed, trimming ~60–80 KB from the critical path on every route.
 * `ssr: false` is deliberate: none of these render meaningful content before
 * the user clicks/presses a key anyway.
 */
const GlobalCommandPalette = dynamic(
  () => import('./GlobalCommandPalette').then((m) => m.GlobalCommandPalette),
  { ssr: false }
);
const AlertDrawer = dynamic(
  () => import('@/components/admin-v2/AlertDrawer').then((m) => m.AlertDrawer),
  { ssr: false }
);
const RightPanel = dynamic(
  () => import('./RightPanel').then((m) => m.RightPanel),
  { ssr: false }
);

interface AppShellProps {
  children: React.ReactNode;
}

function AppShellInner({ children }: AppShellProps) {
  const pathname = usePathname();
  const { collapsed } = useSidebarState();
  const mode = classifyPage(pathname);
  const isNew = mode === 'v2';

  return (
    <div className="min-h-screen bg-admin-bg">
      <UnifiedSidebar />

      <div className={cn('transition-all duration-200', collapsed ? 'pl-[72px]' : 'pl-60')}>
        <UnifiedTopbar />
        <GlobalActionBar />

        <main className="min-h-screen">
          <LegacyWrapper>{children}</LegacyWrapper>
        </main>
      </div>

      {ADMIN_FEATURE_FLAGS.ADMIN_NEW_DASHBOARD && <RightPanel />}

      {/* Global Command Palette — available on ALL pages via Cmd+K */}
      <GlobalCommandPalette />
      <AlertDrawer />
    </div>
  );
}

/**
 * AppShell — the global layout container.
 * Provides sidebar state via context, then renders:
 *   Sidebar | Topbar + Content | RightPanel | CommandPalette
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <SidebarProvider>
      <AppShellInner>{children}</AppShellInner>
    </SidebarProvider>
  );
}
