'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, Button, Tabs, Modal, ModalFooter, Input } from '@/components/ui';
import { useAdminAuthStore } from '@/store/auth';
import { cn } from '@/lib/cn';
import {
  getFees,
  getFeesTrading,
  getFeesWithdrawal,
  createFeeTier,
  updateFeeTier,
  getFeePromotions,
  createFeePromotion,
  updateFeePromotion,
  deleteFeePromotion,
  getFeeAuditHistory,
  patchWithdrawalFee,
  type FeeTier,
  type FeePromotion,
} from '@/lib/admin';
import { getRevenueBreakdown } from '@/lib/admin/analytics';
import { AdminPageFrame } from '@/components/admin-shell/AdminPageFrame';

type TabId = 'trading' | 'withdrawal';

type TradingPairRow = { id: string; symbol: string; maker_fee?: string | number | null; taker_fee?: string | number | null };
type WithdrawalRow = {
  id: string;
  symbol: string;
  name?: string;
  withdrawal_fee?: string | number | null;
  withdrawal_fee_type?: string;
  min_withdrawal?: string | number | null;
  chain_symbol?: string | null;
};
type FeeTierRow = {
  id?: string;
  tier_name?: string;
  name?: string;
  tier_level?: number;
  min_trading_volume?: string | number | null;
  min_volume?: string | number | null;
  min_token_holding?: string | number | null;
  spot_maker_fee?: string | number | null;
  maker_fee?: string | number | null;
  spot_taker_fee?: string | number | null;
  taker_fee?: string | number | null;
  withdrawal_fee_discount?: string | number | null;
};

