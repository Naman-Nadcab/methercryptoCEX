/**
 * Page Classification System — determines which layout wrapper to apply.
 *
 * After the full light-theme migration, all pages use the unified design system
 * with a consistent light background. The v2 distinction is no longer needed.
 */

export type PageMode = 'v2' | 'legacy';

export function classifyPage(_pathname: string | null): PageMode {
  return 'legacy';
}

export function isV2Page(_pathname: string | null): boolean {
  return false;
}
