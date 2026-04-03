'use client';

import Link from 'next/link';
import { PiggyBank } from 'lucide-react';

export default function EarnPage() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="rounded-xl border border-border bg-card p-8 text-center shadow-sm sm:p-10">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-xl bg-muted sm:h-20 sm:w-20">
          <PiggyBank className="h-8 w-8 text-primary sm:h-10 sm:w-10" aria-hidden />
        </div>
        <span className="mb-4 inline-block rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          Coming soon
        </span>
        <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">
          Earn
        </h1>
        <p className="mx-auto mb-8 max-w-md text-sm text-muted-foreground sm:text-base">
          Flexible savings, staking, and on-chain earn products will be available
          here soon.
        </p>
        <Link
          href="/wallet/convert"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          Explore Convert
        </Link>
      </div>
    </div>
  );
}
