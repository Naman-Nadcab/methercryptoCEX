/**
 * Page metadata resolver — maps pathnames to titles and breadcrumbs.
 */

interface PageMeta {
  title: string;
  breadcrumbs: { label: string; href?: string }[];
}

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/incidents': 'Incidents',
  '/users': 'Users',
  '/kyc': 'KYC Verification',
  '/wallets': 'Wallets',
  '/treasury': 'Treasury',
  '/reconciliation': 'Reconciliation',
  '/deposits': 'Deposits',
  '/withdrawals': 'Withdrawals',
  '/trading': 'Trading',
  '/markets': 'Markets',
  '/orders': 'Orders',
  '/trades': 'Trades',
  '/p2p': 'P2P Trading',
  '/liquidity': 'Liquidity',
  '/risk': 'Risk & AML',
  '/analytics': 'Analytics',
  '/fees': 'Fees',
  '/staking': 'Staking & Earn',
  '/notifications': 'Notifications',
  '/security': 'Security',
  '/logs': 'System Logs',
  '/audit/config': 'Audit Logs',
  '/compliance': 'Compliance & Reporting',
  '/admin-users': 'Admin Users',
  '/announcements': 'Announcements',
  '/integrations': 'Integrations',
  '/settings': 'Settings',
  '/operations': 'Operations',
  '/monitoring': 'Monitoring',
  '/admin-control': 'Admin Control',
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
