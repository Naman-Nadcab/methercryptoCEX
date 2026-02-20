'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import {
  SectionHeader,
  Panel,
  DataTableContainer,
  DataTableHead,
  DataTableTh,
  DataTableBody,
  DataTableRow,
  DataTableCell,
  StatusBadge,
} from '@/components/admin/control-plane';
import { Loader2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface AdminRow {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  permissions?: string[] | null;
  is_active?: boolean;
  last_login_at?: string | null;
  created_at: string;
}

export default function RolesPage() {
  const { accessToken } = useAdminAuthStore();
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAdmins = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/admins`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Failed to load admins');
        return;
      }
      setAdmins(data?.data?.admins ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchAdmins();
  }, [fetchAdmins]);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Roles & Permissions"
        subtitle="Admin users and their roles. Permission changes are applied via backend."
      />
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-200 text-sm">{error}</div>
      )}
      <Panel title="Admin list" subtitle="Role and permissions reflect backend state. Withdrawal approval and Super Admin are enforced by backend.">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
          </div>
        ) : (
          <DataTableContainer>
            <DataTableHead>
              <DataTableRow>
                <DataTableTh>Email</DataTableTh>
                <DataTableTh>Name</DataTableTh>
                <DataTableTh>Role</DataTableTh>
                <DataTableTh>Permissions</DataTableTh>
                <DataTableTh>Active</DataTableTh>
                <DataTableTh>Last login</DataTableTh>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {admins.map((a) => (
                <DataTableRow key={a.id}>
                  <DataTableCell className="font-medium text-gray-200">{a.email}</DataTableCell>
                  <DataTableCell className="text-gray-400">{a.name ?? '—'}</DataTableCell>
                  <DataTableCell>
                    <StatusBadge variant={a.role === 'super_admin' || a.role === 'Super Admin' ? 'RISK' : 'NEUTRAL'} label={a.role} showDot />
                  </DataTableCell>
                  <DataTableCell className="text-xs text-gray-400 max-w-[200px] truncate">
                    {Array.isArray(a.permissions) && a.permissions.length ? a.permissions.join(', ') : '—'}
                  </DataTableCell>
                  <DataTableCell>
                    <StatusBadge variant={a.is_active !== false ? 'LIVE' : 'DEGRADED'} label={a.is_active !== false ? 'Yes' : 'No'} showDot />
                  </DataTableCell>
                  <DataTableCell className="text-gray-400 text-xs">
                    {a.last_login_at ? new Date(a.last_login_at).toLocaleString() : '—'}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTableContainer>
        )}
      </Panel>
    </div>
  );
}
