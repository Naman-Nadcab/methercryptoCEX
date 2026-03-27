import { adminFetch } from './api';

export interface ConfigAuditLogRow {
  timestamp: string;
  admin: string;
  action: string;
  setting_key: string;
  old_value: string;
  new_value: string;
}

export function getConfigAuditLogs(token: string | null, limit?: number) {
  return adminFetch<{ logs: ConfigAuditLogRow[] }>('/audit/config', {
    token,
    params: limit != null ? { limit } : undefined,
  });
}
