'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw,
  Shield,
  ChevronDown,
  ChevronRight,
  FileCheck,
  Smartphone,
  ShoppingCart,
  CheckCircle2,
  FileText,
  CircleDot,
  Filter,
  X,
  Loader2,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { useBalancesByAccount } from '@/lib/balances';
import { useReferencePrice } from '@/hooks/useReferencePrice';
import {
  fetchP2PAds,
  fetchMyPaymentMethods,
  createOrder,
  createAd,
  P2P_ADS_QUERY_KEY,
  P2P_ORDER_QUERY_KEY,
  P2P_PAYMENT_METHODS_QUERY_KEY,
  type P2PAdRow,
} from '@/lib/p2pApi';

const CRYPTO_OPTIONS = ['USDT', 'BTC', 'ETH', 'USDC'];
const CRYPTO_OPTIONS_EXTRA = ['MNT', 'SOL', 'BNB', 'SUI', 'XRP'];
const FIAT_OPTIONS = ['USD', 'INR', 'EUR', 'GBP'];
const FIAT_SYMBOLS: Record<string, string> = { USD: '$', INR: '₹', EUR: '€', GBP: '£' };
const PER_PAGE_OPTIONS = [10, 20, 50];

const PAYMENT_TABS = [
  { id: 'local', label: 'Local Banks' },
  { id: 'upi', label: 'UPI' },
  { id: 'other', label: 'Other' },
];

const PAYMENT_BUTTONS_LOCAL = ['Bank Transfer', 'IMPS Bank Transfer', 'PayPal', 'PayTM', 'UPI'];

const FAQ_TABS = [
  { id: 'p2p', label: 'P2P Trading' },
  { id: 'merchants', label: 'Merchants' },
  { id: 'security', label: 'Security' },
];

const FAQ_ITEMS: Record<string, { q: string; a: string }[]> = {
  p2p: [
    { q: 'What is P2P trading?', a: 'P2P (peer-to-peer) trading lets you buy and sell crypto directly with other users using your preferred fiat currency and payment method.' },
    { q: 'How do I participate in P2P trading?', a: 'Complete identity verification, add a payment method, then choose an ad and place your order. Follow the instructions to complete the trade.' },
    { q: 'Are there any fees for P2P trading?', a: 'Methereum P2P has zero trading fees. You only pay the price set by the advertiser.' },
    { q: 'How long does P2P trading take?', a: 'Most orders complete within 15–30 minutes once payment is confirmed.' },
    { q: 'Why is my order still pending?', a: 'The seller may be waiting for your payment, or you need to confirm payment in the order chat.' },
    { q: 'What is an escrow service?', a: 'We hold the crypto in escrow until you confirm payment. The seller then releases it to you.' },
    { q: 'How to appeal an order?', a: 'If you have a dispute, open a ticket from the order page. Our support team will review and resolve it.' },
  ],
  merchants: [
    { q: 'Who can become a merchant?', a: 'Users who complete advanced verification and meet trading volume requirements can apply.' },
    { q: 'What are verified merchants?', a: 'Verified merchants have a badge and meet our compliance and performance standards.' },
  ],
  security: [
    { q: 'Is P2P trading safe?', a: 'Yes. We use escrow to protect both parties. Never release payment outside the platform.' },
    { q: 'How do I avoid scams?', a: 'Trade only within the platform, complete all steps in the order flow, and never pay to external links.' },
  ],
};

const HELP_ITEMS = [
  { title: 'What is P2P', body: 'Trade crypto directly with other users. No middleman — agree on price and payment.' },
  { title: 'How ads work', body: 'Create a buy or sell ad, set your price and limits, and start receiving orders.' },
  { title: 'How payments work', body: 'Crypto is held in escrow until you confirm payment. Complete all steps in the order flow.' },
  { title: 'Dispute protection', body: 'Use only platform escrow, complete steps in-app, and never pay outside the order. Open a ticket from the order page for disputes.' },
];

// UI row shape for table (mapped from API)
interface AdRow {
  id: string;
  advertiser: string;
  initial: string;
  completion: string;
  trades: string;
  verified: boolean;
  price: string;
  limitMin: number;
  limitMax: number;
  limitFiat: string;
  available: string;
  paymentMethods: string;
  orderCount?: number;
  completionRateNum?: number;
  paymentTimeMins?: number;
  eligible?: boolean;
  accepted_platform_method_ids?: string[];
}

function mapApiAdToRow(ad: P2PAdRow): AdRow {
  const completionNum = ad.merchant_completion_rate != null ? parseFloat(String(ad.merchant_completion_rate)) : 0;
  const paymentMethods = Array.isArray(ad.accepted_payment_methods)
    ? (ad.accepted_payment_methods as string[]).join(', ')
    : typeof ad.accepted_payment_methods === 'string' ? ad.accepted_payment_methods : '';
  return {
    id: ad.id,
    advertiser: ad.username ?? '—',
    initial: (ad.username ?? '?').charAt(0).toUpperCase(),
    completion: `${completionNum.toFixed(2)}%`,
    trades: `${ad.merchant_total_orders ?? ad.total_orders ?? 0}+`,
    verified: true,
    price: ad.current_price ?? '0',
    limitMin: parseFloat(ad.min_amount) || 0,
    limitMax: parseFloat(ad.max_amount) || 0,
    limitFiat: ad.fiat_currency ?? 'USD',
    available: `${ad.available_amount ?? '0'} ${ad.crypto_symbol ?? ''}`.trim(),
    paymentMethods: paymentMethods || '—',
    orderCount: ad.merchant_total_orders ?? ad.completed_orders ?? 0,
    completionRateNum: completionNum,
    paymentTimeMins: ad.payment_time_limit ?? 30,
    eligible: true,
    accepted_platform_method_ids: ad.accepted_platform_method_ids,
  };
}

const SORT_OPTIONS = [
  { id: 'overall', label: 'Overall sorting' },
  { id: 'orders', label: 'Completed order number' },
  { id: 'completion', label: 'Completion Rate' },
  { id: 'price_high', label: 'Price (highest to lowest)' },
] as const;

