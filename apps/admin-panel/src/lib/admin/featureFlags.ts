/**
 * Admin feature flags — simple env-based flags for progressive feature rollout.
 * Flags can be toggled via env vars or the admin settings/feature-flags API.
 */

export const ADMIN_FEATURE_FLAGS = {
  ADMIN_NEW_DASHBOARD: true,
  ADMIN_NEW_DASHBOARD_V2_INTELLIGENCE: true,
  ADMIN_INCIDENT_MANAGEMENT: true,
  ADMIN_INCIDENT_SYSTEM: true,
  ADMIN_AI_OPS: true,
  ADMIN_PRODUCTION_HARDENING: true,
} as const;

export type AdminFeatureFlag = keyof typeof ADMIN_FEATURE_FLAGS;

export function isFeatureEnabled(flag: AdminFeatureFlag): boolean {
  return ADMIN_FEATURE_FLAGS[flag] ?? false;
}
