'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ChevronRight,
  Clock,
  Globe,
  Loader2,
  LogOut,
  Monitor,
  Shield,
  Smartphone,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { toast } from '@/components/ui/toaster';

interface SessionInfo {
  id: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastActiveAt: string;
  isCurrent: boolean;
}

interface ActivityEntry {
  id: string;
  type: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  details: unknown;
}

function normalizeSession(row: Record<string, unknown>): SessionInfo {
  const id = String(row.id ?? '');
  const ip = String(row.ip ?? row.ip_address ?? '—');
  const userAgent = String(row.userAgent ?? row.user_agent ?? '');
  const createdAt = String(row.createdAt ?? row.created_at ?? '');
  const lastActiveAt = String(
    row.lastActiveAt ??
      row.last_active_at ??
      row.last_activity_at ??
      row.created_at ??
      row.createdAt ??
      ''
  );
  const isCurrent = Boolean(row.isCurrent ?? row.is_current);
  return { id, ip, userAgent, createdAt, lastActiveAt, isCurrent };
}

function normalizeActivity(row: Record<string, unknown>, index: number): ActivityEntry {
  const id = row.id != null ? String(row.id) : `activity-${index}`;
  const type = String(row.type ?? row.activity_type ?? '—');
  const ip = String(row.ip ?? row.ip_address ?? '—');
  const userAgent = String(row.userAgent ?? row.user_agent ?? '');
  const createdAt = String(row.createdAt ?? row.created_at ?? '');
  const details = row.details ?? row.activity_details ?? null;
  return { id, type, ip, userAgent, createdAt, details };
}

/** Human-readable browser + OS from a User-Agent string */
function parseUserAgent(ua: string): { label: string; isMobile: boolean } {
  if (!ua || !ua.trim()) {
    return { label: 'Unknown browser', isMobile: false };
  }

  let browser = 'Unknown browser';
  if (/Edg\//.test(ua)) browser = 'Microsoft Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
  else if (/MSIE|Trident/.test(ua)) browser = 'Internet Explorer';

  let os = '';
  if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1))
    os = 'iPad';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/Linux/.test(ua)) os = 'Linux';
  else if (/CrOS/.test(ua)) os = 'Chrome OS';

  const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  const label = os ? `${browser} · ${os}` : browser;
  return { label, isMobile };
}

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatActivityType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractLocation(details: unknown): string {
  if (!details || typeof details !== 'object') return '—';
  const d = details as Record<string, unknown>;
  const city =
    (typeof d.city === 'string' && d.city) ||
    (typeof d.location_city === 'string' && d.location_city) ||
    '';
  const country =
    (typeof d.country === 'string' && d.country) ||
    (typeof d.location_country === 'string' && d.location_country) ||
    (typeof d.country_code === 'string' && d.country_code) ||
    '';
  if (city && country) return `${city}, ${country}`;
  if (country) return country;
  if (city) return city;
  if (typeof d.location === 'string' && d.location) return d.location;
  return '—';
}

function isSuspiciousActivityType(type: string): boolean {
  const t = type.toLowerCase();
  return (
    t.includes('login_failed') ||
    t.includes('failed_login') ||
    t === 'access_blocked' ||
    t.includes('unauthorized') ||
    t.includes('brute')
  );
}

