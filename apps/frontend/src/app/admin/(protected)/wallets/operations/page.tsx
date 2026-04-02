'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import {
  SectionHeader,
  Panel,
  ActionButton,
} from '@/components/admin/control-plane';
import { Card, Row, Col, Switch, Button, message } from 'antd';
import {
  Loader2,
  RefreshCw,
  ArrowDownToLine,
  ArrowUpFromLine,
  Wallet,
  Database,
  CreditCard,
  ChevronRight,
} from 'lucide-react';

const API_URL = getApiBaseUrl();

interface WalletStatus {
  depositPaused: boolean;
  withdrawalPaused: boolean;
}

interface FundsSummary {
  ledger_totals?: Array<{ chain_name: string; token_symbol: string; amount: string }>;
  on_chain_totals?: {
    hot_wallets?: Array<{ chain_name: string; balance: string }>;
    cold_wallets?: Array<{ chain_id: string; chain_name: string; balance: string | null }>;
  };
  reconciliation?: { status: string };
}

export default function WalletOperationsPage() {
  const { accessToken } = useAdminAuthStore();
  const [status, setStatus] = useState<WalletStatus | null>(null);
  const [funds, setFunds] = useState<FundsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [sweepRunning, setSweepRunning] = useState(false);
  const [sweepResult, setSweepResult] = useState<{ swept: number; errors: string[] } | null>(null);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [statusRes, fundsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/admin/operational/wallet-status`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        fetch(`${API_URL}/api/v1/admin/funds/summary`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      ]);
      const statusData = await statusRes.json();
      const fundsData = await fundsRes.json();
      if (statusData?.success && statusData?.data) setStatus(statusData.data);
      if (fundsData?.success && fundsData?.data) setFunds(fundsData.data);
    } catch (e) {
      message.error('Failed to load wallet operations');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggle = async (key: 'depositPaused' | 'withdrawalPaused', value: boolean) => {
    if (!accessToken) return;
    setUpdating(key);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/operational/wallet-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ [key]: value }),
      });
      const data = await res.json();
      if (data?.success) {
        setStatus((s) => (s ? { ...s, [key]: value } : { depositPaused: false, withdrawalPaused: false }));
        message.success(value ? 'Paused' : 'Resumed');
      } else {
        message.error(data?.error?.message ?? 'Update failed');
      }
    } catch {
      message.error('Request failed');
    } finally {
      setUpdating(null);
    }
  };

  const handleRunSweep = async () => {
    if (!accessToken) return;
    setSweepRunning(true);
    setSweepResult(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/deposit-sweeps/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        setSweepResult({
          swept: data.data?.swept_count ?? 0,
          errors: Array.isArray(data.data?.errors) ? data.data.errors : [],
        });
        message.success(`Sweep completed: ${data.data?.swept_count ?? 0} addresses swept`);
        fetchData();
      } else {
        setSweepResult({ swept: 0, errors: [data?.error?.message ?? 'Run failed'] });
        message.error('Deposit sweep failed');
      }
    } catch (e) {
      setSweepResult({ swept: 0, errors: [e instanceof Error ? e.message : 'Network error'] });
      message.error('Request failed');
    } finally {
      setSweepRunning(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Wallet Operations"
        subtitle="Pause deposits/withdrawals, manual adjustments, deposit sweep, and hot/cold wallet monitoring"
        action={
          <ActionButton variant="secondary" onClick={fetchData} loading={loading} icon={<RefreshCw className="w-4 h-4" />}>
            Refresh
          </ActionButton>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="Deposits" className="admin-card">
            <div className="flex items-center justify-between">
              <span className="admin-metric-label">Pause deposits</span>
              <Switch
                checked={status?.depositPaused ?? false}
                loading={updating === 'depositPaused'}
                onChange={(checked) => handleToggle('depositPaused', checked)}
                checkedChildren="Paused"
                unCheckedChildren="Live"
              />
            </div>
            <p className="text-xs admin-metric-label mt-2">
              When paused, new deposits will not be credited.
            </p>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="Withdrawals" className="admin-card">
            <div className="flex items-center justify-between">
              <span className="admin-metric-label">Pause withdrawals</span>
              <Switch
                checked={status?.withdrawalPaused ?? false}
                loading={updating === 'withdrawalPaused'}
                onChange={(checked) => handleToggle('withdrawalPaused', checked)}
                checkedChildren="Paused"
                unCheckedChildren="Live"
              />
            </div>
            <p className="text-xs admin-metric-label mt-2">
              When paused, withdrawal requests will be blocked.
            </p>
          </Card>
        </Col>

        <Col xs={24} md={12}>
          <Panel title="Manual Adjustments" subtitle="Credit or debit user balances">
            <div className="flex flex-col gap-2">
              <Link href="/admin/wallets/deposits/manual-credit">
                <Button type="primary" icon={<CreditCard className="w-4 h-4" />} block>
                  Manual Credit
                </Button>
              </Link>
              <Link href="/admin/wallets/adjust">
                <Button type="default" icon={<Wallet className="w-4 h-4" />} block>
                  Balance Adjustments
                </Button>
              </Link>
            </div>
          </Panel>
        </Col>
        <Col xs={24} md={12}>
          <Panel title="Deposit Sweep" subtitle="Consolidate user deposits to hot wallet (Super Admin)">
            <Button
              type="primary"
              danger={false}
              loading={sweepRunning}
              onClick={handleRunSweep}
              icon={<Database className="w-4 h-4" />}
              block
            >
              Trigger Deposit Sweep
            </Button>
            {sweepResult && (
              <p className="text-sm admin-metric-label mt-2">
                Last run: {sweepResult.swept} swept
                {sweepResult.errors.length > 0 && ` — ${sweepResult.errors.join(', ')}`}
              </p>
            )}
          </Panel>
        </Col>

        <Col xs={24}>
          <Panel
            title="Hot & Cold Wallet Balances"
            subtitle="Live view of hot and cold wallet reserves"
            headerAction={
              <Link href="/admin/wallets/funds-summary">
                <Button type="link" size="small">
                  Full summary <ChevronRight className="w-4 h-4 inline" />
                </Button>
              </Link>
            }
          >
            {funds?.on_chain_totals?.hot_wallets?.length ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <ArrowDownToLine className="w-4 h-4" /> Hot wallets
                  </h4>
                  <div className="space-y-2">
                    {funds.on_chain_totals.hot_wallets.map((h) => (
                      <div key={h.chain_name} className="flex justify-between text-sm">
                        <span>{h.chain_name}</span>
                        <span className="font-mono">{h.balance}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <ArrowUpFromLine className="w-4 h-4" /> Cold wallets
                  </h4>
                  {funds?.on_chain_totals?.cold_wallets?.length ? (
                    <div className="space-y-2">
                      {funds.on_chain_totals.cold_wallets.map((c) => (
                        <div key={c.chain_id} className="flex justify-between text-sm">
                          <span>{c.chain_name}</span>
                          <span className="font-mono">{c.balance ?? 'N/A'}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No cold wallet data</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm admin-metric-label">No hot wallet data. Use Full summary for details.</p>
            )}
          </Panel>
        </Col>
      </Row>
    </div>
  );
}
