'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, ChevronRight, Loader2 } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { EmptyState } from '@/components/ui/EmptyState';

interface Announcement {
  id: string;
  title: string;
  summary: string | null;
  type: string;
  is_pinned: boolean;
  published_at: string | null;
  created_at: string;
}

export default function AnnouncementsListPage() {
  const [list, setList] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${getApiBaseUrl()}/api/v1/user/announcements?limit=50`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && data?.data?.announcements) setList(data.data.announcements);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center">
          <Bell className="w-5 h-5 text-orange-600 dark:text-orange-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Announcements</h1>
          <p className="text-sm text-muted-foreground">Latest updates and news from the platform</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No announcements"
          description="There are no announcements at the moment. Check back later for updates."
          className="bg-card rounded-xl border border-border"
        />
      ) : (
        <div className="space-y-2">
          {list.map((a) => {
            const isNew = a.is_pinned || (a.published_at && (Date.now() - new Date(a.published_at).getTime() < 7 * 24 * 60 * 60 * 1000));
            return (
              <Link
                key={a.id}
                href={`/dashboard/announcements/${a.id}`}
                className="block bg-card rounded-xl border border-border p-4 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {isNew && (
                      <span className="px-2 py-0.5 bg-red-500 text-white text-xs font-medium rounded flex-shrink-0">NEW</span>
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{a.title}</p>
                      {a.summary && <p className="text-sm text-muted-foreground truncate mt-0.5">{a.summary}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {a.published_at ? new Date(a.published_at).toLocaleDateString() : new Date(a.created_at).toLocaleDateString()}
                    </span>
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
