'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Table, Tag, Button, Card, Statistic, Row, Col, Space } from 'antd';
import {
  Loader2,
  RefreshCw,
  Settings,
  Database,
  Mail,
  MessageSquare,
  Shield,
  Zap,
} from 'lucide-react';

const API_URL = getApiBaseUrl();

interface ApiSetting {
  id: string;
  category: string;
  provider: string;
  name: string;
  api_key?: string | null;
  api_url?: string | null;
  is_active: boolean;
  is_default: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  sms: 'SMS',
  email: 'Email',
  kyc: 'KYC',
  rpc: 'Blockchain RPC',
  sanctions: 'Sanctions API',
  market_data: 'Price Oracle',
  chart: 'Chart API',
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  sms: <MessageSquare className="w-4 h-4" />,
  email: <Mail className="w-4 h-4" />,
  kyc: <Shield className="w-4 h-4" />,
  rpc: <Database className="w-4 h-4" />,
  sanctions: <Shield className="w-4 h-4" />,
  market_data: <Zap className="w-4 h-4" />,
  chart: <Zap className="w-4 h-4" />,
};

export default function IntegrationsPage() {
  const { accessToken } = useAdminAuthStore();
  const [settings, setSettings] = useState<ApiSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSettings = useCallback(async (isRefresh = false) => {
    if (!accessToken) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/settings/api`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (data?.success && data?.data?.settings) {
        setSettings(data.data.settings);
      } else if (data?.success && Array.isArray(data?.data)) {
        setSettings(data.data);
      }
    } catch (e) {
      console.error('Integrations fetch error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const byCategory = settings.reduce<Record<string, ApiSetting[]>>((acc, s) => {
    const cat = s.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  const columns = [
    {
      title: 'Provider',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, r: ApiSetting) => (
        <Space>
          {CATEGORY_ICONS[r.category] ?? <Settings className="w-4 h-4" />}
          <span className="admin-metric-value">{name || r.provider}</span>
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'default'}>{active ? 'Active' : 'Inactive'}</Tag>
      ),
    },
    {
      title: 'Default',
      dataIndex: 'is_default',
      key: 'is_default',
      render: (def: boolean) => (def ? <Tag color="blue">Default</Tag> : null),
    },
    {
      title: 'API Key',
      dataIndex: 'api_key',
      key: 'api_key',
      render: (v: string | null) => (v ? '••••••••' : '—'),
    },
    {
      title: 'Action',
      key: 'action',
      render: (_: unknown, r: ApiSetting) => (
        <Link href={`/admin/system/api-settings?id=${r.id}`}>
          <Button type="link" size="small">
            Configure
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">Integrations Control Panel</h1>
          <p className="text-sm admin-metric-label mt-0.5">
            Blockchain RPC, KYC, Email, SMS, Sanctions, Price Oracle — update API keys and endpoints
          </p>
        </div>
        <Space>
          <Button
            type="default"
            icon={<RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />}
            onClick={() => fetchSettings(true)}
            loading={refreshing}
          >
            Refresh
          </Button>
          <Link href="/admin/system/api-settings">
            <Button type="primary">Manage API Settings</Button>
          </Link>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        {Object.entries(CATEGORY_LABELS).map(([cat, label]) => (
          <Col key={cat} xs={24} sm={12} lg={8}>
            <Card size="small" className="admin-card">
              <Statistic
                title={label}
                value={byCategory[cat]?.length ?? 0}
                suffix="providers"
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Card title="API Settings by Category" className="admin-card">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 admin-accent-blue animate-spin" />
          </div>
        ) : (
          <Table
            dataSource={settings}
            columns={columns}
            rowKey="id"
            pagination={false}
            size="small"
          />
        )}
      </Card>
    </div>
  );
}
