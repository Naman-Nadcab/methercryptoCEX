'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel, ActionButton } from '@/components/admin/control-plane';
import { Card, Form, Input, Button, message } from 'antd';
import { Loader2, RefreshCw, Save, TestTube } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface SanctionsConfig {
  provider: string;
  apiUrl: string;
  apiKeySet: boolean;
}

export default function SanctionsConfigPage() {
  const { accessToken } = useAdminAuthStore();
  const [config, setConfig] = useState<SanctionsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ allowed: boolean; reason?: string; provider?: string } | null>(null);
  const [form] = Form.useForm();

  const fetchConfig = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/compliance/sanctions/config`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && json?.data) {
        setConfig(json.data);
        form.setFieldsValue({
          provider: json.data.provider || 'chainalysis',
          apiUrl: json.data.apiUrl || '',
          apiKey: '', // never show existing key
        });
      }
    } catch {
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, form]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const onFinish = async (v: { provider: string; apiUrl: string; apiKey?: string }) => {
    if (!accessToken) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/compliance/sanctions/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          provider: v.provider,
          apiUrl: v.apiUrl,
          ...(v.apiKey ? { apiKey: v.apiKey } : {}),
        }),
      });
      const json = await res.json();
      if (json?.success) {
        message.success('Sanctions config saved');
        fetchConfig();
      } else message.error(json?.error?.message ?? 'Save failed');
    } catch {
      message.error('Request failed');
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    if (!accessToken) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/compliance/sanctions/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ address: '0x0000000000000000000000000000000000000001', amount: '0', asset: 'USDT' }),
      });
      const json = await res.json();
      if (json?.success && json?.data) {
        setTestResult(json.data);
        message.success(json.data.allowed ? 'Test passed (allowed)' : 'Test returned block');
      } else message.error(json?.error?.message ?? 'Test failed');
    } catch {
      message.error('Test request failed');
    } finally {
      setTesting(false);
    }
  };

  if (loading && !config) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Sanctions Provider Configuration"
        subtitle="Configure sanctions screening (Chainalysis, Elliptic, TRM). Fail-closed in production when provider is unavailable."
        action={
          <ActionButton variant="secondary" onClick={fetchConfig} loading={loading} icon={<RefreshCw className="w-4 h-4" />}>
            Refresh
          </ActionButton>
        }
      />

      <Card title="Provider settings" className="admin-card">
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="provider" label="Provider name">
            <Input placeholder="e.g. chainalysis, elliptic, trm" />
          </Form.Item>
          <Form.Item name="apiUrl" label="API URL">
            <Input placeholder="https://api.provider.com/screen" />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key (leave blank to keep existing)">
            <Input.Password placeholder="••••••••" autoComplete="off" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={saving} icon={<Save className="w-4 h-4" />}>
              Save configuration
            </Button>
          </Form.Item>
        </Form>
        {config?.apiKeySet && <p className="text-sm text-gray-500">API key is set (update above to change).</p>}
      </Card>

      <Panel title="Test connection" subtitle="Run a test screening request">
        <Button type="default" onClick={runTest} loading={testing} icon={<TestTube className="w-4 h-4" />}>
          Test sanctions check
        </Button>
        {testResult && (
          <div className="mt-4 p-3 rounded bg-gray-800">
            <p><strong>Result:</strong> {testResult.allowed ? 'Allowed' : 'Blocked'}</p>
            {testResult.reason && <p><strong>Reason:</strong> {testResult.reason}</p>}
            {testResult.provider && <p><strong>Provider:</strong> {testResult.provider}</p>}
          </div>
        )}
      </Panel>
    </div>
  );
}
