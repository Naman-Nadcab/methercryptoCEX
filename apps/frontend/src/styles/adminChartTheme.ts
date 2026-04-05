/**
 * Admin chart color system — dark-first, driven by CSS variables.
 * Both light and dark values are defined on .admin-panel / .dark .admin-panel
 * in globals.css so charts adapt automatically.
 */
export const adminChartTheme = {
  primary: 'var(--chart-primary)',
  secondary: 'var(--chart-secondary)',
  accent: 'var(--chart-accent, var(--chart-primary))',
  success: 'var(--chart-success)',
  warning: 'var(--chart-warning)',
  danger: 'var(--chart-danger)',
  grid: 'var(--chart-grid)',
  axis: 'var(--admin-muted)',
  text: 'var(--admin-text)',
  textMuted: 'var(--admin-text-muted)',
  tooltipBg: 'var(--admin-card-bg)',
  tooltipBorder: 'var(--admin-card-border)',
} as const;
