'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel, ActionButton, MetricWidget } from '@/components/admin/control-plane';
import { Card, Row, Col, Table } from 'antd';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, RefreshCw, Wifi } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface NetworkRiskData {
  suspiciousIps: Array<{ ip: string; requestCount: number; lastSeen: string }>;
  vpnLoginTrend: Array<{ hour: string; logins: number; distinctIps: number }>;
  highRiskLocations: Array<{ ip: string; userId: string; loginCount: number }>;
  anomalyCount: number;
}

export default function NetworkRiskPage() {
  const { accessToken } = useAdminAuthStore();
  const [data, setData] = useState<NetworkRiskData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/security/network-risk`, {
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

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  const d = data ?? {
    suspiciousIps: [],
    vpnLoginTrend: [],
    highRiskLocations: [],
    anomalyCount: 0,
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="VPN / TOR Network Risk Monitor"
        subtitle="Suspicious IPs, high-risk login locations, and login anomalies"
        action={
          <ActionButton variant="secondary" onClick={fetchData} loading={loading} icon={<RefreshCw className="w-4 h-4" />}>
            Refresh
          </ActionButton>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <MetricWidget
            label="Suspicious IPs (24h)"
            value={d.suspiciousIps?.length ?? 0}
            variant={(d.suspiciousIps?.length ?? 0) > 5 ? 'danger' : 'neutral'}
            icon={<Wifi className="w-5 h-5" />}
          />
        </Col>
        <Col xs={24} sm={8}>
          <MetricWidget
            label="High-risk locations"
            value={d.highRiskLocations?.length ?? 0}
            variant="neutral"
          />
        </Col>
        <Col xs={24} sm={8}>
          <MetricWidget
            label="Anomaly count"
            value={d.anomalyCount ?? 0}
            variant={d.anomalyCount > 10 ? 'warning' : 'neutral'}
          />
        </Col>
      </Row>

      <Panel title="VPN / proxy login trends (24h)" subtitle="Logins and distinct IPs by hour">
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={d.vpnLoginTrend?.length ? d.vpnLoginTrend : [{ hour: '', logins: 0, distinctIps: 0 }]}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickFormatter={v => v ? new Date(v).toLocaleTimeString([], { hour: '2-digit' }) : ''} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip labelFormatter={v => v ? new Date(v).toLocaleString() : ''} />
              <Area type="monotone" dataKey="logins" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} name="Logins" />
              <Area type="monotone" dataKey="distinctIps" stroke="#10b981" fill="#10b981" fillOpacity={0.2} name="Distinct IPs" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Panel title="Suspicious IP frequency" subtitle="IPs with high request count (24h)">
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.suspiciousIps?.slice(0, 12)?.length ? d.suspiciousIps.slice(0, 12) : [{ ip: '—', requestCount: 0 }]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="ip" tick={{ fontSize: 9 }} tickFormatter={v => (typeof v === 'string' && v.length > 12) ? v.slice(0, 10) + '…' : v} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="requestCount" fill="#f59e0b" name="Requests" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </Col>
        <Col xs={24} md={12}>
          <Panel title="Suspicious login frequency" subtitle="Anomalies by hour">
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.vpnLoginTrend?.length ? d.vpnLoginTrend : [{ hour: '', logins: 0 }]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="hour" tick={{ fontSize: 9 }} tickFormatter={v => v ? new Date(v).toLocaleTimeString([], { hour: '2-digit' }) : ''} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip labelFormatter={v => v ? new Date(v).toLocaleString() : ''} />
                  <Bar dataKey="logins" fill="#8b5cf6" name="Logins" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </Col>
      </Row>

      <Panel title="Suspicious IP addresses" subtitle="High request volume in last 24h">
        <Table
          dataSource={d.suspiciousIps ?? []}
          rowKey="ip"
          size="small"
          columns={[
            { title: 'IP', dataIndex: 'ip', key: 'ip', render: (v: string) => <span className="font-mono text-xs">{v}</span> },
            { title: 'Request count', dataIndex: 'requestCount', key: 'requestCount' },
            { title: 'Last seen', dataIndex: 'lastSeen', key: 'lastSeen', render: (v: string) => v ? new Date(v).toLocaleString() : '—' },
          ]}
          pagination={{ pageSize: 15 }}
        />
      </Panel>

      <Panel title="High risk login locations" subtitle="Same user from multiple days / IPs">
        <Table
          dataSource={d.highRiskLocations ?? []}
          rowKey={(r) => `${r.ip}-${r.userId}`}
          size="small"
          columns={[
            { title: 'IP', dataIndex: 'ip', key: 'ip', render: (v: string) => <span className="font-mono text-xs">{v}</span> },
            {
              title: 'User',
              dataIndex: 'userId',
              key: 'userId',
              render: (v: string) => <Link href={`/admin/users/${v}`} className="text-blue-500 hover:underline font-mono text-xs">{v?.slice(0, 8)}…</Link>,
            },
            { title: 'Login count', dataIndex: 'loginCount', key: 'loginCount' },
          ]}
          pagination={{ pageSize: 10 }}
        />
      </Panel>
    </div>
  );
}
