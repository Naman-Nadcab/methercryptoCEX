'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminAuthStore } from '@/store/auth';
import {
  getSystemSettings,
  patchSystemSettings,
  getSystemFeatures,
  patchSystemFeature,
  postEmergencyAction,
  getSystemSettingsHistory,
  getSystemSettingsVersionDiff,
  postSystemSettingsRollback,
  getSystemProfiles,
  patchSystemProfile,
  postSystemApplyProfile,
  getSystemSafeMode,
  postSystemSafeMode,
  getSystemFeatureDependencies,
  postSystemFeatureDependency,
  patchSystemFeatureDependency,
  deleteSystemFeatureDependency,
  getOperationalWalletStatus,
  patchOperationalWalletStatus,
  type FeatureFlagRow,
  type FeatureDependencyRow,
  type ConfigVersionRow,
} from '@/lib/system-api';
import { getRiskSettings, patchRiskSettings, type RiskSettings } from '@/lib/risk-api';
import { getTradingHalt, setTradingHalt } from '@/lib/trading-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { ArrowLeft, Power, PowerOff, AlertTriangle, History, RotateCcw, GitCompare, Shield, Layers, Search, Download, Upload, GitBranch, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SensitiveActionModal } from '@/components/ops/SensitiveActionModal';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';

const TRADING_KEYS = ['default_maker_fee', 'default_taker_fee', 'min_order_size'];
const LIMIT_KEYS = ['api_rate_limit', 'max_withdrawal_per_day', 'max_orders_per_minute', 'max_login_attempts'];
const RISK_KEYS = ['large_withdrawal_threshold', 'whale_trade_threshold', 'aml_alert_sensitivity', 'cancel_rate_threshold', 'market_manipulation_window'];
const EMERGENCY_PREFIX = ['emergency_pause_trading', 'emergency_disable_withdrawals', 'emergency_disable_deposits', 'emergency_disable_p2p', 'safe_mode'];
const KNOWN_KEYS = new Set([...TRADING_KEYS, ...LIMIT_KEYS, ...RISK_KEYS, ...EMERGENCY_PREFIX]);

function toExportValue(value: string): string | number {
  const trimmed = String(value).trim();
  if (trimmed === '' || trimmed === '1' || trimmed === '0') return trimmed === '1' ? 1 : trimmed === '0' ? 0 : trimmed;
  const num = Number(trimmed);
  if (!Number.isNaN(num) && String(num) === trimmed) return num;
  return trimmed;
}

function buildExportPayload(settings: Record<string, { value: string }>): Record<string, Record<string, string | number>> {
  const trading: Record<string, string | number> = {};
  const limits: Record<string, string | number> = {};
  const risk: Record<string, string | number> = {};
  const emergency: Record<string, string | number> = {};
  const other: Record<string, string | number> = {};
  for (const [key, entry] of Object.entries(settings)) {
    const val = toExportValue(entry.value);
    if (TRADING_KEYS.includes(key)) trading[key] = val;
    else if (LIMIT_KEYS.includes(key)) limits[key] = val;
    else if (RISK_KEYS.includes(key)) risk[key] = val;
    else if (EMERGENCY_PREFIX.includes(key) || key === 'safe_mode') emergency[key] = val;
    else other[key] = val;
  }
  const out: Record<string, Record<string, string | number>> = {};
  if (Object.keys(trading).length) out.trading = trading;
  if (Object.keys(limits).length) out.limits = limits;
  if (Object.keys(risk).length) out.risk = risk;
  if (Object.keys(emergency).length) out.emergency = emergency;
  if (Object.keys(other).length) out.other = other;
  return out;
}

function flattenImportPayload(obj: unknown): { ok: true; data: Record<string, string> } | { ok: false; error: string } {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'Invalid JSON: root must be an object.' };
  }
  const record = obj as Record<string, unknown>;
  const flat: Record<string, string> = {};
  const groupKeys = ['trading', 'limits', 'risk', 'emergency', 'other'];
  const isGrouped = groupKeys.some((k) => k in record);
  if (isGrouped) {
    for (const group of groupKeys) {
      const val = record[group];
      if (val === undefined) continue;
      if (val === null || typeof val !== 'object' || Array.isArray(val)) {
        return { ok: false, error: `Invalid structure: "${group}" must be an object.` };
      }
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (typeof k !== 'string' || k.startsWith('_')) continue;
        flat[k] = v != null ? String(v) : '';
      }
    }
  } else {
    for (const [k, v] of Object.entries(record)) {
      if (typeof k !== 'string' || k.startsWith('_')) continue;
      flat[k] = v != null ? String(v) : '';
    }
  }
  if (Object.keys(flat).length === 0) {
    return { ok: false, error: 'No settings to import.' };
  }
  return { ok: true, data: flat };
}

const ROLLOUT_OPTIONS = [
  { value: 'all', label: 'All users' },
  { value: 'beta', label: 'Beta users' },
  { value: 'tier', label: 'Specific tiers' },
];

const DEPENDENCY_BEHAVIOUR_OPTIONS = [
  { value: 'auto_disable', label: 'Disable child if parent disabled' },
  { value: 'warning_only', label: 'Show warning but allow enable' },
];

const LIMITS_VALIDATION: Record<string, { min: number; max: number }> = {
  api_rate_limit: { min: 10, max: 10000 },
  max_orders_per_minute: { min: 1, max: 1000 },
  max_withdrawal_per_day: { min: 100, max: 100000000 },
  max_login_attempts: { min: 3, max: 20 },
};

function getLimitFieldError(key: string, value: string): string | null {
  const num = Number(value);
  if (value.trim() === '' || Number.isNaN(num)) return 'Enter a valid number';
  if (!Number.isInteger(num) || num < 0) return 'Must be a whole number';
  const rules = LIMITS_VALIDATION[key];
  if (!rules) return null;
  if (num < rules.min) return `Min ${rules.min}`;
  if (num > rules.max) return `Max ${rules.max}`;
  return null;
}

function getLimitsErrors(form: Record<string, string>): Record<string, string> {
  const err: Record<string, string> = {};
  (Object.keys(LIMITS_VALIDATION) as (keyof typeof LIMITS_VALIDATION)[]).forEach((key) => {
    const msg = getLimitFieldError(key, form[key] ?? '');
    if (msg) err[key] = msg;
  });
  return err;
}

type SystemTab = 'configuration' | 'version-history';

