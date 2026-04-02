'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Bell, Download, FileText, Send, Shield, ChevronRight } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { ORDERS_HREF, walletPath, ROUTES } from '@/lib/routes';

interface Notification {
  id: string;
  title: string;
  message: string;
  notification_type: string;
  is_read: boolean;
  created_at: string;
}

interface NotificationCenterProps {
  accessToken?: string | null;
  className?: string;
}

const TYPE_CONFIG: Record<string, { icon: typeof Bell; label: string; href: string }> = {
  deposit: { icon: Download, label: 'Deposit completed', href: walletPath.depositCrypto },
  order: { icon: FileText, label: 'Order filled', href: `${ORDERS_HREF}/spot` },
  withdrawal: { icon: Send, label: 'Withdrawal sent', href: walletPath.withdrawCrypto },
  security: { icon: Shield, label: 'Security alert', href: '/dashboard/security' },
};

function getConfig(type: string) {
  return TYPE_CONFIG[type] ?? { icon: Bell, label: type, href: '/dashboard/announcements' };
}

export function NotificationCenter({ accessToken, className = '' }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && accessToken) {
      setLoading(true);
      const url = getApiBaseUrl();
      fetch(`${url}/api/v1/user/notifications?limit=20`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
        .then((res) => res.json())
        .then((data) => {
          if (data?.success && data?.data) {
            setNotifications(data.data.notifications ?? []);
            setUnreadCount(data.data.unreadCount ?? 0);
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [open, accessToken]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const fallbackNotifications: Notification[] = notifications.length > 0
    ? []
    : [
        { id: '1', title: 'Deposit completed', message: 'Your BTC deposit has been credited.', notification_type: 'deposit', is_read: true, created_at: new Date().toISOString() },
        { id: '2', title: 'Order filled', message: 'Your limit order for ETH/USDT was filled.', notification_type: 'order', is_read: false, created_at: new Date().toISOString() },
        { id: '3', title: 'Withdrawal sent', message: 'Your USDT withdrawal has been processed.', notification_type: 'withdrawal', is_read: true, created_at: new Date().toISOString() },
        { id: '4', title: 'Security alert', message: 'New login detected. If this wasn\'t you, secure your account.', notification_type: 'security', is_read: false, created_at: new Date().toISOString() },
      ];

  const displayList = notifications.length > 0 ? notifications : fallbackNotifications;

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors duration-150"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell className="w-[18px] h-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-semibold text-white bg-destructive rounded-full">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-popover dark:bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            <Link
              href={ROUTES.dashboard.announcements}
              onClick={() => setOpen(false)}
              className="text-xs text-primary hover:underline flex items-center gap-0.5"
            >
              View all <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
            ) : displayList.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">No notifications yet.</div>
            ) : (
              displayList.slice(0, 10).map((n) => {
                const config = getConfig(n.notification_type);
                const Icon = config.icon;
                return (
                  <Link
                    key={n.id}
                    href={config.href}
                    onClick={() => setOpen(false)}
                    className={`flex gap-3 p-4 border-b border-border last:border-0 hover:bg-muted/50 transition-colors ${!n.is_read ? 'bg-primary/5 dark:bg-primary/10' : ''}`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{n.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">{formatTime(n.created_at)}</p>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
