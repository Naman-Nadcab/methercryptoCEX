/**
 * Command Registry — centralized searchable index for the Operator Command Palette.
 *
 * Three categories:
 *   navigate  — go to a page
 *   action    — perform an operation (may open confirmation)
 *   search    — look up an entity (user, txn, etc.)
 */

export type CommandCategory = 'navigate' | 'action' | 'search';
export type ActionSeverity = 'normal' | 'warning' | 'danger';

export interface CommandEntry {
  id: string;
  label: string;
  description?: string;
  category: CommandCategory;
  icon: string;
  keywords: string[];
  /** For navigate commands — relative path */
  href?: string;
  /** For action commands — severity determines confirm UX */
  severity?: ActionSeverity;
  /** Human-readable keyboard shortcut hint (display only) */
  shortcutHint?: string;
  /** Group label inside the palette */
  group: string;
}

/* ------------------------------------------------------------------ */
/*  Navigation commands                                                */
/* ------------------------------------------------------------------ */

const NAV_COMMANDS: CommandEntry[] = [
  { id: 'nav-dashboard', label: 'Dashboard', description: 'Admin control center overview', category: 'navigate', icon: 'Zap', href: '/dashboard', keywords: ['dashboard', 'control', 'intelligent', 'overview', 'home'], group: 'Overview' },
  { id: 'nav-incidents', label: 'Incidents', description: 'Active & past incidents', category: 'navigate', icon: 'Siren', href: '/incidents', keywords: ['incident', 'outage', 'issue', 'siren'], group: 'Overview' },
  { id: 'nav-monitoring', label: 'Monitoring', description: 'System health & infra', category: 'navigate', icon: 'Activity', href: '/monitoring', keywords: ['monitor', 'health', 'infra', 'system', 'status', 'latency'], group: 'Overview' },
  { id: 'nav-analytics', label: 'Analytics', description: 'Volume, revenue, reports', category: 'navigate', icon: 'PieChart', href: '/analytics', keywords: ['analytics', 'report', 'volume', 'revenue', 'chart'], group: 'Overview' },
  { id: 'nav-users', label: 'Users', description: 'All user accounts', category: 'navigate', icon: 'Users', href: '/users', keywords: ['user', 'account', 'customer', 'member'], group: 'User Management' },
  { id: 'nav-kyc', label: 'KYC Verification', description: 'Identity verification queue', category: 'navigate', icon: 'ShieldCheck', href: '/kyc', keywords: ['kyc', 'identity', 'verification', 'id'], group: 'User Management' },
  { id: 'nav-security', label: 'Security', description: 'Account security settings', category: 'navigate', icon: 'Shield', href: '/security', keywords: ['security', '2fa', 'login', 'password'], group: 'User Management' },
  { id: 'nav-wallets', label: 'Wallets', description: 'User wallet balances', category: 'navigate', icon: 'Wallet', href: '/wallets', keywords: ['wallet', 'balance', 'fund'], group: 'Finance' },
  { id: 'nav-treasury', label: 'Treasury', description: 'Hot/cold wallet reserves', category: 'navigate', icon: 'Landmark', href: '/treasury', keywords: ['treasury', 'hot', 'cold', 'reserve', 'vault'], group: 'Finance' },
  { id: 'nav-deposits', label: 'Deposits', description: 'Deposit history & queue', category: 'navigate', icon: 'ArrowDownToLine', href: '/deposits', keywords: ['deposit', 'fund', 'incoming'], group: 'Finance' },
  { id: 'nav-withdrawals', label: 'Withdrawals', description: 'Pending & processed', category: 'navigate', icon: 'ArrowUpFromLine', href: '/withdrawals', keywords: ['withdraw', 'pending', 'outgoing', 'approval'], group: 'Finance' },
  { id: 'nav-fees', label: 'Fees', description: 'Fee configuration', category: 'navigate', icon: 'CreditCard', href: '/fees', keywords: ['fee', 'commission', 'charge'], group: 'Finance' },
  { id: 'nav-trading', label: 'Trading', description: 'Trading engine & spot', category: 'navigate', icon: 'TrendingUp', href: '/trading', keywords: ['trade', 'engine', 'spot', 'order'], group: 'Trading' },
  { id: 'nav-markets', label: 'Markets', description: 'Market pairs & listings', category: 'navigate', icon: 'BarChart3', href: '/markets', keywords: ['market', 'pair', 'listing', 'symbol'], group: 'Trading' },
  { id: 'nav-orders', label: 'Orders', description: 'Order management', category: 'navigate', icon: 'ShoppingCart', href: '/orders', keywords: ['order', 'open', 'filled', 'cancelled'], group: 'Trading' },
  { id: 'nav-trades', label: 'Trades', description: 'Trade history', category: 'navigate', icon: 'LineChart', href: '/trades', keywords: ['trade', 'history', 'execution', 'fill'], group: 'Trading' },
  { id: 'nav-p2p', label: 'P2P Trading', description: 'Peer-to-peer & disputes', category: 'navigate', icon: 'Repeat', href: '/p2p', keywords: ['p2p', 'peer', 'dispute', 'escrow'], group: 'Trading' },
  { id: 'nav-liquidity', label: 'Liquidity', description: 'Liquidity pools & bots', category: 'navigate', icon: 'Droplets', href: '/liquidity', keywords: ['liquidity', 'pool', 'bot', 'maker'], group: 'Trading' },
  { id: 'nav-risk', label: 'Risk & AML', description: 'AML alerts & compliance', category: 'navigate', icon: 'AlertTriangle', href: '/risk', keywords: ['risk', 'aml', 'compliance', 'sanction', 'alert'], group: 'Compliance' },
  { id: 'nav-compliance', label: 'Compliance & Reporting', description: 'STR, regulatory reports', category: 'navigate', icon: 'FileText', href: '/compliance', keywords: ['compliance', 'report', 'str', 'regulatory'], group: 'Compliance' },
  { id: 'nav-audit', label: 'Audit Logs', description: 'System audit trail', category: 'navigate', icon: 'FileText', href: '/audit/config', keywords: ['audit', 'log', 'trail', 'history'], group: 'Compliance' },
  { id: 'nav-admin-users', label: 'Admin Users', description: 'Manage admin accounts & roles', category: 'navigate', icon: 'ShieldCheck', href: '/admin-users', keywords: ['admin', 'user', 'role', 'rbac', 'permission'], group: 'System' },
  { id: 'nav-announcements', label: 'Announcements', description: 'System-wide announcements', category: 'navigate', icon: 'Megaphone', href: '/announcements', keywords: ['announce', 'notice', 'broadcast', 'maintenance'], group: 'System' },
  { id: 'nav-notifications', label: 'Notifications', description: 'Notification settings', category: 'navigate', icon: 'Bell', href: '/notifications', keywords: ['notification', 'email', 'push', 'alert'], group: 'System' },
  { id: 'nav-integrations', label: 'Integrations', description: 'API & webhook config', category: 'navigate', icon: 'Cable', href: '/integrations', keywords: ['integration', 'api', 'webhook', 'plugin'], group: 'System' },
  { id: 'nav-settings', label: 'Settings', description: 'Global configuration', category: 'navigate', icon: 'Settings', href: '/settings', keywords: ['setting', 'config', 'preference'], group: 'System' },
  { id: 'nav-operations', label: 'Operations', description: 'Ops management', category: 'navigate', icon: 'Cog', href: '/operations', keywords: ['operation', 'ops', 'maintenance'], group: 'System' },
  { id: 'nav-admin-control', label: 'Admin Control', description: 'Admin permissions', category: 'navigate', icon: 'Gauge', href: '/admin-control', keywords: ['admin', 'control', 'permission', 'role'], group: 'System' },
];

