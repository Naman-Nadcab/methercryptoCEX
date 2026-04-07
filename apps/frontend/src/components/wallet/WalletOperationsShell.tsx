'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid,
  Download,
  Send,
  ArrowLeftRight,
  RefreshCw,
  Clock,
} from 'lucide-react';
import { walletPath } from '@/lib/routes';
import { cn } from '@/lib/utils';

export type WalletOpsNavId =
  | 'overview'
  | 'deposit'
  | 'withdraw'
  | 'transfer'
  | 'convert'
  | 'history';

const NAV_ITEMS: {
  id: WalletOpsNavId;
  label: string;
  href: string;
  icon: typeof LayoutGrid;
}[] = [
  { id: 'overview', label: 'Overview', href: walletPath.overview, icon: LayoutGrid },
  { id: 'deposit', label: 'Deposit', href: walletPath.depositCrypto, icon: Download },
  { id: 'withdraw', label: 'Withdraw', href: walletPath.withdrawCrypto, icon: Send },
  { id: 'transfer', label: 'Transfer', href: walletPath.transfer, icon: ArrowLeftRight },
  { id: 'convert', label: 'Convert', href: walletPath.convert, icon: RefreshCw },
  { id: 'history', label: 'History', href: walletPath.history, icon: Clock },
];

export function getWalletOpsActiveId(pathname: string | null): WalletOpsNavId | undefined {
  if (!pathname) return undefined;
  if (
    pathname === '/wallet' ||
    pathname === '/wallet/' ||
    pathname.startsWith('/dashboard/assets/overview')
  ) {
    return 'overview';
  }
  if (pathname.startsWith('/wallet/deposit') || pathname.startsWith('/dashboard/deposit')) {
    return 'deposit';
  }
  if (pathname.startsWith('/wallet/withdraw') || pathname.startsWith('/dashboard/withdraw')) {
    return 'withdraw';
  }
  if (pathname === '/wallet/transfer' || pathname === '/dashboard/transfer') {
    return 'transfer';
  }
  if (
    pathname.startsWith('/wallet/convert') ||
    pathname.startsWith('/dashboard/assets/convert') ||
    pathname === '/dashboard/convert'
  ) {
    return 'convert';
  }
  if (pathname.startsWith('/wallet/history') || pathname.startsWith('/dashboard/assets/history')) {
    return 'history';
  }
  return undefined;
}

type WalletOperationsShellProps = {
  title: string;
  description?: string;
  headerRight?: ReactNode;
  children: ReactNode;
};

export function WalletOperationsShell({
  title,
  description,
  headerRight,
  children,
}: WalletOperationsShellProps) {
  const pathname = usePathname();
  const activeId = getWalletOpsActiveId(pathname);

  return (
    <div className="w-full space-y-6">
      <div className="rounded-2xl border border-border bg-card/90 p-1.5 shadow-sm backdrop-blur-sm supports-[backdrop-filter]:bg-card/75">
        <nav
          className="flex gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Wallet"
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeId === item.id;
            return (
              <Link
                key={item.id}
                href={item.href}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary/12 text-primary shadow-sm ring-1 ring-primary/15'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {headerRight ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{headerRight}</div>
        ) : null}
      </div>

      {children}
    </div>
  );
}
