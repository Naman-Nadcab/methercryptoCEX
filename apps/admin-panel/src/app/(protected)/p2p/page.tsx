'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Repeat } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, Tabs, Modal, ModalFooter, Textarea } from '@/components/ui';
import { useAdminAuthStore, hasAdminPermission } from '@/store/auth';
import { getP2pOverview, getP2pOrders, getP2pDisputes, getP2pAds, resolveP2pDispute, getP2pMerchants, reviewP2pMerchant, getP2pEscrows, freezeEscrow, unfreezeEscrow } from '@/lib/admin';
import { cn } from '@/lib/cn';
import { useAdminWs } from '@/hooks/useAdminWs';

const REFETCH_MS = 30_000;
const PAGE_SIZE = 20;
type TabId = 'orders' | 'disputes' | 'ads' | 'merchants' | 'escrows';
type DisputeRow = Record<string, unknown>;
type MerchantRow = Record<string, unknown>;
type EscrowRow = Record<string, unknown>;
function n(v: unknown): number {
  const x = Number(v);
  return v != null && Number.isFinite(x) ? x : 0;
}
function str(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v || '—';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '—';
}
function formatDt(v: unknown): string {
  const d = v == null ? NaN : new Date(v as string).getTime();
  return Number.isNaN(d) ? '—' : new Date(d).toLocaleString();
}
function statusVar(s: string): 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary' {
  const x = s.toLowerCase();
  if (['completed', 'resolved', 'active'].includes(x)) return 'success';
  if (['open', 'under_review', 'pending', 'payment_pending', 'awaiting_payment', 'payment_sent'].includes(x)) return 'warning';
  if (['disputed', 'cancelled', 'expired', 'closed'].includes(x)) return 'danger';
  if (x === 'paused') return 'info';
  return 'default';
}

