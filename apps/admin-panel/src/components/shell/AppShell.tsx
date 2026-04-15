'use client';

import { usePathname } from 'next/navigation';
import { classifyPage } from '@/lib/pageClassification';
import { ADMIN_FEATURE_FLAGS } from '@/lib/admin/featureFlags';
import { SidebarProvider, useSidebarState } from './SidebarContext';
import { UnifiedSidebar } from './UnifiedSidebar';
import { UnifiedTopbar } from './UnifiedTopbar';
import { RightPanel } from './RightPanel';
import { GlobalCommandPalette } from './GlobalCommandPalette';
import { GlobalActionBar } from './GlobalActionBar';
import { LegacyWrapper } from './LegacyWrapper';
import { NewPageWrapper } from './NewPageWrapper';
import { AlertDrawer } from '@/components/admin-v2/AlertDrawer';
import { cn } from '@/lib/cn';

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
