'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { ArrowLeftRight, LayoutGrid, PlusCircle, ListOrdered, CreditCard, BarChart3, UserCircle } from 'lucide-react';
import { P2P_HREF, ROUTES, loginWithRedirect } from '@/lib/routes';

const nav = [
  { href: P2P_HREF, label: 'Marketplace', icon: LayoutGrid },
  { href: `${P2P_HREF}/create-ad`, label: 'Post Ad', icon: PlusCircle },
  { href: `${P2P_HREF}/my-ads`, label: 'My Ads', icon: ArrowLeftRight },
  { href: `${P2P_HREF}/orders`, label: 'Orders', icon: ListOrdered },
  { href: `${P2P_HREF}/payment-methods`, label: 'Payments', icon: CreditCard },
  { href: `${P2P_HREF}/merchant-dashboard`, label: 'Dashboard', icon: BarChart3 },
];

export function P2PHeader() {
  const pathname = usePathname();
  const { accessToken, _hasHydrated } = useAuthStore();
  const authed = _hasHydrated && !!accessToken;

  return (
    <header className="sticky top-0 z-30 border-b border-border/40 bg-card/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <Link href={P2P_HREF} className="flex items-center gap-2 shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <ArrowLeftRight className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="hidden text-[13px] font-bold text-foreground sm:inline">P2P Trading</span>
        </Link>

        <nav className="flex items-center gap-0.5 overflow-x-auto" aria-label="P2P sections">
          {nav.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === P2P_HREF
                ? pathname === P2P_HREF
                : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors duration-150 ${
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          {authed ? (
            <Link
              href={ROUTES.home}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/40 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
            >
              <UserCircle className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Main App</span>
            </Link>
          ) : (
            <Link
              href={loginWithRedirect(P2P_HREF)}
              className="rounded-md bg-primary px-4 py-1.5 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
