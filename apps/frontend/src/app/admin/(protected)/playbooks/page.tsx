'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Card, Row, Col, Button } from 'antd';
import { Loader2, RefreshCw, FileText } from 'lucide-react';

const API_URL = getApiBaseUrl();

const PLAYBOOK_ITEMS = [
  { id: 'trading_halt', title: 'Trading Halt Procedures', color: 'border-amber-500/50 bg-amber-500/5' },
  { id: 'wallet_freeze', title: 'Wallet Freeze Procedures', color: 'border-red-500/50 bg-red-500/5' },
  { id: 'incident_response', title: 'Incident Response Workflows', color: 'border-blue-500/50 bg-blue-500/5' },
  { id: 'aml_escalation', title: 'AML Escalation Protocols', color: 'border-purple-500/50 bg-purple-500/5' },
];

export default function OperationalPlaybooksPage() {
  const { accessToken } = useAdminAuthStore();
  const [playbooks, setPlaybooks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/operations/playbooks`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && json?.data?.playbooks) setPlaybooks(json.data.playbooks);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">Operational Playbooks</h1>
          <p className="text-sm admin-metric-label mt-0.5">Trading halt, wallet freeze, incident response, AML escalation</p>
        </div>
        <Button type="default" icon={<RefreshCw className="w-4 h-4" />} onClick={fetchData} loading={loading}>Refresh</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 admin-accent-blue animate-spin" /></div>
      ) : (
        <Row gutter={[16, 16]}>
          {PLAYBOOK_ITEMS.map((item) => (
            <Col xs={24} key={item.id}>
              <Card
                title={
                  <span className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    {item.title}
                  </span>
                }
                className={`admin-card border-l-4 ${item.color}`}
              >
                <pre className="whitespace-pre-wrap text-sm admin-metric-label font-sans leading-relaxed">
                  {playbooks[item.id] ?? 'No procedure defined.'}
                </pre>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Card title="Related Links" className="admin-card">
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/control-center"><Button size="small">Control Center</Button></Link>
          <Link href="/admin/settings/operations"><Button size="small">Operations Control</Button></Link>
          <Link href="/admin/incidents"><Button size="small">Incidents</Button></Link>
          <Link href="/admin/compliance/alerts"><Button size="small">AML Alerts</Button></Link>
        </div>
      </Card>
    </div>
  );
}
