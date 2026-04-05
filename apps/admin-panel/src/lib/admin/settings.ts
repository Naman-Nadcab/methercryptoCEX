/**
 * Admin System Settings API — uses existing /api/v1/admin/settings, settings/blockchains, settings/currencies, etc.
 */

import { adminFetch } from './apiClient';

export async function getSettings(token: string | null) {
  return adminFetch<Record<string, unknown>>('/settings', { token });
}

export async function patchSettings(token: string | null, body: Record<string, unknown>) {
  return adminFetch('/settings', { method: 'PATCH', token, body });
}

export async function getSettingsBlockchains(token: string | null) {
  return adminFetch<{ blockchains?: unknown[] }>('/settings/blockchains', { token });
}

export async function getSettingsCurrencies(token: string | null) {
  return adminFetch<{ currencies?: unknown[] }>('/settings/currencies', { token });
}

export async function getSettingsTradingPairs(
  token: string | null,
  params?: { limit?: number; offset?: number; quote_symbol?: string }
) {
  return adminFetch('/settings/trading-pairs', {
    token,
    params: params as Record<string, string | number | boolean | undefined>,
  });
}

export async function getAdmins(token: string | null) {
  return adminFetch<{ admins?: unknown[] }>('/admins', { token });
}

export async function getAdminLogs(token: string | null, params?: { limit?: number; offset?: number }) {
  return adminFetch<{ logs?: unknown[] }>('/admins/logs', {
    token,
    params: params as Record<string, string | number | boolean | undefined>,
  });
}
