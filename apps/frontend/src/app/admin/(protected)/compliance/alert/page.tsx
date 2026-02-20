'use client';

import { redirect } from 'next/navigation';

/**
 * Alert Detail: no id in URL — redirect to alerts list.
 * Detail view is at /admin/compliance/alerts/[id] when opening a row from the list.
 */
export default function ComplianceAlertLandingPage() {
  redirect('/admin/compliance/alerts');
}
