'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import {
  SectionHeader,
  Panel,
  ActionButton,
} from '@/components/admin/control-plane';
import { Card, Row, Col, Switch, InputNumber, Button, message } from 'antd';
import { Loader2, RefreshCw, Settings, Shield } from 'lucide-react';

const API_URL = getApiBaseUrl();

export default function SystemConfigPage() {
  const { accessToken } = useAdminAuthStore();
  const [tradingHalted, setTradingHalted] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [featureToggles, setFeatureToggles] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [haltRes, settingsRes, featuresRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/admin/trading-halt`, { headers: { Authorization: `Bearer ${accessToken}` } }),
        fetch(`${API_URL}/api/v1/admin/settings`, { headers: { Authorization: `Bearer ${accessToken}` } }),
        fetch(`${API_URL}/api/v1/admin/settings/features?limit=100`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      ]);
      const haltData = await haltRes.json();
      const settingsData = await settingsRes.json();
      const featuresData = await featuresRes.json();
      if (haltData?.success && haltData?.data != null) setTradingHalted(!!haltData.data.halted);
      if (settingsData?.success && settingsData?.data) setSettings(settingsData.data);
      if (featuresData?.success && featuresData?.data?.features) {
        const map: Record<string, boolean> = {};
        for (const f of featuresData.data.features) {
          map[f.feature_key] = f.is_enabled;
        }
        setFeatureToggles(map);
      }
    } catch (e) {
      message.error('Failed to load configuration');
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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ halted }),
      });
      const data = await res.json();
      if (data?.success) {
        setTradingHalted(halted);
        message.success(halted ? 'Trading halted' : 'Trading resumed');
      } else message.error(data?.error?.message ?? 'Failed');
    } catch {
      message.error('Request failed');
    } finally {
      setSaving(null);
    }
  };

  const handleSetting = async (key: string, value: string | number) => {
    if (!accessToken) return;
    setSaving(key);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ [key]: String(value) }),
      });
      const data = await res.json();
      if (data?.success) {
        setSettings((s) => ({ ...s, [key]: String(value) }));
        message.success('Setting updated');
      } else message.error(data?.error?.message ?? 'Failed');
    } catch {
      message.error('Request failed');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="System Configuration"
        subtitle="Maintenance mode, spot/P2P trading, liquidity bot, withdrawal limits — persisted in system_settings and feature_toggles"
        action={
          <ActionButton variant="secondary" onClick={fetchData} loading={loading} icon={<RefreshCw className="w-4 h-4" />}>
            Refresh
          </ActionButton>
        }
      />

      {loading && tradingHalted === null ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <Card title="Maintenance Mode" className="admin-card">
              <div className="flex items-center justify-between">
                <span className="admin-metric-label">Global maintenance</span>
                <Switch
                  checked={settings.MAINTENANCE_MODE === 'true'}
                  loading={saving === 'MAINTENANCE_MODE'}
                  onChange={(checked) => handleSetting('MAINTENANCE_MODE', checked ? 'true' : 'false')}
                  checkedChildren="On"
                  unCheckedChildren="Off"
                />
              </div>
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card title="Spot Trading" className="admin-card">
              <div className="flex items-center justify-between">
                <span className="admin-metric-label">Trading status</span>
                <Switch
                  checked={!tradingHalted}
                  loading={saving === 'trading'}
                  onChange={(checked) => handleTradingHalt(!checked)}
                  checkedChildren="Enabled"
                  unCheckedChildren="Halted"
                />
              </div>
              <p className="text-xs admin-metric-label mt-2">Halts all spot order placement</p>
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card title="P2P Trading" className="admin-card">
              <div className="flex items-center justify-between">
                <span className="admin-metric-label">P2P enabled</span>
                <Switch
                  checked={featureToggles['trade.p2p'] ?? featureToggles['p2p.enabled'] ?? true}
                  disabled
                  checkedChildren="On"
                  unCheckedChildren="Off"
                />
              </div>
              <p className="text-xs admin-metric-label mt-2">Manage via Feature Flags</p>
              <a href="/admin/settings/features" className="text-blue-500 text-sm hover:underline">Feature Flags →</a>
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card title="Liquidity Bot" className="admin-card">
              <div className="flex items-center justify-between">
                <span className="admin-metric-label">Bot enabled</span>
                <Switch
                  checked={settings.LIQUIDITY_BOT_ENABLED === 'true'}
                  loading={saving === 'LIQUIDITY_BOT_ENABLED'}
                  onChange={(checked) => handleSetting('LIQUIDITY_BOT_ENABLED', checked ? 'true' : 'false')}
                  checkedChildren="On"
                  unCheckedChildren="Off"
                />
              </div>
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card title="Withdrawal Limits" className="admin-card">
              <div className="space-y-2">
                <label className="block text-sm admin-metric-label">
                  Daily limit (USD)
                  <InputNumber
                    className="w-full mt-1"
                    min={0}
                    value={parseFloat(settings.WITHDRAWAL_DAILY_LIMIT_USD ?? '0') || undefined}
                    onChange={(v) => v != null && handleSetting('WITHDRAWAL_DAILY_LIMIT_USD', v)}
                    placeholder="e.g. 10000"
                  />
                </label>
                <label className="block text-sm admin-metric-label">
                  Single tx limit (USD)
                  <InputNumber
                    className="w-full mt-1"
                    min={0}
                    value={parseFloat(settings.WITHDRAWAL_SINGLE_LIMIT_USD ?? '0') || undefined}
                    onChange={(v) => v != null && handleSetting('WITHDRAWAL_SINGLE_LIMIT_USD', v)}
                    placeholder="e.g. 5000"
                  />
                </label>
              </div>
            </Card>
          </Col>
          <Col xs={24}>
            <Panel title="Quick Links" subtitle="Full configuration">
              <div className="flex flex-wrap gap-2">
                <a href="/admin/settings"><Button size="small">System Settings</Button></a>
                <a href="/admin/settings/features"><Button size="small">Feature Flags</Button></a>
                <a href="/admin/settings/operations"><Button size="small">Operations Control</Button></a>
              </div>
            </Panel>
          </Col>
        </Row>
      )}
    </div>
  );
}
