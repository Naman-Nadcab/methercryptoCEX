import { redirect } from 'next/navigation';

/**
 * Legacy route: API Settings moved to System Controls.
 * Redirect to canonical page so old bookmarks and links still work.
 */
export default function AdminSettingsApiPage() {
  redirect('/admin/system/api-settings');
}
