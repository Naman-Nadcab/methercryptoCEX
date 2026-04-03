'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function ConvertRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/wallet/convert');
  }, [router]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <div
          className="mx-auto mb-5 h-9 w-9 animate-spin rounded-full border-2 border-muted border-t-primary"
          aria-hidden
        />
        <p className="text-sm text-muted-foreground">Redirecting to Convert…</p>
      </div>
    </div>
  );
}
