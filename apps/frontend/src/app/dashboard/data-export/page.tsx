'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, FileText, History, FileSpreadsheet, Loader2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadCsv, ordersToCsv } from '@/lib/exportCsv';
import { notifyError } from '@/lib/notifyError';

type TabType = 'transaction' | 'order' | 'account';
type TimeRangeType = '7days' | '30days' | '90days' | 'custom';

type ExportLog = {
  id: string;
  kind: TabType;
  requestedAt: string;
  status: 'completed' | 'failed';
  rows: number;
  fileName?: string;
  reason?: string;
};

type WalletTx = {
  id?: string;
  type?: string;
  coin?: string;
  symbol?: string;
  quantity?: string;
  amount?: string;
  status?: string;
  date_time?: string;
  created_at?: string;
  txid?: string;
  txHash?: string;
};

type OrderExportRow = {
  market: string;
  side: string;
  type?: string;
  price: string | null;
  stop_price?: string | null;
  quantity: string;
  filled_quantity: string;
  status: string;
  created_at: string;
};

function toDateBounds(timeRange: TimeRangeType, startDate: string, endDate: string): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end);
  if (timeRange === '7days') start.setDate(end.getDate() - 7);
  if (timeRange === '30days') start.setDate(end.getDate() - 30);
  if (timeRange === '90days') start.setDate(end.getDate() - 90);
  if (timeRange === 'custom') {
    const s = new Date(`${startDate}T00:00:00`);
    const e = new Date(`${endDate}T23:59:59`);
    return { start: Number.isFinite(s.getTime()) ? s : start, end: Number.isFinite(e.getTime()) ? e : end };
  }
  return { start, end };
}

