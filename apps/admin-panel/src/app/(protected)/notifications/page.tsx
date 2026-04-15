'use client';

import { useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Info, Loader2, Send, CheckCircle2, AlertTriangle, Mail, Bell, Webhook, RefreshCw } from 'lucide-react';
import { adminFetch } from '@/lib/api';
import { useAdminAuthStore } from '@/store/auth';
import { cn } from '@/lib/cn';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';

/* ── constants ─────────────────────────────────────────────────────── */
const EVENT_TYPES = [
  'Critical alerts',
  'Withdrawal approvals',
  'KYC submissions',
  'AML alerts',
  'System health warnings',
] as const;

const EVENT_HINTS: Record<(typeof EVENT_TYPES)[number], string> = {
  'Critical alerts':          'Exchange-wide incidents, custody anomalies, and mandatory paging events.',
  'Withdrawal approvals':     'Queue items that need human sign-off before funds move on-chain.',
  'KYC submissions':          'New or refreshed identity packets awaiting analyst review.',
  'AML alerts':               'Sanctions hits, velocity spikes, and typology matches from the risk engine.',
  'System health warnings':   'Degraded RPC, queue backlog, or latency budget breaches.',
};

const CHANNELS = ['Email alerts', 'Push notifications', 'Webhook alerts'] as const;

const CHANNEL_META: Record<(typeof CHANNELS)[number], { blurb: string; icon: React.ElementType; accent: string }> = {
  'Email alerts':        { blurb: 'SMTP digests to verified operator inboxes. Best for compliance-friendly archival.', icon: Mail,    accent: 'blue' },
  'Push notifications':  { blurb: 'Real-time mobile or desktop pushes for on-call responders.',                        icon: Bell,    accent: 'indigo' },
  'Webhook alerts':      { blurb: 'POST callbacks to your internal incident or ticketing systems.',                    icon: Webhook, accent: 'amber' },
};

type ChannelKey = (typeof CHANNELS)[number];
type EventKey   = (typeof EVENT_TYPES)[number];
type Prefs      = Record<ChannelKey, Record<EventKey, boolean>>;