export default function P2pManagementPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const admin = useAdminAuthStore((s) => s.admin);
  const qc = useQueryClient();
  useAdminWs({
    onEvent: (event) => {
      const type = (event?.type as string) ?? '';
      if (['p2p_order_created', 'p2p_dispute_created', 'p2p_dispute_resolved'].includes(type)) {
        qc.invalidateQueries({ queryKey: ['admin', 'p2p'] });
      }
    },
  });
  const canResolve = hasAdminPermission(admin, 'p2p:disputes');
  const [tab, setTab] = useState<TabId>('orders');
  const [ordersPage, setOrdersPage] = useState(1);
  const [disputesPage, setDisputesPage] = useState(1);
  const [adsPage, setAdsPage] = useState(1);
  const [merchantsPage, setMerchantsPage] = useState(1);
  const [merchantFilter, setMerchantFilter] = useState('all');
  const [resolveTarget, setResolveTarget] = useState<DisputeRow | null>(null);
  const [resolution, setResolution] = useState<'favor_buyer' | 'favor_seller' | 'cancelled'>('favor_buyer');
  const [resolveNotes, setResolveNotes] = useState('');
  const [reviewTarget, setReviewTarget] = useState<MerchantRow | null>(null);
  const [reviewStatus, setReviewStatus] = useState<'approved' | 'rejected'>('approved');
  const [reviewNote, setReviewNote] = useState('');
  const [escrowAction, setEscrowAction] = useState<{ row: EscrowRow; action: 'freeze' | 'unfreeze' } | null>(null);
  const [escrowReason, setEscrowReason] = useState('');

  const ov = useQuery({
    queryKey: ['admin', 'p2p', 'overview', token],
    staleTime: 30_000,
    queryFn: async () => {
      const r = await getP2pOverview(token);
      if (!r.success) throw new Error(r.error?.message ?? 'Overview failed');
      return r.data as Record<string, unknown> | undefined;
    },
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });
  const oq = useQuery({
    queryKey: ['admin', 'p2p', 'orders', token, ordersPage],
    staleTime: 30_000,
    queryFn: async () => {
      const r = await getP2pOrders(token, { page: ordersPage, limit: PAGE_SIZE });
      if (!r.success) throw new Error(r.error?.message ?? 'Orders failed');
      return r.data;
    },
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });
  const dq = useQuery({
    queryKey: ['admin', 'p2p', 'disputes', token],
    staleTime: 30_000,
    queryFn: async () => {
      const r = await getP2pDisputes(token);
      if (!r.success) throw new Error(r.error?.message ?? 'Disputes failed');
      const raw = r.data;
      const list = Array.isArray(raw) ? raw : Array.isArray((raw as { disputes?: unknown[] })?.disputes) ? (raw as { disputes: unknown[] }).disputes : [];
      return list as DisputeRow[];
    },
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });
  const aq = useQuery({
    queryKey: ['admin', 'p2p', 'ads', token, adsPage],
    staleTime: 30_000,
    queryFn: async () => {
      const r = await getP2pAds(token, { page: adsPage, limit: PAGE_SIZE });
      if (!r.success) throw new Error(r.error?.message ?? 'Ads failed');
      return r.data;
    },
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });
  const resolveMu = useMutation({
    mutationFn: async (p: { id: string; resolution: typeof resolution; notes: string }) => {
      const r = await resolveP2pDispute(token, p.id, { resolution: p.resolution, notes: p.notes.trim() || undefined });
      if (!r.success) throw new Error(r.error?.message ?? 'Resolve failed');
      return r;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'p2p'] });
      setResolveTarget(null);
      setResolveNotes('');
    },
  });

  const mq = useQuery({
    queryKey: ['admin', 'p2p', 'merchants', token, merchantsPage, merchantFilter],
    staleTime: 30_000,
    queryFn: async () => {
      const r = await getP2pMerchants(token, { page: merchantsPage, limit: PAGE_SIZE, status: merchantFilter !== 'all' ? merchantFilter : undefined });
      if (!r.success) throw new Error(r.error?.message ?? 'Merchants failed');
      return r.data;
    },
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });
  const eq = useQuery({
    queryKey: ['admin', 'p2p', 'escrows', token],
    staleTime: 30_000,
    queryFn: async () => {
      const r = await getP2pEscrows(token);
      if (!r.success) throw new Error(r.error?.message ?? 'Escrows failed');
      const raw = r.data;
      const list = Array.isArray(raw) ? raw : Array.isArray((raw as { escrows?: unknown[] })?.escrows) ? (raw as { escrows: unknown[] }).escrows : [];
      return list as EscrowRow[];
    },
    enabled: !!token,
    refetchInterval: REFETCH_MS,
  });
  const reviewMu = useMutation({
    mutationFn: async (p: { id: string; status: 'approved' | 'rejected'; note: string }) => {
      const r = await reviewP2pMerchant(token, p.id, { status: p.status, note: p.note.trim() || undefined });
      if (!r.success) throw new Error(r.error?.message ?? 'Review failed');
      return r;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'p2p'] });
      setReviewTarget(null);
      setReviewNote('');
    },
  });
  const escrowMu = useMutation({
    mutationFn: async (p: { id: string; action: 'freeze' | 'unfreeze'; reason?: string }) => {
      const r = p.action === 'freeze' ? await freezeEscrow(token, p.id, p.reason) : await unfreezeEscrow(token, p.id);
      if (!r.success) throw new Error(r.error?.message ?? `${p.action} failed`);
      return r;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'p2p'] });
      setEscrowAction(null);
      setEscrowReason('');
    },
  });

  const adsS = ov.data?.adsStats as Record<string, unknown> | undefined;
  const ordS = ov.data?.orderStats as Record<string, unknown> | undefined;
  const dspS = ov.data?.disputeStats as Record<string, unknown> | undefined;
  const orders = (oq.data?.orders ?? []) as Record<string, unknown>[];
  const op = oq.data?.pagination;
  const oPages = Math.max(1, Math.ceil((op?.total ?? 0) / PAGE_SIZE));
  const allD = dq.data ?? [];
  const dPages = Math.max(1, Math.ceil(allD.length / PAGE_SIZE));
  const dSlice = useMemo(() => {
    const s = (disputesPage - 1) * PAGE_SIZE;
    return allD.slice(s, s + PAGE_SIZE);
  }, [allD, disputesPage]);
  const ads = (aq.data?.ads ?? []) as Record<string, unknown>[];
  const ap = aq.data?.pagination;
  const aPages = Math.max(1, Math.ceil((ap?.total ?? 0) / PAGE_SIZE));
  const merchants = (mq.data?.merchants ?? []) as MerchantRow[];
  const mp = mq.data?.pagination;
  const mPages = Math.max(1, Math.ceil((mp?.total ?? 0) / PAGE_SIZE));
  const allE = eq.data ?? [];
  const escrowsByStatus = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of allE) {
      const s = str(e.status).toLowerCase();
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [allE]);
  const activeEscrows = allE.filter((e) => str(e.status).toLowerCase() === 'active' || str(e.status).toLowerCase() === 'held');
  const totalEscrowValue = useMemo(() => allE.reduce((sum, e) => sum + n(e.amount ?? e.crypto_amount), 0), [allE]);

  const tw = 'overflow-x-auto rounded-ds-md border border-admin-border';
  const th = 'text-left text-xs font-semibold uppercase tracking-wide text-admin-muted px-3 py-2.5 bg-white/[0.02]';
  const td = 'px-3 py-2.5 text-sm text-admin-text border-t border-admin-border align-middle';
  const pag = (page: number, pages: number, total: number, suf: string, busy: boolean, setPage: (u: (p: number) => number) => void) => (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-admin-muted">
      <span>Page {page} of {pages} · {total.toLocaleString()} {suf}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1 || busy} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
        <Button variant="outline" size="sm" disabled={page >= pages || busy} onClick={() => setPage((p) => p + 1)}>Next</Button>
      </div>
    </div>
  );
  const panel = (loading: boolean, err: unknown, empty: boolean, emptyMsg: string) => {
    if (loading) return <div className="flex h-36 items-center justify-center text-sm text-admin-muted">Loading…</div>;
    if (err) return <div className="py-8 text-center text-sm text-admin-danger">{(err as Error).message}</div>;
    if (empty) return <div className="py-12 text-center text-sm text-admin-muted">{emptyMsg}</div>;
    return null;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-admin-text">P2P Trading</h1>
        <p className="text-xs text-admin-muted mt-0.5">Manage orders, disputes, and advertisements.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {[
          ['Active Orders', n(ordS?.active_orders)],
          ['Open Disputes', n(dspS?.open_disputes) + n(dspS?.under_review)],
          ['Active Ads', n(adsS?.active_ads)],
          ['Total Volume', n(ordS?.total_orders)],
          ['Escrow Value', totalEscrowValue.toLocaleString(undefined, { maximumFractionDigits: 2 })],
          ['Active Escrows', activeEscrows.length],
        ].map(([label, value]) => (
          <Card key={label as string} className="border-admin-border shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-admin-muted">{label as string}</CardTitle>
            </CardHeader>
            <CardContent>
              {ov.isLoading ? <div className="h-8 w-24 animate-pulse rounded bg-white/5" /> : <p className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
      {ov.isError && <p className="text-sm text-admin-danger">{(ov.error as Error).message}</p>}
      <Card className="border-admin-border shadow-sm">
        <CardHeader className="pb-0">
          <Tabs<TabId>
            variant="pills"
            size="sm"
            active={tab}
            onChange={setTab}
            items={[
              { id: 'orders', label: 'Orders', badge: op?.total ?? undefined },
              { id: 'disputes', label: 'Disputes', badge: allD.length || undefined },
              { id: 'ads', label: 'Ads', badge: ap?.total ?? undefined },
              { id: 'merchants', label: 'Merchants', badge: mp?.total ?? undefined },
              { id: 'escrows', label: 'Escrows', badge: allE.length || undefined },
            ]}
          />
        </CardHeader>
        <CardContent className="pt-4">
          {tab === 'orders' && (
            <>
              {panel(oq.isLoading, oq.error, !oq.isLoading && orders.length === 0, 'No P2P orders.')}
              {!oq.isLoading && !oq.isError && orders.length > 0 && (
                <>
                  <div className={tw}>
                    <table className="w-full min-w-[720px] border-collapse">
                      <thead>
                        <tr>
                          {['User', 'Type', 'Amount', 'Price', 'Status', 'Created'].map((h) => (
                            <th key={h} className={th}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((row) => {
                          const t = str(row.ad_type ?? row.type ?? row.side).toLowerCase();
                          const typeLabel = t === 'buy' ? 'Buy' : t === 'sell' ? 'Sell' : '—';
                          const sym = str(row.crypto_symbol);
                          const qty = str(row.quantity ?? row.crypto_amount);
                          return (
                            <tr key={str(row.id)}>
                              <td className={td}>{str(row.buyer_username ?? row.buyer_email)}</td>
                              <td className={td}>{typeLabel}</td>
                              <td className={cn(td, 'tabular-nums')}>{sym !== '—' ? `${qty} ${sym}` : qty}</td>
                              <td className={cn(td, 'tabular-nums')}>{`${str(row.price)} ${str(row.fiat_currency)}`}</td>
                              <td className={td}><Badge variant={statusVar(str(row.status))} size="sm">{str(row.status)}</Badge></td>
                              <td className={cn(td, 'whitespace-nowrap text-admin-muted')}>{formatDt(row.created_at)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {pag(op?.page ?? ordersPage, oPages, op?.total ?? 0, 'total', oq.isFetching, setOrdersPage)}
                </>
              )}
            </>
          )}

          {tab === 'disputes' && (
            <>
              {panel(dq.isLoading, dq.error, !dq.isLoading && allD.length === 0, 'No open disputes.')}
              {!dq.isLoading && !dq.isError && allD.length > 0 && (
                <>
                  <div className={tw}>
                    <table className="w-full min-w-[900px] border-collapse">
                      <thead>
                        <tr>
                          {['ID', 'Buyer', 'Seller', 'Amount', 'Reason', 'Status', 'Actions'].map((h) => (
                            <th key={h} className={th}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dSlice.map((row) => {
                          const st = str(row.status);
                          const open = ['open', 'under_review'].includes(st.toLowerCase());
                          return (
                            <tr key={str(row.id)}>
                              <td className={cn(td, 'font-mono text-xs')}>{`${str(row.id).slice(0, 8)}…`}</td>
                              <td className={td}>{str(row.buyer_username ?? row.buyer_email)}</td>
                              <td className={td}>{str(row.seller_username ?? row.seller_email)}</td>
                              <td className={cn(td, 'tabular-nums')}>
                                {`${str(row.crypto_amount ?? row.quantity)} ${str(row.crypto_symbol)}`}
                                <span className="block text-xs text-admin-muted">{`${str(row.fiat_amount)} ${str(row.fiat_currency)}`}</span>
                              </td>
                              <td className={cn(td, 'max-w-[200px] truncate')} title={str(row.reason)}>{str(row.reason)}</td>
                              <td className={td}><Badge variant={statusVar(st)} size="sm">{st}</Badge></td>
                              <td className={td}>
                                {open && canResolve ? (
                                  <Button size="sm" variant="outline" onClick={() => { setResolution('favor_buyer'); setResolveNotes(''); setResolveTarget(row); }}>Resolve</Button>
                                ) : (
                                  <span className="text-xs text-admin-muted">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {pag(disputesPage, dPages, allD.length, 'open', dq.isFetching, setDisputesPage)}
                </>
              )}
            </>
          )}

          {tab === 'ads' && (
            <>
              {panel(aq.isLoading, aq.error, !aq.isLoading && ads.length === 0, 'No P2P ads.')}
              {!aq.isLoading && !aq.isError && ads.length > 0 && (
                <>
                  <div className={tw}>
                    <table className="w-full min-w-[800px] border-collapse">
                      <thead>
                        <tr>
                          {['User', 'Type', 'Asset', 'Price', 'Limits', 'Status'].map((h) => (
                            <th key={h} className={th}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ads.map((row) => {
                          const t = str(row.ad_type ?? row.type).toLowerCase();
                          return (
                            <tr key={str(row.id)}>
                              <td className={td}>{str(row.username ?? row.email)}</td>
                              <td className={td}>{t === 'buy' ? 'Buy' : t === 'sell' ? 'Sell' : '—'}</td>
                              <td className={cn(td, 'font-medium')}>{str(row.crypto_symbol)}</td>
                              <td className={cn(td, 'tabular-nums')}>{`${str(row.price)} ${str(row.fiat_currency)}`}</td>
                              <td className={cn(td, 'tabular-nums text-xs')}>{`${str(row.min_amount)} – ${str(row.max_amount)}`}</td>
                              <td className={td}><Badge variant={statusVar(str(row.status))} size="sm">{str(row.status)}</Badge></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {pag(ap?.page ?? adsPage, aPages, ap?.total ?? 0, 'total', aq.isFetching, setAdsPage)}
                </>
              )}
            </>
          )}
          {tab === 'merchants' && (
            <>
              <div className="mb-4 flex items-center gap-2">
                <select
                  className="rounded-ds-md border border-admin-border bg-admin-card px-3 py-1.5 text-sm"
                  value={merchantFilter}
                  onChange={(e) => { setMerchantFilter(e.target.value); setMerchantsPage(1); }}
                >
                  <option value="all">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
              {panel(mq.isLoading, mq.error, !mq.isLoading && merchants.length === 0, 'No merchant applications.')}
              {!mq.isLoading && !mq.isError && merchants.length > 0 && (
                <>
                  <div className={tw}>
                    <table className="w-full min-w-[900px] border-collapse">
                      <thead>
                        <tr>
                          {['User', 'Business Name', 'Type', '30d Volume', 'Completion', 'Status', 'Applied', 'Actions'].map((h) => (
                            <th key={h} className={th}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {merchants.map((row) => {
                          const st = str(row.status);
                          const isPending = st.toLowerCase() === 'pending';
                          return (
                            <tr key={str(row.id)}>
                              <td className={td}>{str(row.user_email ?? row.user_username)}</td>
                              <td className={cn(td, 'font-medium')}>{str(row.business_name)}</td>
                              <td className={td}>{str(row.business_type)}</td>
                              <td className={cn(td, 'tabular-nums')}>{n(row.volume_30d).toLocaleString()}</td>
                              <td className={cn(td, 'tabular-nums')}>{n(row.completion_rate).toFixed(1)}%</td>
                              <td className={td}><Badge variant={statusVar(st)} size="sm">{st}</Badge></td>
                              <td className={cn(td, 'whitespace-nowrap text-admin-muted')}>{formatDt(row.created_at)}</td>
                              <td className={td}>
                                {isPending && canResolve ? (
                                  <Button size="sm" variant="outline" onClick={() => { setReviewStatus('approved'); setReviewNote(''); setReviewTarget(row); }}>Review</Button>
                                ) : (
                                  <span className="text-xs text-admin-muted">{row.reviewer_email ? `by ${str(row.reviewer_email)}` : '—'}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {pag(mp?.page ?? merchantsPage, mPages, mp?.total ?? 0, 'total', mq.isFetching, setMerchantsPage)}
                </>
              )}
            </>
          )}

          {tab === 'escrows' && (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-ds-md border border-admin-border px-3 py-2">
                  <p className="text-[10px] font-medium uppercase text-admin-muted">Total Value</p>
                  <p className="text-lg font-semibold tabular-nums">{totalEscrowValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                </div>
                <div className="rounded-ds-md border border-admin-border px-3 py-2">
                  <p className="text-[10px] font-medium uppercase text-admin-muted">Active</p>
                  <p className="text-lg font-semibold tabular-nums">{activeEscrows.length}</p>
                </div>
                {Object.entries(escrowsByStatus).map(([status, count]) => (
                  <div key={status} className="rounded-ds-md border border-admin-border px-3 py-2">
                    <p className="text-[10px] font-medium uppercase text-admin-muted">{status}</p>
                    <p className="text-lg font-semibold tabular-nums">{count}</p>
                  </div>
                ))}
              </div>
              {panel(eq.isLoading, eq.error, !eq.isLoading && allE.length === 0, 'No escrows found.')}
              {!eq.isLoading && !eq.isError && allE.length > 0 && (
                <div className={tw}>
                  <table className="w-full min-w-[900px] border-collapse">
                    <thead>
                      <tr>
                        {['ID', 'Buyer', 'Seller', 'Amount', 'Asset', 'Status', 'Frozen', 'Created', 'Actions'].map((h) => (
                          <th key={h} className={th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {allE.map((row) => {
                        const st = str(row.status).toLowerCase();
                        const isFrozen = row.frozen === true || row.is_frozen === true || st === 'frozen';
                        const canAct = ['active', 'held', 'frozen'].includes(st);
                        return (
                          <tr key={str(row.id)}>
                            <td className={cn(td, 'font-mono text-xs')}>{`${str(row.id).slice(0, 8)}…`}</td>
                            <td className={td}>{str(row.buyer_username ?? row.buyer_email ?? row.buyer_id)}</td>
                            <td className={td}>{str(row.seller_username ?? row.seller_email ?? row.seller_id)}</td>
                            <td className={cn(td, 'tabular-nums font-medium')}>{str(row.amount ?? row.crypto_amount)}</td>
                            <td className={td}>{str(row.crypto_symbol ?? row.asset ?? row.currency)}</td>
                            <td className={td}><Badge variant={statusVar(str(row.status))} size="sm">{str(row.status)}</Badge></td>
                            <td className={td}>{isFrozen ? <Badge variant="danger" size="sm">Frozen</Badge> : <span className="text-admin-muted">No</span>}</td>
                            <td className={cn(td, 'whitespace-nowrap text-admin-muted')}>{formatDt(row.created_at)}</td>
                            <td className={td}>
                              {canAct ? (
                                <div className="flex gap-1">
                                  {!isFrozen && (
                                    <Button size="sm" variant="outline" onClick={() => { setEscrowReason(''); setEscrowAction({ row, action: 'freeze' }); }}>Freeze</Button>
                                  )}
                                  {isFrozen && (
                                    <Button size="sm" variant="outline" onClick={() => { setEscrowAction({ row, action: 'unfreeze' }); }}>Unfreeze</Button>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-admin-muted">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Escrow Freeze/Unfreeze Modal */}
      <Modal open={!!escrowAction} onClose={() => !escrowMu.isPending && setEscrowAction(null)} title={escrowAction?.action === 'freeze' ? 'Freeze Escrow' : 'Unfreeze Escrow'} size="sm">
        <div className="space-y-3">
          {escrowAction?.action === 'freeze' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-admin-muted">Reason</label>
              <Textarea rows={3} value={escrowReason} onChange={(e) => setEscrowReason(e.target.value)} disabled={escrowMu.isPending} placeholder="Reason for freezing" />
            </div>
          )}
          <p className="text-sm text-admin-muted">
            {escrowAction?.action === 'freeze' ? 'This will freeze the escrow and prevent any releases.' : 'This will unfreeze the escrow and allow normal processing.'}
          </p>
          {escrowMu.isError && <p className="text-sm text-admin-danger">{(escrowMu.error as Error).message}</p>}
        </div>
        <ModalFooter className="mt-2 border-0 px-0 pb-0 pt-4">
          <Button variant="outline" onClick={() => setEscrowAction(null)} disabled={escrowMu.isPending}>Cancel</Button>
          <Button onClick={() => { const eid = str(escrowAction?.row?.id); if (eid !== '—' && escrowAction) escrowMu.mutate({ id: eid, action: escrowAction.action, reason: escrowReason.trim() || undefined }); }} disabled={escrowMu.isPending}>
            {escrowMu.isPending ? 'Processing…' : 'Confirm'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Merchant Review Modal */}
      <Modal open={!!reviewTarget} onClose={() => !reviewMu.isPending && setReviewTarget(null)} title="Review Merchant Application" size="md">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-admin-muted">Business:</span> {str(reviewTarget?.business_name)}</div>
            <div><span className="text-admin-muted">Type:</span> {str(reviewTarget?.business_type)}</div>
            <div><span className="text-admin-muted">30d Volume:</span> {n(reviewTarget?.volume_30d).toLocaleString()}</div>
            <div><span className="text-admin-muted">Completion:</span> {n(reviewTarget?.completion_rate).toFixed(1)}%</div>
          </div>
          <label className="block text-xs font-medium text-admin-muted">Decision</label>
          <select className="w-full rounded-ds-md border border-admin-border bg-admin-card px-3 py-2 text-sm" value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value as typeof reviewStatus)} disabled={reviewMu.isPending}>
            <option value="approved">Approve</option>
            <option value="rejected">Reject</option>
          </select>
          <div>
            <label className="mb-1 block text-xs font-medium text-admin-muted">Note (optional)</label>
            <Textarea rows={3} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} disabled={reviewMu.isPending} placeholder="Review notes" />
          </div>
          {reviewMu.isError && <p className="text-sm text-admin-danger">{(reviewMu.error as Error).message}</p>}
        </div>
        <ModalFooter className="mt-2 border-0 px-0 pb-0 pt-4">
          <Button variant="outline" onClick={() => setReviewTarget(null)} disabled={reviewMu.isPending}>Cancel</Button>
          <Button onClick={() => { const mid = str(reviewTarget?.id); if (mid !== '—') reviewMu.mutate({ id: mid, status: reviewStatus, note: reviewNote }); }} disabled={reviewMu.isPending}>
            {reviewMu.isPending ? 'Reviewing…' : reviewStatus === 'approved' ? 'Approve' : 'Reject'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Dispute Resolution Modal */}
      <Modal open={!!resolveTarget} onClose={() => !resolveMu.isPending && setResolveTarget(null)} title="Resolve dispute" size="md">
        <div className="space-y-3">
          <label className="block text-xs font-medium text-admin-muted">Resolution</label>
          <select className="w-full rounded-ds-md border border-admin-border bg-admin-card px-3 py-2 text-sm" value={resolution} onChange={(e) => setResolution(e.target.value as typeof resolution)} disabled={resolveMu.isPending}>
            <option value="favor_buyer">Release to buyer</option>
            <option value="favor_seller">Release to seller</option>
            <option value="cancelled">Cancel</option>
          </select>
          <div>
            <label className="mb-1 block text-xs font-medium text-admin-muted">Notes (optional)</label>
            <Textarea rows={3} value={resolveNotes} onChange={(e) => setResolveNotes(e.target.value)} disabled={resolveMu.isPending} placeholder="Audit notes" />
          </div>
          {resolveMu.isError && <p className="text-sm text-admin-danger">{(resolveMu.error as Error).message}</p>}
        </div>
        <ModalFooter className="mt-2 border-0 px-0 pb-0 pt-4">
          <Button variant="outline" onClick={() => setResolveTarget(null)} disabled={resolveMu.isPending}>Cancel</Button>
          <Button onClick={() => { const id = str(resolveTarget?.id); if (id !== '—') resolveMu.mutate({ id, resolution, notes: resolveNotes }); }} disabled={resolveMu.isPending}>
            {resolveMu.isPending ? 'Resolving…' : 'Confirm'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