function toCsvCell(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function walletTransactionsToCsv(rows: WalletTx[]): string {
  const headers = ['Time', 'Type', 'Asset', 'Amount', 'Status', 'Tx Hash'];
  const body = rows.map((r) => [
    r.date_time ?? r.created_at ?? '',
    r.type ?? '',
    r.coin ?? r.symbol ?? '',
    r.quantity ?? r.amount ?? '',
    r.status ?? '',
    r.txid ?? r.txHash ?? '',
  ]);
  return [headers.map(toCsvCell).join(','), ...body.map((row) => row.map(toCsvCell).join(','))].join('\n');
}

export default function DataExportPage() {
  const [activeTab, setActiveTab] = useState<TabType>('transaction');
  const [timeRange, setTimeRange] = useState<TimeRangeType>('30days');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [exportType, setExportType] = useState<'all' | 'deposit' | 'withdrawal' | 'transfer' | 'trade'>('all');
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<ExportLog[]>([]);

  const tabs: Array<{ id: TabType; label: string; icon: typeof FileText }> = [
    { id: 'transaction', label: 'Transaction Log', icon: FileText },
    { id: 'order', label: 'Order History', icon: History },
    { id: 'account', label: 'Account Statement', icon: FileSpreadsheet },
  ];

  const canRun = useMemo(() => {
    if (activeTab === 'account') return false;
    if (timeRange !== 'custom') return true;
    return Boolean(startDate && endDate);
  }, [activeTab, timeRange, startDate, endDate]);

  const appendLog = (entry: Omit<ExportLog, 'id' | 'requestedAt'>) => {
    setLogs((prev) => [
      {
        id: crypto.randomUUID(),
        requestedAt: new Date().toISOString(),
        ...entry,
      },
      ...prev.slice(0, 24),
    ]);
  };

  const handleExport = async () => {
    if (!canRun || running) return;
    setRunning(true);
    try {
      const { start, end } = toDateBounds(timeRange, startDate, endDate);
      if (activeTab === 'order') {
        const orders: OrderExportRow[] = [];
        let cursor: string | null = null;
        for (let i = 0; i < 200; i += 1) {
          const requestUrl: string = `/api/v1/spot/orders?status=HISTORY&limit=100${
            cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
          }`;
          const res = (await api.get<{ orders?: OrderExportRow[]; next_cursor?: string | null }>(
            requestUrl,
            { notifyOnError: false }
          )) as { success: boolean; data?: { orders?: OrderExportRow[]; next_cursor?: string | null } };
          if (!res.success) break;
          const batch = Array.isArray(res.data?.orders) ? res.data.orders : [];
          if (batch.length === 0) break;
          orders.push(...batch);
          cursor = res.data?.next_cursor ?? null;
          if (!cursor) break;
        }
        const filtered = orders.filter((o) => {
          const t = new Date(o.created_at).getTime();
          if (!Number.isFinite(t)) return false;
          if (t < start.getTime() || t > end.getTime()) return false;
          if (exportType !== 'all' && exportType !== 'trade') return false;
          return true;
        });
        const csv = ordersToCsv(filtered);
        const fileName = `spot-orders-${new Date().toISOString().slice(0, 10)}.csv`;
        downloadCsv(fileName, csv);
        appendLog({ kind: 'order', status: 'completed', rows: filtered.length, fileName });
        return;
      }

      const txRes = await api.get<WalletTx[]>('/api/v1/wallet/transactions/all', { notifyOnError: false });
      if (!txRes.success || !Array.isArray(txRes.data)) {
        throw new Error('Unable to fetch wallet transactions.');
      }
      const filtered = txRes.data.filter((t) => {
        const stamp = t.date_time ?? t.created_at;
        const ms = stamp ? new Date(stamp).getTime() : NaN;
        if (!Number.isFinite(ms)) return false;
        if (ms < start.getTime() || ms > end.getTime()) return false;
        if (exportType !== 'all') {
          const rowType = (t.type ?? '').toLowerCase();
          if (rowType !== exportType) return false;
        }
        return true;
      });
      const csv = walletTransactionsToCsv(filtered);
      const fileName = `wallet-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
      downloadCsv(fileName, csv);
      appendLog({ kind: 'transaction', status: 'completed', rows: filtered.length, fileName });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed';
      notifyError(message);
      appendLog({ kind: activeTab, status: 'failed', rows: 0, reason: message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 lg:p-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Data Export</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Download account activity exports. Account statements are temporarily disabled until backend job pipeline is enabled.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'account' ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Account statement export is not live yet.</p>
              <p className="mt-1 text-amber-100/80">
                Use trade and wallet exports for now. This prevents showing a fake export flow.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Type</span>
              <select
                value={exportType}
                onChange={(e) =>
                  setExportType(e.target.value as 'all' | 'deposit' | 'withdrawal' | 'transfer' | 'trade')
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              >
                {activeTab === 'order' ? (
                  <>
                    <option value="all">All orders</option>
                    <option value="trade">Trade orders</option>
                  </>
                ) : (
                  <>
                    <option value="all">All transactions</option>
                    <option value="deposit">Deposits</option>
                    <option value="withdrawal">Withdrawals</option>
                    <option value="transfer">Transfers</option>
                  </>
                )}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Time Range</span>
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value as TimeRangeType)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              >
                <option value="7days">Last 7 days</option>
                <option value="30days">Last 30 days</option>
                <option value="90days">Last 90 days</option>
                <option value="custom">Custom range</option>
              </select>
            </label>
          </div>
          {timeRange === 'custom' && (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Start Date</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">End Date</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2"
                />
              </label>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!canRun || running}
              onClick={() => void handleExport()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {running ? 'Preparing export...' : 'Export CSV'}
            </button>
            <Link href="/wallet/history" className="text-sm text-primary hover:underline">
              Open full wallet history
            </Link>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Export Activity</h2>
        </div>
        <div className="p-4">
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No export jobs in this session.</p>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <div key={log.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-foreground">
                      {log.kind} export - {log.status}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(log.requestedAt).toLocaleString()} · rows: {log.rows}
                    </p>
                  </div>
                  <span className={log.status === 'completed' ? 'text-emerald-400' : 'text-red-400'}>
                    {log.fileName ?? log.reason ?? 'Failed'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
