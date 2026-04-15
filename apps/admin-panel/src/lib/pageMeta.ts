/**
 * Page metadata resolver — maps pathnames to titles and breadcrumbs.
 */

interface PageMeta {
  title: string;
  breadcrumbs: { label: string; href?: string }[];
}

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/control-center': 'Control Center',
  '/admin-control': 'Exchange Controls',
  '/monitoring': 'Monitoring',
  '/monitoring/alert-rules': 'Alert Rules',
  '/incidents': 'Incidents',
  '/operations': 'Operations Hub',
  '/triage': 'Triage Queue',
  '/analytics': 'Analytics',
  '/analytics/scheduled-reports': 'Scheduled Reports',
  '/trading': 'Trading Engine',
  '/markets': 'Markets',
  '/orders': 'Orders',
  '/trades': 'Trades',
  '/liquidity': 'Liquidity',
  '/admin/mm-control': 'MM Desk',
  '/p2p': 'P2P Trading',
  '/wallets': 'Wallets',
  '/treasury': 'Treasury',
  '/treasury/settings': 'Treasury Settings',
  '/deposits': 'Deposits',
  '/withdrawals': 'Withdrawals',
  '/reconciliation': 'Reconciliation',
  '/fees': 'Fees',
  '/staking': 'Staking & Earn',
  '/risk': 'Risk & AML',
  '/risk/automation': 'Risk Automation',
  '/risk/settings': 'Risk Settings',
  '/risk/severity-settings': 'Severity Levels',
  '/compliance': 'Compliance & Reporting',
  '/approvals': 'Approvals',
  '/audit': 'Audit Logs',
  '/audit/config': 'Config Changes',
  '/logs': 'System Logs',
  '/users': 'Users',
  '/kyc': 'KYC Verification',
  '/security': 'Security',
  '/support': 'Support Tickets',
  '/admin-users': 'Admin Users',
  '/notifications': 'Notifications',
  '/announcements': 'Announcements',
  '/integrations': 'Integrations',
  '/settings': 'General Settings',
  '/settings/system': 'System Config',
  '/settings/integrations': 'Compliance Providers',
  '/settings/infrastructure': 'Infrastructure',
  '/settings/nodes': 'Nodes',
  '/backups': 'Backups',
  '/system/page-audit': 'Page & API Audit',
};

export function getPageMeta(pathname: string | null): PageMeta {
  if (!pathname) return { title: 'Admin', breadcrumbs: [{ label: 'Admin' }] };

  const exactTitle = PAGE_TITLES[pathname];
  if (exactTitle) {
    return {
      title: exactTitle,
      breadcrumbs: [
        { label: 'Admin', href: '/dashboard' },
        { label: exactTitle },
      ],
    };
  }

  const segments = pathname.split('/').filter(Boolean);
  const breadcrumbs = [{ label: 'Admin', href: '/dashboard' }];
  let path = '';
  for (const seg of segments) {
    path += '/' + seg;
    const label = PAGE_TITLES[path] || seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    breadcrumbs.push({ label, href: path });
  }

  const title = breadcrumbs[breadcrumbs.length - 1]?.label ?? 'Admin';
  return { title, breadcrumbs };
}
