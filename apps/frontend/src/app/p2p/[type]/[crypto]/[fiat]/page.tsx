'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
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
} from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';

const NAV_LINKS = [
  { label: 'Buy Crypto', href: '/dashboard/assets/convert' },
  { label: 'Markets', href: '/dashboard/markets' },
  { label: 'Trade', href: '/dashboard/trade' },
  { label: 'P2P', href: '/p2p' },
];

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

// Placeholder ad row for Bybit-style layout (replace with API later)
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
}

const PLACEHOLDER_ADS: AdRow[] = [
  {
    id: '1',
    advertiser: 'TradeEasy',
    initial: 'T',
    completion: '99.99%',
    trades: '1000+',
    verified: true,
    price: '1.00',
    limitMin: 100,
    limitMax: 100000,
    limitFiat: 'USD',
    available: '10000.00000000 USDT',
    paymentMethods: 'Bank Transfer, UPI, Paytm, IMPS, GPay',
    orderCount: 1000,
    completionRateNum: 99.99,
    paymentTimeMins: 15,
    eligible: true,
  },
  {
    id: '2',
    advertiser: 'john_trader',
    initial: 'J',
    completion: '96.67%',
    trades: '150+',
    verified: true,
    price: '1.015',
    limitMin: 100,
    limitMax: 5000,
    limitFiat: 'USD',
    available: '8000.00000000 USDT',
    paymentMethods: 'Bank Transfer, UPI, Paytm, IMPS, GPay',
    orderCount: 150,
    completionRateNum: 96.67,
    paymentTimeMins: 30,
    eligible: true,
  },
  {
    id: '3',
    advertiser: 'CryptoMerchant',
    initial: 'C',
    completion: '98.50%',
    trades: '500+',
    verified: true,
    price: '0.998',
    limitMin: 50,
    limitMax: 50000,
    limitFiat: 'USD',
    available: '25000.00000000 USDT',
    paymentMethods: 'Bank Transfer, PayPal, IMPS, UPI',
    orderCount: 500,
    completionRateNum: 98.5,
    paymentTimeMins: 15,
    eligible: true,
  },
  {
    id: '4',
    advertiser: 'NewSeller',
    initial: 'N',
    completion: '88.00%',
    trades: '20+',
    verified: false,
    price: '1.02',
    limitMin: 10,
    limitMax: 1000,
    limitFiat: 'USD',
    available: '500.00000000 USDT',
    paymentMethods: 'UPI, Paytm',
    orderCount: 20,
    completionRateNum: 88,
    paymentTimeMins: 30,
    eligible: false,
  },
];

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
  const [loading, setLoading] = useState(false);

  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<FilterState>(DEFAULT_FILTERS);
  const [filterApplied, setFilterApplied] = useState<FilterState>(DEFAULT_FILTERS);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);

  const typeSafe = type === 'sell' ? 'sell' : 'buy';
  const allCrypto = [...CRYPTO_OPTIONS, ...CRYPTO_OPTIONS_EXTRA];
  const cryptoSafe = allCrypto.includes(crypto) ? crypto : 'USDT';
  const fiatSafe = FIAT_OPTIONS.includes(fiat) ? fiat : 'INR';

  const handleFiatChange = (newFiat: string) => {
    router.push(`/p2p/${typeSafe}/${cryptoSafe}/${newFiat}`);
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
    let list = [...PLACEHOLDER_ADS];
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
  }, [filterApplied]);

  return (
    <div className="min-h-screen bg-[#0b0e11]">
      {/* Header — Bybit-style dark */}
      <header className="sticky top-0 z-50 border-b border-gray-800 bg-[#0b0e11]">
        <div className="container mx-auto flex h-14 items-center justify-between px-4 lg:px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center">
              <span className="text-white font-bold text-sm">M</span>
            </div>
            <span className="text-lg font-bold text-white hidden sm:inline">Methereum</span>
          </Link>
          <nav className="hidden lg:flex items-center gap-0">
            <Link href="/dashboard/assets/convert" className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors">
              Buy Crypto
            </Link>
            <Link href="/dashboard/markets" className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors">
              Markets
            </Link>
            <Link href="/dashboard/trade" className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors">
              Trade
            </Link>
            <Link href="/p2p" className="px-4 py-2 text-sm font-medium text-blue-400 border-b-2 border-blue-400">
              P2P
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/deposit/crypto" className="hidden sm:inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors">
              Deposit
            </Link>
            <ThemeToggle variant="icon" size="sm" />
            <Link href="/login" className="text-sm font-medium text-gray-300 hover:text-white px-3 py-2 transition-colors">
              Login
            </Link>
            <Link href="/signup" className="text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded-lg transition-colors">
              Register
            </Link>
          </div>
        </div>
      </header>

      <main className="bg-[#0b0e11]">
        {/* P2P Trading — exact structure from reference: one row Buy/Sell + Crypto, next row filters */}
        <section className="border-b border-gray-800 bg-[#0b0e11]">
          <div className="container mx-auto px-4 lg:px-6 py-8 max-w-7xl">
            <h1 className="text-2xl font-bold text-white">P2P Trading</h1>
            <p className="text-gray-400 mt-1">Buy & Sell Crypto with your preferred fiat currency.</p>

            {/* Card container — same as reference (white card on gray; we use dark card) */}
            <div className="mt-6 rounded-xl border border-gray-800 bg-[#181a20] p-5">
              {/* Row 1: Buy/Sell toggle (left) + Crypto list (right) — same row */}
              <div className="flex flex-wrap items-center gap-4">
                {/* Buy / Sell segmented control */}
                <div className="flex rounded-lg overflow-hidden bg-[#0b0e11] p-0.5 border border-gray-700">
                  <Link
                    href={`/p2p/buy/${cryptoSafe}/${fiatSafe}`}
                    className={`px-5 py-2.5 text-sm font-semibold transition-colors ${
                      typeSafe === 'buy' ? 'bg-blue-500 text-white' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Buy
                  </Link>
                  <Link
                    href={`/p2p/sell/${cryptoSafe}/${fiatSafe}`}
                    className={`px-5 py-2.5 text-sm font-semibold transition-colors ${
                      typeSafe === 'sell' ? 'bg-blue-500 text-white' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Sell
                  </Link>
                </div>

                {/* Crypto selection bar — same row, inline list + "Supports 300+ Cryptos >" */}
                <div className="flex flex-wrap items-center gap-1 flex-1 min-w-0">
                  {CRYPTO_OPTIONS.map((symbol) => (
                    <Link
                      key={symbol}
                      href={`/p2p/${typeSafe}/${symbol}/${fiatSafe}`}
                      className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                        cryptoSafe === symbol ? 'text-blue-400 bg-blue-500/20' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      {symbol}
                    </Link>
                  ))}
                  <span className="w-px h-4 bg-gray-600 mx-1 flex-shrink-0" aria-hidden />
                  {CRYPTO_OPTIONS_EXTRA.map((symbol) => (
                    <Link
                      key={symbol}
                      href={`/p2p/${typeSafe}/${symbol}/${fiatSafe}`}
                      className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                        cryptoSafe === symbol ? 'text-blue-400 bg-blue-500/20' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      {symbol}
                    </Link>
                  ))}
                  <Link
                    href={`/p2p/${typeSafe}/${cryptoSafe}/${fiatSafe}`}
                    className="ml-2 text-sm text-gray-500 hover:text-blue-400 transition-colors whitespace-nowrap"
                  >
                    Supports 300+ Cryptos &gt;
                  </Link>
                </div>
              </div>

              {/* Row 2: Enter Amount (input + fiat dropdown in one) | All Payment Methods | Refresh settings | Filter (icon + badge) */}
              <div className="flex flex-wrap items-center gap-3 mt-4">
                {/* Enter Amount — input with fiat dropdown attached on the right (single component) */}
                <div className="flex rounded-lg border border-gray-700 bg-[#0b0e11] overflow-hidden min-w-[200px] flex-1 max-w-xs">
                  <input
                    type="text"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="Enter Amount"
                    className="flex-1 bg-transparent text-white placeholder-gray-500 px-3 py-2.5 text-sm focus:outline-none focus:ring-0 min-w-0"
                  />
                  <div className="relative flex border-l border-gray-700 items-stretch">
                    <select
                      value={fiatSafe}
                      onChange={(e) => handleFiatChange(e.target.value)}
                      className="bg-[#0b0e11] text-gray-400 pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:ring-0 cursor-pointer appearance-none border-0"
                    >
                      {FIAT_OPTIONS.map((o) => (
                        <option key={o} value={o}>{FIAT_SYMBOLS[o] || o} {o}</option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-gray-500 pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" />
                  </div>
                </div>
                <div className="relative flex items-center">
                  <select
                    value={paymentFilter}
                    onChange={(e) => setPaymentFilter(e.target.value)}
                    className="rounded-lg border border-gray-700 bg-[#0b0e11] text-gray-400 pl-3 pr-8 py-2.5 text-sm min-w-[160px] focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">All Payment Methods</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-gray-500 absolute right-2.5 pointer-events-none" />
                </div>
                <div className="relative flex items-center">
                  <select
                    className="rounded-lg border border-gray-700 bg-[#0b0e11] text-gray-400 pl-3 pr-8 py-2.5 text-sm min-w-[140px] focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value=""
                    onChange={() => {}}
                  >
                    <option value="">Refresh settings</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-gray-500 absolute right-2.5 pointer-events-none" />
                </div>
                {/* Filter — text + funnel icon + badge; opens panel */}
                <div className="relative">
                  <button
                    ref={filterButtonRef}
                    type="button"
                    onClick={() => setFilterOpen((o) => !o)}
                    className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 transition-colors"
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
                      className="absolute right-0 top-full mt-2 z-50 w-[320px] rounded-xl border border-gray-700 bg-[#1e2026] shadow-xl p-4"
                    >
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Ad Types</p>
                      <div className="space-y-2.5 mb-4">
                        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                          <input
                            type="checkbox"
                            checked={filterDraft.verifiedOnly}
                            onChange={(e) => setFilterDraft((d) => ({ ...d, verifiedOnly: e.target.checked }))}
                            className="rounded border-gray-600 bg-[#181a20] text-blue-500 focus:ring-blue-500"
                          />
                          Show only Verified Advertisers
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                          <input
                            type="checkbox"
                            checked={filterDraft.blockAdvertisersOnly}
                            onChange={(e) => setFilterDraft((d) => ({ ...d, blockAdvertisersOnly: e.target.checked }))}
                            className="rounded border-gray-600 bg-[#181a20] text-blue-500 focus:ring-blue-500"
                          />
                          Show only Block Advertisers
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                          <input
                            type="checkbox"
                            checked={filterDraft.eligibleAdsOnly}
                            onChange={(e) => setFilterDraft((d) => ({ ...d, eligibleAdsOnly: e.target.checked }))}
                            className="rounded border-gray-600 bg-[#181a20] text-blue-500 focus:ring-blue-500"
                          />
                          Show only Eligible Ads
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                          <input
                            type="checkbox"
                            checked={filterDraft.noVerificationRequired}
                            onChange={(e) => setFilterDraft((d) => ({ ...d, noVerificationRequired: e.target.checked }))}
                            className="rounded border-gray-600 bg-[#181a20] text-blue-500 focus:ring-blue-500"
                          />
                          Ads With No Verification Required
                        </label>
                      </div>

                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Sort By</p>
                      <div className="grid grid-cols-2 gap-2 mb-4">
                        {SORT_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setFilterDraft((d) => ({ ...d, sortBy: opt.id }))}
                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                              filterDraft.sortBy === opt.id
                                ? 'bg-blue-500 text-white'
                                : 'bg-[#181a20] text-gray-400 hover:text-white border border-gray-700'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Payment Time Limit (minutes)</p>
                      <div className="flex gap-2 mb-4">
                        {PAYMENT_TIME_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setFilterDraft((d) => ({ ...d, paymentTimeLimit: opt.id }))}
                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                              filterDraft.paymentTimeLimit === opt.id
                                ? 'bg-blue-500 text-white'
                                : 'bg-[#181a20] text-gray-400 hover:text-white border border-gray-700'
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
                          className="w-full py-2.5 rounded-lg text-sm font-semibold bg-blue-500 hover:bg-blue-600 text-white transition-colors"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={handleFilterReset}
                          className="w-full py-2.5 rounded-lg text-sm font-medium bg-[#181a20] hover:bg-[#0b0e11] text-gray-300 border border-gray-700 transition-colors"
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
            <div className="mt-6 rounded-xl border border-gray-800 overflow-hidden bg-[#181a20]">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 bg-[#1e2026]">
                      <th className="text-left py-4 px-4 font-semibold text-gray-300">Advertiser</th>
                      <th className="text-left py-4 px-4 font-semibold text-gray-300">Price</th>
                      <th className="text-left py-4 px-4 font-semibold text-gray-300">Limit/Available</th>
                      <th className="text-left py-4 px-4 font-semibold text-gray-300">Payment</th>
                      <th className="text-right py-4 px-4 font-semibold text-gray-300">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-gray-500">
                          Loading...
                        </td>
                      </tr>
                    ) : ads.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-gray-500">
                          No ads found. Try changing filters.
                        </td>
                      </tr>
                    ) : (
                      ads.map((ad) => (
                        <tr key={ad.id} className="border-b border-gray-800 hover:bg-[#1e2026]/50 transition-colors">
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-blue-600/80 flex items-center justify-center flex-shrink-0">
                                <span className="text-white font-semibold text-sm">{ad.initial}</span>
                              </div>
                              <div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-medium text-white">{ad.advertiser}</span>
                                  {ad.verified && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                      Verified
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-gray-500 mt-0.5">
                                  {ad.completion} completion · {ad.trades} trades
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <span className="font-medium text-white">
                              {fiatSafe} {ad.price}
                            </span>
                          </td>
                          <td className="py-4 px-4 text-gray-400">
                            <p className="text-sm">
                              Limit: {ad.limitMin.toLocaleString()} - {ad.limitMax.toLocaleString()} {ad.limitFiat}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">Available: {ad.available}</p>
                          </td>
                          <td className="py-4 px-4 text-gray-400 text-sm max-w-[200px]">
                            {ad.paymentMethods}
                          </td>
                          <td className="py-4 px-4 text-right">
                            <Link
                              href="/login"
                              className="inline-flex px-4 py-2 rounded-lg font-medium bg-blue-500 hover:bg-blue-600 text-white text-sm transition-colors"
                            >
                              {typeSafe === 'buy' ? `Buy ${cryptoSafe}` : `Sell ${cryptoSafe}`}
                            </Link>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {/* Pagination — Bybit-style: rows per page + page nav */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800 bg-[#1e2026]">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-400">Rows per page</span>
                  <select
                    value={perPage}
                    onChange={(e) => {
                      setPerPage(Number(e.target.value));
                      setPage(0);
                    }}
                    className="rounded border border-gray-700 bg-[#181a20] text-white px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                    className="p-2 rounded border border-gray-700 bg-[#181a20] text-gray-400 disabled:opacity-50 text-sm hover:bg-[#0b0e11] transition-colors"
                  >
                    ←
                  </button>
                  <span className="px-2 text-sm text-gray-400">{page + 1}</span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => p + 1)}
                    className="p-2 rounded border border-gray-700 bg-[#181a20] text-gray-400 text-sm hover:bg-[#0b0e11] transition-colors"
                  >
                    →
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How to Get Started */}
        <section className="border-b border-gray-800 py-12 bg-[#0b0e11]">
          <div className="container mx-auto px-4 lg:px-6 max-w-7xl">
            <div className="flex items-end justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">How to Get Started With Methereum P2P</h2>
                <p className="text-gray-400 mt-1">Learn simply: we&apos;ll show you how to start trading P2P. Only 3 steps away!</p>
              </div>
              <Link href="/signup" className="text-blue-400 hover:text-blue-300 font-medium text-sm hidden sm:inline">
                View all &gt;
              </Link>
            </div>
            <div className="grid md:grid-cols-3 gap-6 mt-8">
              <div className="rounded-2xl border border-gray-800 bg-[#181a20] p-6">
                <div className="w-14 h-14 rounded-xl bg-blue-500/20 flex items-center justify-center mb-4">
                  <FileCheck className="w-7 h-7 text-blue-400" />
                </div>
                <h3 className="font-semibold text-white">Step 1: Get Verified</h3>
                <p className="text-sm text-gray-400 mt-2">Complete identity verification to buy and sell crypto with fiat currency on P2P.</p>
              </div>
              <div className="rounded-2xl border border-gray-800 bg-[#181a20] p-6">
                <div className="w-14 h-14 rounded-xl bg-blue-500/20 flex items-center justify-center mb-4">
                  <Smartphone className="w-7 h-7 text-blue-400" />
                </div>
                <h3 className="font-semibold text-white">Step 2: Add Payment Method</h3>
                <p className="text-sm text-gray-400 mt-2">Connect a local bank account or digital payment method to trade.</p>
              </div>
              <div className="rounded-2xl border border-gray-800 bg-[#181a20] p-6">
                <div className="w-14 h-14 rounded-xl bg-blue-500/20 flex items-center justify-center mb-4">
                  <ShoppingCart className="w-7 h-7 text-blue-400" />
                </div>
                <h3 className="font-semibold text-white">Step 3: Start Trading</h3>
                <p className="text-sm text-gray-400 mt-2">Place your order and quickly trade crypto with other users.</p>
              </div>
            </div>
            <Link href="/signup" className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 font-medium mt-4 sm:hidden">View all <ChevronRight className="w-4 h-4" /></Link>
          </div>
        </section>

        {/* Benefits of P2P */}
        <section className="border-b border-gray-800 py-12 bg-[#0b0e11]">
          <div className="container mx-auto px-4 lg:px-6 max-w-7xl">
            <h2 className="text-xl font-bold text-white">Benefits of P2P</h2>
            <div className="grid md:grid-cols-2 gap-12 mt-8">
              <div>
                <h3 className="font-semibold text-white mb-4">Why Choose P2P?</h3>
                <div className="flex items-start gap-4">
                  <div className="w-20 h-20 rounded-2xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                    <CircleDot className="w-10 h-10 text-blue-400" />
                  </div>
                  <p className="text-gray-300 pt-2">Zero fees · 24/7 Support · Flexible Payment · Fast Transactions</p>
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-white mb-4">Why Choose Methereum P2P?</h3>
                <ul className="space-y-3 text-gray-300 text-sm">
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-blue-400 flex-shrink-0" /> Zero-fee transactions</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-blue-400 flex-shrink-0" /> 24/7 live chat support</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-blue-400 flex-shrink-0" /> Extensive selection of merchants</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-blue-400 flex-shrink-0" /> Diverse payment methods</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-blue-400 flex-shrink-0" /> Escrow service</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-blue-400 flex-shrink-0" /> Competitive prices</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Learn About P2P */}
        <section className="border-b border-gray-800 py-12 bg-[#0b0e11]">
          <div className="container mx-auto px-4 lg:px-6 max-w-7xl">
            <h2 className="text-xl font-bold text-white">Learn About P2P</h2>
            <div className="grid md:grid-cols-3 gap-6 mt-6">
              <div className="rounded-2xl border border-gray-800 bg-[#181a20] p-6">
                <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center mb-3">
                  <CircleDot className="w-6 h-6 text-blue-400" />
                </div>
                <h3 className="font-semibold text-white">What is P2P?</h3>
                <p className="text-sm text-gray-400 mt-2">Trade crypto directly with other users. No middleman — agree on price and payment.</p>
                <Link href={`/p2p/${typeSafe}/${cryptoSafe}/${fiatSafe}`} className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm font-medium mt-3">Read more &gt;</Link>
              </div>
              <div className="rounded-2xl border border-gray-800 bg-[#181a20] p-6">
                <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center mb-3">
                  <FileText className="w-6 h-6 text-blue-400" />
                </div>
                <h3 className="font-semibold text-white">How to post an ad</h3>
                <p className="text-sm text-gray-400 mt-2">Create a buy or sell ad, set your price and limits, and start receiving orders.</p>
                <Link href={`/p2p/${typeSafe}/${cryptoSafe}/${fiatSafe}`} className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm font-medium mt-3">Read more &gt;</Link>
              </div>
              <div className="rounded-2xl border border-gray-800 bg-[#181a20] p-6">
                <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center mb-3">
                  <Shield className="w-6 h-6 text-blue-400" />
                </div>
                <h3 className="font-semibold text-white">How to protect your assets on P2P trading</h3>
                <p className="text-sm text-gray-400 mt-2">Use only platform escrow, complete steps in-app, and never pay outside the order.</p>
                <Link href={`/p2p/${typeSafe}/${cryptoSafe}/${fiatSafe}`} className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm font-medium mt-3">Read more &gt;</Link>
              </div>
            </div>
          </div>
        </section>

        {/* Payment Methods */}
        <section className="border-b border-gray-800 py-12 bg-[#0b0e11]">
          <div className="container mx-auto px-4 lg:px-6 max-w-7xl">
            <div className="flex items-end justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">Payment Methods</h2>
                <p className="text-gray-400 text-sm mt-1">Explore all supported payment methods</p>
              </div>
              <Link href={`/p2p/${typeSafe}/${cryptoSafe}/${fiatSafe}`} className="text-blue-400 hover:text-blue-300 font-medium text-sm">View all &gt;</Link>
            </div>
            <div className="flex gap-2 mt-4 border-b border-gray-800 pb-4">
              {PAYMENT_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setPaymentTab(t.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    paymentTab === t.id ? 'bg-blue-500 text-white' : 'bg-[#181a20] text-gray-400 hover:text-white border border-gray-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 mt-4">
              {PAYMENT_BUTTONS_LOCAL.map((name) => (
                <span key={name} className="px-4 py-2 rounded-lg bg-[#181a20] border border-gray-800 text-sm text-gray-300">
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* FAQs */}
        <section className="py-12 bg-[#0b0e11]">
          <div className="container mx-auto px-4 lg:px-6 max-w-7xl">
            <h2 className="text-xl font-bold text-white">FAQs</h2>
            <div className="flex gap-2 mt-4 border-b border-gray-800 pb-4">
              {FAQ_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setFaqTab(t.id); setFaqOpen(null); }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    faqTab === t.id ? 'bg-blue-500 text-white' : 'bg-[#181a20] text-gray-400 hover:text-white border border-gray-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              {(FAQ_ITEMS[faqTab] || FAQ_ITEMS.p2p).map((item, i) => (
                <div key={i} className="rounded-xl border border-gray-800 bg-[#181a20] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                    className="w-full flex items-center justify-between py-4 px-4 text-left text-sm font-medium text-white hover:bg-[#1e2026] transition-colors"
                  >
                    {item.q}
                    <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform flex-shrink-0 ${faqOpen === i ? 'rotate-180' : ''}`} />
                  </button>
                  {faqOpen === i && (
                    <div className="px-4 pb-4 text-sm text-gray-400 border-t border-gray-800 pt-2">
                      {item.a}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <Link href={`/p2p/${typeSafe}/${cryptoSafe}/${fiatSafe}`} className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 font-medium mt-4">View more FAQs &gt;</Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-[#0b0e11] border-t border-gray-800 py-12">
        <div className="container mx-auto px-4 lg:px-6 max-w-7xl">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-8">
            <div className="col-span-2 md:col-span-2">
              <h4 className="text-sm font-semibold text-white mb-3">Products</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/p2p" className="hover:text-white transition-colors">P2P</Link></li>
                <li><Link href="/dashboard/trade" className="hover:text-white transition-colors">Spot Trading</Link></li>
                <li><Link href="/dashboard/api" className="hover:text-white transition-colors">API</Link></li>
              </ul>
            </div>
            <div className="col-span-2 md:col-span-2">
              <h4 className="text-sm font-semibold text-white mb-3">Company</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/" className="hover:text-white transition-colors">About Us</Link></li>
                <li><Link href="/" className="hover:text-white transition-colors">Announcements</Link></li>
              </ul>
            </div>
            <div className="col-span-2 md:col-span-2">
              <h4 className="text-sm font-semibold text-white mb-3">Support</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/" className="hover:text-white transition-colors">Help Center</Link></li>
                <li><Link href="/terms" className="hover:text-white transition-colors">Terms of Service</Link></li>
                <li><Link href="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-10 pt-8 border-t border-gray-800 text-center text-sm text-gray-500">
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