/* ------------------------------------------------------------------ */
/*  Quick Actions                                                      */
/* ------------------------------------------------------------------ */

const ACTION_COMMANDS: CommandEntry[] = [
  { id: 'act-pause-trading', label: 'Pause Trading', description: 'Halt all spot trading immediately', category: 'action', icon: 'PauseCircle', keywords: ['pause', 'halt', 'stop', 'trading', 'emergency'], severity: 'danger', group: 'Emergency' },
  { id: 'act-freeze-withdrawals', label: 'Freeze Withdrawals', description: 'Stop all pending withdrawals', category: 'action', icon: 'Lock', keywords: ['freeze', 'lock', 'withdrawal', 'stop'], severity: 'danger', group: 'Emergency' },
  { id: 'act-emergency-mode', label: 'Emergency Mode', description: 'Activate full emergency lockdown', category: 'action', icon: 'ShieldAlert', keywords: ['emergency', 'lockdown', 'panic', 'critical'], severity: 'danger', group: 'Emergency' },
  { id: 'act-create-incident', label: 'Create Incident', description: 'Start a new incident report', category: 'action', icon: 'Siren', keywords: ['incident', 'create', 'report', 'outage'], severity: 'warning', group: 'Operations' },
  { id: 'act-trigger-audit', label: 'Export Audit Log', description: 'Download audit trail as JSON', category: 'action', icon: 'Download', keywords: ['audit', 'export', 'download', 'log'], severity: 'normal', group: 'Operations' },
  { id: 'act-refresh-all', label: 'Refresh All Data', description: 'Force-refresh all dashboard queries', category: 'action', icon: 'RefreshCw', keywords: ['refresh', 'reload', 'update', 'data'], severity: 'normal', group: 'Operations' },
];

