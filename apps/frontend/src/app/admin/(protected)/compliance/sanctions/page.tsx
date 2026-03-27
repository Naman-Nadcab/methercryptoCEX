'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel, ActionButton, MetricWidget } from '@/components/admin/control-plane';
import { Card, Row, Col, Table } from 'antd';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, RefreshCw, ShieldAlert } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface SanctionsData {
  sanctionsHits: number;
  blockedWithdrawals: number;
  flaggedUsers: number;
  hitsTimeline: Array<{ date: string; count: number }>;
  blockedTxTimeline: Array<{ date: string; count: number }>;
  highRiskUsers: Array<{ userId: string; alertCount: number; riskScore: number }>;
}

export default function SanctionsDashboardPage() {
  const { accessToken } = useAdminAuthStore();
  const [data, setData] = useState<SanctionsData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/compliance/sanctions`, {
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
    sanctionsHits: 0,
    blockedWithdrawals: 0,
    flaggedUsers: 0,
    hitsTimeline: [],
    blockedTxTimeline: [],
    highRiskUsers: [],
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Sanctions Screening Dashboard"
        subtitle="Sanctions hits, blocked withdrawals, flagged users, and risk distribution"
        action={
          <ActionButton variant="secondary" onClick={fetchData} loading={loading} icon={<RefreshCw className="w-4 h-4" />}>
            Refresh
          </ActionButton>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <MetricWidget
            label="Sanctions hits (30d)"
            value={d.sanctionsHits}
            variant={d.sanctionsHits > 0 ? 'danger' : 'neutral'}
            icon={<ShieldAlert className="w-5 h-5" />}
          />
        </Col>
        <Col xs={24} sm={8}>
          <MetricWidget
            label="Blocked withdrawals"
            value={d.blockedWithdrawals}
            variant={d.blockedWithdrawals > 0 ? 'warning' : 'neutral'}
          />
        </Col>
        <Col xs={24} sm={8}>
          <MetricWidget
            label="Flagged users"
            value={d.flaggedUsers}
            variant={d.flaggedUsers > 0 ? 'warning' : 'neutral'}
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Panel title="Sanctions alerts timeline" subtitle="Daily hits (30d)">
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.hitsTimeline?.length ? d.hitsTimeline : [{ date: '', count: 0 }]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={v => v ? new Date(v).toLocaleDateString() : ''} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip labelFormatter={v => v ? new Date(v).toLocaleDateString() : ''} />
                  <Area type="monotone" dataKey="count" stroke="#ef4444" fill="#ef4444" fillOpacity={0.3} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </Col>
        <Col xs={24} md={12}>
          <Panel title="Blocked transactions" subtitle="By day (30d)">
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.blockedTxTimeline?.length ? d.blockedTxTimeline : [{ date: '', count: 0 }]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={v => v ? new Date(v).toLocaleDateString() : ''} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip labelFormatter={v => v ? new Date(v).toLocaleDateString() : ''} />
                  <Bar dataKey="count" fill="#f59e0b" name="Blocked" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </Col>
      </Row>

      <Panel title="High risk user distribution" subtitle="Flagged users by risk score">
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={d.highRiskUsers?.length ? d.highRiskUsers.slice(0, 15) : [{ userId: '—', riskScore: 0 }]}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="userId" tick={{ fontSize: 9 }} tickFormatter={v => (typeof v === 'string' && v.length > 8) ? v.slice(0, 8) + '…' : v} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="riskScore" fill="#dc2626" name="Risk score" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel title="Flagged users" subtitle="Open sanctions-related alerts">
        <Table
          dataSource={d.highRiskUsers ?? []}
          rowKey="userId"
          size="small"
          columns={[
            {
              title: 'User',
              dataIndex: 'userId',
              key: 'userId',
              render: (v: string) => <Link href={`/admin/users/${v}`} className="text-blue-500 hover:underline font-mono text-xs">{v?.slice(0, 8)}…</Link>,
            },
            { title: 'Alert count', dataIndex: 'alertCount', key: 'alertCount' },
            {
              title: 'Risk score',
              dataIndex: 'riskScore',
              key: 'riskScore',
              render: (s: number) => <span className={s >= 90 ? 'text-red-600 font-medium' : s >= 50 ? 'text-amber-600' : ''}>{s}</span>,
            },
          ]}
          pagination={{ pageSize: 10 }}
        />
      </Panel>
    </div>
  );
}