export default function SystemSettingsPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<SystemTab>('configuration');
  const [emergencyModal, setEmergencyModal] = useState<{ action: string; label: string; enabled: boolean } | null>(null);
  const [emergencyReason, setEmergencyReason] = useState('');
  const [tradingPauseModalOpen, setTradingPauseModalOpen] = useState(false);
  const [diffModal, setDiffModal] = useState<{ versionId: string; versionNum: number } | null>(null);
  const [rollbackModal, setRollbackModal] = useState<ConfigVersionRow | null>(null);
  const [importPreview, setImportPreview] = useState<{ flat: Record<string, string> } | { error: string } | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);

  const { data: settingsData } = useQuery({
    queryKey: ['admin', 'system', 'settings', token],
    staleTime: 30_000,
    queryFn: () => getSystemSettings(token),
    enabled: !!token,
  });
  const { data: featuresData } = useQuery({
    queryKey: ['admin', 'system', 'features', token],
    staleTime: 30_000,
    queryFn: () => getSystemFeatures(token),
    enabled: !!token,
  });
  const { data: riskData } = useQuery({
    queryKey: ['admin', 'risk', 'settings', token],
    staleTime: 30_000,
    queryFn: () => getRiskSettings(token),
    enabled: !!token,
  });
  const { data: haltData } = useQuery({
    queryKey: ['admin', 'trading-halt', token],
    staleTime: 30_000,
    queryFn: () => getTradingHalt(token),
    enabled: !!token,
  });
  const { data: historyData } = useQuery({
    queryKey: ['admin', 'system', 'settings', 'history', token],
    staleTime: 30_000,
    queryFn: () => getSystemSettingsHistory(token),
    enabled: !!token && activeTab === 'version-history',
  });
  const { data: diffData } = useQuery({
    queryKey: ['admin', 'system', 'settings', 'diff', diffModal?.versionId, token],
    staleTime: 30_000,
    queryFn: () => getSystemSettingsVersionDiff(token, diffModal!.versionId),
    enabled: !!token && !!diffModal?.versionId,
  });
  const { data: profilesData } = useQuery({
    queryKey: ['admin', 'system', 'profiles', token],
    staleTime: 30_000,
    queryFn: () => getSystemProfiles(token),
    enabled: !!token,
  });
  const { data: safeModeData } = useQuery({
    queryKey: ['admin', 'system', 'safe-mode', token],
    staleTime: 30_000,
    queryFn: () => getSystemSafeMode(token),
    enabled: !!token,
  });
  const { data: depsData } = useQuery({
    queryKey: ['admin', 'system', 'features', 'dependencies', token],
    staleTime: 30_000,
    queryFn: () => getSystemFeatureDependencies(token),
    enabled: !!token,
  });
  const { data: walletStatusData } = useQuery({
    queryKey: ['admin', 'operational', 'wallet-status', token],
    staleTime: 30_000,
    queryFn: () => getOperationalWalletStatus(token),
    enabled: !!token,
  });

  const settings = settingsData?.data?.settings ?? {};
  const features = (featuresData?.data?.features ?? []) as FeatureFlagRow[];
  const risk = riskData?.data;
  const tradingHalted = haltData?.data?.halted ?? false;

  const [tradingForm, setTradingForm] = useState({ default_maker_fee: '0.1', default_taker_fee: '0.1', min_order_size: '0.0001' });
  const [limitsForm, setLimitsForm] = useState({
    api_rate_limit: '60',
    max_withdrawal_per_day: '100000',
    max_orders_per_minute: '100',
    max_login_attempts: '5',
  });
  const [riskForm, setRiskForm] = useState({ large_withdrawal_threshold: 10000, whale_trade_threshold: 100000, cancel_rate_threshold: 80, market_manipulation_window: 300 });

  const [featureSearch, setFeatureSearch] = useState('');
  const [featureSearchDebounced, setFeatureSearchDebounced] = useState('');
  const [featureStatusFilter, setFeatureStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [featureRolloutFilter, setFeatureRolloutFilter] = useState<'all' | 'all_users' | 'beta' | 'tier'>('all');
  const [selectedFeatureKeys, setSelectedFeatureKeys] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<{ action: 'enable' | 'disable'; count: number } | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [saveToProfileTarget, setSaveToProfileTarget] = useState<string>('production');
  const [saveToProfileConfirm, setSaveToProfileConfirm] = useState<string | null>(null);
  const [saveToProfilePending, setSaveToProfilePending] = useState(false);
  const [dependencyModal, setDependencyModal] = useState<'add' | { edit: FeatureDependencyRow } | null>(null);
  const [dependencyForm, setDependencyForm] = useState({ feature_key: '', requires_feature_key: '', behaviour: 'auto_disable' as string });
  const [dependencySaveConfirm, setDependencySaveConfirm] = useState(false);
  const [deleteDependencyTarget, setDeleteDependencyTarget] = useState<{ feature_key: string; requires_feature_key: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setFeatureSearchDebounced(featureSearch), 300);
    return () => clearTimeout(t);
  }, [featureSearch]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleBulkConfirm = async () => {
    if (!bulkConfirm) return;
    const keys = Array.from(selectedFeatureKeys);
    const action = bulkConfirm.action;
    const newStatus = action === 'enable' ? 'enabled' : 'disabled';
    setBulkPending(true);
    let failed = false;
    for (const key of keys) {
      try {
        await patchSystemFeature(token, { feature_key: key, status: newStatus });
      } catch {
        failed = true;
        break;
      }
    }
    queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'features'] });
    setBulkPending(false);
    setBulkConfirm(null);
    setSelectedFeatureKeys(new Set());
    if (failed) setToast({ type: 'error', message: 'One or more updates failed.' });
    else setToast({ type: 'success', message: `${keys.length} feature flags ${action === 'enable' ? 'enabled' : 'disabled'}.` });
  };

  const toggleFeatureSelection = (featureKey: string) => {
    setSelectedFeatureKeys((prev) => {
      const next = new Set(prev);
      if (next.has(featureKey)) next.delete(featureKey);
      else next.add(featureKey);
      return next;
    });
  };

  const toggleSelectAllFeatures = () => {
    if (selectedFeatureKeys.size === filteredFeatures.length) setSelectedFeatureKeys(new Set());
    else setSelectedFeatureKeys(new Set(filteredFeatures.map((f) => f.feature_key)));
  };

  const handleSaveToProfileConfirm = async () => {
    const profileName = saveToProfileConfirm;
    if (!profileName) return;
    const settingsPayload: Record<string, string> = {};
    for (const [key, entry] of Object.entries(settings)) {
      settingsPayload[key] = (entry as { value?: string })?.value ?? '';
    }
    setSaveToProfilePending(true);
    try {
      await patchSystemProfile(token, profileName, settingsPayload);
      queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'profiles'] });
      setSaveToProfileConfirm(null);
      setToast({ type: 'success', message: `Profile "${profileName}" saved successfully.` });
    } catch {
      setToast({ type: 'error', message: 'Failed to save profile.' });
    } finally {
      setSaveToProfilePending(false);
    }
  };

  const filteredFeatures = useMemo(() => {
    return features.filter((f) => {
      const q = featureSearchDebounced.trim().toLowerCase();
      if (q) {
        const nameMatch = f.feature_key.toLowerCase().includes(q);
        const descMatch = (f.description ?? '').toLowerCase().includes(q);
        if (!nameMatch && !descMatch) return false;
      }
      if (featureStatusFilter !== 'all' && f.status !== featureStatusFilter) return false;
      if (featureRolloutFilter !== 'all') {
        const rolloutValue = featureRolloutFilter === 'all_users' ? 'all' : featureRolloutFilter;
        if (f.rollout !== rolloutValue) return false;
      }
      return true;
    });
  }, [features, featureSearchDebounced, featureStatusFilter, featureRolloutFilter]);

  useEffect(() => {
    const el = selectAllCheckboxRef.current;
    if (!el) return;
    const ind = filteredFeatures.length > 0 && selectedFeatureKeys.size > 0 && selectedFeatureKeys.size < filteredFeatures.length;
    el.indeterminate = ind;
  }, [filteredFeatures.length, selectedFeatureKeys.size]);

  const limitsErrors = useMemo(() => getLimitsErrors(limitsForm), [limitsForm]);
  const limitsFormValid = Object.keys(limitsErrors).length === 0;

  useEffect(() => {
    TRADING_KEYS.forEach((k) => {
      const v = settings[k]?.value;
      if (v !== undefined) setTradingForm((f) => ({ ...f, [k]: v }));
    });
  }, [settings]);
  useEffect(() => {
    LIMIT_KEYS.forEach((k) => {
      const v = settings[k]?.value;
      if (v !== undefined) setLimitsForm((f) => ({ ...f, [k]: v }));
    });
  }, [settings]);
  useEffect(() => {
    if (risk) {
      setRiskForm({
        large_withdrawal_threshold: risk.large_withdrawal_threshold,
        whale_trade_threshold: risk.whale_trade_threshold,
        cancel_rate_threshold: risk.cancel_rate_threshold,
        market_manipulation_window: risk.market_manipulation_window ?? 300,
      });
    }
  }, [risk]);

  const patchSettingsMutation = useMutation({
    mutationFn: (body: Record<string, string>) => patchSystemSettings(token, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'settings'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'settings', 'history'] });
    },
  });
  const patchFeatureMutation = useMutation({
    mutationFn: (body: { id?: string; feature_key?: string; status?: string; rollout?: string }) => patchSystemFeature(token, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'features'] }),
  });
  const patchRiskMutation = useMutation({
    mutationFn: (body: Partial<RiskSettings>) => patchRiskSettings(token, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'risk', 'settings'] }),
  });
  const haltMutation = useMutation({
    mutationFn: ({ halted, reason }: { halted: boolean; reason?: string }) =>
      setTradingHalt(token, halted, reason ? { reason } : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'trading-halt'] });
      setTradingPauseModalOpen(false);
    },
  });
  const emergencyMutation = useMutation({
    mutationFn: ({ action, enabled }: { action: string; enabled: boolean }) => postEmergencyAction(token, action, enabled),
    onSuccess: (_, { action }) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'settings'] });
      if (action === 'pause_trading') queryClient.invalidateQueries({ queryKey: ['admin', 'trading-halt'] });
      if (action === 'disable_withdrawals' || action === 'disable_deposits') {
        queryClient.invalidateQueries({ queryKey: ['admin', 'operational', 'wallet-status'] });
      }
      setEmergencyModal(null);
    },
  });
  const rollbackMutation = useMutation({
    mutationFn: (version_id: string) => postSystemSettingsRollback(token, version_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'settings'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'settings', 'history'] });
      setRollbackModal(null);
    },
  });
  const applyProfileMutation = useMutation({
    mutationFn: (profile: string) => postSystemApplyProfile(token, profile),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'settings'] });
    },
  });
  const safeModeMutation = useMutation({
    mutationFn: (enabled: boolean) => postSystemSafeMode(token, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'safe-mode'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'settings'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'trading-halt'] });
    },
  });
  const walletStatusMutation = useMutation({
    mutationFn: (body: { depositPaused?: boolean; withdrawalPaused?: boolean }) =>
      patchOperationalWalletStatus(token, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'operational', 'wallet-status'] });
    },
  });
  const importSettingsMutation = useMutation({
    mutationFn: (payload: Record<string, string>) => patchSystemSettings(token, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'settings'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'settings', 'history'] });
      setImportPreview(null);
    },
  });
  const postDependencyMutation = useMutation({
    mutationFn: (body: { feature_key: string; requires_feature_key: string; behaviour?: string }) =>
      postSystemFeatureDependency(token, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'features', 'dependencies'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'features'] });
      setDependencyModal(null);
      setDependencySaveConfirm(false);
      setDependencyForm({ feature_key: '', requires_feature_key: '', behaviour: 'auto_disable' });
      setToast({ type: 'success', message: 'Dependency rule saved.' });
    },
    onError: () => setToast({ type: 'error', message: 'Failed to save dependency.' }),
  });
  const patchDependencyMutation = useMutation({
    mutationFn: (body: { feature_key: string; requires_feature_key: string; behaviour: string }) =>
      patchSystemFeatureDependency(token, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'features', 'dependencies'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'features'] });
      setDependencyModal(null);
      setDependencySaveConfirm(false);
      setDependencyForm({ feature_key: '', requires_feature_key: '', behaviour: 'auto_disable' });
      setToast({ type: 'success', message: 'Dependency rule updated.' });
    },
    onError: () => setToast({ type: 'error', message: 'Failed to update dependency.' }),
  });
  const deleteDependencyMutation = useMutation({
    mutationFn: (params: { feature_key: string; requires_feature_key: string }) =>
      deleteSystemFeatureDependency(token, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'features', 'dependencies'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'system', 'features'] });
      setDeleteDependencyTarget(null);
      setToast({ type: 'success', message: 'Dependency rule deleted.' });
    },
    onError: () => setToast({ type: 'error', message: 'Failed to delete dependency.' }),
  });

  const versions = (historyData?.data?.versions ?? []) as ConfigVersionRow[];
  const historyUniqueAdmins = useMemo(() => {
    const names = Array.from(
      new Set(versions.map((v) => v.updated_by).filter((x): x is string => x != null && x !== ''))
    );
    return names.sort((a, b) => a.localeCompare(b));
  }, [versions]);

  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');
  const [historyUpdatedBy, setHistoryUpdatedBy] = useState('');

  const filteredVersions = useMemo(() => {
    return versions.filter((v) => {
      if (historyStartDate) {
        const rowDate = v.timestamp ? new Date(v.timestamp) : null;
        const start = new Date(historyStartDate);
        start.setHours(0, 0, 0, 0);
        if (rowDate && rowDate < start) return false;
      }
      if (historyEndDate) {
        const rowDate = v.timestamp ? new Date(v.timestamp) : null;
        const end = new Date(historyEndDate);
        end.setHours(23, 59, 59, 999);
        if (rowDate && rowDate > end) return false;
      }
      if (historyUpdatedBy && (v.updated_by ?? '') !== historyUpdatedBy) return false;
      return true;
    });
  }, [versions, historyStartDate, historyEndDate, historyUpdatedBy]);

  const profiles = profilesData?.data?.profiles ?? [];
  const safeMode = safeModeData?.data?.safe_mode ?? false;
  const walletStatus = walletStatusData?.data ?? { depositPaused: false, withdrawalPaused: false };
  const dependencies = depsData?.data?.dependencies ?? [];
  const dependsOnMap = dependencies.reduce<Record<string, string[]>>((acc, d) => {
    (acc[d.feature_key] = acc[d.feature_key] || []).push(d.requires_feature_key);
    return acc;
  }, {});

  const dynamicVars = Object.entries(settings).filter(([k]) => !KNOWN_KEYS.has(k) && !k.startsWith('emergency_'));

  const handleExportSettings = () => {
    const payload = buildExportPayload(settings);
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `system_settings_export_${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = typeof reader.result === 'string' ? reader.result : '';
        const parsed = JSON.parse(text) as unknown;
        const result = flattenImportPayload(parsed);
        if (result.ok) setImportPreview({ flat: result.data });
        else setImportPreview({ error: result.error });
      } catch {
        setImportPreview({ error: 'Invalid JSON file.' });
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  return (
    <AdminPageFrame
      title="Global configuration & feature flags"
      description="Toggle features, trading and risk settings, limits, and emergency controls."
      quickActions={
        <>
          <Link href="/settings">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <Button variant="secondary" size="sm" onClick={handleExportSettings}>
            <Download className="h-4 w-4 mr-1" />
            Export Settings
          </Button>
          <input
            ref={importFileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleImportFile}
          />
          <Button variant="secondary" size="sm" onClick={() => importFileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" />
            Import Settings
          </Button>
        </>
      }
    >
      <SensitiveActionModal
        open={tradingPauseModalOpen}
        onClose={() => setTradingPauseModalOpen(false)}
        onConfirm={(note) => haltMutation.mutate({ halted: true, reason: note })}
        title="Pause all spot trading"
        description="Required for audit compliance. Users cannot place or cancel orders while halted."
        variant="danger"
        confirmLabel="Pause trading"
        isLoading={haltMutation.isPending}
      />

      <div className="border-b border-admin-border">
        <nav className="flex gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('configuration')}
            className={cn(
              'border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              activeTab === 'configuration' ? 'border-admin-primary text-admin-primary' : 'border-transparent text-admin-muted hover:text-admin-text'
            )}
          >
            Configuration
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('version-history')}
            className={cn(
              'border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              activeTab === 'version-history' ? 'border-admin-primary text-admin-primary' : 'border-transparent text-admin-muted hover:text-admin-text'
            )}
          >
            Version history
          </button>
        </nav>
      </div>

      {activeTab === 'version-history' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Configuration version history
            </CardTitle>
            <p className="text-sm text-admin-muted">View previous versions and rollback if needed.</p>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm font-medium text-admin-text">Start date</label>
                <input
                  type="date"
                  value={historyStartDate}
                  onChange={(e) => setHistoryStartDate(e.target.value)}
                  className="rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm font-medium text-admin-text">End date</label>
                <input
                  type="date"
                  value={historyEndDate}
                  onChange={(e) => setHistoryEndDate(e.target.value)}
                  className="rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm font-medium text-admin-text">Updated by</label>
                <select
                  value={historyUpdatedBy}
                  onChange={(e) => setHistoryUpdatedBy(e.target.value)}
                  className="rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
                >
                  <option value="">All</option>
                  {historyUniqueAdmins.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-admin-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/[0.02]">
                  <tr>
                    <th className="px-4 py-3 font-medium text-admin-muted">Version</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Updated by</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Change summary</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Timestamp</th>
                    <th className="px-4 py-3 font-medium text-admin-muted">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-admin-muted">No version history yet. Changes to system settings will create versions.</td>
                    </tr>
                  ) : filteredVersions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-admin-muted">No matching versions.</td>
                    </tr>
                  ) : (
                    filteredVersions.map((v) => (
                      <tr key={v.id} className="border-t border-admin-border">
                        <td className="px-4 py-3 font-medium">{v.version}</td>
                        <td className="px-4 py-3 text-admin-muted">{v.updated_by ?? '—'}</td>
                        <td className="px-4 py-3 max-w-xs truncate text-admin-muted" title={v.change_summary ?? ''}>{v.change_summary ?? '—'}</td>
                        <td className="px-4 py-3 text-admin-muted text-xs">{v.timestamp ? new Date(v.timestamp).toLocaleString() : '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            <Button variant="secondary" size="sm" onClick={() => setDiffModal({ versionId: v.id, versionNum: v.version })}>
                              <GitCompare className="h-4 w-4" />
                              View diff
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => setRollbackModal(v)}>
                              <RotateCcw className="h-4 w-4" />
                              Rollback
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'configuration' && (
        <>
      {/* === SECTION: OPERATIONAL CONTROLS (CRITICAL) === */}
      <div className="rounded-lg border-l-4 border-red-500 bg-red-950/20 px-4 py-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-red-400">Operational Controls — Critical</h2>
        <p className="text-xs text-red-400/70">These directly affect user-facing deposit, withdrawal, and trading flows in real time.</p>
      </div>

      {/* Safe mode */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-admin-danger" />
            Safe mode
          </CardTitle>
          <p className="text-sm text-admin-muted">When enabled: disables withdrawals, trading, and API trading. Use during incidents.</p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border border-admin-border p-4">
            <span className="font-medium">Safe mode is {safeMode ? 'on' : 'off'}</span>
            <Button
              variant={safeMode ? 'secondary' : 'primary'}
              onClick={() => safeModeMutation.mutate(!safeMode)}
              disabled={safeModeMutation.isPending}
            >
              {safeMode ? 'Turn off safe mode' : 'Turn on safe mode'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-admin-danger" />
            Wallet operation controls
          </CardTitle>
          <p className="text-sm text-admin-muted">Operator kill-switches for deposit and withdrawal flows.</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-admin-border p-4">
              <div>
                <p className="font-medium">Deposits</p>
                <p className="text-xs text-admin-muted">Status: {walletStatus.depositPaused ? 'Paused' : 'Live'}</p>
              </div>
              <Button
                variant={walletStatus.depositPaused ? 'secondary' : 'primary'}
                onClick={() => walletStatusMutation.mutate({ depositPaused: !walletStatus.depositPaused })}
                disabled={walletStatusMutation.isPending}
              >
                {walletStatus.depositPaused ? 'Resume' : 'Pause'}
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-admin-border p-4">
              <div>
                <p className="font-medium">Withdrawals</p>
                <p className="text-xs text-admin-muted">Status: {walletStatus.withdrawalPaused ? 'Paused' : 'Live'}</p>
              </div>
              <Button
                variant={walletStatus.withdrawalPaused ? 'secondary' : 'primary'}
                onClick={() => walletStatusMutation.mutate({ withdrawalPaused: !walletStatus.withdrawalPaused })}
                disabled={walletStatusMutation.isPending}
              >
                {walletStatus.withdrawalPaused ? 'Resume' : 'Pause'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* === SECTION: SYSTEM CONFIGURATION (Non-critical) === */}
      <div className="rounded-lg border-l-4 border-blue-500 bg-blue-950/20 px-4 py-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-blue-400">System Configuration</h2>
        <p className="text-xs text-blue-400/70">Feature flags, profiles, trading/risk settings, and limits. Changes here do not immediately halt user flows.</p>
      </div>

      {/* Environment profiles */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Environment profiles
          </CardTitle>
          <p className="text-sm text-admin-muted">Apply a saved configuration profile (Production, Staging, Testing). Save current live settings to a profile to overwrite it.</p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            {['production', 'staging', 'testing'].map((name) => (
              <div key={name} className="flex items-center gap-2 rounded-lg border border-admin-border px-4 py-2">
                <span className="capitalize font-medium">{name}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => applyProfileMutation.mutate(name)}
                  disabled={applyProfileMutation.isPending}
                >
                  Apply profile
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-admin-border pt-4">
            <label className="text-sm font-medium text-admin-text">Save current settings to:</label>
            <select
              value={saveToProfileTarget}
              onChange={(e) => setSaveToProfileTarget(e.target.value)}
              className="rounded-lg border border-admin-border px-3 py-2 text-sm text-admin-text focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
            >
              <option value="production">Production</option>
              <option value="staging">Staging</option>
              <option value="testing">Testing</option>
            </select>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSaveToProfileConfirm(saveToProfileTarget)}
              disabled={saveToProfilePending}
            >
              Save Current Settings to Profile
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Feature flags */}
      <Card>
        <CardHeader>
          <CardTitle>Feature flags</CardTitle>
          <p className="text-sm text-admin-muted">Enable or disable features. Dependencies: disabling a feature auto-disables dependents (e.g. Liquidity bot requires Spot trading).</p>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-admin-muted" />
              <input
                type="text"
                placeholder="Search by feature name or description..."
                value={featureSearch}
                onChange={(e) => setFeatureSearch(e.target.value)}
                className="w-full rounded-lg border border-admin-border py-2 pl-9 pr-3 text-sm placeholder:text-admin-muted focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm text-admin-muted">Status</label>
              <select
                value={featureStatusFilter}
                onChange={(e) => setFeatureStatusFilter(e.target.value as 'all' | 'enabled' | 'disabled')}
                className="rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
              >
                <option value="all">All</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
              <label className="ml-2 text-sm text-admin-muted">Rollout</label>
              <select
                value={featureRolloutFilter}
                onChange={(e) => setFeatureRolloutFilter(e.target.value as 'all' | 'all_users' | 'beta' | 'tier')}
                className="rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-admin-primary focus:outline-none focus:ring-1 focus:ring-admin-primary"
              >
                <option value="all">All</option>
                <option value="all_users">All Users</option>
                <option value="beta">Beta Users</option>
                <option value="tier">Specific Tier</option>
              </select>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setBulkConfirm({ action: 'enable', count: selectedFeatureKeys.size })}
              disabled={selectedFeatureKeys.size === 0 || bulkPending}
            >
              Enable Selected
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setBulkConfirm({ action: 'disable', count: selectedFeatureKeys.size })}
              disabled={selectedFeatureKeys.size === 0 || bulkPending}
            >
              Disable Selected
            </Button>
            {selectedFeatureKeys.size > 0 && (
              <span className="text-sm text-admin-muted">{selectedFeatureKeys.size} selected</span>
            )}
          </div>
          {toast && (
            <div
              className={cn(
                'mb-3 rounded-lg px-4 py-2 text-sm',
                toast.type === 'success' ? 'bg-emerald-950/20 border border-emerald-500/30 text-emerald-400' : 'bg-red-950/20 border border-red-500/30 text-red-400'
              )}
              role="alert"
            >
              {toast.message}
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-admin-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.02]">
                <tr>
                  <th className="w-10 px-2 py-3">
                    <input
                      ref={selectAllCheckboxRef}
                      type="checkbox"
                      checked={filteredFeatures.length > 0 && selectedFeatureKeys.size === filteredFeatures.length}
                      onChange={toggleSelectAllFeatures}
                      className="h-4 w-4 rounded border-admin-border"
                    />
                  </th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Feature</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Description</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Depends on</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Status</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Rollout</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Last updated</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredFeatures.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-admin-muted">
                      {features.length === 0 ? 'No feature flags loaded.' : 'No features match your search or filters.'}
                    </td>
                  </tr>
                ) : (
                  filteredFeatures.map((f) => (
                  <tr key={f.id} className="border-t border-admin-border">
                    <td className="w-10 px-2 py-3">
                      <input
                        type="checkbox"
                        checked={selectedFeatureKeys.has(f.feature_key)}
                        onChange={() => toggleFeatureSelection(f.feature_key)}
                        className="h-4 w-4 rounded border-admin-border"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium capitalize">{f.feature_key.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-admin-muted">{f.description || '—'}</td>
                    <td className="px-4 py-3 text-admin-muted text-xs">
                      {dependsOnMap[f.feature_key]?.length ? dependsOnMap[f.feature_key].map((r) => r.replace(/_/g, ' ')).join(', ') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={f.status} variant={f.status === 'enabled' ? 'success' : 'default'} />
                    </td>
                    <td className="px-4 py-3">{ROLLOUT_OPTIONS.find((r) => r.value === f.rollout)?.label ?? f.rollout}</td>
                    <td className="px-4 py-3 text-admin-muted text-xs">{f.updated_at ? new Date(f.updated_at).toLocaleString() : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => patchFeatureMutation.mutate({ id: f.id, status: f.status === 'enabled' ? 'disabled' : 'enabled' })}
                          disabled={patchFeatureMutation.isPending}
                        >
                          {f.status === 'enabled' ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                          {f.status === 'enabled' ? 'Disable' : 'Enable'}
                        </Button>
                        <select
                          className="rounded border border-admin-border px-2 py-1 text-xs"
                          value={f.rollout}
                          onChange={(e) => patchFeatureMutation.mutate({ id: f.id, rollout: e.target.value })}
                        >
                          {ROLLOUT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Feature Dependencies */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="h-5 w-5" />
                Feature dependencies
              </CardTitle>
              <p className="mt-1 text-sm text-admin-muted">
                Define which feature depends on another. When parent is disabled, child can auto-disable or show a warning.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => { setDependencyModal('add'); setDependencyForm({ feature_key: '', requires_feature_key: '', behaviour: 'auto_disable' }); }}>
              Add dependency
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border border-admin-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.02]">
                <tr>
                  <th className="px-4 py-3 font-medium text-admin-muted">Feature</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Depends on</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Action</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Last updated</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {dependencies.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-admin-muted">No dependency rules. Add one to link features.</td>
                  </tr>
                ) : (
                  dependencies.map((d, i) => (
                    <tr key={`${d.feature_key}-${d.requires_feature_key}-${i}`} className="border-t border-admin-border">
                      <td className="px-4 py-3 font-mono text-xs">{d.feature_key.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3 font-mono text-xs">{d.requires_feature_key.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3 text-admin-muted text-xs">
                        {d.behaviour === 'warning_only'
                          ? 'Show warning but allow enable'
                          : 'Auto-disable if parent disabled'}
                      </td>
                      <td className="px-4 py-3 text-admin-muted text-xs">
                        {d.updated_at ? new Date(d.updated_at).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setDependencyModal({ edit: d });
                              setDependencyForm({
                                feature_key: d.feature_key,
                                requires_feature_key: d.requires_feature_key,
                                behaviour: d.behaviour ?? 'auto_disable',
                              });
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteDependencyTarget({ feature_key: d.feature_key, requires_feature_key: d.requires_feature_key })}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Trading configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Trading configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-admin-border p-4">
              <div>
                <p className="font-medium">Global trading halt</p>
                <p className="text-sm text-admin-muted">Pause all spot trading across the exchange.</p>
              </div>
              <Button
                variant={tradingHalted ? 'secondary' : 'primary'}
                onClick={() =>
                  tradingHalted ? haltMutation.mutate({ halted: false }) : setTradingPauseModalOpen(true)
                }
                disabled={haltMutation.isPending}
              >
                {tradingHalted ? 'Resume trading' : 'Pause trading'}
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-admin-text">Default maker fee (%)</label>
                <input
                  type="text"
                  value={tradingForm.default_maker_fee}
                  onChange={(e) => setTradingForm((f) => ({ ...f, default_maker_fee: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">Default taker fee (%)</label>
                <input
                  type="text"
                  value={tradingForm.default_taker_fee}
                  onChange={(e) => setTradingForm((f) => ({ ...f, default_taker_fee: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">Minimum order size</label>
                <input
                  type="text"
                  value={tradingForm.min_order_size}
                  onChange={(e) => setTradingForm((f) => ({ ...f, min_order_size: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                />
              </div>
            </div>
            <Button
              onClick={() => patchSettingsMutation.mutate(tradingForm)}
              disabled={patchSettingsMutation.isPending}
            >
              Save trading settings
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Risk configuration (synced with /risk/settings) */}
      <Card>
        <CardHeader>
          <CardTitle>Risk configuration</CardTitle>
          <p className="text-sm text-admin-muted">Synced with Risk settings. <Link href="/risk/settings" className="text-admin-primary hover:underline">Edit in Risk →</Link></p>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              patchRiskMutation.mutate({
                large_withdrawal_threshold: riskForm.large_withdrawal_threshold,
                whale_trade_threshold: riskForm.whale_trade_threshold,
                cancel_rate_threshold: riskForm.cancel_rate_threshold,
                market_manipulation_window: riskForm.market_manipulation_window,
              });
            }}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <div>
              <label className="block text-sm font-medium text-admin-text">Large withdrawal threshold (USD)</label>
              <input
                type="number"
                min={0}
                value={riskForm.large_withdrawal_threshold}
                onChange={(e) => setRiskForm((f) => ({ ...f, large_withdrawal_threshold: Number(e.target.value) || 0 }))}
                className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-admin-text">Whale trade threshold (USD)</label>
              <input
                type="number"
                min={0}
                value={riskForm.whale_trade_threshold}
                onChange={(e) => setRiskForm((f) => ({ ...f, whale_trade_threshold: Number(e.target.value) || 0 }))}
                className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-admin-text">Cancel rate threshold (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={riskForm.cancel_rate_threshold}
                onChange={(e) => setRiskForm((f) => ({ ...f, cancel_rate_threshold: Number(e.target.value) || 0 }))}
                className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={patchRiskMutation.isPending}>
                Save risk settings
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* System limits */}
      <Card>
        <CardHeader>
          <CardTitle>System limits</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-sm font-medium text-admin-text">API rate limit (req/min)</label>
              <input
                type="text"
                value={limitsForm.api_rate_limit}
                onChange={(e) => setLimitsForm((f) => ({ ...f, api_rate_limit: e.target.value }))}
                className={cn(
                  'mt-1 w-full rounded-lg border px-3 py-2 text-sm',
                  limitsErrors.api_rate_limit ? 'border-admin-danger' : 'border-admin-border'
                )}
              />
              {limitsErrors.api_rate_limit && (
                <p className="mt-1 text-sm text-admin-danger">{limitsErrors.api_rate_limit}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-admin-text">Max withdrawal per day (USD)</label>
              <input
                type="text"
                value={limitsForm.max_withdrawal_per_day}
                onChange={(e) => setLimitsForm((f) => ({ ...f, max_withdrawal_per_day: e.target.value }))}
                className={cn(
                  'mt-1 w-full rounded-lg border px-3 py-2 text-sm',
                  limitsErrors.max_withdrawal_per_day ? 'border-admin-danger' : 'border-admin-border'
                )}
              />
              {limitsErrors.max_withdrawal_per_day && (
                <p className="mt-1 text-sm text-admin-danger">{limitsErrors.max_withdrawal_per_day}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-admin-text">Max orders per minute</label>
              <input
                type="text"
                value={limitsForm.max_orders_per_minute}
                onChange={(e) => setLimitsForm((f) => ({ ...f, max_orders_per_minute: e.target.value }))}
                className={cn(
                  'mt-1 w-full rounded-lg border px-3 py-2 text-sm',
                  limitsErrors.max_orders_per_minute ? 'border-admin-danger' : 'border-admin-border'
                )}
              />
              {limitsErrors.max_orders_per_minute && (
                <p className="mt-1 text-sm text-admin-danger">{limitsErrors.max_orders_per_minute}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-admin-text">Max login attempts</label>
              <input
                type="text"
                value={limitsForm.max_login_attempts}
                onChange={(e) => setLimitsForm((f) => ({ ...f, max_login_attempts: e.target.value }))}
                className={cn(
                  'mt-1 w-full rounded-lg border px-3 py-2 text-sm',
                  limitsErrors.max_login_attempts ? 'border-admin-danger' : 'border-admin-border'
                )}
              />
              {limitsErrors.max_login_attempts && (
                <p className="mt-1 text-sm text-admin-danger">{limitsErrors.max_login_attempts}</p>
              )}
            </div>
          </div>
          <Button
            className="mt-4"
            onClick={() => patchSettingsMutation.mutate(limitsForm)}
            disabled={patchSettingsMutation.isPending || !limitsFormValid}
          >
            Save limits
          </Button>
        </CardContent>
      </Card>

      {/* Dynamic system variables */}
      <Card>
        <CardHeader>
          <CardTitle>Dynamic system variables</CardTitle>
          <p className="text-sm text-admin-muted">Key-value configuration. Keys not used by trading/limits/emergency appear here.</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border border-admin-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.02]">
                <tr>
                  <th className="px-4 py-3 font-medium text-admin-muted">Key</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Value</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Description</th>
                  <th className="px-4 py-3 font-medium text-admin-muted">Updated by</th>
                </tr>
              </thead>
              <tbody>
                {dynamicVars.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-admin-muted">No custom variables. Add keys via PATCH /system/settings.</td>
                  </tr>
                ) : (
                  dynamicVars.map(([key, entry]) => (
                    <tr key={key} className="border-t border-admin-border">
                      <td className="px-4 py-3 font-mono text-sm">{key}</td>
                      <td className="px-4 py-3">{entry.value}</td>
                      <td className="px-4 py-3 text-admin-muted">{entry.description ?? '—'}</td>
                      <td className="px-4 py-3 text-admin-muted text-xs">{(entry as { updated_by?: string | null }).updated_by ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Emergency controls — bidirectional toggles with live state */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-admin-danger" />
            Emergency controls
          </CardTitle>
          <p className="text-sm text-admin-muted">Critical kill-switches. Each toggle reads live state from backend and allows ON/OFF switching.</p>
        </CardHeader>
        <CardContent>
          {(() => {
            const emergencyWithdrawals = settings['emergency_disable_withdrawals']?.value === '1' || settings['emergency_disable_withdrawals']?.value === 'true';
            const emergencyDeposits = settings['emergency_disable_deposits']?.value === '1' || settings['emergency_disable_deposits']?.value === 'true';
            const emergencyP2P = settings['emergency_disable_p2p']?.value === '1' || settings['emergency_disable_p2p']?.value === 'true';
            const toggles = [
              { key: 'pause_trading', label: 'Trading', active: tradingHalted, activeLabel: 'HALTED', inactiveLabel: 'Live' },
              { key: 'disable_withdrawals', label: 'Withdrawals', active: emergencyWithdrawals, activeLabel: 'DISABLED', inactiveLabel: 'Live' },
              { key: 'disable_deposits', label: 'Deposits', active: emergencyDeposits, activeLabel: 'DISABLED', inactiveLabel: 'Live' },
              { key: 'disable_p2p', label: 'P2P Trading', active: emergencyP2P, activeLabel: 'DISABLED', inactiveLabel: 'Live' },
            ];
            return (
              <div className="grid gap-3 sm:grid-cols-2">
                {toggles.map((t) => (
                  <div key={t.key} className={cn(
                    'flex items-center justify-between rounded-lg border p-4',
                    t.active ? 'border-red-500/40 bg-red-950/20' : 'border-admin-border'
                  )}>
                    <div>
                      <p className="font-medium text-admin-text">{t.label}</p>
                      <p className={cn('text-xs font-semibold', t.active ? 'text-red-400' : 'text-emerald-400')}>
                        {t.active ? t.activeLabel : t.inactiveLabel}
                      </p>
                    </div>
                    <Button
                      variant={t.active ? 'secondary' : 'primary'}
                      size="sm"
                      className={cn(t.active && 'border-red-500/40 text-red-400 hover:bg-red-950/30')}
                      onClick={() => setEmergencyModal({
                        action: t.key,
                        label: t.active ? `Resume ${t.label.toLowerCase()}` : `Emergency disable ${t.label.toLowerCase()}`,
                        enabled: !t.active,
                      })}
                    >
                      {t.active ? 'Resume' : 'Disable'}
                    </Button>
                  </div>
                ))}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {emergencyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setEmergencyModal(null); setEmergencyReason(''); }}>
          <div className="w-full max-w-sm rounded-xl bg-admin-card border border-red-500/30 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-950/40 border border-red-500/30">
                <span className="block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              </span>
              <h3 className="text-base font-semibold text-admin-text">Confirm Emergency Action</h3>
            </div>
            <p className="mt-1 text-sm text-admin-muted">{emergencyModal.label}. This may affect all users immediately.</p>
            <div className="mt-4">
              <label className="block text-xs font-medium text-admin-muted mb-1">Reason / Notes (required for audit trail)</label>
              <textarea
                value={emergencyReason}
                onChange={(e) => setEmergencyReason(e.target.value)}
                placeholder="e.g. Suspicious withdrawal volume detected, pausing to investigate…"
                className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text resize-none focus:outline-none focus:ring-1 focus:ring-red-500/50"
                rows={3}
              />
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => { setEmergencyModal(null); setEmergencyReason(''); }}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700 text-white border-0"
                onClick={() => emergencyMutation.mutate({ action: emergencyModal.action, enabled: emergencyModal.enabled })}
                disabled={emergencyMutation.isPending || !emergencyReason.trim()}
              >
                {emergencyMutation.isPending ? 'Applying…' : 'Confirm'}
              </Button>
            </div>
            {!emergencyReason.trim() && (
              <p className="mt-2 text-center text-xs text-admin-muted/60">Enter a reason to enable confirm</p>
            )}
          </div>
        </div>
      )}

        </>
      )}

      {diffModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDiffModal(null)}>
          <div className="w-full max-w-2xl max-h-[80vh] overflow-auto rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Configuration diff — Version {diffModal.versionNum}</h3>
            <p className="mt-1 text-sm text-admin-muted">Only keys that changed between that version and current.</p>
            {diffData?.data ? (() => {
              const before = diffData.data.before ?? {};
              const after = diffData.data.after ?? {};
              const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
              const changedKeys = allKeys
                .filter((k) => (before[k] ?? '') !== (after[k] ?? ''))
                .sort((a, b) => a.localeCompare(b));
              return (
                <div className="mt-4">
                  {changedKeys.length === 0 ? (
                    <p className="rounded-lg border border-admin-border bg-white/[0.02] px-4 py-6 text-center text-sm text-admin-muted">
                      No configuration differences found.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-admin-border">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-white/[0.02]">
                          <tr>
                            <th className="px-4 py-3 font-medium text-admin-muted">Setting key</th>
                            <th className="px-4 py-3 font-medium text-admin-muted">Old value</th>
                            <th className="px-4 py-3 font-medium text-admin-muted">New value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {changedKeys.map((k) => (
                            <tr key={k} className="border-t border-admin-border">
                              <td className="px-4 py-3 font-medium font-mono text-admin-text">{k}</td>
                              <td className="px-4 py-3 font-mono text-admin-danger">{(before[k] ?? '') || '—'}</td>
                              <td className="px-4 py-3 font-mono text-admin-success">{(after[k] ?? '') || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })() : (
              <div className="mt-4 space-y-2" aria-busy="true" aria-label="Loading diff">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="h-4 w-36 animate-pulse rounded bg-white/5" />
                    <div className="h-4 min-w-0 flex-1 animate-pulse rounded bg-white/5" />
                    <div className="h-4 min-w-0 flex-1 animate-pulse rounded bg-white/5" />
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4">
              <Button variant="secondary" onClick={() => setDiffModal(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {rollbackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setRollbackModal(null)}>
          <div className="w-full max-w-sm rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Rollback to version</h3>
            <p className="mt-2 text-sm text-admin-muted">
              Restore configuration to version {rollbackModal.version} (updated by {rollbackModal.updated_by ?? '—'}).
              Current settings will be replaced. This action is logged.
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setRollbackModal(null)}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                variant="primary"
                onClick={() => rollbackMutation.mutate(rollbackModal.id)}
                disabled={rollbackMutation.isPending}
              >
                Rollback
              </Button>
            </div>
          </div>
        </div>
      )}

      {bulkConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !bulkPending && setBulkConfirm(null)}>
          <div className="w-full max-w-sm rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Confirm bulk action</h3>
            <p className="mt-2 text-sm text-admin-muted">
              You are about to {bulkConfirm.action} {bulkConfirm.count} feature flag{bulkConfirm.count !== 1 ? 's' : ''}. Continue?
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => !bulkPending && setBulkConfirm(null)} disabled={bulkPending}>
                Cancel
              </Button>
              <Button className="flex-1" variant="primary" onClick={handleBulkConfirm} disabled={bulkPending}>
                {bulkPending ? 'Updating…' : 'Continue'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {saveToProfileConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !saveToProfilePending && setSaveToProfileConfirm(null)}>
          <div className="w-full max-w-sm rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Save to profile</h3>
            <p className="mt-2 text-sm text-admin-muted">
              Save current configuration to <strong className="capitalize">{saveToProfileConfirm}</strong>? This will overwrite the existing profile. This action is logged.
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => !saveToProfilePending && setSaveToProfileConfirm(null)} disabled={saveToProfilePending}>
                Cancel
              </Button>
              <Button className="flex-1" variant="primary" onClick={handleSaveToProfileConfirm} disabled={saveToProfilePending}>
                {saveToProfilePending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {dependencyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!dependencySaveConfirm) { setDependencyModal(null); setDependencySaveConfirm(false); } }}>
          <div className="w-full max-w-md rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">
              {dependencyModal === 'add' ? 'Add dependency' : 'Edit dependency'}
            </h3>
            <p className="mt-1 text-sm text-admin-muted">Feature (child) depends on parent. When parent is disabled, behaviour applies.</p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-admin-text">Feature (child)</label>
                <select
                  value={dependencyForm.feature_key}
                  onChange={(e) => setDependencyForm((f) => ({ ...f, feature_key: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                  disabled={dependencyModal !== 'add'}
                >
                  <option value="">Select feature</option>
                  {features.map((f) => (
                    <option key={f.id} value={f.feature_key}>{f.feature_key.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">Parent feature</label>
                <select
                  value={dependencyForm.requires_feature_key}
                  onChange={(e) => setDependencyForm((f) => ({ ...f, requires_feature_key: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                  disabled={dependencyModal !== 'add'}
                >
                  <option value="">Select parent</option>
                  {features.map((f) => (
                    <option key={f.id} value={f.feature_key}>{f.feature_key.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-admin-text">Behaviour</label>
                <select
                  value={dependencyForm.behaviour}
                  onChange={(e) => setDependencyForm((f) => ({ ...f, behaviour: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm"
                >
                  {DEPENDENCY_BEHAVIOUR_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => { setDependencyModal(null); setDependencySaveConfirm(false); }}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                variant="primary"
                onClick={() => setDependencySaveConfirm(true)}
                disabled={!dependencyForm.feature_key || !dependencyForm.requires_feature_key || dependencyForm.feature_key === dependencyForm.requires_feature_key}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {dependencySaveConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={() => setDependencySaveConfirm(false)}>
          <div className="w-full max-w-sm rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Confirm save</h3>
            <p className="mt-2 text-sm text-admin-muted">Save this dependency rule? This action is logged.</p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setDependencySaveConfirm(false)}>Cancel</Button>
              <Button
                className="flex-1"
                variant="primary"
                onClick={() => {
                  if (dependencyModal === 'add') {
                    postDependencyMutation.mutate({
                      feature_key: dependencyForm.feature_key,
                      requires_feature_key: dependencyForm.requires_feature_key,
                      behaviour: dependencyForm.behaviour,
                    });
                  } else {
                    patchDependencyMutation.mutate({
                      feature_key: dependencyForm.feature_key,
                      requires_feature_key: dependencyForm.requires_feature_key,
                      behaviour: dependencyForm.behaviour,
                    });
                  }
                }}
                disabled={postDependencyMutation.isPending || patchDependencyMutation.isPending}
              >
                {postDependencyMutation.isPending || patchDependencyMutation.isPending ? 'Saving…' : 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {deleteDependencyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !deleteDependencyMutation.isPending && setDeleteDependencyTarget(null)}>
          <div className="w-full max-w-sm rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Delete dependency</h3>
            <p className="mt-2 text-sm text-admin-muted">
              Remove rule: <strong>{deleteDependencyTarget.feature_key}</strong> depends on <strong>{deleteDependencyTarget.requires_feature_key}</strong>?
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => !deleteDependencyMutation.isPending && setDeleteDependencyTarget(null)} disabled={deleteDependencyMutation.isPending}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                variant="primary"
                onClick={() => deleteDependencyMutation.mutate(deleteDependencyTarget)}
                disabled={deleteDependencyMutation.isPending}
              >
                {deleteDependencyMutation.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {importPreview !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setImportPreview(null)}>
          <div className="w-full max-w-lg rounded-xl bg-admin-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-admin-text">Import settings</h3>
            {'error' in importPreview ? (
              <>
                <p className="mt-2 text-sm text-admin-danger">{importPreview.error}</p>
                <div className="mt-4 flex justify-end">
                  <Button variant="secondary" onClick={() => setImportPreview(null)}>Close</Button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-admin-muted">
                  You are about to apply {Object.keys(importPreview.flat).length} setting(s). This will update existing keys. The action will be logged.
                </p>
                <div className="mt-3 max-h-48 overflow-y-auto rounded border border-admin-border p-3 text-sm">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-admin-border">
                        <th className="pb-2 font-medium text-admin-text">Key</th>
                        <th className="pb-2 font-medium text-admin-text">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(importPreview.flat).map(([k, v]) => (
                        <tr key={k} className="border-b border-admin-border/50 last:border-0">
                          <td className="py-1.5 font-mono text-xs">{k}</td>
                          <td className="py-1.5 text-admin-muted">{String(v).slice(0, 40)}{String(v).length > 40 ? '…' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => setImportPreview(null)}>Cancel</Button>
                  <Button
                    className="flex-1"
                    variant="primary"
                    onClick={() => importSettingsMutation.mutate(importPreview.flat)}
                    disabled={importSettingsMutation.isPending}
                  >
                    Confirm and apply
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </AdminPageFrame>
  );
}