/* ------------------------------------------------------------------ */
/*  Search (entity) commands                                           */
/* ------------------------------------------------------------------ */

const SEARCH_COMMANDS: CommandEntry[] = [
  { id: 'search-user', label: 'Search Users', description: 'Find user by email, name or ID', category: 'search', icon: 'UserSearch', keywords: ['search', 'find', 'user', 'email', 'lookup'], group: 'Search' },
  { id: 'search-txn', label: 'Search Transactions', description: 'Look up by txn hash or ID', category: 'search', icon: 'SearchCode', keywords: ['search', 'transaction', 'hash', 'tx', 'txn'], group: 'Search' },
  { id: 'search-wallet', label: 'Search Wallet Address', description: 'Find wallet by address', category: 'search', icon: 'Wallet', keywords: ['search', 'wallet', 'address', 'blockchain'], group: 'Search' },
];

/* ------------------------------------------------------------------ */
/*  Registry                                                           */
/* ------------------------------------------------------------------ */

export const COMMAND_REGISTRY: CommandEntry[] = [
  ...NAV_COMMANDS,
  ...ACTION_COMMANDS,
  ...SEARCH_COMMANDS,
];

/** Groups in display order */
export const GROUP_ORDER = [
  'Control Center',
  'Emergency',
  'Operations',
  'Search',
  'Overview',
  'User Management',
  'Finance',
  'Trading',
  'Compliance',
  'System',
];

export function searchCommands(query: string): CommandEntry[] {
  if (!query.trim()) return COMMAND_REGISTRY;
  const q = query.toLowerCase().trim();
  const terms = q.split(/\s+/);
  return COMMAND_REGISTRY.filter((cmd) => {
    const haystack = `${cmd.label} ${cmd.description ?? ''} ${cmd.keywords.join(' ')}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

export function groupCommands(commands: CommandEntry[]): { group: string; items: CommandEntry[] }[] {
  const map = new Map<string, CommandEntry[]>();
  for (const cmd of commands) {
    const arr = map.get(cmd.group) ?? [];
    arr.push(cmd);
    map.set(cmd.group, arr);
  }
  return GROUP_ORDER
    .filter((g) => map.has(g))
    .map((g) => ({ group: g, items: map.get(g)! }));
}
