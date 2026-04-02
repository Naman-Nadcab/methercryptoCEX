'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Menu,
  Search,
  Bell,
  Settings,
  LogOut,
  ChevronDown,
  ArrowUpFromLine,
  Scale,
  User,
  ArrowDownToLine,
  ShoppingCart,
  TrendingUp,
  Receipt,
  Loader2,
} from 'lucide-react';
import { useAdminAuthStore } from '@/store/admin-auth';
import { getDashboardStats } from '@/lib/admin/users';
import { getWithdrawals } from '@/lib/admin/wallets';
import { getTradingHalt } from '@/lib/admin/trading';
import { adminSearch, type AdminSearchResult } from '@/lib/admin/search';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const SEARCH_DEBOUNCE_MS = 300;
const RESULT_TYPE_LABEL: Record<AdminSearchResult['type'], string> = {
  user: 'User',
  order: 'Order',
  trade: 'Trade',
  withdrawal: 'Withdrawal',
  transaction: 'Transaction',
};
const RESULT_TYPE_ICON: Record<AdminSearchResult['type'], React.ReactNode> = {
  user: <User className="w-4 h-4" />,
  order: <ShoppingCart className="w-4 h-4" />,
  trade: <TrendingUp className="w-4 h-4" />,
  withdrawal: <ArrowDownToLine className="w-4 h-4" />,
  transaction: <Receipt className="w-4 h-4" />,
};

export interface AdminV2HeaderProps {
  onMenuClick: () => void;
}