const usd = (n: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(
    Number.isFinite(n) ? n : 0
  );
const pctFee = (v: string | number | null | undefined) => {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(3)}%` : '—';
};
const wdFee = (c: WithdrawalRow) => {
  const n = c.withdrawal_fee == null ? NaN : typeof c.withdrawal_fee === 'string' ? parseFloat(c.withdrawal_fee) : Number(c.withdrawal_fee);
  if (!Number.isFinite(n)) return '—';
  return (c.withdrawal_fee_type ?? 'fixed').toLowerCase() === 'percentage' ? `${(n * 100).toFixed(4)}%` : `${n} ${c.symbol}`;
};
const minWd = (v: string | number | null | undefined, sym: string) => {
  const n = v == null ? NaN : typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? `${n} ${sym}` : '—';
};

function Load({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-14 text-sm text-admin-muted">
      <Loader2 className="h-5 w-5 animate-spin" />
      {label}
    </div>
  );
}

function formatDate(s: string | undefined | null) {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

/* ------------------------------------------------------------------ */
/*  Tier Modal                                                          */
/* ------------------------------------------------------------------ */

interface TierFormData {
  name: string;
  min_volume: string;
  maker_fee: string;
  taker_fee: string;
}

const TIER_INITIAL: TierFormData = { name: '', min_volume: '0', maker_fee: '0.1', taker_fee: '0.1' };

function TierModal({
  open,
  onClose,
  onConfirm,
  isLoading,
  tier,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (data: { name: string; min_volume: number; maker_fee: number; taker_fee: number }) => void;
  isLoading?: boolean;
  tier?: FeeTierRow | null;
}) {
  const [form, setForm] = useState<TierFormData>(TIER_INITIAL);
  const isEdit = !!tier;

  useEffect(() => {
    if (!open) return;
    if (tier) {
      const makerRaw = tier.spot_maker_fee ?? tier.maker_fee;
      const takerRaw = tier.spot_taker_fee ?? tier.taker_fee;
      const m = makerRaw != null ? parseFloat(String(makerRaw)) : 0;
      const t = takerRaw != null ? parseFloat(String(takerRaw)) : 0;
      setForm({
        name: tier.tier_name ?? tier.name ?? '',
        min_volume: String(tier.min_trading_volume ?? tier.min_volume ?? 0),
        maker_fee: (m * 100).toFixed(3),
        taker_fee: (t * 100).toFixed(3),
      });
    } else {
      setForm(TIER_INITIAL);
    }
  }, [open, tier]);

  const makerFee = parseFloat(form.maker_fee);
  const takerFee = parseFloat(form.taker_fee);
  const minVol = parseFloat(form.min_volume);
  const valid =
    form.name.trim().length > 0 &&
    Number.isFinite(makerFee) && makerFee >= 0 && makerFee <= 100 &&
    Number.isFinite(takerFee) && takerFee >= 0 && takerFee <= 100 &&
    Number.isFinite(minVol) && minVol >= 0;

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Fee Tier' : 'Add Fee Tier'} size="md">
      <div className="space-y-4">
        <Input label="Tier Name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. VIP 1" />
        <Input label="Min Trading Volume (USD)" type="number" min={0} step="any" value={form.min_volume} onChange={(e) => setForm((p) => ({ ...p, min_volume: e.target.value }))} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Maker Fee (%)" type="number" min={0} max={100} step={0.001} value={form.maker_fee} onChange={(e) => setForm((p) => ({ ...p, maker_fee: e.target.value }))} />
          <Input label="Taker Fee (%)" type="number" min={0} max={100} step={0.001} value={form.taker_fee} onChange={(e) => setForm((p) => ({ ...p, taker_fee: e.target.value }))} />
        </div>
      </div>
      <ModalFooter className="-mx-6 -mb-5 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          onClick={() => valid && onConfirm({ name: form.name.trim(), min_volume: minVol, maker_fee: makerFee / 100, taker_fee: takerFee / 100 })}
          disabled={isLoading || !valid}
          loading={isLoading}
        >
          {isEdit ? 'Save Changes' : 'Create Tier'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Promotion Modal                                                     */
/* ------------------------------------------------------------------ */

interface PromoFormData {
  name: string;
  code: string;
  maker_fee_override: string;
  taker_fee_override: string;
  discount_pct: string;
  starts_at: string;
  ends_at: string;
}

const PROMO_INITIAL: PromoFormData = {
  name: '', code: '', maker_fee_override: '', taker_fee_override: '', discount_pct: '', starts_at: '', ends_at: '',
};

function PromotionModal({
  open,
  onClose,
  onConfirm,
  isLoading,
  promo,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (data: {
    name: string;
    code?: string;
    maker_fee_override?: number;
    taker_fee_override?: number;
    discount_pct?: number;
    starts_at?: string;
    ends_at?: string;
  }) => void;
  isLoading?: boolean;
  promo?: FeePromotion | null;
}) {
  const [form, setForm] = useState<PromoFormData>(PROMO_INITIAL);
  const isEdit = !!promo;

  useEffect(() => {
    if (!open) return;
    if (promo) {
      const m = promo.maker_fee_override != null ? parseFloat(String(promo.maker_fee_override)) : NaN;
      const t = promo.taker_fee_override != null ? parseFloat(String(promo.taker_fee_override)) : NaN;
      const d = promo.discount_pct != null ? parseFloat(String(promo.discount_pct)) : NaN;
      setForm({
        name: promo.name ?? '',
        code: promo.code ?? '',
        maker_fee_override: Number.isFinite(m) ? (m * 100).toFixed(3) : '',
        taker_fee_override: Number.isFinite(t) ? (t * 100).toFixed(3) : '',
        discount_pct: Number.isFinite(d) ? (d * 100).toFixed(1) : '',
        starts_at: promo.starts_at ? promo.starts_at.slice(0, 16) : '',
        ends_at: promo.ends_at ? promo.ends_at.slice(0, 16) : '',
      });
    } else {
      setForm(PROMO_INITIAL);
    }
  }, [open, promo]);

  const valid = form.name.trim().length > 0;

  const handleConfirm = () => {
    if (!valid) return;
    const m = parseFloat(form.maker_fee_override);
    const t = parseFloat(form.taker_fee_override);
    const d = parseFloat(form.discount_pct);
    onConfirm({
      name: form.name.trim(),
      code: form.code.trim() || undefined,
      maker_fee_override: Number.isFinite(m) ? m / 100 : undefined,
      taker_fee_override: Number.isFinite(t) ? t / 100 : undefined,
      discount_pct: Number.isFinite(d) ? d / 100 : undefined,
      starts_at: form.starts_at || undefined,
      ends_at: form.ends_at || undefined,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Promotion' : 'Add Promotion'} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Launch Week" />
          <Input label="Code (optional)" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} placeholder="e.g. LAUNCH2026" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Input label="Maker Override (%)" type="number" min={0} max={100} step={0.001} value={form.maker_fee_override} onChange={(e) => setForm((p) => ({ ...p, maker_fee_override: e.target.value }))} placeholder="—" />
          <Input label="Taker Override (%)" type="number" min={0} max={100} step={0.001} value={form.taker_fee_override} onChange={(e) => setForm((p) => ({ ...p, taker_fee_override: e.target.value }))} placeholder="—" />
          <Input label="Discount (%)" type="number" min={0} max={100} step={0.1} value={form.discount_pct} onChange={(e) => setForm((p) => ({ ...p, discount_pct: e.target.value }))} placeholder="—" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Starts At" type="datetime-local" value={form.starts_at} onChange={(e) => setForm((p) => ({ ...p, starts_at: e.target.value }))} />
          <Input label="Ends At" type="datetime-local" value={form.ends_at} onChange={(e) => setForm((p) => ({ ...p, ends_at: e.target.value }))} />
        </div>
      </div>
      <ModalFooter className="-mx-6 -mb-5 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={handleConfirm} disabled={isLoading || !valid} loading={isLoading}>
          {isEdit ? 'Save Changes' : 'Create Promotion'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Delete Confirmation                                                 */
/* ------------------------------------------------------------------ */

function DeleteConfirmModal({
  open,
  label,
  onClose,
  onConfirm,
  isLoading,
}: {
  open: boolean;
  label: string;
  onClose: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Delete Promotion" size="sm">
      <p className="text-sm text-admin-muted">
        Are you sure you want to delete <span className="font-semibold text-admin-text">{label}</span>? This cannot be undone.
      </p>
      <ModalFooter className="-mx-6 -mb-5 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm} disabled={isLoading} loading={isLoading}>Delete</Button>
      </ModalFooter>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                                */
/* ------------------------------------------------------------------ */

export default function FeesManagementPage() {
  const token = useAdminAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabId>('trading');

  const [tierModal, setTierModal] = useState<{ open: boolean; tier: FeeTierRow | null }>({ open: false, tier: null });
  const [promoModal, setPromoModal] = useState<{ open: boolean; promo: FeePromotion | null }>({ open: false, promo: null });
  const [deletePromo, setDeletePromo] = useState<FeePromotion | null>(null);
  const [wdEditTarget, setWdEditTarget] = useState<WithdrawalRow | null>(null);
  const [wdEditForm, setWdEditForm] = useState({ fee: '', minWd: '', feeType: 'fixed' });

  const enabled = !!token;
  const [revQ, tiersQ, tradingQ, wdQ] = useQueries({
    queries: [
      {
        queryKey: ['admin', 'fees', 'revenue-breakdown', '7d', token],
        queryFn: () => getRevenueBreakdown(token, '7d'),
        enabled,
        staleTime: 60_000,
        refetchInterval: 30_000,
      },
      {
        queryKey: ['admin', 'fees', 'tiers', token],
        queryFn: () => getFees(token),
        enabled,
        staleTime: 120_000,
        refetchInterval: 30_000,
      },
      {
        queryKey: ['admin', 'fees', 'trading', token],
        queryFn: () => getFeesTrading(token),
        enabled,
        staleTime: 120_000,
        refetchInterval: 30_000,
      },
      {
        queryKey: ['admin', 'fees', 'withdrawal', token],
        queryFn: () => getFeesWithdrawal(token),
        enabled,
        staleTime: 120_000,
        refetchInterval: 30_000,
      },
    ],
  });

  const promosQ = useQuery({
    queryKey: ['admin', 'fees', 'promotions', token],
    queryFn: () => getFeePromotions(token),
    enabled,
    staleTime: 60_000,
    refetchInterval: 30_000,
  });

  const historyQ = useQuery({
    queryKey: ['admin', 'fees', 'audit-history', token],
    queryFn: () => getFeeAuditHistory(token, { limit: 50 }),
    enabled,
    staleTime: 60_000,
  });

  /* -- Tier mutations -- */
  const createTierMut = useMutation({
    mutationFn: (body: Parameters<typeof createFeeTier>[1]) => createFeeTier(token, body).then((r) => {
      if (!r.success) throw new Error((r as { error?: { message?: string } }).error?.message ?? 'Failed');
      return r;
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'fees', 'tiers'] });
      setTierModal({ open: false, tier: null });
    },
  });

  const updateTierMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateFeeTier>[2] }) =>
      updateFeeTier(token, id, body).then((r) => {
        if (!r.success) throw new Error((r as { error?: { message?: string } }).error?.message ?? 'Failed');
        return r;
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'fees', 'tiers'] });
      setTierModal({ open: false, tier: null });
    },
  });

  /* -- Promotion mutations -- */
  const createPromoMut = useMutation({
    mutationFn: (body: Parameters<typeof createFeePromotion>[1]) => createFeePromotion(token, body).then((r) => {
      if (!r.success) throw new Error((r as { error?: { message?: string } }).error?.message ?? 'Failed');
      return r;
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'fees', 'promotions'] });
      setPromoModal({ open: false, promo: null });
    },
  });

  const updatePromoMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateFeePromotion>[2] }) =>
      updateFeePromotion(token, id, body).then((r) => {
        if (!r.success) throw new Error((r as { error?: { message?: string } }).error?.message ?? 'Failed');
        return r;
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'fees', 'promotions'] });
      setPromoModal({ open: false, promo: null });
    },
  });

  const deletePromoMut = useMutation({
    mutationFn: (id: string) => deleteFeePromotion(token, id).then((r) => {
      if (!r.success) throw new Error((r as { error?: { message?: string } }).error?.message ?? 'Failed');
      return r;
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'fees', 'promotions'] });
      setDeletePromo(null);
    },
  });

  /* -- Withdrawal fee edit -- */
  const wdEditMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      patchWithdrawalFee(token, id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'fees', 'withdrawal'] });
      setWdEditTarget(null);
    },
  });

  function openWdEdit(c: WithdrawalRow) {
    setWdEditTarget(c);
    const n = c.withdrawal_fee == null ? '' : String(c.withdrawal_fee);
    const m = c.min_withdrawal == null ? '' : String(c.min_withdrawal);
    setWdEditForm({ fee: n, minWd: m, feeType: c.withdrawal_fee_type ?? 'fixed' });
  }

  function submitWdEdit() {
    if (!wdEditTarget?.id) return;
    wdEditMut.mutate({
      id: wdEditTarget.id,
      body: {
        withdrawal_fee: wdEditForm.fee,
        min_withdrawal: wdEditForm.minWd,
        withdrawal_fee_type: wdEditForm.feeType,
      },
    });
  }

  /* -- Derived data -- */
  const rev = revQ.data?.success ? revQ.data.data : undefined;
  const revLoading = revQ.isLoading || revQ.isFetching;
  const tiersRaw = tiersQ.data?.success ? (tiersQ.data.data as { tiers?: unknown[] })?.tiers : undefined;
  const tiers = Array.isArray(tiersRaw) ? (tiersRaw as FeeTierRow[]) : [];
  const pairsRaw = tradingQ.data?.success ? (tradingQ.data.data as { pairs?: unknown[] })?.pairs : undefined;
  const pairs = Array.isArray(pairsRaw) ? (pairsRaw as TradingPairRow[]) : [];
  const curRaw = wdQ.data?.success ? (wdQ.data.data as { currencies?: unknown[] })?.currencies : undefined;
  const currencies = Array.isArray(curRaw) ? (curRaw as WithdrawalRow[]) : [];

  const promosData = promosQ.data?.success ? promosQ.data.data : undefined;
  const promotions = (promosData as { promotions?: FeePromotion[] })?.promotions ?? [];

  const historyData = historyQ.data?.success ? historyQ.data.data : undefined;
  const historyLogs = (historyData as { logs?: Array<Record<string, unknown>> })?.logs ?? [];

  const kpis: { label: string; value: number }[] = [
    { label: 'Trading Fee Revenue (7d)', value: rev?.tradingFees ?? 0 },
    { label: 'Withdrawal Fee Revenue (7d)', value: rev?.withdrawalFees ?? 0 },
    { label: 'P2P Commission (7d)', value: rev?.p2pCommission ?? 0 },
    { label: 'Total Revenue (7d)', value: rev?.total ?? 0 },
  ];

  const handleTierConfirm = (data: { name: string; min_volume: number; maker_fee: number; taker_fee: number }) => {
    const t = tierModal.tier;
    if (t?.id) {
      updateTierMut.mutate({ id: t.id, body: data });
    } else {
      createTierMut.mutate(data);
    }
  };

  const handlePromoConfirm = (data: Parameters<typeof createFeePromotion>[1]) => {
    const p = promoModal.promo;
    if (p?.id) {
      updatePromoMut.mutate({ id: p.id, body: data });
    } else {
      createPromoMut.mutate(data);
    }
  };

  return (
    <AdminPageFrame
      title="Fee Management"
      description="Revenue KPIs (last 7 days), trading and withdrawal fees."
      quickActions={
        <Button variant="outline" size="sm" onClick={() => void qc.invalidateQueries({ queryKey: ['admin', 'fees'] })}>
          Refresh
        </Button>
      }
    >

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-admin-border bg-admin-card p-4">
            <p className="text-[10px] font-medium uppercase tracking-wider text-admin-muted">{k.label}</p>
            {revLoading ? (
              <span className="mt-2 inline-block h-5 w-20 animate-pulse rounded bg-white/5 align-middle" />
            ) : (
              <p className="mt-2 text-xl font-bold tabular-nums text-admin-text">{usd(k.value)}</p>
            )}
          </div>
        ))}
      </div>

      {/* Trading / Withdrawal Fees */}
      <Card compact noPadding>
        <div className="border-b border-admin-border px-4 pt-4">
          <Tabs<TabId>
            variant="pills"
            size="sm"
            active={tab}
            onChange={setTab}
            items={[
              { id: 'trading', label: 'Trading Fees' },
              { id: 'withdrawal', label: 'Withdrawal Fees' },
            ]}
          />
        </div>
        <CardContent className="p-0">
          {tab === 'trading' &&
            (tradingQ.isLoading ? (
              <Load label="Loading markets…" />
            ) : pairs.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-14 text-center text-sm text-admin-muted">
                <p>No trading pairs returned.</p>
                <Link
                  href="/markets"
                  className="inline-flex h-8 items-center justify-center rounded-ds-md border border-admin-border px-3 text-sm font-medium hover:bg-white/5"
                >
                  Open markets
                </Link>
              </div>
            ) : (
              <table className="w-full min-w-[440px] text-left text-sm">
                <thead className="border-b border-admin-border bg-white/[0.02] text-xs font-semibold uppercase tracking-wide text-admin-muted">
                  <tr>
                    <th className="px-4 py-3">Market</th>
                    <th className="px-4 py-3">Maker Fee</th>
                    <th className="px-4 py-3">Taker Fee</th>
                    <th className="px-4 py-3 text-right"> </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-admin-border">
                  {pairs.map((p) => (
                    <tr key={p.id} className="hover:bg-white/5">
                      <td className="px-4 py-3 font-medium text-admin-text">{p.symbol}</td>
                      <td className="px-4 py-3 tabular-nums text-admin-text">{pctFee(p.maker_fee)}</td>
                      <td className="px-4 py-3 tabular-nums text-admin-text">{pctFee(p.taker_fee)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/markets/${encodeURIComponent(p.symbol)}`}
                          className={cn('text-sm font-medium text-admin-primary hover:underline')}
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}

          {tab === 'withdrawal' &&
            (wdQ.isLoading ? (
              <Load label="Loading assets…" />
            ) : currencies.length === 0 ? (
              <p className="py-14 text-center text-sm text-admin-muted">No withdrawal fee configuration found.</p>
            ) : (
              <table className="w-full min-w-[400px] text-left text-sm">
                <thead className="border-b border-admin-border bg-white/[0.02] text-xs font-semibold uppercase tracking-wide text-admin-muted">
                  <tr>
                    <th className="px-4 py-3">Asset</th>
                    <th className="px-4 py-3">Withdrawal Fee</th>
                    <th className="px-4 py-3">Min Withdrawal</th>
                    <th className="px-4 py-3 text-right"> </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-admin-border">
                  {currencies.map((c) => (
                    <tr key={`${c.id}-${c.chain_symbol ?? ''}`} className="hover:bg-white/[0.03]">
                      <td className="px-4 py-3">
                        <span className="font-medium text-admin-text">{c.symbol}</span>
                        {c.name ? <span className="ml-2 text-xs text-admin-muted">{c.name}</span> : null}
                        {c.chain_symbol ? <span className="ml-1 rounded bg-white/[0.06] px-1 py-px text-[10px] text-admin-muted">{c.chain_symbol}</span> : null}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-admin-text">{wdFee(c)}</td>
                      <td className="px-4 py-3 tabular-nums text-admin-text">{minWd(c.min_withdrawal, c.symbol)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openWdEdit(c)}
                          className="inline-flex items-center gap-1 rounded-lg border border-admin-border/60 px-2.5 py-1 text-xs text-admin-muted hover:text-admin-text hover:border-blue-500/30 hover:bg-blue-950/10 transition-colors"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
        </CardContent>
      </Card>

      {/* Fee Schedule & VIP Tiers */}
      <Card compact>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Fee schedule &amp; VIP tiers</CardTitle>
            <Button
              size="xs"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setTierModal({ open: true, tier: null })}
            >
              Add Tier
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-admin-text">
          {tiersQ.isLoading ? (
            <div className="flex items-center gap-2 text-admin-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading tier schedule…
            </div>
          ) : tiers.length === 0 ? (
            <p className="text-admin-muted">
              No VIP tiers configured. Click &ldquo;Add Tier&rdquo; to create one.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-ds-sm border border-admin-border">
              <table className="w-full min-w-[660px] text-left text-sm">
                <thead className="bg-white/[0.02] text-xs font-semibold uppercase tracking-wide text-admin-muted">
                  <tr>
                    <th className="px-3 py-2">Tier</th>
                    <th className="px-3 py-2">Level</th>
                    <th className="px-3 py-2">Min volume</th>
                    <th className="px-3 py-2">Min holding</th>
                    <th className="px-3 py-2">Maker</th>
                    <th className="px-3 py-2">Taker</th>
                    <th className="px-3 py-2">WD discount</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-admin-border">
                  {tiers.map((t) => (
                    <tr key={t.id ?? String(t.tier_level)} className="hover:bg-white/5">
                      <td className="px-3 py-2 font-medium text-admin-text">{t.tier_name ?? t.name ?? '—'}</td>
                      <td className="px-3 py-2 tabular-nums">{t.tier_level ?? '—'}</td>
                      <td className="px-3 py-2 tabular-nums">{t.min_trading_volume ?? t.min_volume ?? '—'}</td>
                      <td className="px-3 py-2 tabular-nums">{t.min_token_holding ?? '—'}</td>
                      <td className="px-3 py-2 tabular-nums">{pctFee(t.spot_maker_fee ?? t.maker_fee)}</td>
                      <td className="px-3 py-2 tabular-nums">{pctFee(t.spot_taker_fee ?? t.taker_fee)}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {t.withdrawal_fee_discount != null ? `${(Number(t.withdrawal_fee_discount) * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => setTierModal({ open: true, tier: t })}
                          className="inline-flex items-center gap-1 text-sm font-medium text-admin-primary hover:underline"
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Promotions */}
      <Card compact>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Fee Promotions</CardTitle>
            <Button
              size="xs"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setPromoModal({ open: true, promo: null })}
            >
              Add Promotion
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-admin-text">
          {promosQ.isLoading ? (
            <div className="flex items-center gap-2 text-admin-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading promotions…
            </div>
          ) : promotions.length === 0 ? (
            <p className="text-admin-muted">No fee promotions configured.</p>
          ) : (
            <div className="overflow-x-auto rounded-ds-sm border border-admin-border">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-white/[0.02] text-xs font-semibold uppercase tracking-wide text-admin-muted">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Maker</th>
                    <th className="px-3 py-2">Taker</th>
                    <th className="px-3 py-2">Discount</th>
                    <th className="px-3 py-2">Period</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-admin-border">
                  {promotions.map((p) => (
                    <tr key={p.id} className="hover:bg-white/5">
                      <td className="px-3 py-2 font-medium text-admin-text">{p.name ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-admin-muted">{p.code || '—'}</td>
                      <td className="px-3 py-2 tabular-nums">{pctFee(p.maker_fee_override)}</td>
                      <td className="px-3 py-2 tabular-nums">{pctFee(p.taker_fee_override)}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {p.discount_pct != null ? `${(Number(p.discount_pct) * 100).toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-admin-muted">
                        {p.starts_at ? formatDate(p.starts_at) : '—'} → {p.ends_at ? formatDate(p.ends_at) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setPromoModal({ open: true, promo: p })}
                            className="inline-flex items-center gap-1 text-sm font-medium text-admin-primary hover:underline"
                          >
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </button>
                          <button
                            onClick={() => setDeletePromo(p)}
                            className="inline-flex items-center gap-1 text-sm font-medium text-admin-danger hover:underline"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fee Change History */}
      <Card>
        <CardHeader>
          <CardTitle>Fee Change History</CardTitle>
        </CardHeader>
        <CardContent>
          {historyQ.isLoading ? (
            <Load label="Loading audit trail…" />
          ) : historyLogs.length === 0 ? (
            <p className="py-8 text-center text-sm text-admin-muted">
              No fee change history found. Changes made via the admin panel will appear here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-admin-border text-left text-xs font-semibold uppercase tracking-wide text-admin-muted">
                    <th className="pb-2 pr-4">Date</th>
                    <th className="pb-2 pr-4">Action</th>
                    <th className="pb-2 pr-4">Resource</th>
                    <th className="pb-2 pr-4">Old Value</th>
                    <th className="pb-2 pr-4">New Value</th>
                    <th className="pb-2 pr-4">Actor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-admin-border">
                  {historyLogs.map((log) => (
                    <tr key={String(log.id)} className="hover:bg-white/5">
                      <td className="py-2 pr-4 text-xs text-admin-muted">{formatDate(String(log.created_at))}</td>
                      <td className="py-2 pr-4 font-medium text-admin-text">{String(log.action ?? '—')}</td>
                      <td className="py-2 pr-4 text-admin-text">
                        {log.resource_type ? `${log.resource_type}` : '—'}
                        {log.resource_id ? ` #${log.resource_id}` : ''}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-admin-muted max-w-[180px] truncate" title={String(log.old_value ?? '')}>
                        {log.old_value ? String(log.old_value).slice(0, 60) : '—'}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-admin-muted max-w-[180px] truncate" title={String(log.new_value ?? '')}>
                        {log.new_value ? String(log.new_value).slice(0, 60) : '—'}
                      </td>
                      <td className="py-2 pr-4 text-xs text-admin-muted">{log.actor_id ? `${log.actor_type ?? 'admin'}:${log.actor_id}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modals */}
      <TierModal
        open={tierModal.open}
        onClose={() => setTierModal({ open: false, tier: null })}
        onConfirm={handleTierConfirm}
        isLoading={createTierMut.isPending || updateTierMut.isPending}
        tier={tierModal.tier}
      />

      <PromotionModal
        open={promoModal.open}
        onClose={() => setPromoModal({ open: false, promo: null })}
        onConfirm={handlePromoConfirm}
        isLoading={createPromoMut.isPending || updatePromoMut.isPending}
        promo={promoModal.promo}
      />

      <DeleteConfirmModal
        open={!!deletePromo}
        label={deletePromo?.name ?? 'this promotion'}
        onClose={() => setDeletePromo(null)}
        onConfirm={() => deletePromo && deletePromoMut.mutate(deletePromo.id)}
        isLoading={deletePromoMut.isPending}
      />

      {/* Withdrawal Fee Edit Modal */}
      <Modal
        open={!!wdEditTarget}
        onClose={() => setWdEditTarget(null)}
        title={`Edit Withdrawal Fee — ${wdEditTarget?.symbol ?? ''}`}
        size="sm"
      >
        {wdEditTarget && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-admin-muted mb-1">Fee Type</label>
              <select
                value={wdEditForm.feeType}
                onChange={(e) => setWdEditForm((f) => ({ ...f, feeType: e.target.value }))}
                className="w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm text-admin-text focus:outline-none focus:ring-1 focus:ring-blue-500/40"
              >
                <option value="fixed">Fixed</option>
                <option value="percentage">Percentage</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-admin-muted mb-1">
                Withdrawal Fee {wdEditForm.feeType === 'percentage' ? '(decimal, e.g. 0.001 = 0.1%)' : `(${wdEditTarget.symbol} amount)`}
              </label>
              <input
                type="text"
                value={wdEditForm.fee}
                onChange={(e) => setWdEditForm((f) => ({ ...f, fee: e.target.value }))}
                placeholder={wdEditForm.feeType === 'percentage' ? '0.001' : '0.0005'}
                className="w-full rounded-lg border border-admin-border/60 bg-admin-surface px-3 py-2 text-sm font-mono text-admin-text focus:outline-none focus:ring-1 focus:ring-blue-500/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-admin-muted mb-1">Min Withdrawal ({wdEditTarget.symbol})</label>
              <input
                type="text"
                value={wdEditForm.minWd}
                onChange={(e) => setWdEditForm((f) => ({ ...f, minWd: e.target.value }))}
                placeholder="0.01"
                className="w-full rounded-lg border border-admin-border/60 bg-admin-surface px-3 py-2 text-sm font-mono text-admin-text focus:outline-none focus:ring-1 focus:ring-blue-500/40"
              />
            </div>
            {wdEditMut.isError && (
              <p className="flex items-center gap-1.5 text-xs text-red-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                {(wdEditMut.error as Error)?.message ?? 'Failed to save. The backend may not support this endpoint yet.'}
              </p>
            )}
          </div>
        )}
        <ModalFooter className="-mx-6 -mb-5 mt-4">
          <Button variant="secondary" onClick={() => setWdEditTarget(null)}>Cancel</Button>
          <Button onClick={submitWdEdit} loading={wdEditMut.isPending} disabled={wdEditMut.isPending}>
            Save
          </Button>
        </ModalFooter>
      </Modal>
    </AdminPageFrame>
  );
}
