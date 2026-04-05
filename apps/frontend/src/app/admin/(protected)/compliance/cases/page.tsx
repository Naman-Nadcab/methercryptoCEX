import { redirect } from 'next/navigation';

/**
 * Legacy cases route — consolidated into compliance alerts with a status filter.
 */
export default function ComplianceCasesPage() {
  redirect('/admin/compliance/alerts?status=reviewing');
}
