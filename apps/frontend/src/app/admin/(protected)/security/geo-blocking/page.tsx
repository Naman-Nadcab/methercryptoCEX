'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel, ActionButton } from '@/components/admin/control-plane';
import { Card, Row, Col, Switch, Input, Button, Tag, message } from 'antd';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, RefreshCw, Plus, X } from 'lucide-react';

const API_URL = getApiBaseUrl();

const COUNTRY_CODES = ['US', 'KP', 'IR', 'SY', 'CU', 'RU', 'CN', 'MM', 'SD', 'VE', 'BY', 'ET', 'IQ', 'LB', 'LY', 'SS', 'YE', 'ZZ'];

interface GeoData {
  enabled: boolean;
  blockedCountries: string[];
  loginByCountry: Array<{ country: string; count: number }>;
  blockedAttempts: Array<{ country: string; count: number }>;
}

export default function GeoBlockingPage() {
  const { accessToken } = useAdminAuthStore();
  const [data, setData] = useState<GeoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newCountry, setNewCountry] = useState('');

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/security/geo-blocking`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && json?.data) setData(json.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggle = async (enabled: boolean) => {
    if (!accessToken) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/security/geo-blocking`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ enabled }),
      });
      const json = await res.json();
      if (json?.success) {
        setData(prev => prev ? { ...prev, enabled } : null);
        message.success(enabled ? 'Geo blocking enabled' : 'Geo blocking disabled');
      } else message.error(json?.error?.message ?? 'Update failed');
    } catch {
      message.error('Request failed');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateCountries = async (list: string[]) => {
    if (!accessToken) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/security/geo-blocking`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ blockedCountries: list }),
      });
      const json = await res.json();
      if (json?.success) {
        setData(prev => prev ? { ...prev, blockedCountries: list } : null);
        message.success('Blocked countries updated');
      } else message.error(json?.error?.message ?? 'Update failed');
    } catch {
      message.error('Request failed');
    } finally {
      setSaving(false);
    }
  };

  const addCountry = () => {
    const code = newCountry.trim().toUpperCase();
    if (!code || (data?.blockedCountries ?? []).includes(code)) return;
    handleUpdateCountries([...(data?.blockedCountries ?? []), code]);
    setNewCountry('');
  };

  const removeCountry = (code: string) => {
    handleUpdateCountries((data?.blockedCountries ?? []).filter(c => c !== code));
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  const d = data ?? { enabled: false, blockedCountries: [], loginByCountry: [], blockedAttempts: [] };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Geo Blocking"
        subtitle="Block or allow access by country. Stored in system_settings."
        action={
          <ActionButton variant="secondary" onClick={fetchData} loading={loading} icon={<RefreshCw className="w-4 h-4" />}>
            Refresh
          </ActionButton>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="Geo blocking" className="admin-card">
            <div className="flex items-center justify-between mb-4">
              <span>Enable geo blocking</span>
              <Switch checked={d.enabled} loading={saving} onChange={handleToggle} />
            </div>
            <p className="text-sm text-gray-500 mb-4">When enabled, requests from blocked countries are rejected (403).</p>
            <div className="mb-2">
              <strong>Blocked countries (ISO codes)</strong>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {(d.blockedCountries ?? []).map(code => (
                <Tag key={code} closable onClose={() => removeCountry(code)}>{code}</Tag>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. US"
                value={newCountry}
                onChange={e => setNewCountry(e.target.value)}
                onPressEnter={addCountry}
                maxLength={2}
                className="w-24"
              />
              <Button type="primary" icon={<Plus className="w-4 h-4" />} onClick={addCountry} loading={saving}>
                Add
              </Button>
            </div>
            <p className="text-xs text-gray-500 mt-2">Common: US, KP, IR, SY, CU, RU, etc.</p>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Panel title="Blocked login attempts (7d)" subtitle="By country">
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.blockedAttempts?.length ? d.blockedAttempts : [{ country: '—', count: 0 }]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="country" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#ef4444" name="Blocked" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </Col>
      </Row>

      <Panel title="Login attempts by country (7d)" subtitle="Geographic distribution">
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={d.loginByCountry?.length ? d.loginByCountry : [{ country: '—', count: 0 }]}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="country" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#3b82f6" name="Logins" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </div>
  );
}
