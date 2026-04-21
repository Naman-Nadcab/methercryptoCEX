'use client';

/**
 * User-facing support tickets page.
 *
 * Three views in one component (kept flat on purpose to avoid route churn):
 *   - list:   all of user's tickets
 *   - create: compose a new ticket
 *   - detail: view ticket conversation + reply
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, HelpCircle, Loader2, MessageCircle, Plus, Send } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { getApiBaseUrl } from '@/lib/getApiUrl';
import { notifyError } from '@/lib/notifyError';

type View = 'list' | 'create' | 'detail';

interface TicketSummary {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

interface TicketMessage {
  id: string;
  sender_type: 'user' | 'admin';
  message: string;
  created_at: string;
}

interface TicketDetail {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
}

const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'account', label: 'Account' },
  { value: 'deposit', label: 'Deposit' },
  { value: 'withdrawal', label: 'Withdrawal' },
  { value: 'trading', label: 'Trading' },
  { value: 'kyc', label: 'KYC / Identity' },
  { value: 'security', label: 'Security' },
  { value: 'other', label: 'Other' },
];

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-primary/15 text-primary',
  in_progress: 'bg-warning/15 text-warning',
  waiting_user: 'bg-accent text-foreground',
  resolved: 'bg-success/15 text-success',
  closed: 'bg-muted text-muted-foreground',
};

function formatStatus(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function SupportPage() {
  const { accessToken } = useAuthStore();
  const apiUrl = useMemo(() => getApiBaseUrl(), []);

  const [view, setView] = useState<View>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // List
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);

  // Create
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState('medium');
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);

  // Detail
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);

  const authHeaders = useMemo<HeadersInit>(
    () => (accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    [accessToken]
  );

  const fetchList = async () => {
    if (!accessToken) return;
    setListLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/support/tickets`, { headers: authHeaders });
      const json = await res.json();
      if (res.ok && json?.success) {
        setTickets(json.data?.tickets || []);
      } else {
        notifyError(json?.error?.message || 'Failed to load tickets');
      }
    } catch {
      notifyError('Failed to load tickets');
    } finally {
      setListLoading(false);
    }
  };

  const fetchDetail = async (id: string) => {
    if (!accessToken) return;
    setDetailLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/support/tickets/${id}`, { headers: authHeaders });
      const json = await res.json();
      if (res.ok && json?.success) {
        setDetail(json.data.ticket);
        setMessages(json.data.messages || []);
      } else {
        notifyError(json?.error?.message || 'Failed to load ticket');
        setView('list');
      }
    } catch {
      notifyError('Failed to load ticket');
      setView('list');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
     
  }, [accessToken]);

  useEffect(() => {
    if (view === 'detail' && selectedId) fetchDetail(selectedId);
     
  }, [view, selectedId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    if (subject.trim().length < 3 || message.trim().length < 5) {
      notifyError('Subject and message are too short');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/support/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          subject: subject.trim(),
          category,
          priority,
          message: message.trim(),
        }),
      });
      const json = await res.json();
      if (res.ok && json?.success) {
        setSubject('');
        setMessage('');
        setCategory('general');
        setPriority('medium');
        setSelectedId(json.data.id);
        await fetchList();
        setView('detail');
      } else {
        notifyError(json?.error?.message || 'Failed to create ticket');
      }
    } catch {
      notifyError('Failed to create ticket');
    } finally {
      setCreating(false);
    }
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !selectedId || replyText.trim().length === 0) return;
    setReplying(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/support/tickets/${selectedId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ message: replyText.trim() }),
      });
      const json = await res.json();
      if (res.ok && json?.success) {
        setReplyText('');
        await fetchDetail(selectedId);
      } else {
        notifyError(json?.error?.message || 'Failed to send reply');
      }
    } catch {
      notifyError('Failed to send reply');
    } finally {
      setReplying(false);
    }
  };

  // ================= RENDER =================

  const Header = (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Support</h1>
        <p className="text-sm text-muted-foreground">
          Questions about deposits, withdrawals, KYC or trading? Open a ticket and our team will respond.
        </p>
      </div>
      {view === 'list' && (
        <button
          onClick={() => setView('create')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition"
        >
          <Plus className="w-4 h-4" /> New ticket
        </button>
      )}
    </div>
  );

  if (view === 'create') {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        {Header}

        <button
          onClick={() => setView('list')}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="w-4 h-4" /> Back to tickets
        </button>

        <form onSubmit={handleCreate} className="bg-card border border-border rounded-2xl p-6 space-y-5">
          <div>
            <label className="text-sm font-semibold text-foreground">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Briefly describe the issue"
              maxLength={200}
              className="mt-2 w-full px-4 py-3 rounded-xl bg-muted border border-border focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-semibold text-foreground">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-2 w-full px-4 py-3 rounded-xl bg-muted border border-border focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-foreground">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="mt-2 w-full px-4 py-3 rounded-xl bg-muted border border-border focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-semibold text-foreground">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Include all relevant details: transaction IDs, timestamps, wallet addresses, error messages"
              rows={8}
              maxLength={5000}
              className="mt-2 w-full px-4 py-3 rounded-xl bg-muted border border-border focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none resize-none"
              required
            />
            <p className="text-xs text-muted-foreground mt-1">{message.length} / 5000</p>
          </div>

          <div className="flex items-center justify-between">
            <Link href="/dashboard/help" className="text-sm text-primary hover:underline inline-flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4" /> Check FAQ first
            </Link>
            <button
              type="submit"
              disabled={creating}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-60"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Submit ticket
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (view === 'detail') {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {Header}

        <button
          onClick={() => { setView('list'); setSelectedId(null); setDetail(null); setMessages([]); }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> Back to tickets
        </button>

        {detailLoading || !detail ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="bg-card border border-border rounded-2xl p-6">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-xl font-bold text-foreground">{detail.subject}</h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Opened {formatWhen(detail.created_at)} · Updated {formatWhen(detail.updated_at)}
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLE[detail.status] || 'bg-muted'}`}>
                  {formatStatus(detail.status)}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="px-2 py-0.5 rounded bg-muted">{detail.category}</span>
                <span className="px-2 py-0.5 rounded bg-muted">{detail.priority}</span>
              </div>
              {detail.resolution_note && (
                <div className="mt-4 p-3 rounded-lg bg-success/10 border border-success/30 text-sm text-foreground">
                  <p className="font-semibold text-success mb-1">Resolution</p>
                  {detail.resolution_note}
                </div>
              )}
            </div>

            <div className="space-y-3">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.sender_type === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
                    m.sender_type === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-muted text-foreground rounded-bl-sm border border-border'
                  }`}>
                    <p className="text-[11px] opacity-70 mb-1">
                      {m.sender_type === 'user' ? 'You' : 'Support'} · {formatWhen(m.created_at)}
                    </p>
                    <p className="whitespace-pre-wrap text-sm">{m.message}</p>
                  </div>
                </div>
              ))}
              {messages.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">No messages yet.</p>
              )}
            </div>

            {detail.status !== 'closed' ? (
              <form onSubmit={handleReply} className="bg-card border border-border rounded-2xl p-4 space-y-3 sticky bottom-4">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Reply to support..."
                  rows={3}
                  maxLength={5000}
                  className="w-full px-4 py-3 rounded-xl bg-muted border border-border focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none resize-none"
                />
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">{replyText.length} / 5000</span>
                  <button
                    type="submit"
                    disabled={replying || replyText.trim().length === 0}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-60"
                  >
                    {replying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Send
                  </button>
                </div>
              </form>
            ) : (
              <div className="bg-muted border border-border rounded-xl p-4 text-sm text-muted-foreground text-center">
                This ticket is closed. Open a new ticket if you need further help.
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ============== LIST VIEW ==============
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {Header}

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {listLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="py-16 text-center">
            <MessageCircle className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-foreground font-semibold">No support tickets yet</p>
            <p className="text-sm text-muted-foreground mt-1">Check the FAQ or open a new ticket.</p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Link href="/dashboard/help" className="px-4 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-accent">
                Browse FAQ
              </Link>
              <button
                onClick={() => setView('create')}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
              >
                Open ticket
              </button>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {tickets.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => { setSelectedId(t.id); setView('detail'); }}
                  className="w-full text-left px-5 py-4 flex items-start justify-between gap-4 hover:bg-accent/60 transition"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{t.subject}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t.category} · {t.priority} · {t.message_count} message{t.message_count !== 1 ? 's' : ''} · Updated {formatWhen(t.updated_at)}
                    </p>
                  </div>
                  <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLE[t.status] || 'bg-muted'}`}>
                    {formatStatus(t.status)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
