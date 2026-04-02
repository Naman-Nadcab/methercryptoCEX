'use client';

import Link from 'next/link';
import { ROUTES } from '@/lib/routes';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground px-4">
      <div className="text-center max-w-md">
        <h1 className="text-8xl font-bold text-primary">404</h1>
        <h2 className="text-xl font-semibold mt-2">Page not found</h2>
        <p className="text-muted-foreground mt-2">
          The page you are looking for does not exist or has been moved.
        </p>
        <div className="flex flex-wrap gap-4 justify-center mt-8">
          <Link
            href={ROUTES.home}
            className="px-5 py-2.5 bg-primary text-primary-foreground hover:bg-primary/85 rounded-lg font-medium transition-colors"
          >
            Home
          </Link>
          <Link
            href={ROUTES.login}
            className="px-5 py-2.5 border border-border hover:border-foreground/30 rounded-lg font-medium transition-colors"
          >
            Login
          </Link>
          <Link
            href={ROUTES.markets}
            className="px-5 py-2.5 border border-border hover:border-foreground/30 rounded-lg font-medium transition-colors"
          >
            Markets
          </Link>
        </div>
      </div>
    </div>
  );
}
