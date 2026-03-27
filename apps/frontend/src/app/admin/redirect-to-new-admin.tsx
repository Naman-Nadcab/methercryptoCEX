'use client';

import { useEffect } from 'react';

const ADMIN_PANEL_URL = process.env.NEXT_PUBLIC_ADMIN_PANEL_URL || 'http://localhost:3001';

export function RedirectToNewAdmin({ to = '' }: { to?: string }) {
  useEffect(() => {
    const path = to ? `${ADMIN_PANEL_URL}/${to.replace(/^\//, '')}` : ADMIN_PANEL_URL;
    window.location.href = path;
  }, [to]);
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-slate-600">
      Redirecting to admin panel…
    </div>
  );
}
