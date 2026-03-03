'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel, ActionButton } from '@/components/admin/control-plane';
import { Loader2, RefreshCw, Save, AlertTriangle, RotateCcw, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';

const API_URL = getApiBaseUrl();

/** Key prefix for API configs stored in settings (frontend-only convention) */
const API_CONFIG_PREFIX = 'api_config_';

/** One row from GET /api/v1/admin/settings/api (api_settings table). */
interface ApiSettingRow {
  id: string;
  category: string;
  provider: string;
  name: string;
  api_key?: string | null;
  api_secret?: string | null;
  api_url?: string | null;
  additional_config?: Record<string, unknown> | null;
  is_active: boolean;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  email: 'Email API',
  sms: 'SMS API',
  kyc: 'KYC API',
  chart: 'Chart API',
  rpc: 'RPC / Node API',
  market_data: 'Market Data API',
};

/**
 * Safely reads a value from settings using possible keys (canonical first, then legacy).
 * Does not assume fixed keys; inspects whatever exists in the settings object.
 */
function resolveSetting(settings: Record<string, string>, possibleKeys: string[]): string {
  if (!settings || typeof settings !== 'object') return '';
  for (const k of possibleKeys) {
    if (Object.prototype.hasOwnProperty.call(settings, k)) return String(settings[k] ?? '');
  }
  return '';
}

/** Build hydrated state from raw settings using resolver for each field (backward compatible). */
function hydrateEditedFromSettings(
  settings: Record<string, string>,
  sections: { fields: ApiSectionField[] }[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const section of sections) {
    for (const f of section.fields) {
      const possible = f.possibleKeys ?? [f.key];
      out[f.key] = resolveSetting(settings, possible);
    }
  }
  return out;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 shrink-0 rounded-full border border-border bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
        checked ? 'bg-primary border-primary' : ''
      }`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-card shadow transition-transform mt-0.5 ml-0.5 ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  );
}

interface ApiSectionField {
  key: string;
  label: string;
  type: 'text' | 'toggle';
  description?: string;
  /** First key is canonical; rest are legacy for hydration. */
  possibleKeys?: string[];
}

const SECTIONS: { title: string; subtitle?: string; fields: ApiSectionField[] }[] = [
  {
    title: 'Email API',
    subtitle: 'Transactional email (e.g. Resend, SendGrid, SMTP).',
    fields: [
      { key: 'email_api_provider', label: 'Provider Name', type: 'text', possibleKeys: ['email_api_provider', 'email_provider', 'emailProvider'] },
      { key: 'email_api_key', label: 'API Key', type: 'text', possibleKeys: ['email_api_key', 'emailApiKey'] },
      { key: 'email_api_secret', label: 'Secret / Token', type: 'text', possibleKeys: ['email_api_secret', 'emailApiSecret'] },
      { key: 'email_api_from', label: 'From Email', type: 'text', possibleKeys: ['email_api_from', 'email_from', 'emailFrom'] },
      { key: 'email_api_enabled', label: 'Enabled', type: 'toggle', possibleKeys: ['email_api_enabled', 'email_enabled', 'emailEnabled'] },
    ],
  },
  {
    title: 'SMS API',
    subtitle: 'OTP and notifications (e.g. Twilio, MSG91).',
    fields: [
      { key: 'sms_api_provider', label: 'Provider', type: 'text', possibleKeys: ['sms_api_provider', 'sms_provider', 'smsProvider'] },
      { key: 'sms_api_key', label: 'API Key', type: 'text', possibleKeys: ['sms_api_key', 'smsApiKey'] },
      { key: 'sms_api_sender_id', label: 'Sender ID', type: 'text', possibleKeys: ['sms_api_sender_id', 'sms_sender_id', 'smsSenderId'] },
      { key: 'sms_api_enabled', label: 'Enabled', type: 'toggle', possibleKeys: ['sms_api_enabled', 'sms_enabled', 'smsEnabled'] },
    ],
  },
  {
    title: 'KYC API',
    subtitle: 'Identity verification provider (e.g. Sumsub, Jumio).',
    fields: [
      { key: 'kyc_api_provider', label: 'Provider', type: 'text', possibleKeys: ['kyc_api_provider', 'kyc_provider', 'kycProvider'] },
      { key: 'kyc_api_base_url', label: 'Base URL', type: 'text', possibleKeys: ['kyc_api_base_url', 'kyc_base_url', 'kycBaseUrl'] },
      { key: 'kyc_api_key', label: 'API Key', type: 'text', possibleKeys: ['kyc_api_key', 'kycApiKey'] },
      { key: 'kyc_api_webhook_secret', label: 'Webhook Secret', type: 'text', possibleKeys: ['kyc_api_webhook_secret', 'kyc_webhook_secret', 'kycWebhookSecret'] },
      { key: 'kyc_api_enabled', label: 'Enabled', type: 'toggle', possibleKeys: ['kyc_api_enabled', 'kyc_enabled', 'kycEnabled'] },
    ],
  },
  {
    title: 'Chart API',
    subtitle: 'OHLCV / chart data (e.g. Binance, CoinGecko).',
    fields: [
      { key: 'chart_api_provider', label: 'Provider Name', type: 'text', possibleKeys: ['chart_api_provider', 'chart_provider', 'chartProvider'] },
      { key: 'chart_api_base_url', label: 'Base URL / Endpoint', type: 'text', possibleKeys: ['chart_api_base_url', 'chart_base_url', 'chartBaseUrl'] },
      { key: 'chart_api_key', label: 'API Key (optional)', type: 'text', possibleKeys: ['chart_api_key', 'chartApiKey'] },
      { key: 'chart_api_enabled', label: 'Enabled', type: 'toggle', possibleKeys: ['chart_api_enabled', 'chart_enabled', 'chartEnabled'] },
    ],
  },
  {
    title: 'RPC / Node API',
    subtitle: 'Blockchain RPC endpoints.',
    fields: [
      { key: 'rpc_network_name', label: 'Network Name', type: 'text', possibleKeys: ['rpc_network_name', 'rpc_network', 'rpcNetwork'] },
      { key: 'rpc_url', label: 'RPC URL', type: 'text', possibleKeys: ['rpc_url', 'rpcUrl'] },
      { key: 'rpc_fallback_url', label: 'Fallback RPC URL (optional)', type: 'text', possibleKeys: ['rpc_fallback_url', 'rpc_fallback', 'rpcFallbackUrl'] },
      { key: 'rpc_enabled', label: 'Enabled', type: 'toggle', possibleKeys: ['rpc_enabled', 'rpcEnabled'] },
    ],
  },
  {
    title: 'Market Data API',
    subtitle: 'Tickers, orderbook, or other market feeds.',
    fields: [
      { key: 'market_data_provider', label: 'Provider Name', type: 'text', possibleKeys: ['market_data_provider', 'marketDataProvider'] },
      { key: 'market_data_base_url', label: 'Base URL', type: 'text', possibleKeys: ['market_data_base_url', 'marketDataBaseUrl'] },
      { key: 'market_data_api_key', label: 'API Key (optional)', type: 'text', possibleKeys: ['market_data_api_key', 'marketDataApiKey'] },
      { key: 'market_data_rate_limit', label: 'Rate Limit (optional)', type: 'text', possibleKeys: ['market_data_rate_limit', 'marketDataRateLimit'] },
      { key: 'market_data_enabled', label: 'Enabled', type: 'toggle', possibleKeys: ['market_data_enabled', 'marketDataEnabled'] },
    ],
  },
];

export default function ApiSettingsPage() {
  const { accessToken } = useAdminAuthStore();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [apiSettingsList, setApiSettingsList] = useState<ApiSettingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genericRows, setGenericRows] = useState<{ key: string; value: string }[]>([]);

  const fetchSettings = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    const headers = { Authorization: `Bearer ${accessToken}` };
    try {
      const [resSettings, resApi] = await Promise.all([
        fetch(`${API_URL}/api/v1/admin/settings`, { headers }),
        fetch(`${API_URL}/api/v1/admin/settings/api`, { headers }),
      ]);
      const dataSettings = await resSettings.json();
      const dataApi = await resApi.json();

      if (dataApi?.success && Array.isArray(dataApi.data?.settings)) {
        setApiSettingsList(dataApi.data.settings as ApiSettingRow[]);
      } else {
        setApiSettingsList([]);
      }

      if (dataSettings?.success && typeof dataSettings.data === 'object') {
        const obj = (dataSettings.data as Record<string, string>) ?? {};
        setSettings(obj);
        setEdited(hydrateEditedFromSettings(obj, SECTIONS));
        const generic = Object.entries(obj)
          .filter(([k]) => k.startsWith(API_CONFIG_PREFIX))
          .map(([k, v]) => ({ key: k.slice(API_CONFIG_PREFIX.length), value: String(v ?? '') }));
        setGenericRows(generic.length ? generic : [{ key: '', value: '' }]);
      } else {
        setSettings({});
        setEdited(hydrateEditedFromSettings({}, SECTIONS));
        setGenericRows([{ key: '', value: '' }]);
      }
    } catch {
      setError('Failed to load settings');
      setSettings({});
      setEdited(hydrateEditedFromSettings({}, SECTIONS));
      setApiSettingsList([]);
      setGenericRows([{ key: '', value: '' }]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const resolvedFromSettings = useMemo(
    () => hydrateEditedFromSettings(settings, SECTIONS),
    [settings]
  );

  const isDirty = useMemo(() => {
    for (const section of SECTIONS) {
      for (const f of section.fields) {
        if ((resolvedFromSettings[f.key] ?? '') !== (edited[f.key] ?? '')) return true;
      }
    }
    const editedGeneric = genericRows
      .filter((r) => r.key.trim())
      .map((r) => [API_CONFIG_PREFIX + r.key.trim(), r.value] as const);
    const currentGeneric = Object.entries(settings)
      .filter(([k]) => k.startsWith(API_CONFIG_PREFIX))
      .map(([k, v]) => [k, String(v ?? '')] as const);
    if (editedGeneric.length !== currentGeneric.length) return true;
    const mapCur = Object.fromEntries(currentGeneric);
    for (const [k, v] of editedGeneric) {
      if (mapCur[k] !== v) return true;
    }
    return false;
  }, [resolvedFromSettings, edited, settings, genericRows]);

  /** Build payload with ONLY canonical flat keys (no legacy keys). */
  const buildPayload = useCallback(() => {
    const out: Record<string, string> = {};
    for (const section of SECTIONS) {
      for (const f of section.fields) {
        out[f.key] = edited[f.key] ?? '';
      }
    }
    for (const row of genericRows) {
      const k = row.key.trim();
      if (k) out[API_CONFIG_PREFIX + k] = row.value;
    }
    return out;
  }, [edited, genericRows]);

  const handleSave = async () => {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    const payload = buildPayload();
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/settings`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data?.success) {
        setSettings(payload);
        setEdited(hydrateEditedFromSettings(payload, SECTIONS));
      } else {
        setError(data?.error?.message ?? 'Failed to save');
      }
    } catch {
      setError('Request failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setEdited(hydrateEditedFromSettings(settings, SECTIONS));
    const generic = Object.entries(settings)
      .filter(([k]) => k.startsWith(API_CONFIG_PREFIX))
      .map(([k, v]) => ({ key: k.slice(API_CONFIG_PREFIX.length), value: String(v ?? '') }));
    setGenericRows(generic.length ? generic : [{ key: '', value: '' }]);
    setError(null);
  };

  const updateValue = (key: string, value: string) => {
    setEdited((prev) => ({ ...prev, [key]: value }));
  };

  const toggleBool = (key: string, on: boolean) => {
    updateValue(key, on ? 'true' : 'false');
  };

  const addGenericRow = () => setGenericRows((prev) => [...prev, { key: '', value: '' }]);
  const removeGenericRow = (i: number) => setGenericRows((prev) => prev.filter((_, idx) => idx !== i));
  const updateGenericRow = (i: number, field: 'key' | 'value', val: string) => {
    setGenericRows((prev) => {
      const next = [...prev];
      next[i] = { ...next[i]!, [field]: val };
      return next;
    });
  };

  return (
    <div className="space-y-8 pb-28">
      <SectionHeader
        title="API Settings"
        subtitle="Third-party integrations via key-value settings. Stored with existing settings API."
        action={
          <div className="flex items-center gap-2">
            <ActionButton variant="secondary" onClick={fetchSettings} loading={loading} icon={<RefreshCw className="w-4 h-4" />}>
              Refresh
            </ActionButton>
          </div>
        }
      />

      <Link href="/admin/settings" className="inline-block text-sm text-primary hover:underline">
        ← System Settings
      </Link>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {!loading && apiSettingsList.length > 0 && (
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-muted/30">
            <h2 className="text-sm font-semibold text-foreground">Configured APIs (lagayi hui)</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              APIs from database (api_settings). Ye wahi list hai jo purane admin mein dikhti thi.
            </p>
          </div>
          <div className="p-5">
            {(() => {
              const byCategory = apiSettingsList.reduce<Record<string, ApiSettingRow[]>>((acc, row) => {
                const c = row.category || 'other';
                if (!acc[c]) acc[c] = [];
                acc[c].push(row);
                return acc;
              }, {});
              const order = ['email', 'sms', 'kyc', 'chart', 'rpc', 'market_data'];
              const categories = Array.from(new Set([...order, ...Object.keys(byCategory)]));
              return (
                <div className="space-y-6">
                  {categories.map((cat) => {
                    const rows = byCategory[cat] || [];
                    if (rows.length === 0) return null;
                    const label = CATEGORY_LABELS[cat] || cat;
                    return (
                      <div key={cat}>
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{label}</h3>
                        <div className="rounded-lg border border-border overflow-hidden">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-muted/50 border-b border-border">
                                <th className="text-left px-3 py-2 font-medium text-foreground">Provider</th>
                                <th className="text-left px-3 py-2 font-medium text-foreground">Name</th>
                                <th className="text-left px-3 py-2 font-medium text-foreground">API Key</th>
                                <th className="text-left px-3 py-2 font-medium text-foreground">Active</th>
                                <th className="text-left px-3 py-2 font-medium text-foreground">Default</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((row) => (
                                <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                                  <td className="px-3 py-2 text-foreground">{row.provider}</td>
                                  <td className="px-3 py-2 text-foreground">{row.name}</td>
                                  <td className="px-3 py-2 font-mono text-muted-foreground">
                                    {row.api_key ? (row.api_key.length > 8 ? `${row.api_key.slice(0, 4)}…${row.api_key.slice(-4)}` : '••••') : '—'}
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${row.is_active ? 'bg-green-500/20 text-green-700 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
                                      {row.is_active ? 'Yes' : 'No'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2">
                                    {row.is_default ? (
                                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-primary/20 text-primary">Default</span>
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {loading && Object.keys(settings).length === 0 && apiSettingsList.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {SECTIONS.map(({ title, subtitle, fields }) => (
            <div
              key={title}
              className="rounded-xl border border-border bg-card shadow-sm overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-border bg-muted/30">
                <h2 className="text-sm font-semibold text-foreground">{title}</h2>
                {subtitle && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
                )}
              </div>
              <div className="p-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {fields.map((f) => {
                    if (f.type === 'toggle') {
                      const checked = (edited[f.key] ?? '') === 'true';
                      return (
                        <div
                          key={f.key}
                          className="flex items-center justify-between gap-3 py-1 sm:col-span-2"
                        >
                          <div>
                            <span className="text-sm font-medium text-foreground">{f.label}</span>
                            {f.description && (
                              <p className="text-xs text-muted-foreground mt-0.5">{f.description}</p>
                            )}
                          </div>
                          <Toggle checked={checked} onChange={(on) => toggleBool(f.key, on)} />
                        </div>
                      );
                    }
                    return (
                      <div key={f.key} className="space-y-1 sm:col-span-2">
                        <label className="block text-sm font-medium text-foreground">{f.label}</label>
                        {f.description && (
                          <p className="text-xs text-muted-foreground">{f.description}</p>
                        )}
                        <input
                          type="text"
                          value={edited[f.key] ?? ''}
                          onChange={(e) => updateValue(f.key, e.target.value)}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                          placeholder={f.label}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-muted/30">
            <h2 className="text-sm font-semibold text-foreground">Generic Third-Party APIs</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Dynamic key-value configs. Keys stored with prefix <code className="bg-muted px-1 rounded">{API_CONFIG_PREFIX}</code>.
            </p>
          </div>
          <div className="p-5 space-y-3">
            <div className="grid grid-cols-[1fr_1fr_auto] gap-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              <span>Key</span>
              <span>Value</span>
              <span className="w-10" />
            </div>
            {genericRows.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-3 items-center">
                <input
                  type="text"
                  value={row.key}
                  onChange={(e) => updateGenericRow(i, 'key', e.target.value)}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="config_key"
                />
                <input
                  type="text"
                  value={row.value}
                  onChange={(e) => updateGenericRow(i, 'value', e.target.value)}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="value"
                />
                <button
                  type="button"
                  onClick={() => removeGenericRow(i)}
                  className="p-2 text-muted-foreground hover:text-destructive hover:bg-muted rounded-lg transition-colors"
                  aria-label="Delete row"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <ActionButton variant="secondary" onClick={addGenericRow} icon={<Plus className="w-4 h-4" />}>
              Add API Config
            </ActionButton>
          </div>
        </div>
      )}

      {isDirty && (
        <footer
          role="region"
          aria-label="Unsaved changes"
          className="fixed bottom-0 left-0 right-0 lg:left-[220px] z-30 border-t border-border bg-card shadow-lg px-4 py-3"
        >
          <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-4">
            <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
              You have unsaved changes
            </span>
            <div className="flex items-center gap-2">
              <ActionButton variant="secondary" onClick={handleReset} icon={<RotateCcw className="w-4 h-4" />}>
                Reset
              </ActionButton>
              <ActionButton variant="primary" onClick={handleSave} loading={saving} icon={<Save className="w-4 h-4" />}>
                Save Changes
              </ActionButton>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
