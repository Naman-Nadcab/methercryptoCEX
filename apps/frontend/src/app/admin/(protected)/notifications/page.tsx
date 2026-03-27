'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader } from '@/components/admin/control-plane';
import { KPICard } from '@/components/admin/v2/dashboard';
import { Loader2, Megaphone, Mail, MessageSquare } from 'lucide-react';

interface Announcement {
  id: string;
  is_published?: boolean;
  is_pinned?: boolean;
}

export default function NotificationsPage() {
  const { accessToken } = useAdminAuthStore();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    const apiUrl = getApiBaseUrl();
    fetch(`${apiUrl}/api/v1/admin/notifications/announcements`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => res.json())
      .then((result) => {
        if (result.success && result.data?.announcements) {
          setAnnouncements(result.data.announcements);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [accessToken]);

  const activeAnnouncements = announcements.filter((a) => a.is_published === true);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Notifications"
        subtitle="Manage system announcements, email and SMS templates"
      />
      {loading ? (
        <div className="flex items-center justify-center min-h-[160px]">
          <Loader2 className="w-8 h-8 text-[var(--admin-primary)] animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard title="Sent today" value="—" changeLabel="From email/SMS provider" accent="neutral" />
            <KPICard title="Delivery rate" value="—" changeLabel="From provider metrics" accent="neutral" />
            <KPICard title="Failed" value="—" changeLabel="From provider logs" accent="neutral" />
            <KPICard
              title="Active announcements"
              value={activeAnnouncements.length}
              changeLabel="Published"
              icon={<Megaphone className="w-5 h-5" />}
              href="/admin/notifications/announcements"
              accent="primary"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <Link
              href="/admin/notifications/announcements"
              className="admin-card flex items-center gap-4 p-5 rounded-xl border-2 border-[var(--admin-card-border)] bg-white hover:border-[var(--admin-primary)]/50 hover:bg-[var(--admin-primary)]/5 transition-all shadow-sm hover:shadow-md"
            >
              <div className="w-12 h-12 rounded-xl bg-[var(--admin-primary)]/15 flex items-center justify-center shrink-0">
                <Megaphone className="w-6 h-6 text-[var(--admin-primary)]" />
              </div>
              <div>
                <h3 className="font-semibold text-[var(--admin-text)]">Announcements</h3>
                <p className="text-sm text-[var(--admin-text-muted)]">Create and manage system announcements</p>
              </div>
            </Link>
            <Link
              href="/admin/notifications/email"
              className="admin-card flex items-center gap-4 p-5 rounded-xl border-2 border-[var(--admin-card-border)] bg-white hover:border-[var(--admin-primary)]/50 hover:bg-[var(--admin-primary)]/5 transition-all shadow-sm hover:shadow-md"
            >
              <div className="w-12 h-12 rounded-xl bg-[var(--admin-primary)]/15 flex items-center justify-center shrink-0">
                <Mail className="w-6 h-6 text-[var(--admin-primary)]" />
              </div>
              <div>
                <h3 className="font-semibold text-[var(--admin-text)]">Email templates</h3>
                <p className="text-sm text-[var(--admin-text-muted)]">Manage email templates</p>
              </div>
            </Link>
            <Link
              href="/admin/notifications/sms"
              className="admin-card flex items-center gap-4 p-5 rounded-xl border-2 border-[var(--admin-card-border)] bg-white hover:border-[var(--admin-primary)]/50 hover:bg-[var(--admin-primary)]/5 transition-all shadow-sm hover:shadow-md"
            >
              <div className="w-12 h-12 rounded-xl bg-[var(--admin-primary)]/15 flex items-center justify-center shrink-0">
                <MessageSquare className="w-6 h-6 text-[var(--admin-primary)]" />
              </div>
              <div>
                <h3 className="font-semibold text-[var(--admin-text)]">SMS templates</h3>
                <p className="text-sm text-[var(--admin-text-muted)]">Manage SMS templates</p>
              </div>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
