'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { ChevronRight, PanelLeftClose } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSidebarState } from './SidebarContext';
import { buildSidebarSections, isSidebarNavActive } from '@/lib/admin/nav-sections';

export function UnifiedSidebar() {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const { collapsed, toggle } = useSidebarState();
  const prefetch = useCallback((href: string) => {
    router.prefetch(href);
  }, [router]);

  const sections = useMemo(() => buildSidebarSections(), []);

  const w = collapsed ? 'w-[72px]' : 'w-60';

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 h-screen border-r border-admin-border bg-admin-surface flex flex-col transition-all duration-200',
        w
      )}
    >
      <div
        className={cn(
          'flex h-14 items-center border-b border-admin-border shrink-0',
          collapsed ? 'justify-center px-2' : 'justify-between px-4'
        )}
      >
        {!collapsed && (
          <span className="text-sm font-bold text-admin-text truncate">Exchange Admin</span>
        )}
        <button
          type="button"
          onClick={toggle}
          className="rounded-md p-1.5 text-admin-muted hover:bg-white/5 hover:text-admin-text transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {sections.map((section) => (
          <div key={section.title}>
            {!collapsed && (
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-admin-muted/50">
                {section.title}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = isSidebarNavActive(pathname, item.href);
                return (
                  <Link
                    key={`${section.title}-${item.label}`}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    onMouseEnter={() => prefetch(item.href)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg text-[13px] font-medium transition-all duration-150',
                      collapsed ? 'justify-center px-2 py-2.5' : 'px-2.5 py-2',
                      isActive
                        ? 'bg-admin-primary/15 text-admin-primary border border-admin-primary/20'
                        : 'text-admin-muted hover:bg-white/5 hover:text-admin-text border border-transparent'
                    )}
                  >
                    <item.icon className="h-[18px] w-[18px] shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {!collapsed && (
        <div className="shrink-0 border-t border-admin-border px-4 py-2.5">
          <p className="text-[10px] text-admin-muted/40 font-medium">Admin Panel v2.0</p>
        </div>
      )}
    </aside>
  );
}
