'use client';

import { useState } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { Bell, Send, Loader2 } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';

export default function PushNotificationsPage() {
  const { accessToken } = useAdminAuthStore();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState<'all' | 'verified'>('all');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; totalUsers: number } | null>(null);
  const [error, setError] = useState('');

  const handleSend = async () => {
    if (!accessToken) return;
    setError('');
    if (!title.trim() || !message.trim()) {
      setError('Title and message are required.');
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const apiUrl = getApiBaseUrl();
      const res = await fetch(`${apiUrl}/api/v1/admin/notifications/push-broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ title: title.trim(), message: message.trim(), target }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setResult({ sent: data.data.sent, totalUsers: data.data.totalUsers });
        setTitle('');
        setMessage('');
      } else {
        setError(data.error?.message || 'Send failed');
      }
    } catch (e) {
      setError('Request failed');
      console.error(e);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Push Notifications</h1>
        <p className="text-gray-400 text-sm mt-1">Send in-app notifications to users (shown in the notification bell on the user dashboard).</p>
      </div>

      <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-6 max-w-xl">
        <div className="space-y-4">
          {error && <p className="text-sm text-red-500">{error}</p>}
          {result && (
            <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-400">
              Sent to {result.sent} of {result.totalUsers} users.
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
              placeholder="Notification title"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
              placeholder="Notification message"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Target</label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as 'all' | 'verified')}
              className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
            >
              <option value="all">All users</option>
              <option value="verified">Verified (active) users only</option>
            </select>
          </div>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send push notification
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 max-w-xl">
        <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
          <Bell className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          These notifications appear in the user dashboard notification bell (Binance-style). Users see them when they open the notifications dropdown or the notifications page.
        </p>
      </div>
    </div>
  );
}