export default function AdminV2Header({ onMenuClick }: AdminV2HeaderProps) {
  const router = useRouter();
  const token = useAdminAuthStore((s) => s.accessToken);
  const { admin, logout } = useAdminAuthStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<AdminSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchFocusedRef = useRef(false);
  searchFocusedRef.current = searchFocused;
  const [showAlerts, setShowAlerts] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const { data: statsData } = useQuery({
    queryKey: ['admin', 'dashboard-stats', token],
    queryFn: () => getDashboardStats(token ?? null),
    enabled: !!token,
  });
  const { data: withdrawData } = useQuery({
    queryKey: ['admin', 'withdrawals-stats', token],
    queryFn: () => getWithdrawals(token ?? null, { limit: 1 }),
    enabled: !!token,
  });
  const { data: haltData } = useQuery({
    queryKey: ['admin', 'trading-halt', token],
    queryFn: () => getTradingHalt(token ?? null),
    enabled: !!token,
  });

  const stats = statsData?.data;
  const pendingWithdrawals =
    withdrawData?.data?.stats && typeof (withdrawData.data.stats as { pending_approval?: number }).pending_approval === 'number'
      ? (withdrawData.data.stats as { pending_approval: number }).pending_approval
      : 0;
  const openDisputes = (stats as { p2p?: { openDisputes?: number } })?.p2p?.openDisputes ?? 0;
  const hasAlerts = pendingWithdrawals > 0 || openDisputes > 0;
  const tradingHalted = haltData?.data?.halted ?? false;

  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSearchLoading(true);
      adminSearch(token, searchQuery, 10)
        .then((results) => {
          setSearchResults(results);
          setShowDropdown(searchFocusedRef.current && results.length > 0);
        })
        .finally(() => setSearchLoading(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery, token, searchFocused]);

  const handleSearchResultClick = useCallback(
    (href: string) => {
      setSearchQuery('');
      setSearchResults([]);
      setShowDropdown(false);
      router.push(href);
    },
    [router]
  );

  const handleSearchBlur = useCallback(() => {
    setTimeout(() => setShowDropdown(false), 150);
  }, []);

  const handleGlobalSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const q = searchQuery.trim();
      if (!q) return;
      if (searchResults.length > 0) {
        handleSearchResultClick(searchResults[0].href);
        return;
      }
      router.push(`/admin/users?search=${encodeURIComponent(q)}`);
      setSearchQuery('');
    },
    [searchQuery, searchResults, router, handleSearchResultClick]
  );

  const handleLogout = () => {
    logout();
    router.push('/admin/login');
  };

  return (
    <header className="h-14 border-b border-[var(--admin-card-border)] bg-white flex items-center justify-between px-4 gap-4 sticky top-0 z-30">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden shrink-0"
          onClick={onMenuClick}
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </Button>
        <form onSubmit={handleGlobalSearch} className="hidden sm:flex items-center gap-2 flex-1 max-w-md">
          <div ref={dropdownRef} className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--admin-text-muted)] pointer-events-none z-10" />
            <Input
              type="text"
              placeholder="Search users, orders, trades, withdrawals, transactions..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchFocused(true); }}
              onFocus={() => { setSearchFocused(true); if (searchResults.length > 0) setShowDropdown(true); }}
              onBlur={handleSearchBlur}
              className={cn(
                'pl-9 pr-9 h-9 rounded-[var(--admin-radius)] bg-[var(--admin-input-bg)] border-[var(--admin-card-border)] text-sm',
                searchFocused && 'ring-2 ring-[var(--admin-primary)]/20 border-[var(--admin-primary)]'
              )}
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={showDropdown}
              role="combobox"
            />
            {searchLoading && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden>
                <Loader2 className="w-4 h-4 animate-spin text-[var(--admin-text-muted)]" />
              </span>
            )}
            {showDropdown && (searchResults.length > 0 || searchLoading) && (
              <div
                className="absolute left-0 right-0 top-full mt-1 py-1 rounded-[var(--admin-radius)] border border-[var(--admin-card-border)] bg-[var(--admin-card-bg)] shadow-lg z-50 max-h-[320px] overflow-y-auto"
                role="listbox"
              >
                {searchLoading && searchResults.length === 0 && (
                  <div className="px-3 py-4 text-sm text-[var(--admin-text-muted)] flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Searching…
                  </div>
                )}
                {!searchLoading && searchResults.length === 0 && (
                  <div className="px-3 py-4 text-sm text-[var(--admin-text-muted)] text-center">
                    No results
                  </div>
                )}
                {searchResults.map((r) => (
                  <button
                    key={`${r.type}-${r.id}`}
                    type="button"
                    role="option"
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-[var(--admin-hover-bg)] focus:bg-[var(--admin-hover-bg)] focus:outline-none"
                    onMouseDown={(e) => { e.preventDefault(); handleSearchResultClick(r.href); }}
                  >
                    <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--admin-hover-bg)] text-[var(--admin-text-muted)] shrink-0">
                      {RESULT_TYPE_ICON[r.type]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-[var(--admin-text)] block truncate">{r.label}</span>
                      <span className="text-xs text-[var(--admin-text-muted)] block truncate">
                        {RESULT_TYPE_LABEL[r.type]}
                        {r.subtitle ? ` · ${r.subtitle}` : ''}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button type="submit" size="sm" className="shrink-0 rounded-[var(--admin-radius)]">
            Search
          </Button>
        </form>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <div className="hidden lg:flex items-center gap-2 px-2 text-xs text-[var(--admin-text-muted)]">
          <span className={cn('font-medium', tradingHalted ? 'text-[var(--admin-danger)]' : 'text-[var(--admin-success)]')}>
            {tradingHalted ? 'Halted' : 'Live'}
          </span>
        </div>

        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            className="relative rounded-[var(--admin-radius)]"
            onClick={() => { setShowAlerts(!showAlerts); setShowProfile(false); }}
            aria-label="Alerts"
          >
            <Bell className="w-5 h-5" />
            {hasAlerts && (
              <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center bg-[var(--admin-danger)] text-white text-[10px] font-medium rounded-full">
                {pendingWithdrawals + openDisputes > 99 ? '99+' : pendingWithdrawals + openDisputes}
              </span>
            )}
          </Button>
          {showAlerts && (
            <div className="absolute right-0 mt-2 w-72 bg-white border border-[var(--admin-card-border)] rounded-[var(--admin-radius)] shadow-lg z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--admin-card-border)]">
                <h3 className="text-sm font-semibold text-[var(--admin-text)]">Alerts</h3>
              </div>
              <div className="py-1">
                <Link
                  href="/admin/withdrawals?status=pending_approval"
                  onClick={() => setShowAlerts(false)}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-[var(--admin-text)] hover:bg-[var(--admin-hover-bg)]"
                >
                  <span className="flex items-center gap-2">
                    <ArrowUpFromLine className="w-4 h-4 text-[var(--admin-text-muted)]" />
                    Pending withdrawals
                  </span>
                  <span className="text-xs tabular-nums text-[var(--admin-text-muted)]">{pendingWithdrawals}</span>
                </Link>
                <Link
                  href="/admin/p2p/disputes"
                  onClick={() => setShowAlerts(false)}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-[var(--admin-text)] hover:bg-[var(--admin-hover-bg)]"
                >
                  <span className="flex items-center gap-2">
                    <Scale className="w-4 h-4 text-[var(--admin-text-muted)]" />
                    Open disputes
                  </span>
                  <span className="text-xs tabular-nums text-[var(--admin-text-muted)]">{openDisputes}</span>
                </Link>
              </div>
            </div>
          )}
        </div>

        <DropdownMenu open={showProfile} onOpenChange={setShowProfile}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex items-center gap-2 rounded-[var(--admin-radius)] pl-2 pr-2"
              onClick={() => { setShowProfile(!showProfile); setShowAlerts(false); }}
            >
              <div className="w-8 h-8 rounded-lg bg-[var(--admin-primary)]/15 flex items-center justify-center shrink-0">
                <span className="text-xs font-semibold text-[var(--admin-primary)] uppercase">
                  {admin?.name?.split(' ').map((n) => n[0]).join('').slice(0, 2) || 'AD'}
                </span>
              </div>
              <div className="hidden md:block text-left min-w-0">
                <p className="text-sm font-medium text-[var(--admin-text)] truncate">{admin?.name || 'Admin'}</p>
                <p className="text-[11px] text-[var(--admin-text-muted)] truncate">{admin?.email || ''}</p>
              </div>
              <ChevronDown className="w-4 h-4 text-[var(--admin-text-muted)] hidden md:block shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 rounded-[var(--admin-radius)]">
            <div className="px-3 py-2 border-b border-[var(--admin-card-border)]">
              <p className="text-sm font-medium truncate">{admin?.name || 'Admin'}</p>
              <p className="text-xs text-[var(--admin-text-muted)] truncate">{admin?.email || ''}</p>
              <p className="text-[11px] text-[var(--admin-text-muted)] capitalize mt-0.5">{admin?.role?.replace('_', ' ') || 'Admin'}</p>
            </div>
            <DropdownMenuItem asChild>
              <Link href="/admin/settings/features" className="cursor-pointer">
                <Settings className="w-4 h-4 mr-2" /> Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-[var(--admin-danger)] focus:text-[var(--admin-danger)] cursor-pointer">
              <LogOut className="w-4 h-4 mr-2" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
