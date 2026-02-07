'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Bell, Loader2 } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';

interface Announcement {
  id: string;
  title: string;
  body: string | null;
  summary: string | null;
  type: string;
  is_pinned: boolean;
  published_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export default function AnnouncementDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [item, setItem] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetch(`${getApiBaseUrl()}/api/v1/user/announcements/${id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && data?.data?.announcement) setItem(data.data.announcement);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="p-4 lg:p-8 max-w-3xl mx-auto flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="p-4 lg:p-8 max-w-3xl mx-auto">
        <p className="text-gray-500 dark:text-gray-400">Announcement not found or no longer available.</p>
        <Link href="/dashboard/announcements" className="mt-4 inline-flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to announcements
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-3xl mx-auto">
      <Link
        href="/dashboard/announcements"
        className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Back to announcements
      </Link>

      <article className="bg-white dark:bg-[#181a20] rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
        <div className="p-6 lg:p-8 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs font-medium rounded capitalize">{item.type}</span>
            {item.is_pinned && <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-medium rounded">Pinned</span>}
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{item.title}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            {item.published_at ? new Date(item.published_at).toLocaleString() : new Date(item.created_at).toLocaleString()}
          </p>
        </div>
        <div className="p-6 lg:p-8">
          {item.summary && <p className="text-gray-600 dark:text-gray-300 mb-4">{item.summary}</p>}
          {item.body ? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none text-gray-700 dark:text-gray-300"
              dangerouslySetInnerHTML={{ __html: item.body }}
            />
          ) : (
            <p className="text-gray-500 dark:text-gray-400">No additional content.</p>
          )}
        </div>
      </article>
    </div>
  );
}
