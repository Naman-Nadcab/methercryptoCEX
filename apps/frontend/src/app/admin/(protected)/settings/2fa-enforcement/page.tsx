'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel } from '@/components/admin/control-plane';
import { Form, Switch, Button, message } from 'antd';
import { Loader2, RefreshCw, Save } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface TwoFaPolicy {
  require2faLogin: boolean;
  require2faWithdrawal: boolean;
  require2faApiTrading: boolean;
}

export default function TwoFaEnforcementPage() {
  const { accessToken } = useAdminAuthStore();
  const [data, setData] = useState<TwoFaPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/settings/2fa-enforcement`, {
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

  const onFinish = async (v: TwoFaPolicy) => {
    if (!accessToken) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/settings/2fa-enforcement`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(v),
      });
      const json = await res.json();
      if (json?.success) {
        message.success('2FA enforcement policy updated');
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

  const initial = data ?? { require2faLogin: false, require2faWithdrawal: false, require2faApiTrading: false };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="2FA / Passkey Enforcement"
        subtitle="Require two-factor authentication for login, withdrawals, or API trading. When enabled, users must have 2FA set up and verify to perform the action."
      />
      <Panel>
        <Form
          layout="vertical"
          initialValues={initial}
          onFinish={onFinish}
        >
          <Form.Item name="require2faLogin" label="Require 2FA for login" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="require2faWithdrawal" label="Require 2FA for withdrawals" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="require2faApiTrading" label="Require 2FA for API trading" valuePropName="checked">
            <Switch />
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
