'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable } from '@/components/admin/security/DataTable';
import { formatDateTime } from '@/lib/utils';
import {
  securityApi,
  type SessionRecord,
  type DeviceRecord,
} from '@/lib/securityApi';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;
const USER_AGENT_TRUNCATE = 40;

function getSessionStatus(row: SessionRecord): 'active' | 'revoked' | 'expired' {
  if (row.revoked_at) return 'revoked';
  const expiresAt = new Date(row.expires_at).getTime();
  if (Date.now() > expiresAt) return 'expired';
  return row.is_active ? 'active' : 'expired';
}

function truncate(str: string | null, max: number): string {
  if (!str) return '—';
  if (str.length <= max) return str;
  return `${str.slice(0, max)}…`;
}

function SessionStatusBadge({ status }: { status: 'active' | 'revoked' | 'expired' }) {
  const styles = {
    active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    revoked: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400',
    expired: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  };
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
        styles[status]
      )}
    >
      {status}
    </span>
  );
}

function TrustedBadge({ trusted }: { trusted: boolean | null }) {
  const isTrusted = trusted === true;
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
        isTrusted
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
          : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
      )}
    >
      {isTrusted ? 'Yes' : 'No'}
    </span>
  );
}

export default function SessionsAndDevicesPage() {
  const [activeTab, setActiveTab] = useState<'sessions' | 'devices'>('sessions');
  const [sessionUserId, setSessionUserId] = useState('');
  const [sessionStatusFilter, setSessionStatusFilter] = useState<string>('all');
  const [sessionOffset, setSessionOffset] = useState(0);
  const [deviceUserId, setDeviceUserId] = useState('');
  const [deviceTrustedFilter, setDeviceTrustedFilter] = useState<string>('all');
  const [deviceOffset, setDeviceOffset] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const sessionActiveParam =
    sessionStatusFilter === 'all'
      ? undefined
      : sessionStatusFilter === 'active';

  const {
    data: sessionsData,
    isLoading: sessionsLoading,
    isError: sessionsError,
    error: sessionsErrorObj,
  } = useQuery({
    queryKey: [
      'admin',
      'security',
      'sessions',
      sessionUserId.trim() || null,
      sessionActiveParam,
      sessionOffset,
    ],
    queryFn: () =>
      securityApi.sessions({
        userId: sessionUserId.trim() || undefined,
        active: sessionActiveParam,
        limit: PAGE_SIZE,
        offset: sessionOffset,
      }),
    enabled: activeTab === 'sessions',
  });

  const {
    data: devicesData,
    isLoading: devicesLoading,
    isError: devicesError,
    error: devicesErrorObj,
  } = useQuery({
    queryKey: ['admin', 'security', 'devices', deviceUserId.trim() || null, deviceOffset],
    queryFn: () =>
      securityApi.devices({
        userId: deviceUserId.trim() || undefined,
        limit: PAGE_SIZE,
        offset: deviceOffset,
      }),
    enabled: activeTab === 'devices',
  });

  const sessions = sessionsData?.sessions ?? [];
  const sessionsTotal = sessionsData?.total ?? 0;
  const devicesRaw = devicesData?.devices ?? [];
  const devicesTotal = devicesData?.total ?? 0;
  const devices =
    deviceTrustedFilter === 'all'
      ? devicesRaw
      : deviceTrustedFilter === 'trusted'
        ? devicesRaw.filter((d) => d.is_trusted === true)
        : devicesRaw.filter((d) => d.is_trusted !== true);

  const sessionColumns = useMemo(
    () => [
      {
        id: 'created_at',
        header: 'Created at',
        cell: (row: SessionRecord) => (
          <span className="text-slate-700 dark:text-slate-300">
            {formatDateTime(row.created_at)}
          </span>
        ),
      },
      {
        id: 'user_id',
        header: 'User ID',
        cell: (row: SessionRecord) => (
          <span className="font-mono text-xs">{row.user_id}</span>
        ),
      },
      {
        id: 'device_type',
        header: 'Device type',
        cell: (row: SessionRecord) => (
          <span className="capitalize">{row.device_type ?? '—'}</span>
        ),
      },
      {
        id: 'ip_address',
        header: 'IP address',
        cell: (row: SessionRecord) => (
          <span className="font-mono text-xs">{row.ip_address ?? '—'}</span>
        ),
      },
      {
        id: 'country',
        header: 'Country',
        cell: () => <span>—</span>,
      },
      {
        id: 'user_agent',
        header: 'User agent',
        cell: (row: SessionRecord) => (
          <span
            className="block max-w-[180px] truncate text-slate-600 dark:text-slate-400"
            title={row.user_agent ?? ''}
          >
            {truncate(row.user_agent, USER_AGENT_TRUNCATE)}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: (row: SessionRecord) => (
          <SessionStatusBadge status={getSessionStatus(row)} />
        ),
      },
      {
        id: 'expires_at',
        header: 'Expires at',
        cell: (row: SessionRecord) => (
          <span className="text-slate-600 dark:text-slate-400">
            {formatDateTime(row.expires_at)}
          </span>
        ),
      },
    ],
    []
  );

  const deviceColumns = useMemo(
    () => [
      {
        id: 'device_name',
        header: 'Device name',
        cell: (row: DeviceRecord) => (
          <span className="font-medium">{row.device_name ?? '—'}</span>
        ),
      },
      {
        id: 'device_type',
        header: 'Device type',
        cell: (row: DeviceRecord) => (
          <span className="capitalize">{row.device_type ?? '—'}</span>
        ),
      },
      {
        id: 'user_id',
        header: 'User ID',
        cell: (row: DeviceRecord) => (
          <span className="font-mono text-xs">{row.user_id}</span>
        ),
      },
      {
        id: 'is_trusted',
        header: 'Trusted',
        cell: (row: DeviceRecord) => <TrustedBadge trusted={row.is_trusted} />,
      },
      {
        id: 'first_seen_at',
        header: 'First seen',
        cell: (row: DeviceRecord) => (
          <span className="text-slate-600 dark:text-slate-400">
            {row.first_seen_at ? formatDateTime(row.first_seen_at) : '—'}
          </span>
        ),
      },
      {
        id: 'last_seen_at',
        header: 'Last seen',
        cell: (row: DeviceRecord) => (
          <span className="text-slate-600 dark:text-slate-400">
            {row.last_seen_at ? formatDateTime(row.last_seen_at) : '—'}
          </span>
        ),
      },
      {
        id: 'ip_address',
        header: 'IP address',
        cell: (row: DeviceRecord) => (
          <span className="font-mono text-xs">{row.ip_address ?? '—'}</span>
        ),
      },
      {
        id: 'location_country',
        header: 'Country',
        cell: (row: DeviceRecord) => (
          <span>{row.location_country ?? '—'}</span>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
          Sessions &amp; Devices
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Investigate user sessions and devices (read-only)
        </p>
      </header>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'sessions' | 'devices')}>
        <TabsList className="grid w-full max-w-[240px] grid-cols-2">
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="devices">Devices</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                User ID
              </label>
              <Input
                placeholder="Filter by user"
                className="w-48 font-mono text-sm"
                value={sessionUserId}
                onChange={(e) => {
                  setSessionUserId(e.target.value);
                  setSessionOffset(0);
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Status
              </label>
              <Select
                value={sessionStatusFilter}
                onValueChange={(v) => {
                  setSessionStatusFilter(v);
                  setSessionOffset(0);
                }}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="revoked">Revoked</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {sessionsError && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200">
              {sessionsErrorObj instanceof Error
                ? sessionsErrorObj.message
                : 'Failed to load sessions'}
            </div>
          )}

          {sessionsLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 py-12">
              <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
              <span className="text-sm text-slate-500">Loading sessions…</span>
            </div>
          ) : (
            <>
              <DataTable<SessionRecord>
                columns={sessionColumns}
                data={sessions}
                keyExtractor={(row) => row.id}
                emptyMessage="No sessions found"
                onRowClick={(row) => setSelectedSessionId(row.id)}
                getRowClassName={(row) =>
                  row.id === selectedSessionId
                    ? 'bg-slate-100 dark:bg-slate-800'
                    : ''
                }
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Showing {sessions.length} of {sessionsTotal} session{sessionsTotal !== 1 ? 's' : ''}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSessionOffset((o) => Math.max(0, o - PAGE_SIZE))}
                    disabled={sessionOffset === 0}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSessionOffset((o) => o + PAGE_SIZE)}
                    disabled={sessionOffset + sessions.length >= sessionsTotal}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="devices" className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                User ID
              </label>
              <Input
                placeholder="Filter by user"
                className="w-48 font-mono text-sm"
                value={deviceUserId}
                onChange={(e) => {
                  setDeviceUserId(e.target.value);
                  setDeviceOffset(0);
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Trusted
              </label>
              <Select
                value={deviceTrustedFilter}
                onValueChange={(v) => {
                  setDeviceTrustedFilter(v);
                  setDeviceOffset(0);
                }}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="trusted">Trusted</SelectItem>
                  <SelectItem value="untrusted">Untrusted</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {devicesError && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200">
              {devicesErrorObj instanceof Error
                ? devicesErrorObj.message
                : 'Failed to load devices'}
            </div>
          )}

          {devicesLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 py-12">
              <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
              <span className="text-sm text-slate-500">Loading devices…</span>
            </div>
          ) : (
            <>
              <DataTable<DeviceRecord>
                columns={deviceColumns}
                data={devices}
                keyExtractor={(row) => row.id}
                emptyMessage="No devices found"
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {deviceTrustedFilter === 'all'
                    ? `Showing ${devices.length} of ${devicesTotal} device${devicesTotal !== 1 ? 's' : ''}`
                    : `Showing ${devices.length} device${devices.length !== 1 ? 's' : ''} (filtered)`}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeviceOffset((o) => Math.max(0, o - PAGE_SIZE))}
                    disabled={deviceOffset === 0}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeviceOffset((o) => o + PAGE_SIZE)}
                    disabled={
                      deviceOffset + devicesRaw.length >= devicesTotal ||
                      devicesRaw.length < PAGE_SIZE
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
