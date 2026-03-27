'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Admin Audit Trail: redirects to audit logs with actorType=admin filter.
 */
export default function AdminAuditPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/security/audit-logs?actorType=admin');
  }, [router]);
  return (
    <div className="flex items-center justify-center min-h-[300px]">
      <p className="text-gray-400">Redirecting to Admin Audit Trail…</p>
    </div>
  );
}
