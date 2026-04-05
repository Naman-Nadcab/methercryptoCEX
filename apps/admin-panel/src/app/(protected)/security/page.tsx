'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Key, Monitor, Shield, Smartphone } from 'lucide-react';
import { adminFetch } from '@/lib/api';
import { useAdminAuthStore } from '@/store/auth';
import { cn } from '@/lib/cn';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Modal, ModalFooter, TableSkeleton } from '@/components/ui';

const REFETCH_MS = 30_000;

/** Security dashboard aggregates 24h counters; active sessions use `/security/sessions?active=true` for live totals. */
type SecurityDashboard = {
  risk: { blocksLast24h: number; challengesLast24h: number };
  access: { accessBlockedLast24h: number; vpnTorDetectionsLast24h: number };
  withdrawals: { blockedBySecurity: number; pendingAdminApproval: number };
  accounts: { usersCurrentlyLocked: number; loginFailedLast24h: number; newDeviceLoginsLast24h: number };
};

type AuditLogRow = {
  id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  ip_address: string | null;
  created_at: string;
};

type SessionRow = {
  id?: string;
  admin_email?: string;
  email?: string;
  ip_address?: string;
  ip?: string;
  user_agent?: string;
  device?: string;
  created_at?: string;
};

function formatActor(row: AuditLogRow): string {
  if (row.actor_id) return `${row.actor_type} · ${row.actor_id}`;
  return row.actor_type;
}

function KpiCard({ label, value, loading }: { label: string; value: string | number; loading: boolean }) {
  return (
    <div className="rounded-xl border border-admin-border bg-admin-card p-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">{label}</p>
      <p className="mt-2 text-xl font-bold tabular-nums text-admin-text">
        {loading ? (
          <span className="inline-block h-5 w-16 animate-pulse rounded bg-white/5 align-middle" />
        ) : (
          value
        )}
      </p>
    </div>
  );
}