/* ── helpers ────────────────────────────────────────────────────────── */
function buildDefaultPrefs(): Prefs {
  return {
    'Email alerts':       Object.fromEntries(EVENT_TYPES.map((e) => [e, true]))  as Record<EventKey, boolean>,
    'Push notifications': Object.fromEntries(EVENT_TYPES.map((e) => [e, false])) as Record<EventKey, boolean>,
    'Webhook alerts':     Object.fromEntries(EVENT_TYPES.map((e) => [e, false])) as Record<EventKey, boolean>,
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

/* ── page ───────────────────────────────────────────────────────────── */
export default function NotificationsPage() {
  const token        = useAdminAuthStore((s) => s.accessToken);
  const queryClient  = useQueryClient();
  const [saved,       setSaved]       = useState(false);
  const [saveError,   setSaveError]   = useState('');
  const [testingCh,   setTestingCh]   = useState<ChannelKey | null>(null);
  const [testResult,  setTestResult]  = useState<{ ch: ChannelKey; ok: boolean; msg: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'notification-prefs', token],
    queryFn: () => adminFetch('/notification-prefs', { token }),
    enabled: !!token,
  });

  const serverPrefs                   = normalizePrefs((data?.data as Record<string, unknown>)?.prefs);
  const [localPrefs, setLocalPrefs]   = useState<Prefs | null>(null);
  const prefs                         = localPrefs ?? serverPrefs;
  const isDirty                       = localPrefs !== null;

  const saveMut = useMutation({
    mutationFn: (body: Prefs) =>
      adminFetch('/notification-prefs', { method: 'PUT', body: body as unknown as Record<string, unknown>, token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'notification-prefs'] });
      setSaved(true); setLocalPrefs(null); setSaveError('');
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (e: unknown) => setSaveError((e as { message?: string })?.message ?? 'Failed to save preferences.'),
  });

  const toggle = useCallback((channel: ChannelKey, event: EventKey) => {
    setLocalPrefs((prev) => {
      const base = prev ?? serverPrefs;
      return { ...base, [channel]: { ...base[channel], [event]: !base[channel][event] } };
    });
    setSaved(false);
  }, [serverPrefs]);

  const handleTestSend = async (channel: ChannelKey) => {
    setTestingCh(channel);
    setTestResult(null);
    try {
      await adminFetch('/notification-prefs/test', { method: 'POST', token, body: { channel } });
      setTestResult({ ch: channel, ok: true, msg: `Test ${channel.toLowerCase()} sent successfully.` });
    } catch (e: unknown) {
      setTestResult({ ch: channel, ok: false, msg: (e as { message?: string })?.message ?? 'Test send failed.' });
    } finally {
      setTestingCh(null);
    }
  };

  const enabledCount = (ch: ChannelKey) => EVENT_TYPES.filter((ev) => prefs[ch][ev]).length;

  return (
    <AdminPageFrame
      title="Notifications"
      description="Configure notification channels and event routing preferences."
    >
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-admin-muted">
          <Loader2 className="h-6 w-6 shrink-0 animate-spin text-admin-primary" />
          <span>Loading preferences…</span>
        </div>
      ) : (
        <>
          {/* Info banner — dark themed */}
          <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-950/10 px-4 py-3 text-sm" role="status">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
            <p className="text-blue-300/80">Configure which events trigger notifications on each delivery channel. Preferences are saved server-side per admin account. Use <strong className="text-blue-300">Test Send</strong> to verify channel connectivity before saving.</p>
          </div>

          {/* Channel cards */}
          <div className="space-y-4">
            {CHANNELS.map((channel) => {
              const meta  = CHANNEL_META[channel];
              const Icon  = meta.icon;
              const count = enabledCount(channel);
              return (
                <div key={channel} className="rounded-2xl border border-admin-border/50 bg-admin-card">
                  {/* Card header */}
                  <div className="flex items-start justify-between gap-4 border-b border-admin-border/30 px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border',
                        meta.accent === 'blue' ? 'border-blue-500/25 bg-blue-950/20 text-blue-400' :
                        meta.accent === 'indigo' ? 'border-indigo-500/25 bg-indigo-950/20 text-indigo-400' :
                        'border-amber-500/25 bg-amber-950/20 text-amber-400')}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-admin-text">{channel}</p>
                        <p className="text-[10px] text-admin-muted">{meta.blurb}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn('rounded-full border px-2.5 py-0.5 text-[10px] font-semibold',
                        count > 0 ? 'border-emerald-500/30 bg-emerald-950/15 text-emerald-400' : 'border-admin-border/40 text-admin-muted')}>
                        {count}/{EVENT_TYPES.length} events
                      </span>
                      <button type="button"
                        onClick={() => handleTestSend(channel)}
                        disabled={testingCh !== null}
                        className="flex items-center gap-1.5 rounded-lg border border-admin-border/40 px-3 py-1.5 text-[10px] font-semibold text-admin-muted hover:text-admin-text hover:border-admin-border disabled:opacity-40 transition-colors">
                        {testingCh === channel ? (
                          <><RefreshCw className="h-3 w-3 animate-spin" /> Testing…</>
                        ) : (
                          <><Send className="h-3 w-3" /> Test Send</>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Test result */}
                  {testResult?.ch === channel && (
                    <div className={cn('flex items-center gap-2 border-b border-admin-border/30 px-5 py-2 text-xs',
                      testResult.ok ? 'text-emerald-400' : 'text-red-400')}>
                      {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      {testResult.msg}
                    </div>
                  )}

                  {/* Event checkboxes */}
                  <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
                    {EVENT_TYPES.map((ev) => {
                      const checked = prefs[channel][ev];
                      return (
                        <label key={`${channel}-${ev}`}
                          className={cn('flex cursor-pointer flex-col gap-1.5 rounded-xl border px-3.5 py-3 transition-colors',
                            checked ? 'border-blue-500/30 bg-blue-950/[0.06]' : 'border-admin-border/40 bg-white/[0.015] hover:border-admin-border/60')}>
                          <span className="flex items-center gap-2">
                            <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                              checked ? 'border-blue-500 bg-blue-500' : 'border-admin-border/60 bg-transparent')}>
                              {checked && <Check className="h-2.5 w-2.5 text-white font-bold" />}
                            </span>
                            <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggle(channel, ev)} />
                            <span className="text-xs font-semibold text-admin-text">{ev}</span>
                          </span>
                          <span className="pl-6 text-[10px] leading-relaxed text-admin-muted">{EVENT_HINTS[ev]}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Save bar */}
          <div className={cn('rounded-xl border px-5 py-4 flex items-center gap-3 transition-colors',
            isDirty ? 'border-amber-500/30 bg-amber-950/10' : 'border-admin-border/50 bg-admin-card')}>
            {isDirty && <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />}
            <p className={cn('flex-1 text-xs', isDirty ? 'text-amber-400' : 'text-admin-muted')}>
              {isDirty ? 'You have unsaved changes.' : saved ? '✓ Preferences saved to server.' : 'Preferences are saved per admin account.'}
            </p>
            {isDirty && (
              <button type="button" onClick={() => setLocalPrefs(null)}
                className="text-xs text-admin-muted hover:text-admin-text underline">
                Discard
              </button>
            )}
            <button type="button"
              onClick={() => saveMut.mutate(prefs)}
              disabled={saveMut.isPending || !isDirty}
              className={cn('flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white transition-all disabled:opacity-40',
                isDirty ? 'bg-blue-600 hover:bg-blue-500' : 'bg-white/5 cursor-default')}>
              {saveMut.isPending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : saved ? <><CheckCircle2 className="h-3.5 w-3.5" /> Saved</> : 'Save Preferences'}
            </button>
          </div>
          {saveError && <p className="rounded-lg border border-red-500/25 bg-red-950/10 px-3 py-2 text-xs text-red-400">{saveError}</p>}

          {/* Live matrix */}
          <div className="rounded-2xl border border-admin-border/50 bg-admin-card p-5">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-admin-muted">Live Routing Matrix</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead>
                  <tr className="border-b border-admin-border/40">
                    <th className="pb-2 text-[10px] font-semibold uppercase tracking-wider text-admin-muted">Channel</th>
                    {EVENT_TYPES.map((ev) => (
                      <th key={ev} className="pb-2 px-3 text-[10px] font-semibold text-admin-muted">
                        <span className="line-clamp-2 leading-tight">{ev}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CHANNELS.map((channel) => (
                    <tr key={channel} className="border-b border-admin-border/25 last:border-0">
                      <td className="py-2 text-xs font-medium text-admin-text whitespace-nowrap">{channel}</td>
                      {EVENT_TYPES.map((ev) => (
                        <td key={`${channel}-${ev}`} className="py-2 px-3 text-center">
                          {prefs[channel][ev]
                            ? <span className="text-emerald-400 font-bold text-sm">✓</span>
                            : <span className="text-admin-muted/25">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </AdminPageFrame>
  );
}

function Check({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" className={className}>
      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
