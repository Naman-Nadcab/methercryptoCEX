'use client';

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import {
  ArrowDownToLine, ArrowUpFromLine, Repeat2, AlertTriangle,
  UserPlus, ShieldCheck, Ban, Pause, Play,
} from 'lucide-react';

interface ActivityEvent {
  id: string;
  type: 'deposit' | 'withdrawal' | 'trade' | 'alert' | 'user_signup' | 'kyc_approved' | 'kyc_rejected';
  message: string;
  timestamp: number;
  meta?: Record<string, unknown>;
}

interface GroupedEvents {
  type: ActivityEvent['type'];
  count: number;
  latestMessage: string;
  latestTimestamp: number;
  ids: string[];
}

interface ActivityFeedProps {
  maxItems?: number;
}

const EVENT_CONFIG: Record<ActivityEvent['type'], { icon: typeof ArrowDownToLine; color: string; bgHint: string }> = {
  deposit: { icon: ArrowDownToLine, color: 'text-emerald-400', bgHint: 'bg-emerald-400/5' },
  withdrawal: { icon: ArrowUpFromLine, color: 'text-blue-400', bgHint: 'bg-blue-400/5' },
  trade: { icon: Repeat2, color: 'text-violet-400', bgHint: '' },
  alert: { icon: AlertTriangle, color: 'text-red-400', bgHint: 'bg-red-400/[0.06]' },
  user_signup: { icon: UserPlus, color: 'text-cyan-400', bgHint: '' },
  kyc_approved: { icon: ShieldCheck, color: 'text-emerald-400', bgHint: '' },
  kyc_rejected: { icon: Ban, color: 'text-amber-400', bgHint: 'bg-amber-400/5' },
};

const TYPE_LABELS: Record<ActivityEvent['type'], string> = {
  deposit: 'deposits',
  withdrawal: 'withdrawals',
  trade: 'trades',
  alert: 'alerts',
  user_signup: 'signups',
  kyc_approved: 'KYC approvals',
  kyc_rejected: 'KYC rejections',
};

