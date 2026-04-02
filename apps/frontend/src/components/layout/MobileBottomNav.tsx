'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, TrendingUp, ClipboardList, Wallet, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MARKETS_HREF, ORDERS_HREF, WALLET_HREF, P2P_HREF, LEGACY_PATH_PREFIXES } from '@/lib/routes';
import { SPOT_TRADE_HREF, isSpotTradePath } from '@/lib/tier1-canonical-routes';

const NAV_ITEMS: {
  href: string;
  label: string;
  icon: typeof BarChart3;
  active: (pathname: string) => boolean;
}[] = [
  {
    href: MARKETS_HREF,
    label: 'Markets',
    icon: BarChart3,
    active: (p) => p.startsWith(MARKETS_HREF) || p.startsWith('/markets'),
  },
  {
    href: SPOT_TRADE_HREF,
    label: 'Trade',
    icon: TrendingUp,
    active: (p) => isSpotTradePath(p),
  },
  {
    href: ORDERS_HREF,
    label: 'Orders',
    icon: ClipboardList,
    active: (p) => p.startsWith('/orders') || p.startsWith('/orders'),
  },
  {
    href: WALLET_HREF,
    label: 'Wallet',
    icon: Wallet,
    active: (p) =>
      p.startsWith('/wallet') ||
      p.startsWith('/dashboard/wallet') ||
      p.startsWith('/dashboard/deposit') ||
      p.startsWith('/dashboard/withdraw') ||
      p.startsWith('/wallet/transfer'),
  },
  {
    href: P2P_HREF,
    label: 'P2P',
    icon: Users,
    active: (p) => p.startsWith(P2P_HREF) || p.startsWith(LEGACY_PATH_PREFIXES.p2pV2),
  },
];

export function MobileBottomNav() {
  const pathname = usePathname() ?? '';

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-[60] border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-md md:hidden"
      aria-label="Primary mobile"
    >
      <div className="mx-auto flex h-14 max-w-lg items-stretch justify-around px-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon, active }) => {
          const isActive = active(pathname);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex min-h-[44px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[10px] font-medium transition-colors',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className={cn('h-5 w-5 shrink-0', isActive && 'stroke-[2.5]')} aria-hidden />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
