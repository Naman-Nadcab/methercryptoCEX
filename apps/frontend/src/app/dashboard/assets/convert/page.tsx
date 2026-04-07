'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowUpDown,
  ChevronDown,
  RefreshCw,
  History,
  Search,
  Check,
  Loader2,
  Wallet,
  Sparkles,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useConvertBalances, type ConvertBalanceRow } from '@/lib/balances';
import { CoinIcon } from '@/components/ui/CoinIcon';
import { WalletOperationsShell } from '@/components/wallet/WalletOperationsShell';
import { walletPath } from '@/lib/routes';

interface Currency {
  id: string;
  symbol: string;
  name: string;
  logo_url: string;
  decimals: number;
}

interface QuotePayload {
  toAmount: string;
  rate: string;
  expiresAtMs: number;
  fromCurrencyId: string;
  toCurrencyId: string;
}

interface ConversionHistoryRow {
  id: string;
  conversion_type: string;
  from_symbol: string;
  from_logo: string;
  from_amount: string;
  to_symbol: string;
  to_logo: string;
  to_amount: string;
  conversion_rate: string;
  status: string;
  created_at: string;
  completed_at: string;
  account_type: string;
}

type AccountType = 'funding' | 'spot' | 'trading';

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function apiFailureMessage(res: { error?: unknown }): string {
  const e = res.error;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return 'Request failed';
}

