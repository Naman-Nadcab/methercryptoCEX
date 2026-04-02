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
import { Send } from 'lucide-react';

type Props = {
  orderId: string;
  enabled: boolean;
};

export function P2PChat({ orderId, enabled }: Props) {
  const queryClient = useQueryClient();
  const { accessToken, _hasHydrated } = useAuthStore();
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
      [queryClient, qKey]
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

  if (!enabled) {
    return (
      <div className="rounded-xl border border-gray-200 bg-card p-4 text-sm text-gray-500 dark:border-gray-800 dark:bg-card">
        Chat is available when the order is open.
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-card">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 text-sm font-medium text-gray-900 dark:border-gray-800 dark:text-white">
        <span>Order chat</span>
        <span className="text-[10px] font-normal text-gray-400">
          {wsConnected ? 'Live' : 'Reconnecting…'}
        </span>
      </div>
      <div className="h-64 overflow-y-auto p-3 text-sm">
        {isLoading ? (
          <div className="space-y-3" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : null}
        {!isLoading && messages.length === 0 && (
          <p className="text-sm text-muted-foreground">No messages yet. Coordinate payment details here.</p>
        )}
        <ul className="space-y-2">
          {messages.map((m) => (
            <li key={m.id} className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/50">
              <div className="flex flex-wrap items-baseline justify-between gap-1">
                <span className="text-xs font-medium text-primary">
                  {m.senderUsername ?? m.senderId.slice(0, 8)}
                </span>
                <time className="text-[10px] text-gray-400" dateTime={m.createdAt}>
                  {new Date(m.createdAt).toLocaleString()}
                </time>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-gray-800 dark:text-gray-200">{m.message}</p>
            </li>
          ))}
        </ul>
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-gray-200 p-3 dark:border-gray-800">
        <input
          type="text"
          value={text}
          onChange={(e) => onChangeText(e.target.value)}
          maxLength={2000}
          placeholder="Type a message…"
          className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-card px-3 py-2 text-sm dark:border-gray-700 dark:bg-background dark:text-white"
        />
        <button
          type="submit"
          disabled={sendMut.isPending || !text.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          Send
        </button>
      </form>
      {sendMut.isError && (
        <p className="px-3 pb-2 text-xs text-red-600">Failed to send. Try again.</p>
      )}
    </div>
  );
}
