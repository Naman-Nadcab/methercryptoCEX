'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { ArrowLeftRight, LayoutGrid, PlusCircle, ListOrdered, CreditCard, BarChart3, UserCircle } from 'lucide-react';
import { P2P_HREF, ROUTES, loginWithRedirect } from '@/lib/routes';

const nav = [
  { href: P2P_HREF, label: 'Marketplace', icon: LayoutGrid },
  { href: `${P2P_HREF}/create-ad`, label: 'Post ad', icon: PlusCircle },
  { href: `${P2P_HREF}/my-ads`, label: 'My ads', icon: ArrowLeftRight },
  { href: `${P2P_HREF}/orders`, label: 'Orders', icon: ListOrdered },
  { href: `${P2P_HREF}/payment-methods`, label: 'Payments', icon: CreditCard },
  { href: `${P2P_HREF}/merchant-dashboard`, label: 'Dashboard', icon: BarChart3 },
];

export function P2PHeader() {
  const pathname = usePathname();
  const { accessToken, _hasHydrated } = useAuthStore();
  const authed = _hasHydrated && !!accessToken;

  return (
    <header className="sticky top-0 z-30 border-b border-gray-200/90 bg-white/95 backdrop-blur dark:border-gray-800/90 dark:bg-[#181a20]/95">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Link href={P2P_HREF} className="text-sm font-semibold text-gray-900 dark:text-white">
            P2P Trading
          </Link>
        </div>
        <nav className="flex flex-wrap items-center gap-1 sm:gap-2" aria-label="P2P sections">
          {nav.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === P2P_HREF
                ? pathname === P2P_HREF
                : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors sm:text-sm ${
                  isActive
                    ? 'bg-blue-600 text-white dark:bg-blue-600'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          {authed ? (
            <Link
              href={ROUTES.home}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <UserCircle className="h-3.5 w-3.5" />
              Main app
            </Link>
          ) : (
            <Link
              href={loginWithRedirect(P2P_HREF)}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
