/**
 * Single source of truth for admin-panel sidebar (`UnifiedSidebar` in AppShell).
 */
import type { LucideIcon } from 'lucide-react';
import {
  Zap,
  Gauge,
  Activity,
  PieChart,
  Siren,
  LayoutGrid,
  Users,
  ShieldCheck,
  Shield,
  Headphones,
  Wallet,
  Landmark,
  Scale,
  ArrowDownToLine,
  ArrowUpFromLine,
  CreditCard,
  Coins,
  TrendingUp,
  BarChart3,
  ShoppingCart,
  LineChart,
  Repeat,
  Droplets,
  SlidersHorizontal,
  AlertTriangle,
  CheckSquare,
  FileText,
  Sliders,
  UserCog,
  Bell,
  Megaphone,
  Cable,
  Terminal,
  Settings,
  Cog,
  Database,
} from 'lucide-react';
import { ADMIN_FEATURE_FLAGS } from '@/lib/admin/featureFlags';

export type NavItem = { label: string; href: string; icon: LucideIcon };
export type NavSection = { title: string; items: NavItem[] };

export function buildSidebarSections(): NavSection[] {
  return [
    {
      title: 'Overview',
      items: [
        { label: 'Dashboard', href: '/dashboard', icon: Zap },
        { label: 'Control Center', href: '/control-center', icon: LayoutGrid },
        { label: 'Monitoring', href: '/monitoring', icon: Activity },
        { label: 'Analytics', href: '/analytics', icon: PieChart },
        ...(ADMIN_FEATURE_FLAGS.ADMIN_INCIDENT_SYSTEM ? [{ label: 'Incidents', href: '/incidents', icon: Siren }] : []),
      ],
    },
    {
      title: 'User Management',
      items: [
        { label: 'Users', href: '/users', icon: Users },
        { label: 'KYC', href: '/kyc', icon: ShieldCheck },
        { label: 'Security', href: '/security', icon: Shield },
        { label: 'Support Tickets', href: '/support', icon: Headphones },
      ],
    },
    {
      title: 'Finance',
      items: [
        { label: 'Wallets', href: '/wallets', icon: Wallet },
        { label: 'Treasury', href: '/treasury', icon: Landmark },
        { label: 'Reconciliation', href: '/reconciliation', icon: Scale },
        { label: 'Deposits', href: '/deposits', icon: ArrowDownToLine },
        { label: 'Withdrawals', href: '/withdrawals', icon: ArrowUpFromLine },
        { label: 'Fees', href: '/fees', icon: CreditCard },
        { label: 'Staking & Earn', href: '/staking', icon: Coins },
      ],
    },
    {
      title: 'Trading',
      items: [
        { label: 'Trading', href: '/trading', icon: TrendingUp },
        { label: 'Markets', href: '/markets', icon: BarChart3 },
        { label: 'Orders', href: '/orders', icon: ShoppingCart },
        { label: 'Trades', href: '/trades', icon: LineChart },
        { label: 'P2P', href: '/p2p', icon: Repeat },
        { label: 'Liquidity', href: '/liquidity', icon: Droplets },
        { label: 'MM desk', href: '/admin/mm-control', icon: SlidersHorizontal },
      ],
    },
    {
      title: 'Compliance',
      items: [
        { label: 'Risk & AML', href: '/risk', icon: AlertTriangle },
        { label: 'Approvals', href: '/approvals', icon: CheckSquare },
        { label: 'Compliance', href: '/compliance', icon: FileText },
        { label: 'Audit', href: '/audit', icon: Shield },
        { label: 'Audit configuration', href: '/audit/config', icon: Sliders },
      ],
    },
    {
      title: 'System',
      items: [
        { label: 'Admin users', href: '/admin-users', icon: UserCog },
        { label: 'Announcements', href: '/announcements', icon: Megaphone },
        { label: 'Notifications', href: '/notifications', icon: Bell },
        { label: 'Integrations', href: '/integrations', icon: Cable },
        { label: 'System Logs', href: '/logs', icon: Terminal },
        { label: 'Settings', href: '/settings', icon: Settings },
        { label: 'Backups', href: '/backups', icon: Database },
        { label: 'Operations', href: '/operations', icon: Cog },
        { label: 'Monitoring', href: '/monitoring', icon: Activity },
        { label: 'Admin control', href: '/admin-control', icon: Gauge },
      ],
    },
  ];
}

/** Active link: `/audit` must not light up on `/audit/config`. */
export function isSidebarNavActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === '/audit') return false;
  if (href === '/admin/mm-control' && pathname.startsWith('/admin/mm-control')) return true;
  if (href === '/dashboard') return false;
  return pathname.startsWith(href + '/');
}