export default function ConvertPage() {
  const queryClient = useQueryClient();
  const { accessToken, _hasHydrated } = useAuthStore();

  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [fromCurrency, setFromCurrency] = useState<Currency | null>(null);
  const [toCurrency, setToCurrency] = useState<Currency | null>(null);
  const [fromAmount, setFromAmount] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('spot');

  const [showFromDropdown, setShowFromDropdown] = useState(false);
  const [showToDropdown, setShowToDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [quote, setQuote] = useState<QuotePayload | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const [converting, setConverting] = useState(false);
  const [formError, setFormError] = useState('');
  const [successPhase, setSuccessPhase] = useState<'idle' | 'animating' | 'done'>('idle');
  const [successSummary, setSuccessSummary] = useState<string | null>(null);

  const [dustConverting, setDustConverting] = useState(false);
  const [dustResult, setDustResult] = useState<{ assetsConverted: number; totalUsdt: string } | null>(null);

  const authReady = !!_hasHydrated && !!accessToken;

  const { data: balancesData = [] } = useConvertBalances(accountType, authReady);
  const balances: ConvertBalanceRow[] = balancesData;

  const { data: history = [], isLoading: historyLoading, refetch: refetchHistory } = useQuery({
    queryKey: ['convert', 'history'],
    queryFn: async () => {
      const res = await api.get<ConversionHistoryRow[]>('/api/v1/convert/history?limit=50', {
        notifyOnError: false,
      });
      if (res.success && Array.isArray(res.data)) return res.data;
      return [];
    },
    enabled: authReady,
    staleTime: 30_000,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api.get<Currency[]>('/api/v1/convert/currencies', { skipAuth: true });
      if (cancelled || !res.success || !Array.isArray(res.data)) return;
      setCurrencies(res.data);
      const btc = res.data.find((c) => c.symbol.toUpperCase() === 'BTC');
      const usdt = res.data.find((c) => c.symbol.toUpperCase() === 'USDT');
      setFromCurrency((prev) => prev ?? btc ?? null);
      setToCurrency((prev) => prev ?? usdt ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const quoteRemainingMs = quote ? quote.expiresAtMs - nowTick : 0;
  const quoteExpired = quote !== null && quoteRemainingMs <= 0;

  useEffect(() => {
    if (!quote || quoteExpired) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [quote, quoteExpired]);

  useEffect(() => {
    if (quoteExpired && quote) {
      setQuote(null);
      setFormError('Quote expired. Get a new quote to continue.');
    }
  }, [quoteExpired, quote]);

  const clearQuoteOnInputChange = useCallback(() => {
    setQuote(null);
    setFormError('');
    setSuccessPhase('idle');
    setSuccessSummary(null);
  }, []);

  const getAvailableBalance = useCallback((): string => {
    if (!fromCurrency) return '0';
    const row = balances.find((b) => b.currency_id === fromCurrency.id);
    return row?.available_balance ?? '0';
  }, [fromCurrency, balances]);

  const handleSetMax = () => {
    clearQuoteOnInputChange();
    const bal = getAvailableBalance();
    setFromAmount(bal);
  };

  const handleSwapDirection = () => {
    clearQuoteOnInputChange();
    const f = fromCurrency;
    const t = toCurrency;
    setFromCurrency(t);
    setToCurrency(f);
    setFromAmount('');
  };

  const filteredCurrencies = useMemo(
    () =>
      currencies.filter(
        (c) =>
          c.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.name.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [currencies, searchQuery]
  );

  const handleGetQuote = async () => {
    setFormError('');
    setSuccessPhase('idle');
    setSuccessSummary(null);

    if (!fromCurrency || !toCurrency) {
      setFormError('Select both assets.');
      return;
    }
    if (fromCurrency.id === toCurrency.id) {
      setFormError('Choose two different assets.');
      return;
    }
    const amt = parseFloat(fromAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setFormError('Enter a valid amount.');
      return;
    }

    const available = parseFloat(getAvailableBalance() || '0');
    if (amt > available) {
      setFormError('Amount exceeds available balance.');
      return;
    }

    setQuoteLoading(true);
    try {
      const q = new URLSearchParams({
        from: fromCurrency.symbol,
        to: toCurrency.symbol,
        amount: fromAmount,
        accountType,
      });
      const res = await api.get<{
        from?: { amount?: string; id?: string };
        to?: { amount?: string; id?: string };
        fromAmount?: string;
        toAmount?: string;
        rate?: string;
        expiresAt?: string;
        expiresIn?: number;
      }>(`/api/v1/convert/quote?${q.toString()}`, { skipAuth: true, notifyOnError: false });

      if (!res.success || !res.data) {
        setFormError(apiFailureMessage(res));
        setQuote(null);
        return;
      }

      const d = res.data;
      const toAmt = d.to?.amount ?? d.toAmount ?? '';
      const rateStr = d.rate ?? '';
      const fromId = d.from?.id ?? fromCurrency.id;
      const toId = d.to?.id ?? toCurrency.id;

      let expiresAtMs: number;
      if (d.expiresAt) {
        expiresAtMs = new Date(d.expiresAt).getTime();
      } else {
        const sec = typeof d.expiresIn === 'number' ? d.expiresIn : 30;
        expiresAtMs = Date.now() + sec * 1000;
      }

      if (!toAmt || !rateStr) {
        setFormError('Invalid quote response.');
        setQuote(null);
        return;
      }

      setQuote({
        toAmount: toAmt,
        rate: rateStr,
        expiresAtMs,
        fromCurrencyId: fromId,
        toCurrencyId: toId,
      });
      setNowTick(Date.now());
    } finally {
      setQuoteLoading(false);
    }
  };

  const handleConvert = async () => {
    setFormError('');
    if (!quote || quoteExpired) {
      setFormError('Get a valid quote first.');
      return;
    }
    if (!authReady) {
      setFormError('Please sign in to convert.');
      return;
    }

    const amt = parseFloat(fromAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setFormError('Enter a valid amount.');
      return;
    }

    setConverting(true);
    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await api.post<{
        from?: { currency?: string; amount?: string };
        to?: { currency?: string; amount?: string };
      }>(
        '/api/v1/convert/instant',
        {
          fromCurrencyId: quote.fromCurrencyId,
          toCurrencyId: quote.toCurrencyId,
          fromAmount,
          accountType,
        },
        {
          notifyOnError: false,
          headers: { 'Idempotency-Key': idempotencyKey },
        }
      );

      if (!res.success) {
        setFormError(apiFailureMessage(res));
        return;
      }

      const got = res.data?.to?.amount;
      const sym = res.data?.to?.currency ?? toCurrency?.symbol ?? '';
      setSuccessSummary(
        got != null
          ? `Received ${got} ${sym}`
          : 'Conversion completed.'
      );
      setSuccessPhase('animating');
      setQuote(null);
      setFromAmount('');
      queryClient.invalidateQueries({ queryKey: ['balances'] });
      refetchHistory();

      window.setTimeout(() => {
        setSuccessPhase('done');
      }, 1800);
    } finally {
      setConverting(false);
    }
  };

  const handleConvertDust = async () => {
    if (!authReady) {
      setFormError('Please sign in first.');
      return;
    }
    setDustConverting(true);
    setDustResult(null);
    setFormError('');
    try {
      const res = await api.post<{
        assetsConverted?: number;
        totalUsdt?: string;
        converted_count?: number;
        total_usdt?: string;
      }>('/api/v1/wallet/convert-dust', { threshold: 1 }, { notifyOnError: false });

      if (!res.success) {
        setFormError(apiFailureMessage(res));
        return;
      }
      const d = res.data;
      const count = d?.assetsConverted ?? d?.converted_count ?? 0;
      const total = d?.totalUsdt ?? d?.total_usdt ?? '0';
      setDustResult({ assetsConverted: count, totalUsdt: total });
      queryClient.invalidateQueries({ queryKey: ['balances'] });
      refetchHistory();
    } finally {
      setDustConverting(false);
    }
  };

  const dismissSuccess = () => {
    setSuccessPhase('idle');
    setSuccessSummary(null);
  };

  const rateDisplay =
    quote && fromCurrency && toCurrency
      ? `1 ${fromCurrency.symbol} ≈ ${parseFloat(quote.rate).toLocaleString(undefined, {
          maximumSignificantDigits: 8,
        })} ${toCurrency.symbol}`
      : null;

  const toDisplayEstimate = quote && !quoteExpired ? quote.toAmount : '—';

  return (
    <WalletOperationsShell
      title="Convert"
      description="Instant swap at live rates between assets in your selected account. No separate trading fees."
      headerRight={
        <button
          type="button"
          onClick={() => refetchHistory()}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/35 hover:bg-accent disabled:opacity-50"
          disabled={historyLoading}
        >
          <RefreshCw className={`h-4 w-4 shrink-0 ${historyLoading ? 'animate-spin' : ''}`} />
          Refresh history
        </button>
      }
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-10">
        <div className="space-y-4 lg:col-span-5 xl:col-span-4">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              <span>Convert balances under $1 to USDT</span>
            </div>
            <button
              type="button"
              onClick={handleConvertDust}
              disabled={dustConverting || !authReady}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {dustConverting ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Converting…
                </>
              ) : (
                'Convert Small Balances'
              )}
            </button>
          </div>
          {dustResult && (
            <div className="mt-2 rounded-md bg-muted px-3 py-2 text-sm text-foreground">
              Converted <span className="font-semibold">{dustResult.assetsConverted}</span> asset{dustResult.assetsConverted !== 1 ? 's' : ''} →{' '}
              <span className="font-semibold">{parseFloat(dustResult.totalUsdt).toFixed(4)} USDT</span> received
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Wallet className="h-4 w-4 shrink-0 text-primary" />
              <span>Account</span>
            </div>
            <select
              value={accountType}
              onChange={(e) => {
                setAccountType(e.target.value as AccountType);
                clearQuoteOnInputChange();
              }}
              className="rounded-lg border border-border bg-muted px-3 py-1.5 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="funding">Funding</option>
              <option value="spot">Spot</option>
              <option value="trading">Trading</option>
            </select>
          </div>

          {successPhase !== 'idle' && successSummary && (
            <div
              className={`mb-4 flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-muted py-8 transition-all duration-300 ${
                successPhase === 'animating' ? 'scale-100 opacity-100' : 'opacity-90'
              }`}
            >
              <div
                className={`flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform duration-500 ${
                  successPhase === 'animating' ? 'scale-100' : 'scale-95'
                }`}
              >
                <Check className="h-8 w-8" strokeWidth={2.5} />
              </div>
              <p className="text-center text-sm font-medium text-foreground">{successSummary}</p>
              {successPhase === 'done' && (
                <button
                  type="button"
                  onClick={dismissSuccess}
                  className="text-sm font-medium text-primary hover:text-primary/90"
                >
                  Swap again
                </button>
              )}
            </div>
          )}

          {successPhase === 'idle' && (
            <>
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>From</span>
                <span>
                  Available:{' '}
                  <span className="tabular-nums text-foreground">
                    {fromCurrency
                      ? (() => {
                          const n = parseFloat(getAvailableBalance());
                          return Number.isFinite(n) ? n.toFixed(Math.min(8, fromCurrency.decimals || 8)) : '0';
                        })()
                      : '—'}{' '}
                    {fromCurrency?.symbol ?? ''}
                  </span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted p-3">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setShowFromDropdown(!showFromDropdown);
                      setShowToDropdown(false);
                    }}
                    className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    {fromCurrency && <CoinIcon symbol={fromCurrency.symbol} size={22} />}
                    {fromCurrency?.symbol ?? 'Select'}
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </button>
                  {showFromDropdown && (
                    <div className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                      <div className="border-b border-border p-2">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <input
                            type="search"
                            placeholder="Search"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full rounded-md border border-border bg-muted py-2 pl-8 pr-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                        </div>
                      </div>
                      <div className="max-h-56 overflow-y-auto">
                        {filteredCurrencies.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setFromCurrency(c);
                              setShowFromDropdown(false);
                              setSearchQuery('');
                              clearQuoteOnInputChange();
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted"
                          >
                            <CoinIcon symbol={c.symbol} size={22} />
                            <div>
                              <div className="font-medium text-foreground">{c.symbol}</div>
                              <div className="text-xs text-muted-foreground">{c.name}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={fromAmount}
                  onChange={(e) => {
                    clearQuoteOnInputChange();
                    setFromAmount(e.target.value);
                  }}
                  placeholder="0"
                  className="min-w-0 flex-1 bg-transparent text-right text-lg font-semibold tabular-nums text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSetMax}
                  className="shrink-0 text-sm font-semibold text-primary hover:text-primary/90"
                >
                  MAX
                </button>
              </div>

              <div className="relative z-10 -my-2 flex justify-center">
                <button
                  type="button"
                  onClick={handleSwapDirection}
                  className="rounded-full border border-border bg-card p-2.5 text-primary shadow-sm hover:bg-muted"
                  aria-label="Swap direction"
                >
                  <ArrowUpDown className="h-5 w-5" />
                </button>
              </div>

              <div className="mb-1 mt-1 text-xs text-muted-foreground">To (estimated)</div>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted p-3">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setShowToDropdown(!showToDropdown);
                      setShowFromDropdown(false);
                    }}
                    className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    {toCurrency && <CoinIcon symbol={toCurrency.symbol} size={22} />}
                    {toCurrency?.symbol ?? 'Select'}
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </button>
                  {showToDropdown && (
                    <div className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                      <div className="border-b border-border p-2">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <input
                            type="search"
                            placeholder="Search"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full rounded-md border border-border bg-muted py-2 pl-8 pr-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                        </div>
                      </div>
                      <div className="max-h-56 overflow-y-auto">
                        {filteredCurrencies.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setToCurrency(c);
                              setShowToDropdown(false);
                              setSearchQuery('');
                              clearQuoteOnInputChange();
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted"
                          >
                            <CoinIcon symbol={c.symbol} size={22} />
                            <div>
                              <div className="font-medium text-foreground">{c.symbol}</div>
                              <div className="text-xs text-muted-foreground">{c.name}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1 text-right text-lg font-semibold tabular-nums text-foreground">
                  {quoteLoading ? (
                    <span className="inline-flex items-center justify-end gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      …
                    </span>
                  ) : (
                    toDisplayEstimate
                  )}
                </div>
              </div>

              {rateDisplay && !quoteExpired && quote && (
                <div className="mt-4 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between py-1">
                    <span>Rate</span>
                    <span className="text-foreground">{rateDisplay}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border/50 py-1">
                    <span>Estimated output</span>
                    <span className="tabular-nums text-foreground">
                      {parseFloat(quote.toAmount).toLocaleString(undefined, { maximumFractionDigits: 8 })} {toCurrency?.symbol}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border/50 py-1">
                    <span>Slippage</span>
                    <span className="text-foreground">
                      {(() => {
                        const from = parseFloat(fromAmount);
                        const rate = parseFloat(quote.rate);
                        const to = parseFloat(quote.toAmount);
                        if (!Number.isFinite(from) || !Number.isFinite(rate) || !Number.isFinite(to) || from * rate === 0) return '< 0.5%';
                        const expected = from * rate;
                        const impact = Math.abs((expected - to) / expected) * 100;
                        return impact < 0.5 ? '< 0.5%' : `~${impact.toFixed(2)}%`;
                      })()}
                    </span>
                  </div>
                  <div className="mt-1 text-center tabular-nums">
                    Expires in {formatCountdown(quoteRemainingMs)}
                  </div>
                </div>
              )}

              {formError && (
                <p className="mt-3 text-center text-sm text-sell" role="alert">
                  {formError}
                </p>
              )}

              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleGetQuote}
                  disabled={quoteLoading || !fromCurrency || !toCurrency || !fromAmount}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted py-3 text-sm font-semibold text-foreground hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {quoteLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Getting quote…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4" />
                      Get quote
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleConvert}
                  disabled={
                    converting || !quote || quoteExpired || !fromAmount || !authReady
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {converting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Converting…
                    </>
                  ) : (
                    'Convert'
                  )}
                </button>
              </div>

              <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 border-t border-border pt-4 text-center text-xs">
                <Link href={walletPath.depositCrypto} className="font-medium text-primary hover:text-primary/90">
                  Deposit
                </Link>
                <Link href={walletPath.transfer} className="font-medium text-primary hover:text-primary/90">
                  Transfer
                </Link>
              </div>
            </>
          )}
        </div>
        </div>

        <div className="min-w-0 lg:col-span-7 xl:col-span-8">
        <div className="mb-4 flex items-center gap-2">
          <History className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Conversion history</h2>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
          {historyLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
              <History className="h-10 w-10 opacity-40" />
              <p className="text-sm">No conversions yet</p>
            </div>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">From</th>
                  <th className="px-4 py-3">To</th>
                  <th className="px-4 py-3">Rate</th>
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3 capitalize text-foreground">{row.conversion_type}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 tabular-nums text-foreground">
                        {row.from_logo && (
                          <Image src={row.from_logo} alt="" width={20} height={20} className="rounded-full" unoptimized />
                        )}
                        {parseFloat(row.from_amount).toLocaleString(undefined, { maximumFractionDigits: 8 })}{' '}
                        {row.from_symbol}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 tabular-nums text-foreground">
                        {row.to_logo && (
                          <Image src={row.to_logo} alt="" width={20} height={20} className="rounded-full" unoptimized />
                        )}
                        {parseFloat(row.to_amount || '0').toLocaleString(undefined, { maximumFractionDigits: 8 })}{' '}
                        {row.to_symbol}
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {parseFloat(row.conversion_rate).toLocaleString(undefined, { maximumSignificantDigits: 8 })}
                    </td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">{row.account_type}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          row.status === 'completed'
                            ? 'text-buy'
                            : row.status === 'pending'
                              ? 'text-primary'
                              : 'text-sell'
                        }
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </div>
      </div>
    </WalletOperationsShell>
  );
}
