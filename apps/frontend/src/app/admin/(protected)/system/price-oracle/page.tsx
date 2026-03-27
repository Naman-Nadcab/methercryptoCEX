'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel, ActionButton } from '@/components/admin/control-plane';
import { Card, Row, Col, Form, InputNumber, Input, Button } from 'antd';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, RefreshCw, Settings } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface OracleData {
  provider: string;
  updateIntervalSec: number;
  failoverProvider: string;
  maxDeviationThreshold: number;
  lastUpdate: string | null;
  lastError: string | null;
  lastLatencyMs: number | null;
  prices: Array<{ symbol: string; price: string; updated_at: string }>;
  latencySeries: Array<{ time: string; ms: number }>;
  deviationSeries: Array<{ time: string; deviation: number }>;
}

export default function PriceOraclePage() {
  const { accessToken } = useAdminAuthStore();
  const [data, setData] = useState<OracleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/oracle/status`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && json?.data) {
        setData(json.data);
        form.setFieldsValue({
          provider: json.data.provider,
          updateIntervalSec: json.data.updateIntervalSec,
          failoverProvider: json.data.failoverProvider,
          maxDeviationThreshold: json.data.maxDeviationThreshold,
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

  const onFinish = async (v: Record<string, unknown>) => {
    if (!accessToken) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/oracle/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(v),
      });
      const json = await res.json();
      if (json?.success) {
        fetchData();
      }
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

  const d = data ?? {
    provider: 'binance',
    updateIntervalSec: 60,
    failoverProvider: '',
    maxDeviationThreshold: 0.05,
    lastUpdate: null,
    lastError: null,
    lastLatencyMs: null,
    prices: [],
    latencySeries: [],
    deviationSeries: [],
  };

  const latencyData = d.latencySeries.length ? d.latencySeries : [{ time: 'Now', ms: d.lastLatencyMs ?? 0 }];
  const deviationData = d.deviationSeries.length ? d.deviationSeries : [{ time: 'Now', deviation: 0 }];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Price Oracle Control"
        subtitle="Configure oracle provider, update interval, failover, and max price deviation"
        action={
          <ActionButton variant="secondary" onClick={fetchData} loading={loading} icon={<RefreshCw className="w-4 h-4" />}>
            Refresh
          </ActionButton>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="Oracle settings" className="admin-card">
            <Form form={form} layout="vertical" onFinish={onFinish}>
              <Form.Item name="provider" label="Provider">
                <Input placeholder="e.g. binance" />
              </Form.Item>
              <Form.Item name="updateIntervalSec" label="Update interval (seconds)">
                <InputNumber min={10} max={3600} className="w-full" />
              </Form.Item>
              <Form.Item name="failoverProvider" label="Failover provider">
                <Input placeholder="Optional" />
              </Form.Item>
              <Form.Item name="maxDeviationThreshold" label="Max price deviation (e.g. 0.05 = 5%)">
                <InputNumber min={0} max={1} step={0.01} className="w-full" />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={saving} icon={<Settings className="w-4 h-4" />}>
                Save settings
              </Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="Status" className="admin-card">
            <p><strong>Last update:</strong> {d.lastUpdate ? new Date(d.lastUpdate).toLocaleString() : '—'}</p>
            <p><strong>Last latency:</strong> {d.lastLatencyMs != null ? `${d.lastLatencyMs} ms` : '—'}</p>
            {d.lastError && <p className="text-amber-600"><strong>Last error:</strong> {d.lastError}</p>}
            <div className="mt-4">
              <strong>Recent prices</strong>
              <ul className="text-sm mt-1 space-y-1">
                {d.prices.slice(0, 5).map((p, i) => (
                  <li key={i}>{p.symbol}: {p.price}</li>
                ))}
                {d.prices.length === 0 && <li className="text-gray-500">No prices</li>}
              </ul>
            </div>
          </Card>
        </Col>
      </Row>

      <Panel title="Oracle update latency" subtitle="Response time (ms)">
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={latencyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="ms" stroke="#3b82f6" name="Latency (ms)" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel title="Price deviation" subtitle="Deviation from reference">
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={deviationData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="deviation" stroke="#f59e0b" name="Deviation" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </div>
  );
}
