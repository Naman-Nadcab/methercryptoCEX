import { adminFetch } from './api';

export interface SystemSettingEntry {
  value: string;
  description: string | null;
  updated_at: string | null;
  updated_by?: string | null;
}

export interface FeatureFlagRow {
  id: string;
  feature_key: string;
  description: string;
  status: string;
  rollout: string;
  updated_at: string | null;
}

export interface ConfigVersionRow {
  id: string;
  version: number;
  updated_by: string | null;
  change_summary: string | null;
  timestamp: string;
}

export interface ConfigVersionDetail {
  id: string;
  version: number;
  settings_snapshot: Record<string, string>;
  change_summary: string | null;
  updated_by: string | null;
  timestamp: string;
}

export interface ConfigDiff {
  before: Record<string, string>;
  after: Record<string, string>;
}

export interface SystemProfileRow {
  name: string;
  settings: Record<string, string>;
  updated_at: string;
  updated_by: string | null;
}

export interface FeatureDependencyRow {
  feature_key: string;
  requires_feature_key: string;
  behaviour?: string;
  updated_at?: string | null;
}

export interface OperationalWalletStatus {
  depositPaused: boolean;
  withdrawalPaused: boolean;
}

export function getSystemSettings(token: string | null) {
  return adminFetch<{ settings: Record<string, SystemSettingEntry> }>('/system/settings', { token });
}

export function patchSystemSettings(token: string | null, body: Record<string, string>) {
  return adminFetch<{ updated: boolean }>('/system/settings', { method: 'PATCH', token, body });
}

export function getSystemSettingsHistory(token: string | null) {
  return adminFetch<{ versions: ConfigVersionRow[] }>('/system/settings/history', { token });
}

export function getSystemSettingsVersion(token: string | null, id: string) {
  return adminFetch<{ version: ConfigVersionDetail }>('/system/settings/versions/' + encodeURIComponent(id), { token });
}

export function getSystemSettingsVersionDiff(token: string | null, id: string) {
  return adminFetch<{ before: Record<string, string>; after: Record<string, string> }>(
    '/system/settings/versions/' + encodeURIComponent(id) + '/diff',
    { token }
  );
}

export function postSystemSettingsRollback(token: string | null, version_id: string) {
  return adminFetch<{ rolled_back: boolean }>('/system/settings/rollback', {
    method: 'POST',
    token,
    body: { version_id },
  });
}

export function getSystemFeatures(token: string | null) {
  return adminFetch<{ features: FeatureFlagRow[] }>('/system/features', { token });
}

export function getSystemFeatureDependencies(token: string | null) {
  return adminFetch<{ dependencies: FeatureDependencyRow[] }>('/system/features/dependencies', { token });
}

export function postSystemFeatureDependency(
  token: string | null,
  body: { feature_key: string; requires_feature_key: string; behaviour?: string }
) {
  return adminFetch<{ created: boolean }>('/system/features/dependencies', {
    method: 'POST',
    token,
    body,
  });
}

export function patchSystemFeatureDependency(
  token: string | null,
  body: { feature_key: string; requires_feature_key: string; behaviour: string }
) {
  return adminFetch<{ updated: boolean }>('/system/features/dependencies', {
    method: 'PATCH',
    token,
    body,
  });
}

export function deleteSystemFeatureDependency(
  token: string | null,
  params: { feature_key: string; requires_feature_key: string }
) {
  return adminFetch<{ deleted: boolean }>('/system/features/dependencies', {
    method: 'DELETE',
    token,
    params,
  });
}

export function patchSystemFeature(
  token: string | null,
  body: { id?: string; feature_key?: string; status?: string; rollout?: string }
) {
  return adminFetch<{ updated: boolean }>('/system/features', { method: 'PATCH', token, body });
}

export function postEmergencyAction(token: string | null, action: string, enabled: boolean) {
  return adminFetch<{ action: string; enabled: boolean }>('/system/emergency', {
    method: 'POST',
    token,
    body: { action, enabled },
  });
}

export function getSystemProfiles(token: string | null) {
  return adminFetch<{ profiles: SystemProfileRow[] }>('/system/profiles', { token });
}

export function patchSystemProfile(token: string | null, name: string, settings: Record<string, string>) {
  return adminFetch<{ updated: boolean }>('/system/profiles/' + encodeURIComponent(name), {
    method: 'PATCH',
    token,
    body: { settings },
  });
}

export function postSystemApplyProfile(token: string | null, profile: string) {
  return adminFetch<{ applied: string }>('/system/settings/apply-profile', {
    method: 'POST',
    token,
    body: { profile },
  });
}

export function getSystemSafeMode(token: string | null) {
  return adminFetch<{ safe_mode: boolean }>('/system/safe-mode', { token });
}

export function postSystemSafeMode(token: string | null, enabled: boolean) {
  return adminFetch<{ safe_mode: boolean }>('/system/safe-mode', {
    method: 'POST',
    token,
    body: { enabled },
  });
}

export function getOperationalWalletStatus(token: string | null) {
  return adminFetch<OperationalWalletStatus>('/operational/wallet-status', { token });
}

export function patchOperationalWalletStatus(
  token: string | null,
  body: { depositPaused?: boolean; withdrawalPaused?: boolean }
) {
  return adminFetch<{ message: string }>('/operational/wallet-status', {
    method: 'PATCH',
    token,
    body,
  });
}
