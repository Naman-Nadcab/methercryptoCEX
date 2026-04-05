'use client';

import { useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Info, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@/components/ui';
import { adminFetch } from '@/lib/api';
import { useAdminAuthStore } from '@/store/auth';
import { cn } from '@/lib/cn';

const EVENT_TYPES = [
  'Critical alerts',
  'Withdrawal approvals',
  'KYC submissions',
  'AML alerts',
  'System health warnings',
] as const;

const EVENT_HINTS: Record<(typeof EVENT_TYPES)[number], string> = {
  'Critical alerts': 'Exchange-wide incidents, custody anomalies, and mandatory paging events.',
  'Withdrawal approvals': 'Queue items that need human sign-off before funds move on-chain.',
  'KYC submissions': 'New or refreshed identity packets awaiting analyst review.',
  'AML alerts': 'Sanctions hits, velocity spikes, and typology matches from the risk engine.',
  'System health warnings': 'Degraded RPC, queue backlog, or latency budget breaches.',
};

const CHANNELS = ['Email alerts', 'Push notifications', 'Webhook alerts'] as const;

const CHANNEL_BLURBS: Record<(typeof CHANNELS)[number], string> = {
  'Email alerts': 'SMTP digests to verified operator inboxes. Best for compliance-friendly archival.',
  'Push notifications': 'Real-time mobile or desktop pushes for on-call responders.',
  'Webhook alerts': 'POST callbacks to your internal incident or ticketing systems.',
};

type ChannelKey = (typeof CHANNELS)[number];
type EventKey = (typeof EVENT_TYPES)[number];
type Prefs = Record<ChannelKey, Record<EventKey, boolean>>;

function buildDefaultPrefs(): Prefs {
  return {
    'Email alerts': Object.fromEntries(EVENT_TYPES.map((e) => [e, true])) as Record<EventKey, boolean>,
    'Push notifications': Object.fromEntries(EVENT_TYPES.map((e) => [e, false])) as Record<EventKey, boolean>,
    'Webhook alerts': Object.fromEntries(EVENT_TYPES.map((e) => [e, false])) as Record<EventKey, boolean>,
  };
}

function normalizePrefs(raw: unknown): Prefs {
  const base = buildDefaultPrefs();
  if (!raw || typeof raw !== 'object') return base;
  for (const ch of CHANNELS) {
    const row = (raw as Record<string, unknown>)[ch];
    if (!row || typeof row !== 'object') continue;
    for (const ev of EVENT_TYPES) {
      const v = (row as Record<string, unknown>)[ev];
      if (typeof v === 'boolean') base[ch][ev] = v;
    }
  }
  return base;
}

export default function NotificationsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'notification-prefs', token],
    queryFn: () => adminFetch('/notification-prefs', { token }),
    enabled: !!token,
  });

  const serverPrefs = normalizePrefs((data?.data as Record<string, unknown>)?.prefs);
  const [localPrefs, setLocalPrefs] = useState<Prefs | null>(null);
  const prefs = localPrefs ?? serverPrefs;

  const saveMut = useMutation({
    mutationFn: (body: Prefs) =>
      adminFetch('/notification-prefs', { method: 'PUT', body: body as unknown as Record<string, unknown>, token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'notification-prefs'] });
      setSaved(true);
      setLocalPrefs(null);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const toggle = useCallback((channel: ChannelKey, event: EventKey) => {
    setLocalPrefs((prev) => {
      const base = prev ?? serverPrefs;
      return { ...base, [channel]: { ...base[channel], [event]: !base[channel][event] } };
    });
  }, [serverPrefs]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-admin-muted">
        <Loader2 className="h-6 w-6 shrink-0 animate-spin text-admin-primary" />
        <span>Loading preferences…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-admin-text">Notifications</h1>
        <p className="text-xs text-admin-muted mt-0.5">Configure notification channels and event preferences.</p>
      </div>

      <div className="flex items-start gap-3 rounded-ds-md border border-admin-border bg-blue-50/60 px-4 py-3 text-sm text-gray-800" role="status">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-admin-info" />
        <p>Configure which events trigger notifications on each delivery channel. Preferences are saved server-side per admin.</p>
      </div>

      <div className="space-y-4">
        {CHANNELS.map((channel) => (
          <Card key={channel} compact>
            <CardHeader className="mb-3">
              <div>
                <CardTitle className="text-sm">{channel}</CardTitle>
                <p className="mt-1 text-xs leading-relaxed text-admin-muted">{CHANNEL_BLURBS[channel]}</p>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {EVENT_TYPES.map((ev) => (
                <label
                  key={`${channel}-${ev}`}
                  className={cn(
                    'flex cursor-pointer flex-col gap-1 rounded-lg border border-admin-border bg-admin-card px-3 py-2.5 text-sm',
                    'hover:border-admin-primary/40 transition-colors'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 rounded border-admin-border text-admin-primary focus:ring-admin-primary"
                      checked={prefs[channel][ev]}
                      onChange={() => toggle(channel, ev)}
                    />
                    <span className="font-medium text-gray-800">{ev}</span>
                  </span>
                  <span className="pl-6 text-xs leading-relaxed text-admin-muted">{EVENT_HINTS[ev]}</span>
                </label>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <Button type="button" onClick={() => saveMut.mutate(prefs)} loading={saveMut.isPending}>
          {saved ? 'Saved!' : 'Save Preferences'}
        </Button>
        {saved && <p className="text-sm text-admin-success" role="status" aria-live="polite">Preferences saved to server</p>}
      </div>

      <Card compact>
        <CardHeader className="mb-2">
          <CardTitle className="text-sm">Live matrix (read-only)</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead>
              <tr className="border-b border-admin-border bg-white/[0.02] text-admin-muted">
                <th className="px-3 py-2 font-semibold uppercase tracking-wide">Channel</th>
                {EVENT_TYPES.map((ev) => <th key={ev} className="px-2 py-2 font-semibold"><span className="line-clamp-2">{ev}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {CHANNELS.map((channel) => (
                <tr key={channel} className="border-b border-admin-border last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-admin-text">{channel}</td>
                  {EVENT_TYPES.map((ev) => (
                    <td key={`${channel}-${ev}`} className="px-2 py-2 text-center text-admin-text">{prefs[channel][ev] ? '✓' : '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
