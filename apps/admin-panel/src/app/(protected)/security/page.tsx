'use client';

import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Globe, Key, Monitor, Plus, Shield, Smartphone, Trash2 } from 'lucide-react';
import { adminFetch, formatAdminError } from '@/lib/api';
import { useAdminAuthStore } from '@/store/auth';
import { cn } from '@/lib/cn';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Modal, ModalFooter, TableSkeleton } from '@/components/ui';

const REFETCH_MS = 30_000;
const ADMIN_SESSIONS_ENDPOINT = '/admin-sessions';
const SECURITY_LOG_PAGE_SIZE = 20;

/** Security dashboard aggregates 24h counters; session controls use a single admin-sessions endpoint path. */
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
  admin_name?: string;
  email?: string;
  ip_address?: string;
  ip?: string;
  user_agent?: string;
  device?: string;
  created_at?: string;
  expires_at?: string;
};

type IpRule = {
  id: string;
  ip: string;
  label?: string;
  enabled: boolean;
  created_at?: string;
};

type DeviceRow = {
  id: string;
  user_id: string;
  device_name: string | null;
  device_type: string | null;
  is_trusted: boolean | null;
  last_seen_at: string | null;
  ip_address: string | null;
  location_country: string | null;
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
          <p className="py-6 text-center text-sm text-admin-danger">{formatAdminError(setupMut.error, 'Failed to generate QR code')}</p>
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
          {disableMut.isError && <p className="text-sm text-admin-danger">{formatAdminError(disableMut.error, 'Invalid code. Try again.')}</p>}
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
  const [logsPage, setLogsPage] = useState(1);

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
      adminFetch<{ sessions: unknown[]; total: number }>(ADMIN_SESSIONS_ENDPOINT, {
        token,
        params: { active: true, limit: 1 },
      }),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const sessionsListQ = useQuery({
    queryKey: ['admin', 'security', 'sessions', token],
    staleTime: 30_000,
    queryFn: () => adminFetch(ADMIN_SESSIONS_ENDPOINT, { token, params: { limit: 20 } }),
    enabled: !!token,
    refetchInterval: 30000,
  });
  const sessionsData = sessionsListQ.data;

  const devicesQ = useQuery({
    queryKey: ['admin', 'security', 'devices', token],
    staleTime: 30_000,
    queryFn: () => adminFetch<{ devices: DeviceRow[]; total: number }>('/security/devices', { token, params: { limit: 20 } }),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const logsQ = useQuery({
    queryKey: ['admin', 'security', 'audit-logs', token, logsPage],
    staleTime: 30_000,
    queryFn: () =>
      adminFetch<{ audit_logs: AuditLogRow[]; total: number }>('/security/audit-logs', {
        token,
        params: { limit: SECURITY_LOG_PAGE_SIZE, offset: (logsPage - 1) * SECURITY_LOG_PAGE_SIZE },
      }),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const killMutation = useMutation({
    mutationFn: (sessionId: string) =>
      adminFetch(`${ADMIN_SESSIONS_ENDPOINT}/${sessionId}`, { method: 'DELETE', token, body: {} }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'security', 'sessions'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'security', 'sessions-active-total'] });
    },
  });

  const killSession = (id: string | undefined) => {
    if (id) setKillConfirmId(id);
  };

  /* ── IP Rules ── */
  const [addIpModal,        setAddIpModal]        = useState(false);
  const [newIp,             setNewIp]             = useState('');
  const [newLabel,          setNewLabel]          = useState('');
  const [killConfirmId,     setKillConfirmId]     = useState<string | null>(null);
  const [deleteIpConfirmId, setDeleteIpConfirmId] = useState<string | null>(null);

  const ipRulesQ = useQuery({
    queryKey: ['admin', 'security', 'ip-rules', token],
    queryFn: () => adminFetch<{ rules: IpRule[] } | IpRule[]>('/security/ip-rules', { token }),
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });

  const ipRules: IpRule[] = ipRulesQ.data?.success
    ? (Array.isArray(ipRulesQ.data.data) ? ipRulesQ.data.data : (ipRulesQ.data.data as { rules?: IpRule[] })?.rules ?? [])
    : [];

  const addIpRuleMut = useMutation({
    mutationFn: (body: { ip: string; label?: string }) =>
      adminFetch('/security/ip-rules', { method: 'POST', body, token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'security', 'ip-rules'] });
      setAddIpModal(false);
      setNewIp('');
      setNewLabel('');
    },
  });

  const toggleIpRuleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      adminFetch(`/security/ip-rules/${id}`, { method: 'PATCH', body: { enabled }, token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'security', 'ip-rules'] });
    },
  });

  const deleteIpRuleMut = useMutation({
    mutationFn: (id: string) =>
      adminFetch(`/security/ip-rules/${id}`, { method: 'DELETE', token, body: {} }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'security', 'ip-rules'] });
    },
  });

  const handleAddIpRule = useCallback(() => {
    const trimmed = newIp.trim();
    if (!trimmed) return;
    addIpRuleMut.mutate({ ip: trimmed, label: newLabel.trim() || undefined });
  }, [newIp, newLabel, addIpRuleMut]);

  const sessions = (
    sessionsData?.success && sessionsData.data != null
      ? ((sessionsData.data as { sessions?: SessionRow[] }).sessions ??
          (Array.isArray(sessionsData.data) ? (sessionsData.data as SessionRow[]) : []))
      : []
  ) as SessionRow[];

  const dash = dashboardQ.data?.success ? dashboardQ.data.data : undefined;
  const sessionsTotal = sessionsQ.data?.success ? sessionsQ.data.data?.total ?? 0 : undefined;
  const logs = logsQ.data?.success ? logsQ.data.data?.audit_logs ?? [] : [];
  const logsTotal = logsQ.data?.success ? Number(logsQ.data.data?.total ?? 0) : 0;
  const logsTotalPages = Math.max(1, Math.ceil(logsTotal / SECURITY_LOG_PAGE_SIZE));
  const devices = devicesQ.data?.success ? devicesQ.data.data?.devices ?? [] : [];
  const suspiciousDevices = devices.filter((d) => d.is_trusted === false);
  const logsErr = logsQ.data?.success === false ? logsQ.data.error?.message : undefined;
  const dashLoading = dashboardQ.isLoading || dashboardQ.isFetching;
  const sessLoading = sessionsQ.isLoading || sessionsQ.isFetching;
  const logsLoading = logsQ.isLoading || logsQ.isFetching;
  const sessionsListLoading = sessionsListQ.isPending;

  return (
    <AdminPageFrame title="Security" description="Monitor threats, sessions, and access controls." status="active" error={dashboardQ.data?.success === false ? (dashboardQ.data.error?.message ?? 'Dashboard failed to load.') : null} onRetry={dashboardQ.refetch}>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Failed logins (24h)" value={dash?.accounts.loginFailedLast24h ?? '—'} loading={dashLoading} />
        <KpiCard label="Locked accounts" value={dash?.accounts.usersCurrentlyLocked ?? '—'} loading={dashLoading} />
        <KpiCard label="Active sessions" value={sessionsTotal ?? '—'} loading={sessLoading} />
        <KpiCard label="Suspicious devices" value={suspiciousDevices.length} loading={devicesQ.isLoading || devicesQ.isFetching} />
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
        {!logsLoading && logs.length > 0 && logsTotalPages > 1 && (
          <div className="flex items-center justify-between border-t border-admin-border/50 px-4 py-3 text-xs text-admin-muted">
            <span>
              {((logsPage - 1) * SECURITY_LOG_PAGE_SIZE) + 1}-{Math.min(logsPage * SECURITY_LOG_PAGE_SIZE, logsTotal)} of {logsTotal.toLocaleString()}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setLogsPage((p) => Math.max(1, p - 1))}
                disabled={logsPage <= 1}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-admin-border/40 disabled:opacity-30 hover:bg-white/5"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span>Page {logsPage} / {logsTotalPages}</span>
              <button
                type="button"
                onClick={() => setLogsPage((p) => Math.min(logsTotalPages, p + 1))}
                disabled={logsPage >= logsTotalPages}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-admin-border/40 disabled:opacity-30 hover:bg-white/5"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-4 w-4" /> Active Sessions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sessionsData?.success === false && (
            <p className="mb-3 text-sm text-admin-danger">{formatAdminError(sessionsData.error, 'Failed to load sessions.')}</p>
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
                    <th className="pb-2 pr-4 font-medium">Login Time</th>
                    <th className="pb-2 pr-4 font-medium">Expires</th>
                    <th className="pb-2 pr-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-sm text-admin-muted">
                        No active sessions
                      </td>
                    </tr>
                  ) : (
                    sessions.map((s, i) => (
                      <tr key={s.id ?? i} className="border-b border-admin-border/50 last:border-0">
                        <td className="py-2.5 pr-4 text-xs">
                          <span className="block text-admin-text">{s.admin_name ?? s.admin_email ?? s.email ?? '—'}</span>
                          {s.admin_name && (s.admin_email ?? s.email) && (
                            <span className="block text-[10px] text-admin-muted">{s.admin_email ?? s.email}</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-xs text-admin-muted">{s.ip_address ?? s.ip ?? '—'}</td>
                        <td className="py-2.5 pr-4 text-xs text-admin-muted max-w-[200px] truncate" title={s.user_agent ?? s.device ?? ''}>
                          {s.user_agent?.slice(0, 50) ?? s.device ?? '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-xs text-admin-muted whitespace-nowrap">
                          {s.created_at ? new Date(s.created_at).toLocaleString() : '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-xs text-admin-muted whitespace-nowrap">
                          {s.expires_at ? new Date(s.expires_at).toLocaleString() : '—'}
                        </td>
                        <td className="py-2.5">
                          <Button
                            variant="danger"
                            size="sm"
                            loading={killMutation.isPending && killMutation.variables === s.id}
                            onClick={() => killSession(s.id)}
                          >
                            Force Logout
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
          <Button size="sm" onClick={() => setAddIpModal(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Rule
          </Button>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-admin-muted">Restrict admin panel access to specific IP addresses.</p>

          {ipRulesQ.data?.success === false && (
            <p className="mb-3 text-sm text-admin-danger">{formatAdminError(ipRulesQ.data.error, 'Failed to load IP rules.')}</p>
          )}

          {ipRulesQ.isPending ? (
            <div className="py-4"><TableSkeleton rows={3} cols={4} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-admin-border text-left text-admin-muted">
                    <th className="pb-2 pr-4 font-medium">IP Address</th>
                    <th className="pb-2 pr-4 font-medium">Label</th>
                    <th className="pb-2 pr-4 font-medium">Added</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ipRules.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-sm text-admin-muted">
                        No IP rules configured. Click &quot;Add Rule&quot; to restrict access.
                      </td>
                    </tr>
                  ) : (
                    ipRules.map((rule) => (
                      <tr key={rule.id} className="border-b border-admin-border/50 last:border-0">
                        <td className="py-2.5 pr-4 font-mono text-xs text-admin-text">{rule.ip}</td>
                        <td className="py-2.5 pr-4 text-xs text-admin-muted">{rule.label || '—'}</td>
                        <td className="py-2.5 pr-4 text-xs text-admin-muted whitespace-nowrap">
                          {rule.created_at ? new Date(rule.created_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="py-2.5 pr-4">
                          <button
                            type="button"
                            onClick={() => toggleIpRuleMut.mutate({ id: rule.id, enabled: !rule.enabled })}
                            className={cn(
                              'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-primary',
                              rule.enabled ? 'bg-emerald-600' : 'bg-white/10',
                            )}
                            aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
                          >
                            <span
                              className={cn(
                                'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                                rule.enabled ? 'translate-x-4' : 'translate-x-0',
                              )}
                            />
                          </button>
                        </td>
                        <td className="py-2.5">
                          <Button
                            variant="danger"
                            size="sm"
                            loading={deleteIpRuleMut.isPending && deleteIpRuleMut.variables === rule.id}
                            onClick={() => setDeleteIpConfirmId(rule.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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

      <Modal open={addIpModal} onClose={() => setAddIpModal(false)} title="Add IP Rule" size="sm">
        <div className="space-y-4">
          <Input
            label="IP Address or CIDR"
            value={newIp}
            onChange={(e) => setNewIp(e.target.value)}
            placeholder="e.g. 203.0.113.0/24"
          />
          <Input
            label="Label (optional)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="e.g. Office VPN"
          />
          {addIpRuleMut.isError && (
            <p className="text-sm text-admin-danger">{formatAdminError(addIpRuleMut.error, 'Failed to add rule.')}</p>
          )}
        </div>
        <ModalFooter className="mt-4 border-0 px-0 pb-0 pt-4">
          <Button variant="secondary" onClick={() => setAddIpModal(false)}>Cancel</Button>
          <Button onClick={handleAddIpRule} loading={addIpRuleMut.isPending} disabled={!newIp.trim()}>
            Add Rule
          </Button>
        </ModalFooter>
      </Modal>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-4 w-4" /> Trusted Devices
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-admin-muted">Recent devices with trust state and geo hint.</p>
          {devicesQ.data?.success === false ? (
            <p className="text-sm text-admin-danger">{formatAdminError(devicesQ.data.error, 'Failed to load devices.')}</p>
          ) : devicesQ.isPending ? (
            <TableSkeleton rows={3} cols={5} />
          ) : devices.length === 0 ? (
            <div className="rounded-lg border border-admin-border p-4 text-center text-sm text-admin-muted">
              No device records yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-admin-border text-left text-admin-muted">
                    <th className="pb-2 pr-4 font-medium">Device</th>
                    <th className="pb-2 pr-4 font-medium">Trust</th>
                    <th className="pb-2 pr-4 font-medium">IP</th>
                    <th className="pb-2 pr-4 font-medium">Country</th>
                    <th className="pb-2 pr-4 font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => (
                    <tr key={d.id} className="border-b border-admin-border/50 last:border-0">
                      <td className="py-2.5 pr-4 text-xs text-admin-text">
                        {d.device_name ?? d.device_type ?? 'Unknown device'}
                      </td>
                      <td className="py-2.5 pr-4">
                        <Badge variant={d.is_trusted === false ? 'danger' : 'success'} size="sm">
                          {d.is_trusted === false ? 'Untrusted' : 'Trusted'}
                        </Badge>
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-admin-muted">{d.ip_address ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-xs text-admin-muted">{d.location_country ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-xs text-admin-muted">
                        {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Force Logout Confirm Modal */}
      <Modal
        open={!!killConfirmId}
        onClose={() => !killMutation.isPending && setKillConfirmId(null)}
        title="Force Logout Session"
        size="sm"
      >
        <p className="text-sm text-admin-muted">This will immediately terminate the selected admin session. The user will be logged out and must re-authenticate.</p>
        <ModalFooter>
          <Button variant="ghost" size="sm" disabled={killMutation.isPending} onClick={() => setKillConfirmId(null)}>Cancel</Button>
          <Button variant="danger" size="sm" loading={killMutation.isPending}
            onClick={() => {
              if (killConfirmId) {
                killMutation.mutate(killConfirmId, { onSuccess: () => setKillConfirmId(null) });
              }
            }}>
            Force Logout
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete IP Rule Confirm Modal */}
      {(() => {
        const ipRulesList: IpRule[] = ipRulesQ.data?.success
          ? (Array.isArray(ipRulesQ.data.data) ? ipRulesQ.data.data : (ipRulesQ.data.data as { rules?: IpRule[] })?.rules ?? [])
          : [];
        const targetRule = ipRulesList.find((r) => r.id === deleteIpConfirmId);
        return (
          <Modal
            open={!!deleteIpConfirmId}
            onClose={() => !deleteIpRuleMut.isPending && setDeleteIpConfirmId(null)}
            title="Remove IP Rule"
            size="sm"
          >
            <p className="text-sm text-admin-muted">
              Remove IP rule for <span className="font-mono font-semibold text-admin-text">{targetRule?.ip ?? '—'}</span>
              {targetRule?.label ? <> ({targetRule.label})</> : ''}?
              Access from this IP will no longer be restricted.
            </p>
            <ModalFooter>
              <Button variant="ghost" size="sm" disabled={deleteIpRuleMut.isPending} onClick={() => setDeleteIpConfirmId(null)}>Cancel</Button>
              <Button variant="danger" size="sm" loading={deleteIpRuleMut.isPending}
                onClick={() => {
                  if (deleteIpConfirmId) {
                    deleteIpRuleMut.mutate(deleteIpConfirmId, { onSuccess: () => setDeleteIpConfirmId(null) });
                  }
                }}>
                Remove Rule
              </Button>
            </ModalFooter>
          </Modal>
        );
      })()}
    </AdminPageFrame>
  );
}