const PAYMENT_TIME_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: '15', label: '15' },
  { id: '30', label: '30' },
] as const;

type SortId = (typeof SORT_OPTIONS)[number]['id'];
type PaymentTimeId = (typeof PAYMENT_TIME_OPTIONS)[number]['id'];

interface FilterState {
  verifiedOnly: boolean;
  blockAdvertisersOnly: boolean;
  eligibleAdsOnly: boolean;
  noVerificationRequired: boolean;
  sortBy: SortId;
  paymentTimeLimit: PaymentTimeId;
}

const DEFAULT_FILTERS: FilterState = {
  verifiedOnly: false,
  blockAdvertisersOnly: false,
  eligibleAdsOnly: true,
  noVerificationRequired: false,
  sortBy: 'overall',
  paymentTimeLimit: 'all',
};

function P2PContent() {
  const router = useRouter();
  const params = useParams();
  const queryClient = useQueryClient();
  const { accessToken, _hasHydrated } = useAuthStore();
  const { data: balancesData } = useBalancesByAccount(!!_hasHydrated && !!accessToken);
  const balances: { symbol: string; funding: string; trading: string }[] = balancesData ?? [];

  const type = (params?.type as string) || 'buy';
  const crypto = (params?.crypto as string) || 'USDT';
  const fiat = (params?.fiat as string) || 'INR';

  const [amount, setAmount] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(10);
  const [paymentTab, setPaymentTab] = useState('local');
  const [faqTab, setFaqTab] = useState('p2p');
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [learnOpen, setLearnOpen] = useState<number | null>(null);

  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<FilterState>(DEFAULT_FILTERS);
  const [filterApplied, setFilterApplied] = useState<FilterState>(DEFAULT_FILTERS);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);

  const [modalMode, setModalMode] = useState<'closed' | 'order' | 'ad'>('closed');
  const [selectedAd, setSelectedAd] = useState<AdRow | null>(null);
  const [createQuantity, setCreateQuantity] = useState('');
  const [createPaymentMethodId, setCreatePaymentMethodId] = useState('');
  const [createOrderLoading, setCreateOrderLoading] = useState(false);
  const [createOrderError, setCreateOrderError] = useState<string | null>(null);
  const createOrderIdempotencyKeyRef = useRef<string | null>(null);

  const [adPrice, setAdPrice] = useState('');
  const [adQuantity, setAdQuantity] = useState('');
  const [adPaymentMethodIds, setAdPaymentMethodIds] = useState<string[]>([]);
  const [adPaymentTimeLimit, setAdPaymentTimeLimit] = useState(15);
  const [createAdLoading, setCreateAdLoading] = useState(false);
  const [createAdError, setCreateAdError] = useState<string | null>(null);

  const typeSafe = type === 'sell' ? 'sell' : 'buy';
  const allCrypto = [...CRYPTO_OPTIONS, ...CRYPTO_OPTIONS_EXTRA];
  const cryptoSafe = allCrypto.includes(crypto) ? crypto : 'USDT';
  const fiatSafe = FIAT_OPTIONS.includes(fiat) ? fiat : 'INR';

  const refPrice = useReferencePrice(`${cryptoSafe}_${fiatSafe}`, fiatSafe.toLowerCase());

  const { data: apiAds = [], isLoading: adsLoading } = useQuery({
    queryKey: [...P2P_ADS_QUERY_KEY, typeSafe, cryptoSafe, fiatSafe, page, perPage],
    queryFn: () => fetchP2PAds({ type: typeSafe === 'buy' ? 'sell' : 'buy', currency: cryptoSafe, fiat: fiatSafe, limit: perPage, offset: page * perPage }),
  });

  const { data: paymentMethods = [], isError: paymentMethodsError, error: paymentMethodsErr } = useQuery({
    queryKey: P2P_PAYMENT_METHODS_QUERY_KEY,
    queryFn: () => fetchMyPaymentMethods(),
    enabled: !!_hasHydrated && !!accessToken && (!!selectedAd || modalMode === 'order'),
  });

  const { data: myMethodsForAd = [] } = useQuery({
    queryKey: P2P_PAYMENT_METHODS_QUERY_KEY,
    queryFn: () => fetchMyPaymentMethods(),
    enabled: !!_hasHydrated && !!accessToken && modalMode === 'ad',
  });

  const handleFiatChange = (newFiat: string) => {
    router.push(`/dashboard/p2p/${typeSafe}/${cryptoSafe}/${newFiat}`);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        filterOpen &&
        filterPanelRef.current &&
        filterButtonRef.current &&
        !filterPanelRef.current.contains(e.target as Node) &&
        !filterButtonRef.current.contains(e.target as Node)
      ) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [filterOpen]);

  const orderModalPaymentMethods = useMemo(() => {
    if (!selectedAd || paymentMethods.length === 0) return [];
    const acceptedIds = selectedAd.accepted_platform_method_ids;
    if (!acceptedIds || acceptedIds.length === 0) return paymentMethods;
    return paymentMethods.filter((pm) => pm.payment_method_id && acceptedIds.includes(pm.payment_method_id));
  }, [selectedAd, paymentMethods]);

  useEffect(() => {
    if (selectedAd && orderModalPaymentMethods.length > 0 && !createPaymentMethodId) {
      setCreatePaymentMethodId(orderModalPaymentMethods[0].id);
    } else if (selectedAd && orderModalPaymentMethods.length === 0 && createPaymentMethodId) {
      setCreatePaymentMethodId('');
    }
  }, [selectedAd, orderModalPaymentMethods, createPaymentMethodId]);

  useEffect(() => {
    if (!selectedAd) createOrderIdempotencyKeyRef.current = null;
  }, [selectedAd]);

  const closeP2PModal = () => {
    if (createOrderLoading || createAdLoading) return;
    setModalMode('closed');
    setSelectedAd(null);
    setCreateOrderError(null);
    setCreateAdError(null);
    setAdPrice('');
    setAdQuantity('');
    setAdPaymentMethodIds([]);
    setAdPaymentTimeLimit(15);
  };

  const openAdModal = () => {
    setCreateAdError(null);
    setAdPrice('');
    setAdQuantity('');
    setAdPaymentMethodIds([]);
    setAdPaymentTimeLimit(15);
    setSelectedAd(null);
    setModalMode('ad');
  };

  const handleCreateAd = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateAdError(null);
    const p = parseFloat(adPrice);
    const q = parseFloat(adQuantity);
    if (Number.isNaN(p) || p <= 0) {
      setCreateAdError('Please enter a valid positive price.');
      return;
    }
    if (Number.isNaN(q) || q <= 0) {
      setCreateAdError('Please enter a valid positive quantity.');
      return;
    }
    if (adPaymentMethodIds.length === 0) {
      setCreateAdError('Select at least one payment method.');
      return;
    }
    const qtyStr = adQuantity.trim();
    setCreateAdLoading(true);
    try {
      const res = await createAd({
        type: typeSafe as 'buy' | 'sell',
        currency: cryptoSafe,
        fiat: fiatSafe,
        price: adPrice.trim(),
        min_amount: qtyStr,
        max_amount: qtyStr,
        available_amount: qtyStr,
        payment_method_ids: adPaymentMethodIds,
        payment_time_limit: adPaymentTimeLimit,
      });
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: P2P_ADS_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: ['p2p', 'my-ads'] });
        closeP2PModal();
        return;
      }
      setCreateAdError(res.error?.message ?? 'Failed to create ad.');
    } catch {
      setCreateAdError('Network error. Please try again.');
    } finally {
      setCreateAdLoading(false);
    }
  };

  const toggleAdPaymentMethod = (id: string) => {
    setAdPaymentMethodIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };
  const adPaymentMethodsSource = myMethodsForAd;

  const handleFilterConfirm = () => {
    setFilterApplied({ ...filterDraft });
    setFilterOpen(false);
  };

  const handleFilterReset = () => {
    setFilterDraft({ ...DEFAULT_FILTERS });
    setFilterApplied({ ...DEFAULT_FILTERS });
    setFilterOpen(false);
  };

  const filterCount = useMemo(() => {
    let n = 0;
    if (filterApplied.verifiedOnly) n++;
    if (filterApplied.blockAdvertisersOnly) n++;
    if (filterApplied.eligibleAdsOnly) n++;
    if (filterApplied.noVerificationRequired) n++;
    if (filterApplied.sortBy !== 'overall') n++;
    if (filterApplied.paymentTimeLimit !== 'all') n++;
    return n;
  }, [filterApplied]);

  const ads: AdRow[] = useMemo(() => {
    let list = apiAds.map(mapApiAdToRow);
    const f = filterApplied;

    if (f.verifiedOnly) list = list.filter((ad) => ad.verified);
    if (f.eligibleAdsOnly) list = list.filter((ad) => ad.eligible !== false);
    if (f.noVerificationRequired) list = list.filter((ad) => !ad.verified);
    if (f.blockAdvertisersOnly) list = list.filter(() => false);

    const timeLimit = f.paymentTimeLimit === 'all' ? null : Number(f.paymentTimeLimit);
    if (timeLimit != null) list = list.filter((ad) => (ad.paymentTimeMins ?? 30) <= timeLimit);

    switch (f.sortBy) {
      case 'orders':
        list.sort((a, b) => (b.orderCount ?? 0) - (a.orderCount ?? 0));
        break;
      case 'completion':
        list.sort((a, b) => (b.completionRateNum ?? 0) - (a.completionRateNum ?? 0));
        break;
      case 'price_high':
        list.sort((a, b) => Number(b.price) - Number(a.price));
        break;
      default:
        break;
    }
    return list;
  }, [apiAds, filterApplied]);

  const handleCreateOrder = async () => {
    if (!selectedAd || !createQuantity.trim() || !createPaymentMethodId || createOrderLoading) return;
    const qty = createQuantity.trim();
    if (parseFloat(qty) <= 0 || parseFloat(qty) < selectedAd.limitMin || parseFloat(qty) > selectedAd.limitMax) return;
    setCreateOrderError(null);
    if (createOrderIdempotencyKeyRef.current === null) {
      createOrderIdempotencyKeyRef.current = globalThis.crypto.randomUUID();
    }
    const idempotencyKey = createOrderIdempotencyKeyRef.current;
    setCreateOrderLoading(true);
    try {
      const res = await createOrder({
        adId: selectedAd.id,
        quantity: qty,
        paymentMethodId: createPaymentMethodId,
        idempotencyKey,
      });
      if (res.success && res.data?.id) {
        createOrderIdempotencyKeyRef.current = null;
        queryClient.invalidateQueries({ queryKey: ['balances'] });
        queryClient.invalidateQueries({ queryKey: P2P_ORDER_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: P2P_ADS_QUERY_KEY });
        setCreateOrderError(null);
        setCreateQuantity('');
        setCreatePaymentMethodId('');
        setModalMode('closed');
        setSelectedAd(null);
        router.push(`/dashboard/p2p/orders/${res.data.id}`);
      } else {
        const terminalCodes = ['ORDER_FAILED', 'VALIDATION_ERROR', 'RISK_BLOCKED', 'NOT_FOUND', 'TRADING_HALTED', 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY'];
        if (res.error?.code && terminalCodes.includes(res.error.code)) {
          createOrderIdempotencyKeyRef.current = null;
        }
        setCreateOrderError(res.error?.message ?? 'Could not create order. Please try again.');
      }
    } catch (e) {
      setCreateOrderError('Connection issue. Safe to try again—your funds have not been locked.');
    } finally {
      setCreateOrderLoading(false);
    }
  };

  const availableBalanceForCrypto = useMemo(() => {
    const row = balances.find((b) => b.symbol === cryptoSafe);
    if (!row) return null;
    const funding = parseFloat(row.funding) || 0;
    const trading = parseFloat(row.trading) || 0;
    return typeSafe === 'sell' ? funding.toFixed(8) : (funding + trading).toFixed(8);
  }, [balances, cryptoSafe, typeSafe]);

  const modalOpen = modalMode !== 'closed';
  const isOrderMode = modalMode === 'order' && selectedAd;

  return (
    <div className="min-h-screen min-w-0 bg-gray-50 dark:bg-[#0b0e11]">
      {/* Unified P2P modal: Create Order | Create Ad */}
      {modalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 dark:bg-black/60 backdrop-blur-sm" onClick={closeP2PModal}>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#181a20] w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {isOrderMode ? (
              <>
                <div className="sticky top-0 bg-white dark:bg-[#181a20] border-b border-gray-200 dark:border-gray-800 p-6 pb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white tracking-tight">{typeSafe === 'buy' ? `Buy ${cryptoSafe}` : `Sell ${cryptoSafe}`}</h2>
                  <button type="button" onClick={closeP2PModal} className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30" aria-label="Close">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-6 pt-4">
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Advertiser: {selectedAd.advertiser} · Limit {selectedAd.limitMin}–{selectedAd.limitMax} {selectedAd.limitFiat}</p>
                  {availableBalanceForCrypto != null && (
                    <p className="text-xs text-gray-500 dark:text-gray-500 mb-2 tabular-nums">Your available balance: {availableBalanceForCrypto} {cryptoSafe}</p>
                  )}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Quantity</label>
                      <input
                        type="text"
                        value={createQuantity}
                        onChange={(e) => setCreateQuantity(e.target.value)}
                        placeholder={`Min ${selectedAd.limitMin} - Max ${selectedAd.limitMax}`}
                        className="w-full min-h-[42px] rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0b0e11] px-3 py-2.5 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all duration-200"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Payment method</label>
                      <select
                        value={createPaymentMethodId}
                        onChange={(e) => setCreatePaymentMethodId(e.target.value)}
                        disabled={orderModalPaymentMethods.length === 0}
                        className="w-full min-h-[42px] rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0b0e11] px-3 py-2.5 pr-10 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="">Select payment method</option>
                        {orderModalPaymentMethods.map((pm) => (
                          <option key={pm.id} value={pm.id}>{pm.method_name ?? pm.method_code ?? pm.id}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {createOrderError && (
                    <p className="mt-2 text-sm text-red-400">{createOrderError}</p>
                  )}
                  {paymentMethodsError && (
                    <p className="mt-1 text-sm text-red-400">{paymentMethodsErr instanceof Error ? paymentMethodsErr.message : 'Failed to load payment methods'}</p>
                  )}
                  {!paymentMethodsError && orderModalPaymentMethods.length === 0 && (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-amber-600 dark:text-amber-400">No payment methods configured</p>
                      <Link
                        href="/dashboard/p2p/payment-methods"
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-blue-500 hover:bg-blue-600 text-white"
                      >
                        Add Payment Method
                      </Link>
                    </div>
                  )}
                  {!createOrderLoading && !paymentMethodsError && orderModalPaymentMethods.length > 0 && (!createQuantity.trim() || !createPaymentMethodId) && (
                    <p className="mt-1 text-xs text-gray-500">Enter quantity and select a payment method to continue.</p>
                  )}
                  <div className="mt-5 flex gap-3">
                    <button
                      type="button"
                      disabled={createOrderLoading || !createQuantity.trim() || !createPaymentMethodId || orderModalPaymentMethods.length === 0}
                      aria-busy={createOrderLoading}
                      onClick={handleCreateOrder}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium bg-blue-500 hover:bg-blue-600 active:scale-[0.98] text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-100"
                    >
                      {createOrderLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                      {createOrderLoading ? 'Creating order…' : 'Create order'}
                    </button>
                    <button
                      type="button"
                      onClick={closeP2PModal}
                      className="px-4 py-2.5 rounded-lg font-medium bg-gray-100 dark:bg-[#0b0e11] text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-[#1e2026] hover:border-gray-400 dark:hover:border-gray-600 text-sm disabled:opacity-50 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="sticky top-0 bg-white dark:bg-[#181a20] border-b border-gray-200 dark:border-gray-800 p-6 pb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white tracking-tight">Create {typeSafe === 'buy' ? 'Buy' : 'Sell'} Ad — {cryptoSafe} / {fiatSafe}</h2>
                  <button type="button" onClick={closeP2PModal} className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30" aria-label="Close">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <form onSubmit={handleCreateAd} className="p-6 pt-4 space-y-4">
                  <p className="text-xs text-gray-500 dark:text-gray-500">No funds are locked at ad creation. Funds move to escrow when a buyer creates an order.</p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Price ({fiatSafe} per {cryptoSafe})</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={adPrice}
                      onChange={(e) => setAdPrice(e.target.value)}
                      placeholder="e.g. 90.5"
                      className="w-full min-h-[42px] rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0b0e11] px-3 py-2.5 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all duration-200"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-1 tabular-nums">
                      Market price: {refPrice.price != null ? `${fiatSafe} ${refPrice.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}` : '—'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quantity ({cryptoSafe})</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={adQuantity}
                      onChange={(e) => setAdQuantity(e.target.value)}
                      placeholder="Amount to sell or buy"
                      className="w-full min-h-[42px] rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0b0e11] px-3 py-2.5 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all duration-200"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">Min, max and available are set to this quantity.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment time limit (min)</label>
                    <select
                      value={adPaymentTimeLimit}
                      onChange={(e) => setAdPaymentTimeLimit(Number(e.target.value))}
                      className="w-full min-h-[42px] rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0b0e11] px-3 py-2.5 pr-10 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all duration-200"
                    >
                      <option value={15}>15</option>
                      <option value={30}>30</option>
                      <option value={45}>45</option>
                      <option value={60}>60</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Payment methods (select at least one)</label>
                    <div className="flex flex-wrap gap-2">
                      {adPaymentMethodsSource.map((pm) => (
                        <button
                          key={pm.id}
                          type="button"
                          onClick={() => toggleAdPaymentMethod(pm.id)}
                          className={`px-3 py-2 min-h-[38px] rounded-lg text-sm font-medium border transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
                            adPaymentMethodIds.includes(pm.id)
                              ? 'bg-blue-500/20 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/50 dark:border-blue-500/50'
                              : 'bg-gray-100 dark:bg-[#0b0e11] text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600'
                          }`}
                        >
                          {pm.method_name ?? pm.method_code ?? pm.display_name ?? pm.id.slice(0, 8)}
                        </button>
                      ))}
                    </div>
                    {adPaymentMethodsSource.length === 0 && modalMode === 'ad' && (
                      <div className="mt-2 space-y-2">
                        <p className="text-xs text-amber-600 dark:text-amber-400">No payment methods configured</p>
                        <Link
                          href="/dashboard/p2p/payment-methods"
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-blue-500 hover:bg-blue-600 text-white"
                        >
                          Add Payment Method
                        </Link>
                      </div>
                    )}
                  </div>
                  {createAdError && <p className="text-sm text-red-400">{createAdError}</p>}
                  <div className="flex gap-3 pt-2">
                    <button
                      type="submit"
                      disabled={createAdLoading || adPaymentMethodsSource.length === 0}
                      className="flex-1 px-4 py-2.5 rounded-lg font-medium bg-blue-500 hover:bg-blue-600 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
                    >
                      {createAdLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                      {createAdLoading ? 'Creating…' : 'Create Ad'}
                    </button>
                    <button type="button" onClick={closeP2PModal} className="px-4 py-2.5 rounded-lg font-medium bg-gray-100 dark:bg-[#0b0e11] text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-[#1e2026] text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30">
                      Cancel
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      <main className="bg-gray-50 dark:bg-[#0b0e11]">
        {/* P2P Trading — one row Buy/Sell + Crypto, next row filters */}
        <section className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#0b0e11]">
          <div className="py-6 md:py-8">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">P2P Trading</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">Buy & Sell Crypto with your preferred fiat currency.</p>

            {/* Card container */}
            <div className="mt-5 md:mt-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#181a20] p-4 md:p-5 shadow-sm dark:shadow-none">
              {/* Row 1: Buy/Sell toggle (left) + Crypto list (right) — same row */}
              <div className="flex flex-wrap items-center gap-4">
                {/* Buy / Sell segmented control */}
                <div className="flex rounded-lg overflow-hidden bg-gray-100 dark:bg-[#0b0e11] p-0.5 border border-gray-300 dark:border-gray-700">
                  <Link
                    href={`/dashboard/p2p/buy/${cryptoSafe}/${fiatSafe}`}
                    className={`px-5 py-2.5 text-sm font-semibold transition-all duration-200 rounded-md ${
                      typeSafe === 'buy' ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    Buy
                  </Link>
                  <Link
                    href={`/dashboard/p2p/sell/${cryptoSafe}/${fiatSafe}`}
                    className={`px-5 py-2.5 text-sm font-semibold transition-all duration-200 rounded-md ${
                      typeSafe === 'sell' ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    Sell
                  </Link>
                </div>
                {_hasHydrated && accessToken && (
                  <button
                    type="button"
                    onClick={openAdModal}
                    className="inline-flex items-center px-4 py-2.5 min-h-[42px] text-sm font-medium rounded-lg bg-gray-100 dark:bg-[#0b0e11] text-blue-600 dark:text-blue-400 hover:text-white border border-gray-300 dark:border-gray-700 hover:border-blue-500 hover:bg-blue-500 dark:hover:bg-blue-500 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  >
                    Create Ad
                  </button>
                )}

                {/* Crypto selection bar — same row, inline list + "Supports 300+ Cryptos >" */}
                <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
                  {CRYPTO_OPTIONS.map((symbol) => (
                    <Link
                      key={symbol}
                      href={`/dashboard/p2p/${typeSafe}/${symbol}/${fiatSafe}`}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                        cryptoSafe === symbol ? 'text-blue-600 dark:text-blue-400 bg-blue-500/15 dark:bg-blue-500/20' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5'
                      }`}
                    >
                      {symbol}
                    </Link>
                  ))}
                  <span className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-0.5 flex-shrink-0" aria-hidden />
                  {CRYPTO_OPTIONS_EXTRA.map((symbol) => (
                    <Link
                      key={symbol}
                      href={`/dashboard/p2p/${typeSafe}/${symbol}/${fiatSafe}`}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                        cryptoSafe === symbol ? 'text-blue-600 dark:text-blue-400 bg-blue-500/15 dark:bg-blue-500/20' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5'
                      }`}
                    >
                      {symbol}
                    </Link>
                  ))}
                  <Link
                    href={`/dashboard/p2p/${typeSafe}/${cryptoSafe}/${fiatSafe}`}
                    className="ml-2 text-sm text-gray-500 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors whitespace-nowrap"
                  >
                    Supports 300+ Cryptos &gt;
                  </Link>
                </div>
              </div>

              {/* Row 2: Enter Amount (input + fiat dropdown in one) | All Payment Methods | Refresh settings | Filter (icon + badge) */}
              <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                {/* Enter Amount — input with fiat dropdown attached on the right (single component) */}
                <div className="flex rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0b0e11] overflow-hidden min-w-[200px] flex-1 max-w-xs min-h-[42px] focus-within:ring-2 focus-within:ring-blue-500/30 focus-within:border-blue-500 transition-all duration-200">
                  <input
                    type="text"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="Enter Amount"
                    className="flex-1 bg-transparent text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 px-3 py-2.5 text-sm focus:outline-none min-w-0"
                  />
                  <div className="relative flex border-l border-gray-300 dark:border-gray-700 items-stretch">
                    <select
                      value={fiatSafe}
                      onChange={(e) => handleFiatChange(e.target.value)}
                      className="bg-transparent text-gray-700 dark:text-gray-400 pl-3 pr-9 py-2.5 text-sm focus:outline-none cursor-pointer appearance-none border-0 min-h-full"
                    >
                      {FIAT_OPTIONS.map((o) => (
                        <option key={o} value={o}>{FIAT_SYMBOLS[o] || o} {o}</option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-gray-500 dark:text-gray-500 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" />
                  </div>
                </div>
                <div className="relative flex items-center">
                  <select
                    value={paymentFilter}
                    onChange={(e) => setPaymentFilter(e.target.value)}
                    className="rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0b0e11] text-gray-700 dark:text-gray-400 pl-3 pr-9 py-2.5 text-sm min-w-[160px] min-h-[42px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all duration-200 appearance-none"
                  >
                    <option value="">All Payment Methods</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-gray-500 dark:text-gray-500 absolute right-2.5 pointer-events-none top-1/2 -translate-y-1/2" />
                </div>
                <div className="relative flex items-center">
                  <select
                    className="rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#0b0e11] text-gray-500 dark:text-gray-400 pl-3 pr-9 py-2.5 text-sm min-w-[140px] min-h-[42px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all duration-200 appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
                    value=""
                    onChange={() => {}}
                  >
                    <option value="">Refresh settings</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-gray-500 dark:text-gray-500 absolute right-2.5 pointer-events-none top-1/2 -translate-y-1/2" />
                </div>
                {/* Filter — text + funnel icon + badge; opens panel */}
                <div className="relative">
                  <button
                    ref={filterButtonRef}
                    type="button"
                    onClick={() => setFilterOpen((o) => !o)}
                    className={`flex items-center gap-2 min-h-[42px] px-3 py-2 rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
                      filterCount > 0 ? 'bg-blue-500/10 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/15 dark:hover:bg-blue-500/15' : 'text-blue-600 dark:text-blue-400 hover:bg-gray-100 dark:hover:bg-white/5'
                    }`}
                  >
                    <span className="text-sm font-medium">Filter</span>
                    <span className="relative inline-flex">
                      <Filter className="w-4 h-4 rotate-180" />
                      {filterCount > 0 && (
                        <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] rounded-full bg-blue-500 text-white text-xs font-medium flex items-center justify-center px-1">
                          {filterCount}
                        </span>
                      )}
                    </span>
                  </button>

                  {/* Filter panel — floating to the right of button */}
                  {filterOpen && (
                    <div
                      ref={filterPanelRef}
                      className="absolute right-0 top-full mt-2 z-50 w-[320px] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e2026] shadow-xl dark:shadow-2xl p-4"
                    >
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Ad Types</p>
                      <div className="space-y-3 mb-4">
                        <label className="flex items-center gap-3 cursor-pointer text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors">
                          <input
                            type="checkbox"
                            checked={filterDraft.verifiedOnly}
                            onChange={(e) => setFilterDraft((d) => ({ ...d, verifiedOnly: e.target.checked }))}
                            className="rounded border-gray-400 dark:border-gray-600 bg-white dark:bg-[#181a20] text-blue-500 focus:ring-2 focus:ring-blue-500/30"
                          />
                          Show only Verified Advertisers
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors">
                          <input
                            type="checkbox"
                            checked={filterDraft.blockAdvertisersOnly}
                            onChange={(e) => setFilterDraft((d) => ({ ...d, blockAdvertisersOnly: e.target.checked }))}
                            className="rounded border-gray-400 dark:border-gray-600 bg-white dark:bg-[#181a20] text-blue-500 focus:ring-2 focus:ring-blue-500/30"
                          />
                          Show only Block Advertisers
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors">
                          <input
                            type="checkbox"
                            checked={filterDraft.eligibleAdsOnly}
                            onChange={(e) => setFilterDraft((d) => ({ ...d, eligibleAdsOnly: e.target.checked }))}
                            className="rounded border-gray-400 dark:border-gray-600 bg-white dark:bg-[#181a20] text-blue-500 focus:ring-2 focus:ring-blue-500/30"
                          />
                          Show only Eligible Ads
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors">
                          <input
                            type="checkbox"
                            checked={filterDraft.noVerificationRequired}
                            onChange={(e) => setFilterDraft((d) => ({ ...d, noVerificationRequired: e.target.checked }))}
                            className="rounded border-gray-400 dark:border-gray-600 bg-white dark:bg-[#181a20] text-blue-500 focus:ring-2 focus:ring-blue-500/30"
                          />
                          Ads With No Verification Required
                        </label>
                      </div>

                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Sort By</p>
                      <div className="grid grid-cols-2 gap-2 mb-4">
                        {SORT_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setFilterDraft((d) => ({ ...d, sortBy: opt.id }))}
                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
                              filterDraft.sortBy === opt.id
                                ? 'bg-blue-500 text-white shadow-sm'
                                : 'bg-gray-100 dark:bg-[#181a20] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Payment Time Limit (minutes)</p>
                      <div className="flex gap-2 mb-4">
                        {PAYMENT_TIME_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setFilterDraft((d) => ({ ...d, paymentTimeLimit: opt.id }))}
                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
                              filterDraft.paymentTimeLimit === opt.id
                                ? 'bg-blue-500 text-white shadow-sm'
                                : 'bg-gray-100 dark:bg-[#181a20] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={handleFilterConfirm}
                          className="w-full py-2.5 rounded-lg text-sm font-semibold bg-blue-500 hover:bg-blue-600 text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:ring-offset-2 dark:focus:ring-offset-[#1e2026]"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={handleFilterReset}
                          className="w-full py-2.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-[#181a20] hover:bg-gray-200 dark:hover:bg-[#0b0e11] text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Table — Bybit-style: Advertiser, Price, Limit/Available, Payment, Action */}
            <div className="mt-6 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-[#181a20] shadow-sm dark:shadow-none">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#1e2026] text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-500">
                      <th className="py-2.5 px-4 font-medium">Advertiser</th>
                      <th className="py-2.5 px-4 font-medium">Price</th>
                      <th className="py-2.5 px-4 font-medium">Limit/Available</th>
                      <th className="py-2.5 px-4 font-medium">Payment</th>
                      <th className="text-right py-2.5 px-4 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adsLoading ? (
                      <tr>
                        <td colSpan={5} className="py-16 text-center">
                          <div className="inline-flex items-center gap-2 text-gray-500 dark:text-gray-500">
                            <Loader2 className="w-5 h-5 animate-spin" />
                            <span>Loading...</span>
                          </div>
                        </td>
                      </tr>
                    ) : ads.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-0">
                          <div className="py-12 px-6 text-center border-b border-gray-200 dark:border-gray-800">
                            <p className="text-gray-600 dark:text-gray-400">
                              {typeSafe === 'sell'
                                ? 'No buyers available.'
                                : 'No sellers available.'}
                            </p>
                            <p className="text-sm text-gray-500 mt-1">
                              {typeSafe === 'sell'
                                ? 'Post a Sell Ad to receive buy orders.'
                                : 'Post a Buy Ad to receive sell orders.'}
                            </p>
                            {_hasHydrated && accessToken && (
                              <button
                                type="button"
                                onClick={openAdModal}
                                className="mt-4 inline-flex items-center px-5 py-2.5 rounded-lg font-medium bg-blue-500 hover:bg-blue-600 text-white text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 shadow-sm"
                              >
                                {typeSafe === 'sell' ? 'Post a Sell Ad' : 'Post a Buy Ad'}
                              </button>
                            )}
                            {(!_hasHydrated || !accessToken) && (
                              <Link
                                href="/login"
                                className="mt-4 inline-flex items-center px-5 py-2.5 rounded-lg font-medium bg-blue-500 hover:bg-blue-600 text-white text-sm transition-colors"
                              >
                                Log in to post an ad
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : (
                      ads.map((ad) => (
                        <tr
                          key={ad.id}
                          className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/80 dark:hover:bg-[#1e2026]/50 transition-colors duration-200 cursor-pointer group"
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-blue-500/90 dark:bg-blue-600/80 flex items-center justify-center flex-shrink-0 ring-2 ring-blue-500/20 dark:ring-blue-400/20">
                                <span className="text-white font-semibold text-sm">{ad.initial}</span>
                              </div>
                              <div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-medium text-gray-900 dark:text-white">{ad.advertiser}</span>
                                  {ad.verified && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30">
                                      Verified
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                                  {ad.completion} completion · {ad.trades} trades
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-semibold tabular-nums text-gray-900 dark:text-white">
                              {fiatSafe} {ad.price}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-gray-600 dark:text-gray-400 text-xs">
                            <p className="font-medium text-gray-700 dark:text-gray-300">Limit: {ad.limitMin.toLocaleString()} - {ad.limitMax.toLocaleString()} {ad.limitFiat}</p>
                            <p className="text-gray-500 dark:text-gray-500 mt-0.5">Available: {ad.available}</p>
                          </td>
                          <td className="py-3 px-4 text-gray-600 dark:text-gray-400 text-xs max-w-[200px] truncate" title={ad.paymentMethods}>
                            {ad.paymentMethods}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {_hasHydrated && accessToken ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedAd(ad);
                                  setModalMode('order');
                                  setCreateQuantity('');
                                  setCreatePaymentMethodId(paymentMethods[0]?.id ?? '');
                                  setCreateOrderError(null);
                                }}
                                className="inline-flex h-9 items-center px-4 rounded-lg font-medium bg-blue-500 hover:bg-blue-600 text-white text-sm transition-all duration-200 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:ring-offset-1 dark:focus:ring-offset-[#181a20] shadow-sm"
                              >
                                {typeSafe === 'buy' ? `Buy ${cryptoSafe}` : `Sell ${cryptoSafe}`}
                              </button>
                            ) : (
                              <Link
                                href="/login"
                                className="inline-flex h-9 items-center px-4 rounded-lg font-medium bg-blue-500 hover:bg-blue-600 text-white text-sm transition-all duration-200 active:scale-[0.98] shadow-sm"
                              >
                                {typeSafe === 'buy' ? `Buy ${cryptoSafe}` : `Sell ${cryptoSafe}`}
                              </Link>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {/* Pagination — Bybit-style: rows per page + page nav */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#1e2026]">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Rows per page</span>
                  <select
                    value={perPage}
                    onChange={(e) => {
                      setPerPage(Number(e.target.value));
                      setPage(0);
                    }}
                    className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#181a20] text-gray-900 dark:text-white px-2 py-1.5 text-sm min-h-[32px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all duration-200"
                  >
                    {PER_PAGE_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="p-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#181a20] text-gray-600 dark:text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed text-sm hover:bg-gray-100 dark:hover:bg-[#0b0e11] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  >
                    ←
                  </button>
                  <span className="px-2 text-sm tabular-nums text-gray-600 dark:text-gray-400">{page + 1}</span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => p + 1)}
                    className="p-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#181a20] text-gray-600 dark:text-gray-400 text-sm hover:bg-gray-100 dark:hover:bg-[#0b0e11] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  >
                    →
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Trader Guide Panel */}
        <section className="border-b border-gray-200 dark:border-gray-800 py-6 bg-white dark:bg-[#181a20]">
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-[#1e2026]">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Trader Guide</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Identity Verification → Payment Methods → Place Orders Safely</p>
            </div>
            <div className="flex flex-col sm:flex-row divide-y sm:divide-y-0 sm:divide-x divide-gray-100 dark:divide-gray-800">
              <div className="flex items-center gap-3 px-4 py-3 flex-1 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-blue-500/15 dark:bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                  <FileCheck className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-900 dark:text-white">Step 1: Identity Verification</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">Complete KYC to buy and sell crypto with fiat.</p>
                </div>
              </div>
              <div className="flex items-center gap-3 px-4 py-3 flex-1 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-blue-500/15 dark:bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                  <Smartphone className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-900 dark:text-white">Step 2: Add Payment Methods</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">Connect bank or digital payment to trade.</p>
                </div>
              </div>
              <div className="flex items-center gap-3 px-4 py-3 flex-1 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-blue-500/15 dark:bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                  <ShoppingCart className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-900 dark:text-white">Step 3: Place Orders Safely</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">Select an ad, complete payment, receive crypto.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Trust & Safety Block */}
        <section className="border-b border-gray-200 dark:border-gray-800 py-6 bg-gray-50 dark:bg-[#0b0e11]">
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#181a20] overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Why trade on Methereum P2P</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Safety mechanisms · Escrow protection · Fraud prevention</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-gray-100 dark:bg-gray-800">
              <div className="bg-white dark:bg-[#181a20] px-4 py-3 flex items-center gap-2">
                <Shield className="w-4 h-4 text-blue-500 dark:text-blue-400 flex-shrink-0" />
                <span className="text-xs text-gray-700 dark:text-gray-300">Escrow holds crypto until payment confirmed</span>
              </div>
              <div className="bg-white dark:bg-[#181a20] px-4 py-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-500 dark:text-blue-400 flex-shrink-0" />
                <span className="text-xs text-gray-700 dark:text-gray-300">Zero-fee · 24/7 support · Dispute resolution</span>
              </div>
              <div className="bg-white dark:bg-[#181a20] px-4 py-3 flex items-center gap-2 col-span-2 md:col-span-1">
                <CircleDot className="w-4 h-4 text-blue-500 dark:text-blue-400 flex-shrink-0" />
                <span className="text-xs text-gray-700 dark:text-gray-300">Trade only in-app — never pay external links</span>
              </div>
            </div>
          </div>
        </section>

        {/* Contextual Help Panel */}
        <section className="border-b border-gray-200 dark:border-gray-800 py-6 bg-gray-50 dark:bg-[#0b0e11]">
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#181a20] overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Help</h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {HELP_ITEMS.map((item, i) => (
                <div key={i}>
                  <button
                    type="button"
                    onClick={() => setLearnOpen(learnOpen === i ? null : i)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-[#1e2026]/50 transition-colors focus:outline-none focus:ring-inset focus:ring-2 focus:ring-blue-500/30"
                  >
                    {item.title}
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-150 flex-shrink-0 ${learnOpen === i ? 'rotate-180' : ''}`} />
                  </button>
                  {learnOpen === i && (
                    <div className="px-4 pb-3 text-xs text-gray-600 dark:text-gray-400 border-t border-gray-50 dark:border-gray-800/50 pt-2">
                      {item.body}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Payment Methods */}
        <section className="border-b border-gray-200 dark:border-gray-800 py-6 bg-gray-50 dark:bg-[#0b0e11]">
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#181a20] overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Payment Methods</h2>
              <div className="flex gap-1">
                {PAYMENT_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setPaymentTab(t.id)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      paymentTab === t.id ? 'bg-blue-500 text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="px-4 py-3 flex flex-wrap gap-2">
              {PAYMENT_BUTTONS_LOCAL.map((name) => (
                <span key={name} className="px-2.5 py-1 rounded-md bg-gray-100 dark:bg-[#1e2026] text-xs text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* FAQs */}
        <section className="py-6 bg-gray-50 dark:bg-[#0b0e11]">
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#181a20] overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Support</h2>
              <div className="flex gap-1 mt-2">
                {FAQ_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { setFaqTab(t.id); setFaqOpen(null); }}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      faqTab === t.id ? 'bg-blue-500 text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {(FAQ_ITEMS[faqTab] || FAQ_ITEMS.p2p).map((item, i) => (
                <div key={i}>
                  <button
                    type="button"
                    onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-[#1e2026]/50 transition-colors duration-150 focus:outline-none focus:ring-inset focus:ring-2 focus:ring-blue-500/30"
                  >
                    {item.q}
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-150 flex-shrink-0 ${faqOpen === i ? 'rotate-180' : ''}`} />
                  </button>
                  {faqOpen === i && (
                    <div className="px-4 pb-3 text-xs text-gray-600 dark:text-gray-400 border-t border-gray-50 dark:border-gray-800/50 pt-2">
                      {item.a}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-white dark:bg-[#181a20] border-t border-gray-200 dark:border-gray-800 py-8">
        <div className="container mx-auto px-4 lg:px-6 max-w-7xl">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-6">
            <div className="col-span-2 md:col-span-2">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Products</h4>
              <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <li><Link href="/dashboard/p2p" className="hover:text-gray-900 dark:hover:text-white transition-colors">P2P</Link></li>
                <li><Link href="/dashboard/spot" className="hover:text-gray-900 dark:hover:text-white transition-colors">Spot Trading</Link></li>
                <li><Link href="/dashboard/api" className="hover:text-gray-900 dark:hover:text-white transition-colors">API</Link></li>
              </ul>
            </div>
            <div className="col-span-2 md:col-span-2">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Company</h4>
              <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <li><Link href="/" className="hover:text-gray-900 dark:hover:text-white transition-colors">About Us</Link></li>
                <li><Link href="/" className="hover:text-gray-900 dark:hover:text-white transition-colors">Announcements</Link></li>
              </ul>
            </div>
            <div className="col-span-2 md:col-span-2">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Support</h4>
              <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <li><Link href="/" className="hover:text-gray-900 dark:hover:text-white transition-colors">Help Center</Link></li>
                <li><Link href="/terms" className="hover:text-gray-900 dark:hover:text-white transition-colors">Terms of Service</Link></li>
                <li><Link href="/privacy" className="hover:text-gray-900 dark:hover:text-white transition-colors">Privacy Policy</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-800 text-center text-xs text-gray-500 dark:text-gray-500">
            © 2026 Methereum. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function P2PDynamicPage() {
  return <P2PContent />;
}
