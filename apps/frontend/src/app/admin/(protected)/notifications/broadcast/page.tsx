'use client';

import { useState } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { Card, Form, Input, Button, Select, message, Row, Col } from 'antd';
import { Megaphone } from 'lucide-react';
import Link from 'next/link';

const API_URL = getApiBaseUrl();
const { TextArea } = Input;

export default function AdminNotificationsBroadcastPage() {
  const { accessToken } = useAdminAuthStore();
  const [sending, setSending] = useState(false);

  const handlePushBroadcast = async (values: { title: string; message: string; target: string }) => {
    if (!accessToken) return;
    setSending(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/notifications/push-broadcast`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: values.title.trim(),
          message: values.message.trim(),
          target: values.target || 'all',
        }),
      });
      const data = await res.json();
      if (data?.success) {
        message.success(`Broadcast sent to ${data.data?.sent ?? 0} users`);
        // Reset form
        (document.getElementById('broadcast-form') as HTMLFormElement)?.reset();
      } else {
        message.error(data?.error?.message ?? 'Failed to send broadcast');
      }
    } catch (e) {
      message.error('Request failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold admin-metric-value">Admin Broadcast</h1>
          <p className="text-sm admin-metric-label mt-0.5">
            Send announcements and in-app alerts to users
          </p>
        </div>
        <Link href="/admin/notifications/announcements">
          <Button type="default">Manage Announcements</Button>
        </Link>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card title="Push Broadcast" className="admin-card">
            <Form
              id="broadcast-form"
              layout="vertical"
              onFinish={handlePushBroadcast}
              initialValues={{ target: 'all' }}
            >
              <Form.Item name="title" label="Title" rules={[{ required: true, message: 'Title required' }]}>
                <Input placeholder="Broadcast title" maxLength={200} />
              </Form.Item>
              <Form.Item name="message" label="Message" rules={[{ required: true, message: 'Message required' }]}>
                <TextArea rows={4} placeholder="Message content" maxLength={2000} showCount />
              </Form.Item>
              <Form.Item name="target" label="Target Audience">
                <Select
                  options={[
                    { label: 'All Users', value: 'all' },
                    { label: 'Verified Users Only', value: 'verified' },
                  ]}
                />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={sending} icon={<Megaphone className="w-4 h-4" />}>
                  Send Broadcast
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="Quick Links" className="admin-card">
            <div className="space-y-2">
              <Link href="/admin/notifications/announcements" className="block text-sm admin-accent-blue hover:underline">
                Create / Edit Announcements
              </Link>
              <p className="text-xs admin-metric-label mt-2">
                Broadcast creates in-app notifications for each user. Announcements appear in the public announcements feed.
              </p>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