function timeAgo(ts: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const GROUP_WINDOW_MS = 10_000;

function groupRecentEvents(events: ActivityEvent[]): (ActivityEvent | GroupedEvents)[] {
  const result: (ActivityEvent | GroupedEvents)[] = [];
  const now = Date.now();
  let i = 0;

  while (i < events.length) {
    const current = events[i]!;
    if (now - current.timestamp < GROUP_WINDOW_MS && current.type !== 'alert') {
      let count = 1;
      const ids = [current.id];
      let j = i + 1;
      while (j < events.length && events[j]!.type === current.type && now - events[j]!.timestamp < GROUP_WINDOW_MS) {
        count++;
        ids.push(events[j]!.id);
        j++;
      }
      if (count >= 3) {
        result.push({
          type: current.type,
          count,
          latestMessage: current.message,
          latestTimestamp: current.timestamp,
          ids,
        });
        i = j;
        continue;
      }
    }
    result.push(current);
    i++;
  }

  return result;
}

function isGrouped(item: ActivityEvent | GroupedEvents): item is GroupedEvents {
  return 'count' in item;
}

function ActivityFeedInner({ maxItems = 50 }: ActivityFeedProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [filter, setFilter] = useState<ActivityEvent['type'] | 'all'>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const addEvent = useCallback((event: ActivityEvent) => {
    setEvents((prev) => [event, ...prev].slice(0, maxItems));
  }, [maxItems]);

  useEffect(() => {
    const now = Date.now();
    const seed: ActivityEvent[] = [
      { id: 's1', type: 'trade', message: 'BTC/USDT buy filled — 0.05 BTC @ $67,240', timestamp: now - 5000 },
      { id: 's2', type: 'deposit', message: 'Deposit confirmed — 1,000 USDT (ERC-20)', timestamp: now - 12000 },
      { id: 's3', type: 'withdrawal', message: 'Withdrawal pending — 0.5 ETH', timestamp: now - 25000 },
      { id: 's4', type: 'user_signup', message: 'New user registered — user@example.com', timestamp: now - 45000 },
      { id: 's5', type: 'kyc_approved', message: 'KYC approved — user #4821', timestamp: now - 60000 },
      { id: 's6', type: 'alert', message: 'Large withdrawal flagged — 10 BTC', timestamp: now - 90000 },
    ];
    setEvents(seed);

    const types: ActivityEvent['type'][] = ['trade', 'deposit', 'withdrawal', 'user_signup', 'kyc_approved', 'alert'];
    const messages: Record<ActivityEvent['type'], string[]> = {
      trade: ['ETH/USDT sell filled — 2.1 ETH', 'BTC/USDT buy filled — 0.01 BTC', 'SOL/USDT buy — 50 SOL'],
      deposit: ['Deposit confirmed — 500 USDT', 'Deposit confirmed — 0.1 BTC'],
      withdrawal: ['Withdrawal requested — 200 USDT', 'Withdrawal approved — 1 ETH'],
      user_signup: ['New user registered', 'New user registered'],
      kyc_approved: ['KYC approved', 'KYC verified'],
      kyc_rejected: ['KYC rejected — document unclear'],
      alert: ['Suspicious login detected', 'Rate limit exceeded'],
    };

    let counter = 10;
    const interval = setInterval(() => {
      const type = types[Math.floor(Math.random() * types.length)]!;
      const msgList = messages[type] ?? ['Event'];
      const msg = msgList[Math.floor(Math.random() * msgList.length)]!;
      addEvent({ id: `live-${counter++}`, type, message: msg, timestamp: Date.now() });
    }, 3000);

    return () => clearInterval(interval);
  }, [addEvent]);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [events, autoScroll]);

  const filtered = useMemo(() => {
    const base = filter === 'all' ? events : events.filter((e) => e.type === filter);
    return groupRecentEvents(base);
  }, [events, filter]);

  const filters: { key: ActivityEvent['type'] | 'all'; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'trade', label: 'Trades' },
    { key: 'deposit', label: 'Deposits' },
    { key: 'withdrawal', label: 'Withdrawals' },
    { key: 'alert', label: 'Alerts' },
  ];

  return (
    <div className="rounded-xl border border-[#1F2937] bg-[#151922] flex flex-col h-full">
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Live Activity</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoScroll((s) => !s)}
              className={`p-1 rounded transition-colors ${autoScroll ? 'text-emerald-400 hover:bg-emerald-400/10' : 'text-zinc-600 hover:bg-white/5'}`}
              title={autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
            >
              {autoScroll ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            </button>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${autoScroll ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
              <span className="text-[10px] text-zinc-500">{autoScroll ? 'Live' : 'Paused'}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          {filters.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                filter === f.key ? 'bg-blue-500/20 text-blue-400' : 'text-zinc-600 hover:text-zinc-400 hover:bg-white/5'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-y-auto min-h-0 px-4 pb-4 space-y-0.5">
        {filtered.length === 0 ? (
          <div className="text-sm text-zinc-600 text-center py-8">No events</div>
        ) : (
          filtered.map((item) => {
            if (isGrouped(item)) {
              const cfg = EVENT_CONFIG[item.type];
              const Icon = cfg.icon;
              return (
                <div key={item.ids.join(',')}
                  className={`flex items-start gap-2.5 py-2.5 px-2 rounded-lg border border-[#1F2937]/30 ${cfg.bgHint}`}>
                  <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${cfg.color}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[#E5E7EB] font-medium">
                      {item.count} {TYPE_LABELS[item.type]} in last 10s
                    </p>
                    <p className="text-[10px] text-zinc-500 mt-0.5 truncate">Latest: {item.latestMessage}</p>
                    <p className="text-[10px] text-zinc-600 mt-0.5">{timeAgo(item.latestTimestamp)}</p>
                  </div>
                </div>
              );
            }

            const event = item;
            const cfg = EVENT_CONFIG[event.type];
            const Icon = cfg.icon;
            const isAlert = event.type === 'alert';
            return (
              <div key={event.id}
                className={`flex items-start gap-2.5 py-2 px-2 rounded-lg transition-colors ${
                  isAlert ? 'bg-red-400/[0.06] border border-red-500/10' : 'border border-transparent'
                }`}>
                <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${cfg.color}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-xs truncate ${isAlert ? 'text-red-300 font-medium' : 'text-[#E5E7EB]'}`}>
                    {event.message}
                  </p>
                  <p className="text-[10px] text-zinc-600 mt-0.5">{timeAgo(event.timestamp)}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export const ActivityFeed = memo(ActivityFeedInner);
