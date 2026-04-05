'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel, ActionButton } from '@/components/admin/control-plane';
import {
  Loader2, RefreshCw, Save, AlertTriangle, Plus, Trash2,
  CheckCircle2, XCircle, Zap, Mail, MessageSquare, Globe, Shield,
  Bell, Key, BarChart3, Eye, EyeOff,
} from 'lucide-react';

const API_URL = getApiBaseUrl();

interface ApiSettingRow {
  id: string;
  category: string;
  provider: string;
  name: string;
  api_key?: string | null;
  api_secret?: string | null;
  api_url?: string | null;
  additional_config?: Record<string, string> | null;
  is_active: boolean;
  is_default: boolean;
  updated_at?: string;
}

interface TestResult {
  success: boolean;
  message: string;
  latencyMs: number;
  blockNumber?: string;
}

const CATEGORY_META: Record<string, { label: string; icon: React.ReactNode; description: string; fields: FieldDef[] }> = {
  email: {
    label: 'Email / SMTP',
    icon: <Mail className="w-5 h-5" />,
    description: 'Transactional email for OTP, notifications, and alerts',
    fields: [
      { key: 'api_key', label: 'SMTP Username / API Key', type: 'text', placeholder: 'user@example.com' },
      { key: 'api_secret', label: 'SMTP Password / API Secret', type: 'password', placeholder: '••••••••' },
      { key: 'api_url', label: 'SMTP Host', type: 'text', placeholder: 'smtp.gmail.com' },
      { key: 'additional_config.host', label: 'Host (override)', type: 'text', placeholder: 'smtp.gmail.com', configKey: 'host' },
      { key: 'additional_config.port', label: 'Port', type: 'text', placeholder: '465', configKey: 'port' },
      { key: 'additional_config.secure', label: 'Use TLS/SSL', type: 'toggle', configKey: 'secure' },
      { key: 'additional_config.from_email', label: 'From Email', type: 'text', placeholder: 'noreply@exchange.com', configKey: 'from_email' },
      { key: 'additional_config.from_name', label: 'From Name', type: 'text', placeholder: 'CryptoExchange', configKey: 'from_name' },
    ],
  },
  sms: {
    label: 'SMS / OTP',
    icon: <MessageSquare className="w-5 h-5" />,
    description: 'SMS OTP delivery (Twilio, Fast2SMS, MSG91)',
    fields: [
      { key: 'api_key', label: 'API Key / Account SID', type: 'text', placeholder: 'Your API key' },
      { key: 'api_secret', label: 'API Secret / Auth Token', type: 'password', placeholder: '••••••••' },
      { key: 'additional_config.sender_id', label: 'Sender ID', type: 'text', placeholder: 'INRXPE', configKey: 'sender_id' },
      { key: 'additional_config.message_id', label: 'Message/Template ID (DLT)', type: 'text', placeholder: '181649', configKey: 'message_id' },
      { key: 'additional_config.route', label: 'Route', type: 'text', placeholder: 'dlt', configKey: 'route' },
    ],
  },
  kyc: {
    label: 'KYC / Identity',
    icon: <Shield className="w-5 h-5" />,
    description: 'Identity verification provider (HyperVerge, Sumsub)',
    fields: [
      { key: 'api_key', label: 'App ID / API Key', type: 'text', placeholder: 'Your app ID' },
      { key: 'api_secret', label: 'App Key / API Secret', type: 'password', placeholder: '••••••••' },
      { key: 'api_url', label: 'Base URL', type: 'text', placeholder: 'https://ind-docs.hyperverge.co' },
      { key: 'additional_config.webhook_secret', label: 'Webhook Secret', type: 'password', placeholder: '••••••••', configKey: 'webhook_secret' },
      { key: 'additional_config.sandbox_mode', label: 'Sandbox Mode', type: 'toggle', configKey: 'sandbox_mode' },
    ],
  },
  rpc: {
    label: 'RPC / Blockchain Nodes',
    icon: <Globe className="w-5 h-5" />,
    description: 'Blockchain RPC endpoints for deposits, withdrawals, and indexing',
    fields: [
      { key: 'api_url', label: 'RPC URL', type: 'text', placeholder: 'https://eth-mainnet.g.alchemy.com/v2/...' },
      { key: 'api_key', label: 'API Key (if required)', type: 'text', placeholder: 'Optional API key' },
      { key: 'additional_config.ws_url', label: 'WebSocket URL', type: 'text', placeholder: 'wss://...', configKey: 'ws_url' },
      { key: 'additional_config.backup_url', label: 'Backup RPC URL', type: 'text', placeholder: 'https://...', configKey: 'backup_url' },
      { key: 'additional_config.timeout', label: 'Timeout (ms)', type: 'text', placeholder: '30000', configKey: 'timeout' },
    ],
  },
  push: {
    label: 'Push Notifications',
    icon: <Bell className="w-5 h-5" />,
    description: 'Firebase FCM or APNs push notification credentials',
    fields: [
      { key: 'api_key', label: 'Server Key / FCM Key', type: 'password', placeholder: 'FCM server key' },
      { key: 'api_url', label: 'Endpoint URL', type: 'text', placeholder: 'https://fcm.googleapis.com/fcm/send' },
    ],
  },
  recaptcha: {
    label: 'reCAPTCHA',
    icon: <Key className="w-5 h-5" />,
    description: 'Google reCAPTCHA for bot protection',
    fields: [
      { key: 'api_key', label: 'Site Key', type: 'text', placeholder: '6Le...' },
      { key: 'api_secret', label: 'Secret Key', type: 'password', placeholder: '6Le...' },
    ],
  },
  chart: {
    label: 'Chart / OHLCV Data',
    icon: <BarChart3 className="w-5 h-5" />,
    description: 'OHLCV chart data provider',
    fields: [
      { key: 'api_url', label: 'Base URL', type: 'text', placeholder: 'https://api.binance.com' },
      { key: 'api_key', label: 'API Key (optional)', type: 'text', placeholder: 'Optional' },
    ],
  },
  market_data: {
    label: 'Market Data',
    icon: <BarChart3 className="w-5 h-5" />,
    description: 'Ticker and market feed provider',
    fields: [
      { key: 'api_url', label: 'Base URL', type: 'text', placeholder: 'https://api.coingecko.com/api/v3' },
      { key: 'api_key', label: 'API Key (optional)', type: 'text', placeholder: 'Optional' },
    ],
  },
};

interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'toggle';
  placeholder?: string;
  configKey?: string;
}

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground pr-10 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
      <button type="button" onClick={() => setShow(!show)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${checked ? 'bg-primary border-primary' : 'bg-muted border-border'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

function SettingCard({
  row, meta, onSave, onTest, onToggleActive, onDelete,
}: {
  row: ApiSettingRow;
  meta: typeof CATEGORY_META[string];
  onSave: (id: string, data: Partial<ApiSettingRow>) => Promise<void>;
  onTest: (id: string) => Promise<TestResult | null>;
  onToggleActive: (id: string, active: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const initForm = useCallback(() => {
    const f: Record<string, string> = {
      api_key: row.api_key || '',
      api_secret: row.api_secret || '',
      api_url: row.api_url || '',
    };
    const extra = row.additional_config || {};
    for (const [k, v] of Object.entries(extra)) {
      f[`additional_config.${k}`] = String(v ?? '');
    }
    setForm(f);
  }, [row]);

  useEffect(() => { initForm(); }, [initForm]);

  const handleSave = async () => {
    setSaving(true);
    const additionalConfig: Record<string, string> = {};
    for (const [k, v] of Object.entries(form)) {
      if (k.startsWith('additional_config.')) {
        additionalConfig[k.replace('additional_config.', '')] = v;
      }
    }
    await onSave(row.id, {
      api_key: form.api_key,
      api_secret: form.api_secret,
      api_url: form.api_url,
      additional_config: { ...(row.additional_config || {}), ...additionalConfig },
    });
    setSaving(false);
    setEditing(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await onTest(row.id);
    setTestResult(result);
    setTesting(false);
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${row.is_active ? 'bg-green-500' : 'bg-zinc-400'}`} />
          <div>
            <h3 className="text-sm font-semibold text-foreground">{row.name}</h3>
            <p className="text-xs text-muted-foreground">{row.provider}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Toggle checked={row.is_active} onChange={(v) => onToggleActive(row.id, v)} />
          <button onClick={() => { setEditing(!editing); if (!editing) initForm(); }}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-muted transition-colors">
            {editing ? 'Cancel' : 'Configure'}
          </button>
        </div>
      </div>

      {editing && (
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {meta.fields.map((field) => {
              const fk = field.configKey ? `additional_config.${field.configKey}` : field.key;
              if (field.type === 'toggle') {
                return (
                  <div key={fk} className="flex items-center justify-between md:col-span-2">
                    <span className="text-sm font-medium text-foreground">{field.label}</span>
                    <Toggle checked={form[fk] === 'true'} onChange={(v) => setForm(p => ({ ...p, [fk]: v ? 'true' : 'false' }))} />
                  </div>
                );
              }
              return (
                <div key={fk} className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{field.label}</label>
                  {field.type === 'password' ? (
                    <PasswordInput value={form[fk] || ''} onChange={(v) => setForm(p => ({ ...p, [fk]: v }))} placeholder={field.placeholder} />
                  ) : (
                    <input type="text" value={form[fk] || ''} onChange={(e) => setForm(p => ({ ...p, [fk]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  )}
                </div>
              );
            })}
          </div>

          {testResult && (
            <div className={`rounded-lg px-4 py-3 flex items-start gap-3 text-sm ${testResult.success ? 'bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-400' : 'bg-destructive/10 border border-destructive/30 text-destructive'}`}>
              {testResult.success ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
              <div>
                <p>{testResult.message}</p>
                <p className="text-xs opacity-70 mt-1">Latency: {testResult.latencyMs}ms{testResult.blockNumber ? ` • Block: ${testResult.blockNumber}` : ''}</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <ActionButton variant="primary" onClick={handleSave} loading={saving} icon={<Save className="w-4 h-4" />}>
              Save
            </ActionButton>
            <ActionButton variant="secondary" onClick={handleTest} loading={testing} icon={<Zap className="w-4 h-4" />}>
              Test Connection
            </ActionButton>
            <div className="flex-1" />
            <button onClick={() => onDelete(row.id)} className="px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 rounded-lg transition-colors flex items-center gap-1.5">
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ApiSettingsPage() {
  const { accessToken } = useAdminAuthStore();
  const [settings, setSettings] = useState<ApiSettingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState<string | null>(null);
  const [newProvider, setNewProvider] = useState('');
  const [newName, setNewName] = useState('');

  const headers = { Authorization: `Bearer ${accessToken}` };

  const fetchSettings = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/settings/api`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await res.json();
      if (data?.success && Array.isArray(data.data?.settings)) {
        setSettings(data.data.settings);
      }
    } catch { setError('Failed to load API settings'); }
    finally { setLoading(false); }
  }, [accessToken]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const handleSave = async (id: string, updates: Partial<ApiSettingRow>) => {
    const res = await fetch(`${API_URL}/api/v1/admin/settings/api/${id}`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (data?.success) {
      await fetch(`${API_URL}/api/v1/admin/settings/api/flush-cache`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      await fetchSettings();
    }
  };

  const handleTest = async (id: string): Promise<TestResult | null> => {
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/settings/api/${id}/test`, { method: 'POST', headers });
      const data = await res.json();
      return data?.data || null;
    } catch { return null; }
  };

  const handleToggle = async (id: string, active: boolean) => {
    await fetch(`${API_URL}/api/v1/admin/settings/api/${id}/toggle`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: active }),
    });
    await fetch(`${API_URL}/api/v1/admin/settings/api/flush-cache`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
    });
    await fetchSettings();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this API setting?')) return;
    await fetch(`${API_URL}/api/v1/admin/settings/api/${id}`, { method: 'DELETE', headers });
    await fetchSettings();
  };

  const handleAdd = async () => {
    if (!addingCategory || !newProvider || !newName) return;
    await fetch(`${API_URL}/api/v1/admin/settings/api`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: addingCategory, provider: newProvider, name: newName, is_active: false, is_default: false }),
    });
    setAddingCategory(null);
    setNewProvider('');
    setNewName('');
    await fetchSettings();
  };

  const groupedSettings = settings.reduce<Record<string, ApiSettingRow[]>>((acc, row) => {
    const c = row.category || 'other';
    if (!acc[c]) acc[c] = [];
    acc[c]!.push(row);
    return acc;
  }, {});

  const categoryOrder = ['email', 'sms', 'kyc', 'rpc', 'push', 'recaptcha', 'chart', 'market_data'];
  const allCategories = Array.from(new Set([...categoryOrder, ...Object.keys(groupedSettings)]));

  return (
    <div className="space-y-8 pb-16">
      <SectionHeader
        title="API & Integration Settings"
        subtitle="Manage third-party API credentials. Changes apply dynamically without server restart."
        action={
          <ActionButton variant="secondary" onClick={fetchSettings} loading={loading} icon={<RefreshCw className="w-4 h-4" />}>
            Refresh
          </ActionButton>
        }
      />

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
        <strong>Dynamic Config:</strong> SMTP, SMS, and KYC settings are loaded from this page at runtime.
        After saving, changes take effect within 60 seconds (Redis cache TTL). Use &quot;Test Connection&quot; to verify.
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>
      ) : (
        <div className="space-y-8">
          {allCategories.map((cat) => {
            const rows = groupedSettings[cat] || [];
            const meta = CATEGORY_META[cat] || { label: cat, icon: <Globe className="w-5 h-5" />, description: '', fields: [] };
            return (
              <div key={cat}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">{meta.icon}</div>
                  <div>
                    <h2 className="text-base font-semibold text-foreground">{meta.label}</h2>
                    <p className="text-xs text-muted-foreground">{meta.description}</p>
                  </div>
                </div>

                {rows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    No provider configured.
                    <button onClick={() => setAddingCategory(cat)} className="ml-2 text-primary hover:underline">Add one</button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {rows.map((row) => (
                      <SettingCard key={row.id} row={row} meta={meta} onSave={handleSave} onTest={handleTest}
                        onToggleActive={handleToggle} onDelete={handleDelete} />
                    ))}
                    <button onClick={() => setAddingCategory(cat)}
                      className="flex items-center gap-2 text-xs text-primary hover:underline mt-2">
                      <Plus className="w-3.5 h-3.5" /> Add another {meta.label} provider
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {addingCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAddingCategory(null)}>
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground mb-4">
              Add {CATEGORY_META[addingCategory]?.label || addingCategory} Provider
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Provider Key</label>
                <input type="text" value={newProvider} onChange={(e) => setNewProvider(e.target.value)}
                  placeholder="e.g. twilio, sendgrid" className="w-full mt-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Display Name</label>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Twilio SMS" className="w-full mt-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setAddingCategory(null)} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted">Cancel</button>
              <ActionButton variant="primary" onClick={handleAdd} icon={<Plus className="w-4 h-4" />}>Add Provider</ActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
