'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  fetchP2POrderMessages,
  sendP2POrderMessage,
  markP2POrderMessagesRead,
  P2P_V2_MESSAGES_KEY,
  type P2POrderMessage,
} from '@/lib/p2pApi';
import { useAuthStore } from '@/store/auth';
import { Skeleton } from '@/components/ui/Skeleton';
import { useP2pOrderWs, type P2pOrderWsEvent } from '@/hooks/useP2pOrderWs';
import { Send, MessageCircle } from 'lucide-react';

type Props = {
  orderId: string;
  enabled: boolean;
};

export function P2PChat({ orderId, enabled }: Props) {
  const queryClient = useQueryClient();
  const { accessToken, _hasHydrated, user } = useAuthStore();
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const lastTypingSent = useRef(0);

  const qKey = [...P2P_V2_MESSAGES_KEY(orderId)] as const;

  const { connected: wsConnected, sendTyping } = useP2pOrderWs({
    orderId,
    enabled: enabled && !!orderId && _hasHydrated && !!accessToken,
    onEvent: useCallback(
      (ev: P2pOrderWsEvent) => {
        if (ev.type === 'message:new' && ev.data && typeof ev.data === 'object') {
          const d = ev.data as P2POrderMessage;
          if (!d.id) return;
          queryClient.setQueryData<P2POrderMessage[]>(qKey, (prev) => {
            const list = prev ?? [];
            if (list.some((m) => m.id === d.id)) return list;
            return [...list, d];
          });
        }
      },
      [queryClient, qKey],
    ),
  });

  const { data: messages = [], isLoading } = useQuery({
    queryKey: qKey,
    queryFn: () => fetchP2POrderMessages(orderId),
    enabled: enabled && !!orderId && _hasHydrated && !!accessToken,
    refetchInterval: () => {
      if (!enabled) return false;
      return wsConnected ? 45_000 : 4_000;
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!enabled || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (!last?.id) return;
    const t = setTimeout(() => {
      void markP2POrderMessagesRead(orderId, last.id);
    }, 900);
    return () => clearTimeout(t);
  }, [orderId, enabled, messages]);

  const sendMut = useMutation({
    mutationFn: (msg: string) => sendP2POrderMessage(orderId, msg),
    onSuccess: (res) => {
      if (res.success && res.data) {
        queryClient.setQueryData<P2POrderMessage[]>(qKey, (prev) => {
          const list = prev ?? [];
          if (list.some((m) => m.id === res.data!.id)) return list;
          return [...list, res.data!];
        });
        setText('');
      }
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || sendMut.isPending) return;
    sendMut.mutate(t);
  };

  const onChangeText = (v: string) => {
    setText(v);
    const now = Date.now();
    if (now - lastTypingSent.current > 2800) {
      lastTypingSent.current = now;
      sendTyping();
    }
  };

  const myId = user?.id;

  if (!enabled) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border/30 bg-card p-4 text-sm text-muted-foreground">
        <MessageCircle className="h-4 w-4 text-muted-foreground/40" />
        Chat available when the order is open.
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-lg border border-border/30 bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/20 px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <MessageCircle className="h-3.5 w-3.5 text-primary" />
          Chat
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          wsConnected ? 'bg-[#0ecb81]/10 text-[#0ecb81]' : 'bg-amber-500/10 text-amber-500'
        }`}>
          {wsConnected ? 'Live' : 'Reconnecting…'}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 min-h-[320px] max-h-[calc(100vh-20rem)]">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className={`h-10 rounded-lg ${i % 2 === 0 ? 'w-3/4' : 'ml-auto w-2/3'}`} />
            ))}
          </div>
        ) : null}

        {!isLoading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <MessageCircle className="h-7 w-7 text-muted-foreground/15 mb-2" />
            <p className="text-[12px] text-muted-foreground">No messages yet</p>
          </div>
        )}

        <div className="space-y-2">
          {messages.map((m) => {
            const isMe = myId === m.senderId;
            const isSystem = !m.senderId || m.senderId === 'system' || m.senderUsername?.toLowerCase() === 'system';

            if (isSystem) {
              return (
                <div key={m.id} className="flex justify-center py-1">
                  <span className="rounded-full bg-muted/30 px-3 py-1 text-[10px] text-muted-foreground">
                    {m.message}
                  </span>
                </div>
              );
            }

            return (
              <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[78%] rounded-lg px-3 py-2 ${
                  isMe
                    ? 'bg-primary/10 border border-primary/15'
                    : 'bg-muted/20 border border-border/15'
                }`}>
                  {!isMe && (
                    <p className="text-[10px] font-semibold text-primary mb-0.5">
                      {m.senderUsername ?? m.senderId.slice(0, 8)}
                    </p>
                  )}
                  <p className="text-[13px] text-foreground whitespace-pre-wrap leading-relaxed">{m.message}</p>
                  <time className="block mt-0.5 text-[9px] text-muted-foreground/60 text-right" dateTime={m.createdAt}>
                    {new Date(m.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </time>
                </div>
              </div>
            );
          })}
        </div>
        <div ref={endRef} />
      </div>

      {/* Input */}
      <form onSubmit={submit} className="flex gap-2 border-t border-border/20 p-2.5">
        <input
          type="text"
          value={text}
          onChange={(e) => onChangeText(e.target.value)}
          maxLength={2000}
          placeholder="Type a message…"
          className="min-w-0 flex-1 rounded-lg border border-border/40 bg-background px-3 py-2 text-[13px] text-foreground transition-colors focus:border-primary/40 focus:outline-none"
        />
        <button
          type="submit"
          disabled={sendMut.isPending || !text.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
      {sendMut.isError && (
        <p className="px-3 pb-2 text-[11px] text-[#f6465d]">Failed to send. Try again.</p>
      )}
    </div>
  );
}
