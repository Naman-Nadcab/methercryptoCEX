'use client';

import { useState, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel } from '@/components/admin/control-plane';
import { Input, Button, Table, message, Popconfirm } from 'antd';
import { Loader2, Search, Trash2 } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface ApiKeyRow {
  id: string;
  name: string;
  keyType: string;
  apiKeyUsage: string;
  apiKeyMasked: string;
  ipRestriction: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export default function UserApiKeysPage() {
  const { accessToken } = useAdminAuthStore();
  const [userId, setUserId] = useState('');
  const [list, setList] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async () => {
    const uid = userId.trim();
    if (!accessToken || !uid) {
      message.warning('Enter a user ID');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/users/${encodeURIComponent(uid)}/api-keys`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && Array.isArray(json?.data)) {
        setList(json.data);
      } else {
        setList([]);
        message.info(json?.error?.message ?? 'No API keys or user not found');
      }
    } catch {
      setList([]);
      message.error('Request failed');
    } finally {
      setLoading(false);
    }
  }, [accessToken, userId]);

  const revoke = async (id: string) => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/api-keys/${id}/revoke`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success) {
        message.success('API key revoked');
        search();
      } else message.error(json?.error?.message ?? 'Revoke failed');
    } catch {
      message.error('Request failed');
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="User API Keys"
        subtitle="Look up a user by ID and list or revoke their API keys."
      />
      <Panel>
        <div className="flex gap-2 mb-4">
          <Input
            placeholder="User ID (UUID)"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            onPressEnter={search}
            className="max-w-md"
          />
          <Button type="primary" icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} onClick={search} loading={loading}>
            Search
          </Button>
        </div>
        <Table
          dataSource={list}
          rowKey="id"
          size="small"
          pagination={false}
          columns={[
            { title: 'Name', dataIndex: 'name', key: 'name', width: 120 },
            { title: 'Key type', dataIndex: 'keyType', key: 'keyType', width: 100 },
            { title: 'Usage', dataIndex: 'apiKeyUsage', key: 'apiKeyUsage', width: 100 },
            { title: 'Key (masked)', dataIndex: 'apiKeyMasked', key: 'apiKeyMasked', ellipsis: true },
            { title: 'IP restriction', dataIndex: 'ipRestriction', key: 'ipRestriction', width: 120 },
            { title: 'Expires', dataIndex: 'expiresAt', key: 'expiresAt', width: 140 },
            { title: 'Created', dataIndex: 'createdAt', key: 'createdAt', width: 160 },
            {
              title: 'Action',
              key: 'action',
              width: 90,
              render: (_: unknown, row: ApiKeyRow) => (
                <Popconfirm title="Revoke this API key?" onConfirm={() => revoke(row.id)} okText="Revoke" cancelText="Cancel">
                  <Button type="link" danger size="small" icon={<Trash2 className="w-4 h-4" />} />
                </Popconfirm>
              ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}