export default function SecuritySessionsPage() {
  const { accessToken } = useAuthStore();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [terminating, setTerminating] = useState(false);

  const loadData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [sessionsRes, activityRes] = await Promise.all([
        api.get<SessionInfo[] | Record<string, unknown>[]>('/api/v1/user/sessions', { notifyOnError: false }),
        api.get<ActivityEntry[] | Record<string, unknown>[]>('/api/v1/user/activity', { notifyOnError: false }),
      ]);

      if (sessionsRes.success && Array.isArray(sessionsRes.data)) {
        setSessions(
          (sessionsRes.data as Record<string, unknown>[]).map((row) => normalizeSession(row))
        );
      } else {
        setSessions([]);
        if (!sessionsRes.success && sessionsRes.error?.message) {
          toast({ title: 'Sessions', description: sessionsRes.error.message, variant: 'destructive' });
        }
      }

      if (activityRes.success && Array.isArray(activityRes.data)) {
        setActivity(
          (activityRes.data as Record<string, unknown>[]).map((row, i) => normalizeActivity(row, i))
        );
      } else {
        setActivity([]);
        if (!activityRes.success && activityRes.error?.message) {
          toast({ title: 'Activity', description: activityRes.error.message, variant: 'destructive' });
        }
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const otherSessionCount = useMemo(
    () => sessions.filter((s) => !s.isCurrent).length,
    [sessions]
  );

  const handleLogoutAllOther = async () => {
    if (otherSessionCount === 0) return;
    setTerminating(true);
    try {
      const res = await api.post('/api/v1/auth/logout-all-other', undefined, { notifyOnError: false });
      if (res.success) {
        toast({
          title: 'Sessions ended',
          description: 'All other devices have been signed out.',
          variant: 'success',
        });
        await loadData();
      } else if (res.error?.message) {
        toast({ title: 'Could not sign out', description: res.error.message, variant: 'destructive' });
      }
    } finally {
      setTerminating(false);
    }
  };

  if (!accessToken) {
    return (
      <div className="flex min-h-[400px] items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Please sign in to manage sessions.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4 lg:p-6">
      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/security" className="hover:text-primary">
          Security
        </Link>
        <ChevronRight className="h-4 w-4 shrink-0" />
        <span className="text-foreground">Sessions &amp; devices</span>
      </div>

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Sessions &amp; devices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            See where you&apos;re signed in and review recent account activity.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleLogoutAllOther()}
          disabled={terminating || loading || otherSessionCount === 0}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          {terminating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="h-4 w-4 text-muted-foreground" />
          )}
          Terminate all other sessions
        </button>
      </div>

      <section className="mb-10">
        <div className="mb-4 flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Active sessions</h2>
        </div>

        {loading ? (
          <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-border bg-card">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            No active sessions found.
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {sessions.map((session) => {
              const { label, isMobile } = parseUserAgent(session.userAgent);
              const DeviceIcon = isMobile ? Smartphone : Monitor;
              return (
                <li
                  key={session.id}
                  className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-primary">
                        <DeviceIcon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground">{label}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Globe className="h-3.5 w-3.5 shrink-0" />
                            {session.ip}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5 shrink-0" />
                            Last active {formatDateTime(session.lastActiveAt || session.createdAt)}
                          </span>
                          {session.createdAt && (
                            <span>Signed in {formatDateTime(session.createdAt)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {session.isCurrent && (
                      <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-primary">
                        Current
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-4 flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Recent login activity</h2>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 font-medium text-foreground">Date</th>
                  <th className="px-4 py-3 font-medium text-foreground">Activity type</th>
                  <th className="px-4 py-3 font-medium text-foreground">IP address</th>
                  <th className="px-4 py-3 font-medium text-foreground">Device / browser</th>
                  <th className="px-4 py-3 font-medium text-foreground">Location</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-16 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
                    </td>
                  </tr>
                ) : activity.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                      No activity recorded yet.
                    </td>
                  </tr>
                ) : (
                  activity.map((row) => {
                    const suspicious = isSuspiciousActivityType(row.type);
                    const { label } = parseUserAgent(row.userAgent);
                    const location = extractLocation(row.details);
                    const rowClass = suspicious ? 'text-sell' : 'text-foreground';
                    return (
                      <tr key={row.id} className="border-b border-border last:border-0">
                        <td className={`px-4 py-3 ${rowClass}`}>
                          <span className="inline-flex items-center gap-1.5">
                            {suspicious && (
                              <AlertTriangle className="h-4 w-4 shrink-0 text-sell" aria-hidden />
                            )}
                            {formatDateTime(row.createdAt)}
                          </span>
                        </td>
                        <td className={`px-4 py-3 font-medium ${rowClass}`}>
                          {formatActivityType(row.type)}
                        </td>
                        <td className={`px-4 py-3 ${rowClass}`}>{row.ip}</td>
                        <td className={`px-4 py-3 ${rowClass}`}>{label}</td>
                        <td className={`px-4 py-3 ${rowClass}`}>{location}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
