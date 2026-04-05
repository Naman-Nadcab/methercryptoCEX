'use client';

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, Users, Wallet, TrendingUp, Shield, Activity,
  Settings, AlertTriangle, BarChart3, PauseCircle, Lock, Eye,
} from 'lucide-react';

interface Command {
  id: string;
  label: string;
  category: 'navigate' | 'action' | 'search';
  icon: typeof Search;
  action: () => void;
  keywords: string[];
}

function CommandPaletteInner() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const nav = useCallback((path: string) => {
    setOpen(false);
    router.push(path);
  }, [router]);

  const commands: Command[] = [
    { id: 'users', label: 'All Users', category: 'navigate', icon: Users, action: () => nav('/admin/users'), keywords: ['user', 'accounts', 'customers'] },
    { id: 'withdrawals', label: 'Withdrawals', category: 'navigate', icon: Wallet, action: () => nav('/admin/withdrawals'), keywords: ['withdraw', 'pending', 'wallet'] },
    { id: 'deposits', label: 'Deposits', category: 'navigate', icon: Wallet, action: () => nav('/admin/deposits'), keywords: ['deposit', 'fund'] },
    { id: 'trading', label: 'Trading Engine', category: 'navigate', icon: TrendingUp, action: () => nav('/admin/trading/engine'), keywords: ['trade', 'engine', 'spot', 'market'] },
    { id: 'aml', label: 'AML Alerts', category: 'navigate', icon: AlertTriangle, action: () => nav('/admin/compliance/alerts'), keywords: ['aml', 'compliance', 'alert', 'risk'] },
    { id: 'system-health', label: 'System Health', category: 'navigate', icon: Activity, action: () => nav('/admin/system-health'), keywords: ['health', 'system', 'status', 'latency'] },
    { id: 'kyc', label: 'KYC Overview', category: 'navigate', icon: Shield, action: () => nav('/admin/kyc'), keywords: ['kyc', 'verify', 'identity'] },
    { id: 'reports', label: 'Reports & Analytics', category: 'navigate', icon: BarChart3, action: () => nav('/admin/reports'), keywords: ['report', 'analytics', 'volume'] },
    { id: 'settings', label: 'Settings', category: 'navigate', icon: Settings, action: () => nav('/admin/settings'), keywords: ['setting', 'config', 'configuration'] },
    { id: 'p2p', label: 'P2P Trading', category: 'navigate', icon: TrendingUp, action: () => nav('/admin/p2p'), keywords: ['p2p', 'peer', 'dispute'] },
    { id: 'wallets-hot', label: 'Hot Wallets', category: 'navigate', icon: Wallet, action: () => nav('/admin/wallets/hot'), keywords: ['hot', 'wallet', 'btc', 'eth'] },
    { id: 'api-monitoring', label: 'API Monitoring', category: 'navigate', icon: Activity, action: () => nav('/admin/api-monitoring'), keywords: ['api', 'monitor', 'performance'] },
    { id: 'security', label: 'Security Dashboard', category: 'navigate', icon: Shield, action: () => nav('/admin/security'), keywords: ['security', 'fraud', 'login'] },
    { id: 'view-dashboard', label: 'Dashboard V2', category: 'navigate', icon: Eye, action: () => nav('/admin/dashboard-v2'), keywords: ['dashboard', 'overview', 'home'] },
  ];

  const filtered = query.trim()
    ? commands.filter((c) => {
        const q = query.toLowerCase();
        return c.label.toLowerCase().includes(q) || c.keywords.some((k) => k.includes(q));
      })
    : commands;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => { setSelectedIndex(0); }, [query]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && filtered[selectedIndex]) { filtered[selectedIndex].action(); }
  }, [filtered, selectedIndex]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[80] backdrop-blur-[3px]" onClick={() => setOpen(false)} />
      <div className="fixed inset-0 z-[81] flex items-start justify-center pt-[15vh] px-4">
        <div className="w-full max-w-lg bg-[#151922] border border-[#1F2937] rounded-xl shadow-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1F2937]">
            <Search className="w-4 h-4 text-zinc-500 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search pages, users, actions…"
              className="flex-1 bg-transparent text-sm text-[#E5E7EB] placeholder:text-zinc-600 focus:outline-none"
            />
            <kbd className="text-[10px] text-zinc-600 bg-[#0F1117] border border-[#1F2937] rounded px-1.5 py-0.5">ESC</kbd>
          </div>

          <div className="max-h-[320px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="text-center py-8 text-xs text-zinc-600">No results for &quot;{query}&quot;</div>
            ) : (
              filtered.map((cmd, i) => {
                const Icon = cmd.icon;
                const isSelected = i === selectedIndex;
                return (
                  <button key={cmd.id} onClick={cmd.action}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      isSelected ? 'bg-blue-500/10 text-blue-400' : 'text-zinc-400 hover:bg-white/[0.03]'
                    }`}>
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="text-sm flex-1">{cmd.label}</span>
                    {isSelected && <span className="text-[10px] text-zinc-600">Enter ↵</span>}
                  </button>
                );
              })
            )}
          </div>

          <div className="px-4 py-2 border-t border-[#1F2937] flex items-center gap-4 text-[10px] text-zinc-600">
            <span>↑↓ navigate</span>
            <span>↵ select</span>
            <span>/ to open</span>
          </div>
        </div>
      </div>
    </>
  );
}

export const CommandPalette = memo(CommandPaletteInner);
