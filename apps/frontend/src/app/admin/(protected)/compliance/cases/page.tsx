'use client';

import { redirect } from 'next/navigation';

export default function ComplianceCasesPage() {
  redirect('/admin/compliance/alerts?status=reviewing');
}
