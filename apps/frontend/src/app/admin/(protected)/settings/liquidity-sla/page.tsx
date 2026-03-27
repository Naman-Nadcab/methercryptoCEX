'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel } from '@/components/admin/control-plane';
import { Form, InputNumber, Switch, Button, message } from 'antd';
import { Loader2, Save } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface LiquiditySla {
  minDepthUsd: number;
  maxSpreadBps: number;
  enabled: boolean;
}

export default function LiquiditySlaPage() {
  const { accessToken } = useAdminAuthStore();
  const [data, setData] = useState<LiquiditySla | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/settings/liquidity-sla`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && json?.data) {
        setData(json.data);
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onFinish = async (v: LiquiditySla) => {
    if (!accessToken) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/settings/liquidity-sla`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(v),
      });
      const json = await res.json();
      if (json?.success) {
        message.success('Liquidity SLA updated');
        setData(json.data ?? data);
      } else message.error(json?.error?.message ?? 'Update failed');
    } catch {
      message.error('Request failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  const initial = data ?? { minDepthUsd: 10000, maxSpreadBps: 50, enabled: false };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Liquidity SLA"
        subtitle="Minimum depth and max spread thresholds for liquidity health. When enabled, alerts can fire when markets breach these targets."
      />
      <Panel>
        <Form layout="vertical" initialValues={initial} onFinish={onFinish}>
          <Form.Item name="enabled" label="Enable liquidity SLA monitoring" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="minDepthUsd" label="Min depth (USD)" rules={[{ required: true }]}>
            <InputNumber min={0} className="w-48" />
          </Form.Item>
          <Form.Item name="maxSpreadBps" label="Max spread (bps)" rules={[{ required: true }]}>
            <InputNumber min={0} max={10000} className="w-48" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" icon={saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} loading={saving}>
              Save
            </Button>
          </Form.Item>
        </Form>
      </Panel>
    </div>
  );
}
