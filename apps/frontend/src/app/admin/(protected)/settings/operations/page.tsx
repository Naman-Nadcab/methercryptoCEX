'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import Link from 'next/link';
import { Card, Switch, Button, Space, Row, Col, message } from 'antd';
import { Loader2, RefreshCw, Settings, Shield } from 'lucide-react';

const API_URL = getApiBaseUrl();

export default function OperationsConfigPage() {
  const { accessToken } = useAdminAuthStore();
  const [tradingHalted, setTradingHalted] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [haltRes, settingsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/admin/trading-halt`, { headers: { Authorization: `Bearer ${accessToken}` } }),
        fetch(`${API_URL}/api/v1/admin/settings`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      ]);
      const haltData = await haltRes.json();
      const settingsData = await settingsRes.json();
      if (haltData?.success && haltData?.data != null) setTradingHalted(!!haltData.data.halted);
      if (settingsData?.success && settingsData?.data) setSettings(settingsData.data);
    } catch (e) {
      console.error('Operations config fetch error', e);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleTradingHalt = async (halted: boolean) => {
    if (!accessToken) return;
    setSaving('trading');
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/trading-halt`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ halted }),
      });
      const data = await res.json();
      if (data?.success) {
        setTradingHalted(halted);
        message.success(halted ? 'Trading halted' : 'Trading resumed');
      } else {
        message.error(data?.error?.message ?? 'Failed');
      }
    } catch {
      message.error('Request failed');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">Operations Control</h1>
          <p className="text-sm admin-metric-label mt-0.5">
            Maintenance mode, spot trading, P2P, liquidity bot — dynamic control via system_settings and feature_toggles
          </p>
        </div>
        <Button type="default" icon={<RefreshCw className="w-4 h-4" />} onClick={fetchData} loading={loading}>
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 admin-accent-blue animate-spin" />
        </div>
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <Card title="Spot Trading" className="admin-card">
              <div className="flex items-center justify-between">
                <span className="admin-metric-label">Trading status</span>
                <Switch
                  checked={!tradingHalted}
                  loading={saving === 'trading'}
                  onChange={(checked) => handleTradingHalt(!checked)}
                  checkedChildren="Live"
                  unCheckedChildren="Halted"
                />
              </div>
              <p className="text-xs admin-metric-label mt-2">
                Halts all spot order placement. Uses Redis-backed flag.
              </p>
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card title="Feature Toggles" className="admin-card">
              <p className="text-sm admin-metric-label mb-3">
                Configure maintenance, P2P, deposit/withdrawal via{' '}
                <a href="/admin/settings/features" className="admin-accent-blue hover:underline">
                  Feature Flags
                </a>.
              </p>
              <Link href="/admin/settings/features">
                <Button type="primary" size="small">Manage Features</Button>
              </Link>
            </Card>
          </Col>
          <Col xs={24}>
            <Card title="System Settings" className="admin-card">
              <p className="text-sm admin-metric-label mb-3">
                Update withdrawal limits, fee tiers, and other config via{' '}
                <a href="/admin/settings" className="admin-accent-blue hover:underline">
                  System Settings
                </a>.
              </p>
              <Space>
                <Link href="/admin/settings"><Button type="default" size="small">System Settings</Button></Link>
                <Link href="/admin/fees/trading"><Button type="default" size="small">Fee Configuration</Button></Link>
              </Space>
            </Card>
          </Col>
          <Col xs={24}>
            <Card title="Liquidity Bot" className="admin-card">
              <p className="text-sm admin-metric-label">
                Liquidity bot is configured via environment variables (LIQUIDITY_BOT_ENABLED, LIQUIDITY_BOT_SPREAD_BPS, etc.).
                View current config in{' '}
                <a href="/admin/market-making" className="admin-accent-blue hover:underline">
                  Market Making
                </a>.
              </p>
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
}
