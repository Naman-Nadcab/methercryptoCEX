'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel, ActionButton } from '@/components/admin/control-plane';
import { Card, Table, InputNumber, Button, message } from 'antd';
import { Loader2, RefreshCw, Save } from 'lucide-react';

const API_URL = getApiBaseUrl();

interface TierLimit {
  tier: number;
  dailyLimit: string;
  monthlyLimit: string;
}

export default function WithdrawalTierLimitsPage() {
  const { accessToken } = useAdminAuthStore();
  const [tiers, setTiers] = useState<TierLimit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Record<number, { dailyLimit: string; monthlyLimit: string }>>({});

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/settings/withdrawal-tier-limits`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json?.success && json?.data?.tiers) {
        setTiers(json.data.tiers);
        const map: Record<number, { dailyLimit: string; monthlyLimit: string }> = {};
        json.data.tiers.forEach((t: TierLimit) => {
          map[t.tier] = { dailyLimit: t.dailyLimit, monthlyLimit: t.monthlyLimit };
        });
        setEditing(map);
      }
    } catch {
      setTiers([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    if (!accessToken) return;
    setSaving(true);
    try {
      const payload = Object.entries(editing).map(([tier, lim]) => ({
        tier: parseInt(tier, 10),
        dailyLimit: String(lim.dailyLimit ?? '0'),
        monthlyLimit: String(lim.monthlyLimit ?? '0'),
      }));
      const res = await fetch(`${API_URL}/api/v1/admin/settings/withdrawal-tier-limits`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ tiers: payload }),
      });
      const json = await res.json();
      if (json?.success) {
        message.success('Tier limits updated. New KYC approvals will use these limits.');
        fetchData();
      } else message.error(json?.error?.message ?? 'Update failed');
    } catch {
      message.error('Request failed');
    } finally {
      setSaving(false);
    }
  };

  const updateEdit = (tier: number, field: 'dailyLimit' | 'monthlyLimit', value: string) => {
    setEditing((prev) => ({
      ...prev,
      [tier]: {
        dailyLimit: field === 'dailyLimit' ? value : (prev[tier]?.dailyLimit ?? '0'),
        monthlyLimit: field === 'monthlyLimit' ? value : (prev[tier]?.monthlyLimit ?? '0'),
      },
    }));
  };

  if (loading && tiers.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Withdrawal Limits by KYC Tier"
        subtitle="Daily and monthly withdrawal limits per KYC tier. Applied to users when KYC is approved."
        action={
          <>
            <ActionButton variant="secondary" onClick={fetchData} loading={loading} icon={<RefreshCw className="w-4 h-4" />}>
              Refresh
            </ActionButton>
            <Button type="primary" onClick={handleSave} loading={saving} icon={<Save className="w-4 h-4" />} className="ml-2">
              Save limits
            </Button>
          </>
        }
      />

      <Panel title="Tier limits" subtitle="Tier 0 = no KYC, 1–3 = KYC levels">
        <Table
          dataSource={[0, 1, 2, 3].map((t) => ({
            key: t,
            tier: t,
            dailyLimit: editing[t]?.dailyLimit ?? tiers.find((x) => x.tier === t)?.dailyLimit ?? '0',
            monthlyLimit: editing[t]?.monthlyLimit ?? tiers.find((x) => x.tier === t)?.monthlyLimit ?? '0',
          }))}
          pagination={false}
          columns={[
            {
              title: 'Tier',
              dataIndex: 'tier',
              key: 'tier',
              width: 80,
              render: (t: number) => (t === 0 ? '0 (no KYC)' : `Tier ${t}`),
            },
            {
              title: 'Daily limit',
              dataIndex: 'dailyLimit',
              key: 'dailyLimit',
              render: (_: string, r: { tier: number }) => (
                <InputNumber
                  min={0}
                  value={editing[r.tier]?.dailyLimit ?? r.dailyLimit}
                  onChange={(v) => updateEdit(r.tier, 'dailyLimit', v != null ? String(v) : '0')}
                  className="w-full"
                  stringMode
                />
              ),
            },
            {
              title: 'Monthly limit',
              dataIndex: 'monthlyLimit',
              key: 'monthlyLimit',
              render: (_: string, r: { tier: number }) => (
                <InputNumber
                  min={0}
                  value={editing[r.tier]?.monthlyLimit ?? r.monthlyLimit}
                  onChange={(v) => updateEdit(r.tier, 'monthlyLimit', v != null ? String(v) : '0')}
                  className="w-full"
                  stringMode
                />
              ),
            },
          ]}
        />
        <p className="text-sm text-gray-500 mt-4">Limits are in platform reference currency. When an admin approves KYC, the user&apos;s withdrawal limits are set from the tier matching their KYC level.</p>
      </Panel>
    </div>
  );
}
