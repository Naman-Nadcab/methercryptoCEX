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
      <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Create ad</h1>

      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-[#1e2329] space-y-4">
        <div className="flex gap-2">
          {(['sell', 'buy'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className={`rounded-lg px-4 py-2 text-sm font-medium capitalize ${
                side === s ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500">Crypto</label>
            <select
              value={crypto}
              onChange={(e) => setCrypto(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm dark:border-gray-700 dark:bg-[#0b0e11] dark:text-white"
            >
              {['USDT', 'BTC', 'ETH', 'USDC'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">Fiat</label>
            <select
              value={fiat}
              onChange={(e) => setFiat(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm dark:border-gray-700 dark:bg-[#0b0e11] dark:text-white"
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
          <p className="text-xs text-gray-500 mb-2">Pricing</p>
          <div className="flex gap-2">
            {(['fixed', 'floating'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPricing(p)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize ${
                  pricing === p ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {pricing === 'floating' && (
          <div className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-900/50">
            <p className="text-gray-600 dark:text-gray-400">
              Market price (backend / spot): {marketPrice != null ? `${marketPrice.toFixed(4)} ${fiat}` : '—'}
            </p>
            <label className="mt-2 block text-xs text-gray-500">Margin %</label>
            <input
              type="number"
              value={marginPct}
              onChange={(e) => setMarginPct(e.target.value)}
              className="mt-1 w-full rounded border border-gray-200 px-2 py-1 font-mono dark:border-gray-700 dark:bg-[#0b0e11]"
            />
            {computedFloating != null && (
              <p className="mt-2 font-mono text-gray-900 dark:text-white">
                Ad price: {computedFloating.toFixed(4)} {fiat}
                {diffPct != null && <span className="text-gray-500"> ({diffPct}% vs reference)</span>}
              </p>
            )}
          </div>
        )}

        {pricing === 'fixed' && (
          <div>
            <label className="text-xs text-gray-500">Price ({fiat} per 1 {crypto})</label>
            <input
              value={fixedPrice}
              onChange={(e) => setFixedPrice(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-mono dark:border-gray-700 dark:bg-[#0b0e11] dark:text-white"
            />
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-xs text-gray-500">Min</label>
            <input value={minAmt} onChange={(e) => setMinAmt(e.target.value)} className="mt-1 w-full rounded border px-2 py-1 text-sm dark:bg-[#0b0e11]" />
          </div>
          <div>
            <label className="text-xs text-gray-500">Max</label>
            <input value={maxAmt} onChange={(e) => setMaxAmt(e.target.value)} className="mt-1 w-full rounded border px-2 py-1 text-sm dark:bg-[#0b0e11]" />
          </div>
          <div>
            <label className="text-xs text-gray-500">Total</label>
            <input value={totalAmt} onChange={(e) => setTotalAmt(e.target.value)} className="mt-1 w-full rounded border px-2 py-1 text-sm dark:bg-[#0b0e11]" />
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-500">Payment time limit (minutes)</label>
          <input
            type="number"
            min={5}
            max={120}
            value={timeLimit}
            onChange={(e) => setTimeLimit(Number(e.target.value))}
            className="mt-1 w-full rounded border px-2 py-1 dark:bg-[#0b0e11]"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={autoRel} onChange={(e) => setAutoRel(e.target.checked)} />
          Auto-release when buyer confirms paid
        </label>

        <div>
          <label className="text-xs text-gray-500">Terms / remarks</label>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className="mt-1 w-full rounded border px-2 py-1 text-sm dark:bg-[#0b0e11]" />
        </div>
        <div>
          <label className="text-xs text-gray-500">Auto-reply message</label>
          <textarea value={autoReply} onChange={(e) => setAutoReply(e.target.value)} rows={2} className="mt-1 w-full rounded border px-2 py-1 text-sm dark:bg-[#0b0e11]" />
        </div>

        <div>
          <p className="mb-2 text-xs text-gray-500">Payment methods you accept (your saved methods)</p>
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
          <p className="mt-1 text-[10px] text-gray-400">Platform types: {platformPm.map((p) => p.code).filter(Boolean).join(', ')}</p>
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}

        <button
          type="button"
          disabled={mut.isPending || selectedPm.length === 0}
          onClick={() => {
            setErr(null);
            mut.mutate();
          }}
          className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {mut.isPending ? 'Publishing…' : 'Publish ad'}
        </button>
      </div>
    </div>
  );
}
