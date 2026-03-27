'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel, ActionButton } from '@/components/admin/control-plane';
import { Card, Form, Input, Button, message } from 'antd';
import { Loader2, RefreshCw, Save } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface AlertChannels {
  webhookUrl: string;
  slackWebhookUrl: string;
  pagerdutyKeySet: boolean;
}

export default function AlertChannelsPage() {
  const { accessToken } = useAdminAuthStore();
  const [data, setData] = useState<AlertChannels | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/settings/alert-channels`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && json?.data) {
        setData(json.data);
        form.setFieldsValue({
          webhookUrl: json.data.webhookUrl || '',
          slackWebhookUrl: json.data.slackWebhookUrl || '',
          pagerdutyKey: '', // never show existing
        });
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, form]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onFinish = async (v: { webhookUrl?: string; slackWebhookUrl?: string; pagerdutyKey?: string }) => {
    if (!accessToken) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/settings/alert-channels`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          webhookUrl: v.webhookUrl ?? '',
          slackWebhookUrl: v.slackWebhookUrl ?? '',
          ...(v.pagerdutyKey ? { pagerdutyKey: v.pagerdutyKey } : {}),
        }),
      });
      const json = await res.json();
      if (json?.success) {
        message.success('Alert channels updated');
        fetchData();
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

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Alert Channel Configuration"
        subtitle="Configure where circuit_open, integrity_mismatch, settlement_backlog and engine_unavailable alerts are sent"
        action={
          <ActionButton variant="secondary" onClick={fetchData} loading={loading} icon={<RefreshCw className="w-4 h-4" />}>
            Refresh
          </ActionButton>
        }
      />

      <Card title="Channels" className="admin-card">
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="webhookUrl" label="Primary webhook URL (Slack incoming webhook or generic)">
            <Input placeholder="https://hooks.slack.com/..." />
          </Form.Item>
          <Form.Item name="slackWebhookUrl" label="Slack webhook URL (optional second channel)">
            <Input placeholder="https://hooks.slack.com/..." />
          </Form.Item>
          <Form.Item name="pagerdutyKey" label="PagerDuty integration key (leave blank to keep existing)">
            <Input.Password placeholder="••••••••" autoComplete="off" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={saving} icon={<Save className="w-4 h-4" />}>
              Save
            </Button>
          </Form.Item>
        </Form>
        {data?.pagerdutyKeySet && <p className="text-sm text-gray-500">PagerDuty key is set (update above to change).</p>}
      </Card>

      <Panel title="Alert types" subtitle="These alerts use the configured channels">
        <ul className="list-disc list-inside text-sm text-gray-400">
          <li>Circuit breaker open (settlement / integrity)</li>
          <li>Integrity mismatch</li>
          <li>Matching engine unavailable</li>
          <li>Settlement backlog high</li>
        </ul>
      </Panel>
    </div>
  );
}
