/**
 * Admin Liquid Glass — chart color system.
 * Use CSS variables so light/dark mode and theme updates apply automatically.
 */
export const adminChartTheme = {
  primary: 'var(--chart-primary)',
  secondary: 'var(--chart-secondary)',
  accent: 'var(--chart-accent)',
  success: 'var(--chart-success)',
  warning: 'var(--chart-warning)',
  danger: 'var(--chart-danger)',
  grid: 'var(--chart-grid)',
  axis: 'var(--admin-muted)',
  tooltipBg: 'var(--admin-card)',
  tooltipBorder: 'var(--admin-card-border)',
} as const;
