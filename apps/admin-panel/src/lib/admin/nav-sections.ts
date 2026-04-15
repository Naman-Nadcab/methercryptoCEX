/**
 * Single source of truth for admin-panel sidebar (`UnifiedSidebar`).
 * Tier-1 structure: grouped by operational priority — all historical routes preserved (no removals).
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
  ListTodo,
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
  CalendarClock,
  Server,
  Network,
  ClipboardCheck,
  Shield,
  Lock,
  ScrollText,
  Layers,
  FolderCog,
  BellRing,
  Blocks,
  Wrench,
  ShieldPlus,
  Ban,
  Users2,
  BarChart2,
} from 'lucide-react';
import { ADMIN_FEATURE_FLAGS } from '@/lib/admin/featureFlags';

export type NavItem = { label: string; href: string; icon: LucideIcon };
export type NavSection = { title: string; items: NavItem[] };

export function buildSidebarSections(): NavSection[] {
  const incidentsItem = ADMIN_FEATURE_FLAGS.ADMIN_INCIDENT_SYSTEM
    ? [{ label: 'Incidents', href: '/incidents', icon: Siren }]
    : [];

  return [
    {
      title: 'Command Center',
      items: [
        { label: 'Dashboard', href: '/dashboard', icon: Zap },
        { label: 'Control Center', href: '/control-center', icon: LayoutGrid },
        { label: 'Exchange Controls', href: '/admin-control', icon: Gauge },
        { label: 'Monitoring', href: '/monitoring', icon: Activity },
        { label: 'Alert Rules', href: '/monitoring/alert-rules', icon: Bell },
        ...incidentsItem,
        { label: 'Operations Hub', href: '/operations', icon: Blocks },
        { label: 'Triage Queue', href: '/triage', icon: ListTodo },
      ],
    },
    {
      title: 'Analytics & Reports',
      items: [
        { label: 'Analytics', href: '/analytics', icon: PieChart },
        { label: 'Scheduled Reports', href: '/analytics/scheduled-reports', icon: CalendarClock },
      ],
    },
    {
      title: 'Trading',
      items: [
        { label: 'Trading Engine', href: '/trading', icon: TrendingUp },
        { label: 'Markets', href: '/markets', icon: BarChart3 },
        { label: 'Orders', href: '/orders', icon: ShoppingCart },
        { label: 'Trades', href: '/trades', icon: LineChart },
        { label: 'Liquidity', href: '/liquidity', icon: Droplets },
        { label: 'MM Desk', href: '/admin/mm-control', icon: SlidersHorizontal },
        { label: 'P2P Trading', href: '/p2p', icon: Repeat },
      ],
    },
    {
      title: 'Finance',
      items: [
        { label: 'Wallets', href: '/wallets', icon: Wallet },
        { label: 'Treasury', href: '/treasury', icon: Landmark },
        { label: 'Treasury Settings', href: '/treasury/settings', icon: Sliders },
        { label: 'Deposits', href: '/deposits', icon: ArrowDownToLine },
        { label: 'Withdrawals', href: '/withdrawals', icon: ArrowUpFromLine },
        { label: 'Reconciliation', href: '/reconciliation', icon: Scale },
        { label: 'Fees', href: '/fees', icon: CreditCard },
        { label: 'Staking & Earn', href: '/staking', icon: Coins },
      ],
    },
    {
      title: 'Risk & Compliance',
      items: [
        { label: 'Risk & AML', href: '/risk', icon: AlertTriangle },
        { label: 'Risk Automation', href: '/risk/automation', icon: Wrench },
        { label: 'Risk Settings', href: '/risk/settings', icon: FolderCog },
        { label: 'Severity Levels', href: '/risk/severity-settings', icon: Layers },
        { label: 'Compliance', href: '/compliance', icon: FileText },
        { label: 'Approvals', href: '/approvals', icon: CheckSquare },
      ],
    },
    {
      title: 'Audit & Logs',
      items: [
        { label: 'Audit Logs', href: '/audit', icon: Shield },
        { label: 'Config Changes', href: '/audit/config', icon: ScrollText },
        { label: 'System Logs', href: '/logs', icon: Terminal },
      ],
    },
    {
      title: 'Users & Support',
      items: [
        { label: 'Users',              href: '/users',              icon: Users },
        { label: 'Restrictions / Bans', href: '/users/restrictions', icon: Ban },
        { label: 'Referrals',          href: '/users/referrals',    icon: Users2 },
        { label: 'User Analytics',     href: '/users/analytics',    icon: BarChart2 },
        { label: 'KYC',                href: '/kyc',                icon: ShieldCheck },
        { label: 'Security',           href: '/security',           icon: Lock },
        { label: 'Support Tickets',    href: '/support',            icon: Headphones },
      ],
    },
    {
      title: 'Administration',
      items: [
        { label: 'Admin Users', href: '/admin-users', icon: UserCog },
        { label: 'Notifications', href: '/notifications', icon: Megaphone },
        { label: 'Announcements', href: '/announcements', icon: BellRing },
        { label: 'Integrations', href: '/integrations', icon: Cable },
      ],
    },
    {
      title: 'Settings & Infra',
      items: [
        { label: 'General Settings', href: '/settings', icon: Settings },
        { label: 'System Config', href: '/settings/system', icon: Cog },
        { label: 'Compliance Providers', href: '/settings/integrations', icon: ShieldPlus },
        { label: 'Infrastructure', href: '/settings/infrastructure', icon: Server },
        { label: 'Nodes', href: '/settings/nodes', icon: Network },
        { label: 'Backups', href: '/backups', icon: Database },
        { label: 'Page Audit', href: '/system/page-audit', icon: ClipboardCheck },
      ],
    },
  ];
}

/** Active link: `/audit` must not light up on `/audit/config`. */
export function isSidebarNavActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === '/audit') return pathname === '/audit';
  if (href === '/admin/mm-control' && pathname.startsWith('/admin/mm-control')) return true;
  if (href === '/dashboard') return pathname === '/dashboard';
  if (href === '/p2p' && pathname.startsWith('/p2p')) return true;
  return pathname.startsWith(href + '/');
}
