'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import {
  SectionHeader,
  Panel,
  ActionButton,
} from '@/components/admin/control-plane';
import { Card, Row, Col, Button, Table, message, Popconfirm } from 'antd';
import { Loader2, RefreshCw, Database, Download, RotateCcw } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface Backup {
  id: string;
  type: string;
  sizeBytes: number | null;
  status: string;
  createdAt: string;
}

export default function BackupsPage() {
  const { accessToken } = useAdminAuthStore();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  const fetchBackups = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/operational/backups`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (data?.success && data?.data?.backups) {
        setBackups(data.data.backups);
      }
    } catch {
      message.error('Failed to load backups');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchBackups();
  }, [fetchBackups]);

  const handleCreate = async () => {
    if (!accessToken) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/operational/backups/create`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        message.success('Backup created');
        fetchBackups();
      } else {
        message.error(data?.error?.message ?? 'Backup failed');
      }
    } catch {
      message.error('Request failed');
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (id: string) => {
    if (!accessToken) return;
    setRestoring(id);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/operational/backups/${id}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        message.info('Restore requested. Manual intervention required.');
      } else {
        message.error(data?.error?.message ?? 'Restore failed');
      }
    } catch {
      message.error('Request failed');
    } finally {
      setRestoring(null);
    }
  };

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      render: (v: string) => <span className="font-mono text-xs">{v.slice(0, 8)}…</span>,
    },
    { title: 'Type', dataIndex: 'type', key: 'type' },
    {
      title: 'Size',
      dataIndex: 'sizeBytes',
      key: 'sizeBytes',
      render: (v: number | null) => (v != null ? `${(v / 1024).toFixed(1)} KB` : '—'),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => (
        <span className={`px-2 py-0.5 rounded text-xs ${s === 'completed' ? 'bg-green-500/20 text-green-600' : 'bg-amber-500/20 text-amber-600'}`}>
          {s}
        </span>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: unknown, r: Backup) => (
        <Popconfirm
          title="Restore this backup?"
          description="This will request a restore. Manual intervention required."
          onConfirm={() => handleRestore(r.id)}
          okText="Restore"
          cancelText="Cancel"
        >
          <Button
            type="link"
            size="small"
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            loading={restoring === r.id}
          >
            Restore
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Backup & Recovery"
        subtitle="Create database snapshots, view backup history, and restore from backups"
        action={
          <div className="flex gap-2">
            <ActionButton
              variant="primary"
              onClick={handleCreate}
              loading={creating}
              icon={<Database className="w-4 h-4" />}
            >
              Create Snapshot
            </ActionButton>
            <ActionButton variant="secondary" onClick={fetchBackups} loading={loading} icon={<RefreshCw className="w-4 h-4" />}>
              Refresh
            </ActionButton>
          </div>
        }
      />

      <Panel title="Backup History" subtitle="Recent database snapshots">
        {loading && backups.length === 0 ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : backups.length === 0 ? (
          <p className="text-sm text-gray-500 py-8 text-center">No backups yet. Create a snapshot to get started.</p>
        ) : (
          <Table
            dataSource={backups}
            columns={columns}
            rowKey="id"
            pagination={{ pageSize: 20 }}
            size="small"
          />
        )}
      </Panel>

      <Card title="About Restore" className="admin-card">
        <p className="text-sm admin-metric-label">
          Restore initiates a restore request. In production, this should trigger your backup provider or DBA workflow.
          Full restore typically requires manual steps (pg_restore, RDS restore, etc.).
        </p>
      </Card>
    </div>
  );
}