function TwoFactorCard() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [setupModal, setSetupModal] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disableModal, setDisableModal] = useState(false);

  const { data: statusData } = useQuery({
    queryKey: ['admin', '2fa-status', token],
    staleTime: 30_000,
    queryFn: () => adminFetch('/auth/2fa/status', { token }),
    enabled: !!token,
  });

  const is2FAEnabled = (statusData?.data as Record<string, unknown>)?.enabled === true;

  const setupMut = useMutation({
    mutationFn: () => adminFetch('/auth/2fa/setup', { method: 'POST', token }),
  });

  const verifyMut = useMutation({
    mutationFn: (code: string) => adminFetch('/auth/2fa/verify', { method: 'POST', body: { token: code }, token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', '2fa-status'] });
      setSetupModal(false);
      setVerifyCode('');
    },
  });

  const disableMut = useMutation({
    mutationFn: (code: string) => adminFetch('/auth/2fa/disable', { method: 'POST', body: { token: code }, token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', '2fa-status'] });
      setDisableModal(false);
      setDisableCode('');
    },
  });

  const setupData = setupMut.data?.data as { qrCode?: string; secret?: string } | undefined;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-4 w-4" /> Two-Factor Authentication
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-admin-muted">Manage 2FA for your admin account.</p>
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-admin-border p-3">
              <div>
                <p className="text-sm font-medium text-admin-text">Your 2FA status</p>
                <p className="text-xs text-admin-muted">TOTP-based two-factor authentication</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={is2FAEnabled ? 'success' : 'warning'}>{is2FAEnabled ? 'Enabled' : 'Disabled'}</Badge>
                {is2FAEnabled ? (
                  <Button size="sm" variant="outline" onClick={() => setDisableModal(true)}>Disable</Button>
                ) : (
                  <Button size="sm" onClick={() => { setupMut.mutate(); setSetupModal(true); }}>Enable 2FA</Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Modal open={setupModal} onClose={() => setSetupModal(false)} title="Setup Two-Factor Authentication" size="md">
        {setupMut.isPending ? (
          <p className="py-6 text-center text-sm text-admin-muted">Generating QR code...</p>
        ) : setupData?.qrCode ? (
          <div className="space-y-4">
            <p className="text-sm text-admin-muted">Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.):</p>
            <div className="flex justify-center">
              <img src={setupData.qrCode} alt="2FA QR Code" className="h-48 w-48 rounded-lg border border-admin-border" />
            </div>
            {setupData.secret && (
              <div className="rounded-lg bg-white/[0.02] p-3 text-center">
                <p className="text-xs text-admin-muted mb-1">Manual entry key:</p>
                <code className="text-sm font-mono select-all">{setupData.secret}</code>
              </div>
            )}
            <Input
              label="Enter the 6-digit code from your app"
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="text-center font-mono text-lg tracking-widest"
            />
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-admin-danger">{setupMut.error?.message ?? 'Failed to generate QR code'}</p>
        )}
        <ModalFooter className="mt-4 border-0 px-0 pb-0 pt-4">
          <Button variant="secondary" onClick={() => setSetupModal(false)}>Cancel</Button>
          <Button onClick={() => verifyMut.mutate(verifyCode)} loading={verifyMut.isPending} disabled={verifyCode.length !== 6}>
            Verify &amp; Enable
          </Button>
        </ModalFooter>
      </Modal>

      <Modal open={disableModal} onClose={() => setDisableModal(false)} title="Disable Two-Factor Authentication" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-admin-muted">Enter your current 2FA code to disable two-factor authentication. This will reduce the security of your account.</p>
          <Input
            label="2FA Code"
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            className="text-center font-mono text-lg tracking-widest"
          />
          {disableMut.isError && <p className="text-sm text-admin-danger">Invalid code. Try again.</p>}
        </div>
        <ModalFooter className="mt-4 border-0 px-0 pb-0 pt-4">
          <Button variant="secondary" onClick={() => setDisableModal(false)}>Cancel</Button>
          <Button variant="outline" onClick={() => disableMut.mutate(disableCode)} loading={disableMut.isPending} disabled={disableCode.length !== 6}>
            Disable 2FA
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}

export default function SecurityPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();

  const dashboardQ = useQuery({
    queryKey: ['admin', 'security', 'dashboard', token],
    staleTime: 30_000,
    queryFn: () => adminFetch<SecurityDashboard>('/security/dashboard', { token }),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const sessionsQ = useQuery({
    queryKey: ['admin', 'security', 'sessions-active-total', token],
    staleTime: 30_000,
    queryFn: () =>
      adminFetch<{ sessions: unknown[]; total: number }>('/security/sessions', {
        token,
        params: { active: true, limit: 1 },
      }),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const sessionsListQ = useQuery({
    queryKey: ['admin', 'security', 'sessions', token],
    staleTime: 30_000,
    queryFn: () => adminFetch('/security/sessions', { token, params: { limit: 20 } }),
    enabled: !!token,
    refetchInterval: 30000,
  });
  const sessionsData = sessionsListQ.data;

  const logsQ = useQuery({
    queryKey: ['admin', 'security', 'audit-logs', token],
    staleTime: 30_000,
    queryFn: () =>
      adminFetch<{ audit_logs: AuditLogRow[]; total: number }>('/security/audit-logs', {
        token,
        params: { limit: 50 },
      }),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const killMutation = useMutation({
    mutationFn: (sessionId: string) =>
      adminFetch(`/security/sessions/${sessionId}`, { method: 'DELETE', token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'security'] });
    },
  });

  const killSession = (id: string | undefined) => {
    if (id && confirm('Kill this session?')) killMutation.mutate(id);
  };

  const sessions = (
    sessionsData?.success && sessionsData.data != null
      ? ((sessionsData.data as { sessions?: SessionRow[] }).sessions ??
          (Array.isArray(sessionsData.data) ? (sessionsData.data as SessionRow[]) : []))
      : []
  ) as SessionRow[];

  const dash = dashboardQ.data?.success ? dashboardQ.data.data : undefined;
  const sessionsTotal = sessionsQ.data?.success ? sessionsQ.data.data?.total ?? 0 : undefined;
  const logs = logsQ.data?.success ? logsQ.data.data?.audit_logs ?? [] : [];
  const logsErr = logsQ.data?.success === false ? logsQ.data.error?.message : undefined;
  const dashLoading = dashboardQ.isLoading || dashboardQ.isFetching;
  const sessLoading = sessionsQ.isLoading || sessionsQ.isFetching;
  const logsLoading = logsQ.isLoading || logsQ.isFetching;
  const sessionsListLoading = sessionsListQ.isPending;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-admin-text">Security</h1>
        <p className="text-xs text-admin-muted mt-0.5">Monitor threats, sessions, and access controls.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Failed logins (24h)" value={dash?.accounts.loginFailedLast24h ?? '—'} loading={dashLoading} />
        <KpiCard label="Locked accounts" value={dash?.accounts.usersCurrentlyLocked ?? '—'} loading={dashLoading} />
        <KpiCard label="Active sessions" value={sessionsTotal ?? '—'} loading={sessLoading} />
        <KpiCard label="Suspicious IPs (24h)" value={dash?.access.vpnTorDetectionsLast24h ?? '—'} loading={dashLoading} />
      </div>

      {(dashboardQ.data?.success === false || sessionsQ.data?.success === false) && (
        <p className="text-sm text-admin-danger">
          {dashboardQ.data?.success === false && (dashboardQ.data.error?.message ?? 'Dashboard failed to load.')}
          {sessionsQ.data?.success === false && (sessionsQ.data.error?.message ?? ' Sessions count unavailable.')}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent security events</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {logsLoading ? (
            <div className="px-6 py-6">
              <TableSkeleton rows={3} cols={4} />
            </div>
          ) : logsErr ? (
            <p className="px-6 py-10 text-center text-sm text-admin-danger">{logsErr}</p>
          ) : logs.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-admin-muted">No security events in the selected window.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead>
                  <tr className="border-b border-admin-border bg-white/[0.02]">
                    <th className="px-4 py-2.5 font-medium text-admin-muted">Timestamp</th>
                    <th className="px-4 py-2.5 font-medium text-admin-muted">Actor</th>
                    <th className="px-4 py-2.5 font-medium text-admin-muted">Action</th>
                    <th className="px-4 py-2.5 font-medium text-admin-muted">IP</th>
                    <th className="px-4 py-2.5 font-medium text-admin-muted">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((row) => (
                    <tr key={row.id} className="border-b border-admin-border/50 last:border-0 hover:bg-white/5">
                      <td className="whitespace-nowrap px-4 py-2.5 text-admin-muted">
                        {new Date(row.created_at).toLocaleString()}
                      </td>
                      <td className="max-w-[200px] px-4 py-2.5">
                        <span className="block truncate font-medium text-admin-text" title={formatActor(row)}>
                          {formatActor(row)}
                        </span>
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-2.5 text-admin-text">{row.action}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[10px] text-admin-muted">
                        {row.ip_address ?? '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="success" size="sm">Logged</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-4 w-4" /> Active Sessions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sessionsData?.success === false && (
            <p className="mb-3 text-sm text-admin-danger">{sessionsData.error?.message ?? 'Failed to load sessions.'}</p>
          )}
          {sessionsListLoading ? (
            <div className="py-4">
              <TableSkeleton rows={3} cols={4} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-admin-border text-left text-admin-muted">
                    <th className="pb-2 pr-4 font-medium">Admin</th>
                    <th className="pb-2 pr-4 font-medium">IP Address</th>
                    <th className="pb-2 pr-4 font-medium">Device</th>
                    <th className="pb-2 pr-4 font-medium">Started</th>
                    <th className="pb-2 pr-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-sm text-admin-muted">
                        No active sessions
                      </td>
                    </tr>
                  ) : (
                    sessions.map((s, i) => (
                      <tr key={s.id ?? i} className="border-b border-admin-border/50 last:border-0">
                        <td className="py-2.5 pr-4 text-xs text-admin-text">{s.admin_email ?? s.email ?? '—'}</td>
                        <td className="py-2.5 pr-4 font-mono text-xs text-admin-muted">{s.ip_address ?? s.ip ?? '—'}</td>
                        <td className="py-2.5 pr-4 text-xs text-admin-muted">
                          {s.user_agent?.slice(0, 40) ?? s.device ?? '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-xs text-admin-muted">
                          {s.created_at ? new Date(s.created_at).toLocaleString() : '—'}
                        </td>
                        <td className="py-2.5">
                          <Button
                            variant="danger"
                            size="sm"
                            loading={killMutation.isPending && killMutation.variables === s.id}
                            onClick={() => killSession(s.id)}
                          >
                            Kill
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <TwoFactorCard />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4" /> IP Whitelisting
          </CardTitle>
          <p
            className="max-w-[220px] text-right text-[10px] leading-snug text-admin-muted"
            title="Managed via ADMIN_IP_WHITELIST environment variable"
          >
            IPs are managed via{' '}
            <code className="rounded bg-white/5 px-1 py-0.5 text-[9px]">ADMIN_IP_WHITELIST</code>
          </p>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-admin-muted">Restrict admin panel access to specific IP addresses.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-admin-border text-left text-admin-muted">
                  <th className="pb-2 pr-4 font-medium">IP Address</th>
                  <th className="pb-2 pr-4 font-medium">Label</th>
                  <th className="pb-2 pr-4 font-medium">Added</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={4} className="py-6 text-center text-sm text-admin-muted">
                    IP whitelist is managed via environment variables. Use{' '}
                    <code className="rounded bg-white/5 px-1.5 py-0.5 text-xs">ADMIN_IP_WHITELIST</code> to
                    configure.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-4 w-4" /> Trusted Devices
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-admin-muted">Devices that have been verified for admin access.</p>
          <div className="rounded-lg border border-admin-border p-4 text-center text-sm text-admin-muted">
            Device trust management tracks browser fingerprints and verified devices. Data will appear once admins
            authenticate with device verification enabled.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
