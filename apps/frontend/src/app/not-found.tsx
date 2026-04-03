import Link from 'next/link';
import { ArrowLeft, ArrowRightLeft, Home, LineChart, Users } from 'lucide-react';
import { ROUTES, walletPath } from '@/lib/routes';

const links = [
  { href: ROUTES.home, label: 'Home', icon: Home },
  { href: ROUTES.markets, label: 'Markets', icon: LineChart },
  { href: ROUTES.p2p, label: 'P2P', icon: Users },
  { href: walletPath.convert, label: 'Buy crypto', icon: ArrowRightLeft },
] as const;

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background px-4 py-16">
      <div className="mx-auto flex max-w-lg flex-col items-center text-center">
        <div className="w-full rounded-2xl border border-border bg-card px-8 py-12 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Error</p>
          <h1 className="mt-3 font-display text-6xl font-bold tabular-nums text-primary sm:text-7xl">404</h1>
          <h2 className="mt-2 text-xl font-semibold text-foreground">Page not found</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            The page you are looking for does not exist or may have been moved.
          </p>

          <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-3">
            <Link
              href={ROUTES.home}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to home
            </Link>
            <Link
              href={ROUTES.login}
              className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
            >
              Log in
            </Link>
          </div>

          <div className="mt-10 border-t border-border pt-8">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Popular pages</p>
            <nav className="mt-4 flex flex-col gap-2 text-left sm:mx-auto sm:max-w-xs">
              {links.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
                >
                  <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </div>
  );
}
