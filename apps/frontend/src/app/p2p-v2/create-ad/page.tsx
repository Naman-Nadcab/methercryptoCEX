'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import RequireAuth from '@/components/RequireAuth';
import { useP2pReferencePrice } from '@/hooks/useP2pReferencePrice';
import { createAd, fetchPlatformPaymentMethods, fetchMyPaymentMethods } from '@/lib/p2pApi';
import { useQuery } from '@tanstack/react-query';

export default function P2PV2CreateAdPage() {
  return (
    <RequireAuth>
      <CreateAdForm />
    </RequireAuth>
  );
}

function CreateAdForm() {
  const router = useRouter();
  const [side, setSide] = useState<'buy' | 'sell'>('sell');
  const [crypto, setCrypto] = useState('USDT');
  const [fiat, setFiat] = useState('INR');
  const [pricing, setPricing] = useState<'fixed' | 'floating'>('fixed');
  const [fixedPrice, setFixedPrice] = useState('');
  const [marginPct, setMarginPct] = useState('0');
  const [minAmt, setMinAmt] = useState('');
  const [maxAmt, setMaxAmt] = useState('');
  const [totalAmt, setTotalAmt] = useState('');
  const [timeLimit, setTimeLimit] = useState(15);
  const [autoRel, setAutoRel] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [autoReply, setAutoReply] = useState('');
  const [selectedPm, setSelectedPm] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const { price: marketPrice } = useP2pReferencePrice(crypto, fiat, 4000);

  const computedFloating = useMemo(() => {
    const m = parseFloat(marginPct);
    if (!Number.isFinite(m) || marketPrice == null || marketPrice <= 0) return null;
    return marketPrice * (1 + m / 100);
  }, [marginPct, marketPrice]);

  const { data: platformPm = [] } = useQuery({
    queryKey: ['p2p-v2', 'platform-pm'],
    queryFn: fetchPlatformPaymentMethods,
  });

  const { data: myPm = [] } = useQuery({
    queryKey: ['p2p-v2', 'my-pm'],
    queryFn: () => fetchMyPaymentMethods(),
  });

  const mut = useMutation({
    mutationFn: () => {
      const priceStr =
        pricing === 'floating'
          ? (computedFloating != null ? String(computedFloating.toFixed(4)) : '')
          : fixedPrice.trim();
      if (!priceStr) throw new Error('Set a valid price');
      return createAd({
        type: side,
        currency: crypto,
        fiat,
        price: priceStr,
        min_amount: minAmt.trim(),
        max_amount: maxAmt.trim(),
        available_amount: totalAmt.trim(),
        payment_method_ids: selectedPm,
        payment_time_limit: timeLimit,
        auto_release: autoRel,
        remarks: remarks.trim() || undefined,
        auto_reply: autoReply.trim() || undefined,
        pricing_type: pricing === 'floating' ? 'floating' : 'fixed',
        float_margin_percent: pricing === 'floating' ? parseFloat(marginPct) : undefined,
      });
    },
    onSuccess: (res) => {
      if (res.success) {
        router.push('/p2p/my-ads');
      } else {
        setErr(res.error?.message ?? 'Failed');
      }
    },
    onError: (e: Error) => setErr(e.message),
  });

  const diffPct =
    pricing === 'floating' && marketPrice && computedFloating
      ? (((computedFloating - marketPrice) / marketPrice) * 100).toFixed(2)
      : null;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Create ad</h1>

      <div className="rounded-xl border border-border bg-card p-5 dark:border-border dark:bg-card space-y-4">
        <div className="flex gap-2">
          {(['sell', 'buy'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className={`rounded-lg px-4 py-2 text-sm font-medium capitalize ${
                side === s ? 'bg-primary text-primary-foreground' : 'bg-accent text-foreground'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Crypto</label>
            <select
              value={crypto}
              onChange={(e) => setCrypto(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border px-2 py-2 text-sm dark:border-border dark:bg-background dark:text-foreground"
            >
              {['USDT', 'BTC', 'ETH', 'USDC'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Fiat</label>
            <select
              value={fiat}
              onChange={(e) => setFiat(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border px-2 py-2 text-sm dark:border-border dark:bg-background dark:text-foreground"
            >
              {['INR', 'USD', 'EUR', 'GBP'].map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-2">Pricing</p>
          <div className="flex gap-2">
            {(['fixed', 'floating'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPricing(p)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize ${
                  pricing === p ? 'bg-primary text-primary-foreground' : 'bg-accent text-foreground'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {pricing === 'floating' && (
          <div className="rounded-lg bg-muted p-3 text-sm dark:bg-card/50">
            <p className="text-muted-foreground">
              Market price (backend / spot): {marketPrice != null ? `${marketPrice.toFixed(4)} ${fiat}` : '—'}
            </p>
            <label className="mt-2 block text-xs text-muted-foreground">Margin %</label>
            <input
              type="number"
              value={marginPct}
              onChange={(e) => setMarginPct(e.target.value)}
              className="mt-1 w-full rounded border border-border px-2 py-1 font-mono dark:border-border dark:bg-background"
            />
            {computedFloating != null && (
              <p className="mt-2 font-mono text-foreground">
                Ad price: {computedFloating.toFixed(4)} {fiat}
                {diffPct != null && <span className="text-muted-foreground"> ({diffPct}% vs reference)</span>}
              </p>
            )}
          </div>
        )}

        {pricing === 'fixed' && (
          <div>
            <label className="text-xs text-muted-foreground">Price ({fiat} per 1 {crypto})</label>
            <input
              value={fixedPrice}
              onChange={(e) => setFixedPrice(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2 font-mono dark:border-border dark:bg-background dark:text-foreground"
            />
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Min</label>
            <input value={minAmt} onChange={(e) => setMinAmt(e.target.value)} className="mt-1 w-full rounded border px-2 py-1 text-sm dark:bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Max</label>
            <input value={maxAmt} onChange={(e) => setMaxAmt(e.target.value)} className="mt-1 w-full rounded border px-2 py-1 text-sm dark:bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Total</label>
            <input value={totalAmt} onChange={(e) => setTotalAmt(e.target.value)} className="mt-1 w-full rounded border px-2 py-1 text-sm dark:bg-background" />
          </div>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Payment time limit (minutes)</label>
          <input
            type="number"
            min={5}
            max={120}
            value={timeLimit}
            onChange={(e) => setTimeLimit(Number(e.target.value))}
            className="mt-1 w-full rounded border px-2 py-1 dark:bg-background"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={autoRel} onChange={(e) => setAutoRel(e.target.checked)} />
          Auto-release when buyer confirms paid
        </label>

        <div>
          <label className="text-xs text-muted-foreground">Terms / remarks</label>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className="mt-1 w-full rounded border px-2 py-1 text-sm dark:bg-background" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Auto-reply message</label>
          <textarea value={autoReply} onChange={(e) => setAutoReply(e.target.value)} rows={2} className="mt-1 w-full rounded border px-2 py-1 text-sm dark:bg-background" />
        </div>

        <div>
          <p className="mb-2 text-xs text-muted-foreground">Payment methods you accept (your saved methods)</p>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {myPm.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedPm.includes(m.id)}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedPm([...selectedPm, m.id]);
                    else setSelectedPm(selectedPm.filter((x) => x !== m.id));
                  }}
                />
                {m.display_name || m.method_name}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">Platform types: {platformPm.map((p) => p.code).filter(Boolean).join(', ')}</p>
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}

        <button
          type="button"
          disabled={mut.isPending || selectedPm.length === 0}
          onClick={() => {
            setErr(null);
            mut.mutate();
          }}
          className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {mut.isPending ? 'Publishing…' : 'Publish ad'}
        </button>
      </div>
    </div>
  );
}
