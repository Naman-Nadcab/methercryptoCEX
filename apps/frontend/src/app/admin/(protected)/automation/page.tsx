'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Card, Table, Row, Col, Button, Tag, Modal, Form, Input, Select } from 'antd';
import { AdminChartCard } from '@/components/admin/charts';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2, RefreshCw, Plus, Zap } from 'lucide-react';

const API_URL = getApiBaseUrl();
const TRIGGERS = ['aml_spike', 'volatility_spike', 'suspicious_user', 'chain_outage', 'withdrawal_spike'];
const ACTIONS = ['block_user', 'pause_market', 'disable_deposits', 'send_alert', 'halt_trading'];

interface Rule {
  id: string;
  name: string;
  trigger: string;
  action: string;
  enabled?: boolean;
}

export default function AutomationPage() {
  const { accessToken } = useAdminAuthStore();
  const [rules, setRules] = useState<Rule[]>([]);
  const [executions, setExecutions] = useState<Array<{ action: string; details: unknown; created_at: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [rulesRes, execRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/admin/operations/automation/rules`, { headers: { Authorization: `Bearer ${accessToken}` } }),
        fetch(`${API_URL}/api/v1/admin/operations/automation/executions`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      ]);
      const rulesData = await rulesRes.json();
      const execData = await execRes.json();
      if (rulesData?.success) setRules(rulesData.data.rules ?? []);
      if (execData?.success) setExecutions(execData.data.executions ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAddRule = async (values: { name: string; trigger: string; action: string }) => {
    if (!accessToken) return;
    const newRule: Rule = { id: crypto.randomUUID(), name: values.name, trigger: values.trigger, action: values.action, enabled: true };
    const updated = [...rules, newRule];
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/operations/automation/rules`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: updated }),
      });
      const data = await res.json();
      if (data?.success) {
        setRules(updated);
        setModalOpen(false);
        form.resetFields();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const triggerCounts = TRIGGERS.map((t) => ({ name: t.replace(/_/g, ' '), count: rules.filter((r) => r.trigger === t).length }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">Exchange Automation Engine</h1>
          <p className="text-sm admin-metric-label mt-0.5">Define automated operational rules — auto block, pause markets, alert on AML</p>
        </div>
        <div className="flex gap-2">
          <Button type="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setModalOpen(true)}>Add Rule</Button>
          <Button type="default" icon={<RefreshCw className="w-4 h-4" />} onClick={fetchData} loading={loading}>Refresh</Button>
        </div>
      </div>

      {loading && rules.length === 0 ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 admin-accent-blue animate-spin" /></div>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <AdminChartCard title="Rules by Trigger" subtitle="Count per trigger type">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={triggerCounts}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="name" stroke="#9CA3AF" fontSize={10} angle={-20} textAnchor="end" height={50} />
                    <YAxis stroke="#9CA3AF" fontSize={11} />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                    <Bar dataKey="count" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </AdminChartCard>
            </Col>
            <Col xs={24} lg={12}>
              <Card size="small" className="admin-card h-full">
                <h3 className="text-sm font-semibold admin-metric-value mb-3">Rule Types</h3>
                <ul className="text-xs admin-metric-label space-y-1">
                  <li><strong>aml_spike</strong> → auto alert on AML spike</li>
                  <li><strong>volatility_spike</strong> → auto pause market</li>
                  <li><strong>suspicious_user</strong> → auto block user</li>
                  <li><strong>chain_outage</strong> → auto disable deposits</li>
                  <li><strong>withdrawal_spike</strong> → send alert</li>
                </ul>
              </Card>
            </Col>
          </Row>

          <Card title="Automation Rules" className="admin-card">
            {rules.length === 0 ? (
              <p className="text-sm admin-metric-label py-4">No rules defined. Add a rule to automate operations.</p>
            ) : (
              <Table size="small" dataSource={rules} rowKey="id" pagination={{ pageSize: 10 }}
                columns={[
                  { title: 'Name', dataIndex: 'name', key: 'name' },
                  { title: 'Trigger', dataIndex: 'trigger', key: 'trigger', render: (v: string) => <Tag color="blue">{v}</Tag> },
                  { title: 'Action', dataIndex: 'action', key: 'action', render: (v: string) => <Tag color="green">{v}</Tag> },
                  { title: 'Status', key: 'status', render: () => <Tag color="success">Active</Tag> },
                ]}
              />
            )}
          </Card>

          <Card title="Recent Executions" className="admin-card">
            {executions.length === 0 ? (
              <p className="text-sm admin-metric-label py-4">No automation executions recorded.</p>
            ) : (
              <Table size="small" dataSource={executions} rowKey={(r, i) => `${r.action}-${i}`} pagination={{ pageSize: 10 }}
                columns={[
                  { title: 'Action', dataIndex: 'action', key: 'action' },
                  { title: 'Time', dataIndex: 'created_at', key: 'created_at', render: (v: string) => v ? new Date(v).toLocaleString() : '—' },
                ]}
              />
            )}
          </Card>
        </>
      )}

      <Modal title="Add Automation Rule" open={modalOpen} onCancel={() => setModalOpen(false)} footer={null}>
        <Form form={form} layout="vertical" onFinish={handleAddRule}>
          <Form.Item name="name" label="Rule Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Auto-block AML high risk" />
          </Form.Item>
          <Form.Item name="trigger" label="Trigger" rules={[{ required: true }]}>
            <Select options={TRIGGERS.map((t) => ({ label: t.replace(/_/g, ' '), value: t }))} placeholder="Select trigger" />
          </Form.Item>
          <Form.Item name="action" label="Action" rules={[{ required: true }]}>
            <Select options={ACTIONS.map((a) => ({ label: a.replace(/_/g, ' '), value: a }))} placeholder="Select action" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" icon={<Zap className="w-4 h-4" />}>Add Rule</Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
