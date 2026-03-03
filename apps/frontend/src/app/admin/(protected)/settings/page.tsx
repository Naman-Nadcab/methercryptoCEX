'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { SectionHeader, Panel, ActionButton } from '@/components/admin/control-plane';
import { Loader2, RefreshCw, Save, AlertTriangle, RotateCcw, Settings } from 'lucide-react';
import Link from 'next/link';
import {
  SETTINGS_SECTIONS,
  getSettingMeta,
  isBooleanKey,
  isVipFeeKey,
  parseVipFeeJson,
  stringifyVipFeeJson,
  type VipFeeRow,
} from './settings-meta';

const API_URL = getApiBaseUrl();

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 shrink-0 rounded-full border border-border bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 ${
        checked ? 'bg-primary border-primary' : ''
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-card shadow ring-0 transition-transform mt-0.5 ml-0.5 ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export default function SettingsPage() {
  const { accessToken } = useAdminAuthStore();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/settings`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (data?.success && typeof data.data === 'object') {
        const obj = data.data as Record<string, string>;
        setSettings(obj);
        setEdited(obj);
      } else {
        setSettings({});
        setEdited({});
      }
    } catch {
      setError('Failed to load settings');
      setSettings({});
      setEdited({});
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const isDirty = useMemo(() => {
    const keys = new Set([...Object.keys(settings), ...Object.keys(edited)]);
    for (const k of Array.from(keys)) {
      if ((settings[k] ?? '') !== (edited[k] ?? '')) return true;
    }
    return false;
  }, [settings, edited]);

  const handleSave = async () => {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/admin/settings`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(edited),
      });
      const data = await res.json();
      if (data?.success) {
        setSettings(edited);
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
    setEdited(settings);
    setError(null);
  };

  const updateValue = (key: string, value: string) => {
    setEdited((prev) => ({ ...prev, [key]: value }));
  };

  const toggleBool = (key: string, on: boolean) => {
    updateValue(key, on ? 'true' : 'false');
  };

  const keysBySection = useMemo(() => {
    const allKeys = Array.from(new Set([...Object.keys(edited)])).sort();
    const bySection: Record<string, string[]> = {};
    for (const section of SETTINGS_SECTIONS) {
      bySection[section] = [];
    }
    for (const key of allKeys) {
      const meta = getSettingMeta(key);
      const section = meta.section;
      if (!bySection[section]) bySection[section] = [];
      bySection[section].push(key);
    }
    return bySection;
  }, [edited]);

  return (
    <div className="space-y-6 pb-24">
      <SectionHeader
        title="System Settings"
        subtitle="Structured key-value settings. Changes are saved to the existing API."
        action={
          <div className="flex items-center gap-2">
            <ActionButton
              variant="secondary"
              onClick={fetchSettings}
              loading={loading}
              icon={<RefreshCw className="w-4 h-4" />}
            >
              Refresh
            </ActionButton>
          </div>
        }
      />

      <Panel title="System Controls" subtitle="Quick links (matches sidebar).">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <Link href="/admin/settings" className="flex items-center gap-2 px-3 py-2 rounded-[4px] bg-muted/50 text-foreground text-[12px] font-medium hover:bg-muted">
            <Settings className="w-4 h-4 text-muted-foreground" />
            System Settings
          </Link>
          <Link href="/admin/system/api-settings" className="flex items-center gap-2 px-3 py-2 rounded-[4px] bg-muted/50 text-foreground text-[12px] font-medium hover:bg-muted">
            <Settings className="w-4 h-4 text-muted-foreground" />
            API Settings
          </Link>
          <Link href="/admin/settings/features" className="flex items-center gap-2 px-3 py-2 rounded-[4px] bg-muted/50 text-foreground text-[12px] font-medium hover:bg-muted">
            <Settings className="w-4 h-4 text-muted-foreground" />
            Feature Flags
          </Link>
          <Link href="/admin/settings/blockchain" className="flex items-center gap-2 px-3 py-2 rounded-[4px] bg-muted/50 text-foreground text-[12px] font-medium hover:bg-muted">
            <Settings className="w-4 h-4 text-muted-foreground" />
            Blockchain / Token Config
          </Link>
          <Link href="/admin/monitoring/counters" className="flex items-center gap-2 px-3 py-2 rounded-[4px] bg-muted/50 text-foreground text-[12px] font-medium hover:bg-muted">
            <Settings className="w-4 h-4 text-muted-foreground" />
            Counters / Limits
          </Link>
        </div>
      </Panel>

      {error && (
        <div className="rounded-[4px] border border-destructive/30 bg-destructive/10 px-3 py-2 flex items-center gap-2 text-[12px] text-destructive">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading && Object.keys(settings).length === 0 ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : (
        <>
          {SETTINGS_SECTIONS.map((section) => {
            const keys = keysBySection[section];
            if (!keys || keys.length === 0) return null;
            const vipKeys = keys.filter(isVipFeeKey);
            const otherKeys = keys.filter((k) => !isVipFeeKey(k));
            const hasVip = vipKeys.length > 0;

            return (
              <Panel key={section} title={section} noPadding={false}>
                <div className="space-y-4">
                  {otherKeys.map((key) => {
                    const meta = getSettingMeta(key);
                    const value = edited[key] ?? '';
                    const isBool = isBooleanKey(key);

                    if (isBool) {
                      const checked = value === 'true';
                      return (
                        <div key={key} className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-[13px] font-medium text-foreground">{meta.label}</p>
                            {meta.description && (
                              <p className="text-[11px] text-muted-foreground mt-0.5">{meta.description}</p>
                            )}
                          </div>
                          <Toggle
                            checked={checked}
                            onChange={(on) => toggleBool(key, on)}
                          />
                        </div>
                      );
                    }

                    if (meta.type === 'number') {
                      const num = value === '' ? '' : String(parseFloat(value));
                      return (
                        <div key={key}>
                          <label className="block text-[13px] font-medium text-foreground mb-1">{meta.label}</label>
                          <input
                            type="number"
                            value={num}
                            onChange={(e) => updateValue(key, e.target.value)}
                            className="w-full max-w-xs rounded-[4px] border border-border bg-background px-3 py-2 text-[12px] text-foreground"
                            placeholder="0"
                            step="any"
                          />
                        </div>
                      );
                    }

                    return (
                      <div key={key}>
                        <label className="block text-[13px] font-medium text-foreground mb-1">{meta.label}</label>
                        <input
                          type="text"
                          value={value}
                          onChange={(e) => updateValue(key, e.target.value)}
                          className="w-full max-w-md rounded-[4px] border border-border bg-background px-3 py-2 text-[12px] text-foreground placeholder:text-muted-foreground"
                          placeholder="(empty)"
                        />
                      </div>
                    );
                  })}

                  {hasVip && (
                    <div className="pt-2">
                      <p className="text-[13px] font-medium text-foreground mb-2">VIP Fee Rates</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[12px] border border-border rounded-[4px]" data-admin-table>
                          <thead>
                            <tr className="border-b border-border bg-muted/40">
                              <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase">VIP Level</th>
                              <th className="px-3 py-2 text-right text-[11px] font-semibold text-muted-foreground uppercase">Spot Maker</th>
                              <th className="px-3 py-2 text-right text-[11px] font-semibold text-muted-foreground uppercase">Spot Taker</th>
                              <th className="px-3 py-2 text-right text-[11px] font-semibold text-muted-foreground uppercase">Fiat Maker</th>
                              <th className="px-3 py-2 text-right text-[11px] font-semibold text-muted-foreground uppercase">Fiat Taker</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {vipKeys.sort().map((key) => {
                              const level = key.replace('fee_rates_vip_', '');
                              const raw = edited[key] ?? '';
                              const row = parseVipFeeJson(raw);
                              const updateRow = (next: VipFeeRow) => updateValue(key, stringifyVipFeeJson(next));
                              return (
                                <tr key={key} className="hover:bg-muted/40">
                                  <td className="px-3 py-2 font-medium text-foreground">VIP {level}</td>
                                  <td className="px-3 py-2">
                                    <input
                                      type="number"
                                      step="0.0001"
                                      className="w-full rounded-[4px] border border-border bg-background px-2 py-1 text-right text-[12px] tabular-nums"
                                      value={row.spot_maker ?? ''}
                                      onChange={(e) => updateRow({ ...row, spot_maker: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      type="number"
                                      step="0.0001"
                                      className="w-full rounded-[4px] border border-border bg-background px-2 py-1 text-right text-[12px] tabular-nums"
                                      value={row.spot_taker ?? ''}
                                      onChange={(e) => updateRow({ ...row, spot_taker: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      type="number"
                                      step="0.0001"
                                      className="w-full rounded-[4px] border border-border bg-background px-2 py-1 text-right text-[12px] tabular-nums"
                                      value={row.fiat_maker ?? ''}
                                      onChange={(e) => updateRow({ ...row, fiat_maker: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      type="number"
                                      step="0.0001"
                                      className="w-full rounded-[4px] border border-border bg-background px-2 py-1 text-right text-[12px] tabular-nums"
                                      value={row.fiat_taker ?? ''}
                                      onChange={(e) => updateRow({ ...row, fiat_taker: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </Panel>
            );
          })}
        </>
      )}

      {isDirty && (
        <footer className="fixed bottom-0 left-0 right-0 lg:left-[220px] z-30 px-3 py-2 border-t border-border bg-card text-[12px] flex items-center justify-between gap-4 shadow-lg">
          <span className="text-amber-600 dark:text-amber-400 font-medium">You have unsaved changes</span>
          <div className="flex items-center gap-2">
            <ActionButton variant="secondary" onClick={handleReset} icon={<RotateCcw className="w-4 h-4" />}>
              Reset
            </ActionButton>
            <ActionButton variant="primary" onClick={handleSave} loading={saving} icon={<Save className="w-4 h-4" />}>
              Save Changes
            </ActionButton>
          </div>
        </footer>
      )}
    </div>
  );
}
