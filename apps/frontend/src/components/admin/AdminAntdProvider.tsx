'use client';

import { ConfigProvider } from 'antd';
import type { ThemeConfig } from 'antd';

const adminTheme: ThemeConfig = {
  token: {
    colorBgBase: '#F8FAFC',
    colorBgContainer: '#FFFFFF',
    colorBgElevated: '#FFFFFF',
    colorBorder: '#E5E7EB',
    colorText: '#111827',
    colorTextSecondary: '#6B7280',
    colorPrimary: '#6366F1',
    colorSuccess: '#10B981',
    colorWarning: '#F59E0B',
    colorError: '#EF4444',
    colorInfo: '#06B6D4',
    borderRadius: 12,
  },
  components: {
    Table: {
      colorBgContainer: 'var(--admin-card)',
      colorBorderSecondary: 'var(--admin-card-border)',
    },
  },
};

export function AdminAntdProvider({ children }: { children: React.ReactNode }) {
  return <ConfigProvider theme={adminTheme}>{children}</ConfigProvider>;
}
