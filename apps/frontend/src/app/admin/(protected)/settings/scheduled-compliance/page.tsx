'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel } from '@/components/admin/control-plane';
import { Form, Switch, Input, Button, message } from 'antd';
import { Loader2, Save } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface ScheduledCompliance {
  enabled: boolean;
  cron: string;
  recipients: string[];
}

export default function ScheduledCompliancePage() {
  const { accessToken } = useAdminAuthStore();
  const [data, setData] = useState<ScheduledCompliance | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/settings/scheduled-compliance`, {
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

  const onFinish = async (v: { enabled?: boolean; cron?: string; recipients?: string }) => {
    if (!accessToken) return;
    setSaving(true);
    try {
      const recipients = typeof v.recipients === 'string' ? v.recipients.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) : [];
      const res = await fetch(`${API_URL}/api/v1/admin/settings/scheduled-compliance`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          enabled: v.enabled,
          cron: v.cron,
          recipients,
        }),
      });
      const json = await res.json();
      if (json?.success) {
        message.success('Scheduled compliance updated');
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

  const initial: ScheduledCompliance = data ?? { enabled: false, cron: '0 9 * * *', recipients: [] };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Scheduled Compliance Reports"
        subtitle="Configure cron schedule and email recipients for daily/weekly compliance report delivery."
      />
      <Panel>
        <Form layout="vertical" initialValues={{ ...initial, recipients: initial.recipients.join('\n') }} onFinish={onFinish}>
          <Form.Item name="enabled" label="Enable scheduled reports" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="cron" label="Cron expression (e.g. 0 9 * * * = daily 09:00)">
            <Input placeholder="0 9 * * *" className="max-w-xs" />
          </Form.Item>
          <Form.Item name="recipients" label="Recipients (one email per line or comma-separated)">
            <Input.TextArea rows={4} placeholder="compliance@example.com" />
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
