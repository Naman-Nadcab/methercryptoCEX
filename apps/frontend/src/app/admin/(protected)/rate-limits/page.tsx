'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import {
  SectionHeader,
  Panel,
  ActionButton,
  MetricWidget,
} from '@/components/admin/control-plane';
import { Card, Row, Col } from 'antd';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Loader2, RefreshCw, Activity, AlertTriangle, Bot, Key } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface RateLimitData {
  requestVolume24h: number;
  rateLimitViolations: number;
  botTrafficSpikes: number;
  rateLimitKeysCount: number;
  series24h: Array<{ hour: number; requests: number; violations: number }>;
  suspiciousApiKeys: unknown[];
}

export default function RateLimitsPage() {
  const { accessToken } = useAdminAuthStore();
  const [data, setData] = useState<RateLimitData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/operational/rate-limits`, {
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
    requestVolume24h: 0,
    rateLimitViolations: 0,
    botTrafficSpikes: 0,
    rateLimitKeysCount: 0,
    series24h: [],
    suspiciousApiKeys: [],
  };

  /** No random filler: use API series, or a uniform per-hour estimate from totals (clearly not measured per-hour). */
  const chartData =
    d.series24h.length > 0
      ? d.series24h
      : d.requestVolume24h > 0
        ? Array.from({ length: 24 }, (_, i) => ({
            hour: i,
            name: `${i}:00`,
            requests: Math.round(d.requestVolume24h / 24),
            violations: Math.round(d.rateLimitViolations / 24),
          }))
        : [];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Rate Limit Monitoring"
        subtitle="API request volume, rate limit violations, bot traffic, and suspicious API key usage"
        action={
          <ActionButton variant="secondary" onClick={fetchData} loading={loading} icon={<RefreshCw className="w-4 h-4" />}>
            Refresh
          </ActionButton>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <MetricWidget
            label="API Requests (24h)"
            value={d.requestVolume24h.toLocaleString()}
            variant="positive"
            icon={<Activity className="w-5 h-5" />}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <MetricWidget
            label="Rate Limit Violations"
            value={d.rateLimitViolations.toLocaleString()}
            variant={d.rateLimitViolations > 100 ? 'danger' : d.rateLimitViolations > 10 ? 'warning' : 'neutral'}
            icon={<AlertTriangle className="w-5 h-5" />}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <MetricWidget
            label="Bot Traffic Spikes"
            value={d.botTrafficSpikes.toLocaleString()}
            variant={d.botTrafficSpikes > 5 ? 'danger' : 'neutral'}
            icon={<Bot className="w-5 h-5" />}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <MetricWidget
            label="Active Rate Limit Keys"
            value={d.rateLimitKeysCount.toLocaleString()}
            variant="neutral"
            icon={<Key className="w-5 h-5" />}
          />
        </Col>
      </Row>

      <Panel title="Request Volume (24h)" subtitle="Hourly API request distribution">
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="hour" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{ background: 'var(--card-bg)', borderRadius: 8 }}
                formatter={(v: number) => [v, 'Requests']}
              />
              <Area type="monotone" dataKey="requests" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Panel title="Violations Trend" subtitle="Rate limit hits by hour">
            <div className="h-[200px]">
              {chartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-gray-500">No violation trend data.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: 'var(--card-bg)', borderRadius: 8 }}
                      formatter={(v: number) => [v, 'Violations']}
                    />
                    <Area type="monotone" dataKey="violations" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.3} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </Panel>
        </Col>
        <Col xs={24} md={12}>
          <Panel title="Suspicious API Keys" subtitle="Flags for unusual usage patterns">
            {d.suspiciousApiKeys?.length ? (
              <ul className="space-y-2 text-sm">
                {d.suspiciousApiKeys.map((k: unknown, i: number) => (
                  <li key={i} className="font-mono text-amber-600 dark:text-amber-400">
                    {String(k)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500 py-4">No suspicious API keys detected.</p>
            )}
          </Panel>
        </Col>
      </Row>
    </div>
  );
}
