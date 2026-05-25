import { db } from '../lib/database.js';

export type ApprovalPolicyMode = 'always_dual' | 'single_allowed';

export interface ApprovalPolicyRow {
  key: string;
  label: string;
  mode: ApprovalPolicyMode;
  required_approvals: number;
  require_distinct_role: boolean;
  allowed_checker_roles: string[];
}

const SETTINGS_KEY = 'admin_approval_policies_v1';

const DEFAULT_POLICIES: ApprovalPolicyRow[] = [
  { key: 'global_action:halt_trading', label: 'Halt trading', mode: 'always_dual', required_approvals: 2, require_distinct_role: true, allowed_checker_roles: [] },
  { key: 'global_action:cancel_all_orders', label: 'Cancel all orders', mode: 'always_dual', required_approvals: 2, require_distinct_role: true, allowed_checker_roles: [] },
  { key: 'global_action:disable_withdrawals', label: 'Disable withdrawals', mode: 'always_dual', required_approvals: 2, require_distinct_role: true, allowed_checker_roles: [] },
  { key: 'global_action:disable_deposits', label: 'Disable deposits', mode: 'always_dual', required_approvals: 2, require_distinct_role: true, allowed_checker_roles: [] },
  { key: 'global_action:pause_p2p', label: 'Pause P2P', mode: 'always_dual', required_approvals: 2, require_distinct_role: true, allowed_checker_roles: [] },
  { key: 'global_action:pause_market_making', label: 'Pause market making', mode: 'always_dual', required_approvals: 2, require_distinct_role: true, allowed_checker_roles: [] },
];

function normalizePolicyRows(rows: unknown): ApprovalPolicyRow[] {
  if (!Array.isArray(rows)) return DEFAULT_POLICIES;
  const byKey = new Map<string, ApprovalPolicyRow>();
  for (const fallback of DEFAULT_POLICIES) byKey.set(fallback.key, fallback);
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Partial<ApprovalPolicyRow>;
    const key = typeof row.key === 'string' ? row.key.trim() : '';
    if (!key || !byKey.has(key)) continue;
    const mode: ApprovalPolicyMode = row.mode === 'single_allowed' ? 'single_allowed' : 'always_dual';
    const required = Math.min(5, Math.max(1, Number(row.required_approvals) || 2));
    const requireDistinctRole = row.require_distinct_role !== false;
    const allowedCheckerRoles = Array.isArray(row.allowed_checker_roles)
      ? row.allowed_checker_roles
          .map((r) => (typeof r === 'string' ? r.trim().toLowerCase().replace(/\s+/g, '_') : ''))
          .filter((r): r is string => r.length > 0)
      : [];
    const fallback = byKey.get(key)!;
    byKey.set(key, {
      key,
      label: typeof row.label === 'string' && row.label.trim() ? row.label.trim() : fallback.label,
      mode,
      required_approvals: required,
      require_distinct_role: requireDistinctRole,
      allowed_checker_roles: allowedCheckerRoles,
    });
  }
  return Array.from(byKey.values());
}

export async function getAdminApprovalPolicies(): Promise<ApprovalPolicyRow[]> {
  const res = await db.query<{ value: unknown }>(
    `SELECT value FROM system_settings WHERE key = $1 LIMIT 1`,
    [SETTINGS_KEY]
  );
  return normalizePolicyRows(res.rows[0]?.value);
}

export async function saveAdminApprovalPolicies(rows: ApprovalPolicyRow[]): Promise<ApprovalPolicyRow[]> {
  const normalized = normalizePolicyRows(rows);
  await db.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = NOW()`,
    [SETTINGS_KEY, JSON.stringify(normalized)]
  );
  return normalized;
}

export async function getAdminApprovalPolicyByKey(key: string): Promise<ApprovalPolicyRow> {
  const policies = await getAdminApprovalPolicies();
  return policies.find((p) => p.key === key) ?? DEFAULT_POLICIES.find((p) => p.key === key) ?? {
    key,
    label: key,
    mode: 'always_dual',
    required_approvals: 2,
    require_distinct_role: true,
    allowed_checker_roles: [],
  };
}

