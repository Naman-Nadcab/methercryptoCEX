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
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href={P2P_HREF} className="flex shrink-0 items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <ArrowLeftRight className="h-4 w-4 text-primary" />
          </div>
          <span className="hidden text-base font-bold tracking-tight text-foreground sm:inline">P2P Trading</span>
        </Link>

        <nav className="flex items-center gap-1 overflow-x-auto pb-0.5" aria-label="P2P sections">
          {nav.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === P2P_HREF
                ? pathname === P2P_HREF
                : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                  isActive
                    ? 'bg-primary/12 text-primary ring-1 ring-primary/15'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 opacity-90" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          {authed ? (
            <Link
              href={ROUTES.home}
              className="inline-flex items-center gap-2 rounded-xl border border-border/40 px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              <UserCircle className="h-4 w-4" />
              <span className="hidden sm:inline">Main App</span>
            </Link>
          ) : (
            <Link
              href={loginWithRedirect(P2P_HREF)}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
