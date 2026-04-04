'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  HelpCircle, Search, Download, Upload, Shield, Key,
  CreditCard, BarChart3, Users, ChevronDown, ChevronRight,
} from 'lucide-react';

interface HelpItem {
  id: string;
  title: string;
  content: string;
  category: string;
}

const CATEGORIES = [
  { key: 'all', label: 'All Topics', icon: HelpCircle },
  { key: 'deposit', label: 'Deposits', icon: Download },
  { key: 'withdraw', label: 'Withdrawals', icon: Upload },
  { key: 'trading', label: 'Trading', icon: BarChart3 },
  { key: 'security', label: 'Security', icon: Shield },
  { key: 'account', label: 'Account', icon: Key },
  { key: 'fees', label: 'Fees & VIP', icon: CreditCard },
  { key: 'p2p', label: 'P2P', icon: Users },
];

const HELP_ITEMS: HelpItem[] = [
  { id: 'deposit-how', category: 'deposit', title: 'How to Make a Crypto Deposit', content: 'Select your chain and token from the Deposit page, generate a deposit address, and send funds from your external wallet. Always include the required memo/tag for networks that support it (e.g., XRP, ATOM). Deposits require network confirmations before being credited — typically 10–30 minutes.' },
  { id: 'deposit-wrong', category: 'deposit', title: 'Wrong Network or Missing Memo', content: 'If you deposited on an unsupported network or forgot the memo/tag, contact support with your transaction ID and deposit address. Manual recovery may take several business days and is subject to a recovery fee.' },
  { id: 'deposit-pending', category: 'deposit', title: 'Deposit Not Credited', content: 'Check your transaction on the blockchain explorer. If the required confirmations are met but funds haven\'t appeared, use the Self-Service tool on the Assets History page, or contact support.' },
  { id: 'withdraw-how', category: 'withdraw', title: 'How to Withdraw Crypto', content: 'Go to the Withdraw page, select the coin and network, enter the recipient address, and confirm the amount. Verify via 2FA or email OTP. Withdrawals are processed within minutes for most networks.' },
  { id: 'withdraw-fiat', category: 'withdraw', title: 'Fiat Withdrawals', content: 'Bank withdrawals (INR, USD, EUR) are not yet available. Currently you can withdraw crypto to any external wallet. Fiat off-ramp via payment partners is planned.' },
  { id: 'withdraw-limits', category: 'withdraw', title: 'Withdrawal Limits', content: 'Withdrawal limits are based on your KYC verification level. Complete identity verification to unlock higher limits. Check the Security → Withdrawal Limits page for your current tier.' },
  { id: 'trade-spot', category: 'trading', title: 'How Spot Trading Works', content: 'Spot trading lets you buy and sell crypto at current market prices or set limit orders. Use the order form to place market, limit, or stop-limit orders. Your trading balance is used for orders — transfer funds from Funding to Trading first.' },
  { id: 'trade-types', category: 'trading', title: 'Order Types Explained', content: 'Market: executes immediately at best price. Limit: executes when price reaches your target. Stop-Limit: triggers a limit order when stop price is hit. Each has different use cases for entry/exit strategies.' },
  { id: 'trade-transfer', category: 'trading', title: 'Transferring Between Accounts', content: 'Use the Transfer page to move funds between Funding and Trading accounts. Transfers are instant and free. Funding account is for deposits/withdrawals; Trading account is for spot orders.' },
  { id: 'security-2fa', category: 'security', title: 'Setting Up 2FA', content: 'Go to Security → 2FA to enable Google Authenticator. Scan the QR code, save your backup key securely, and enter the verification code. 2FA protects login, withdrawals, and sensitive operations.' },
  { id: 'security-passkeys', category: 'security', title: 'Using Passkeys', content: 'Passkeys provide passwordless, phishing-resistant login using your device biometrics (Face ID, fingerprint) or hardware security keys. Set up in Security → Passkeys.' },
  { id: 'security-fund-pwd', category: 'security', title: 'Fund Password', content: 'A secondary password required for withdrawals and transfers. Set it up in Security → Fund Password to add extra protection to your funds.' },
  { id: 'security-anti-phish', category: 'security', title: 'Anti-Phishing Code', content: 'Set a custom anti-phishing code that appears in all official emails from us. If an email doesn\'t contain your code, it may be a phishing attempt.' },
  { id: 'account-kyc', category: 'account', title: 'Identity Verification (KYC)', content: 'Complete KYC to unlock full features: higher withdrawal limits, P2P trading, and fiat services. Go to Account → Identity to upload your documents. Verification typically completes within 24 hours.' },
  { id: 'account-api', category: 'account', title: 'API Key Management', content: 'Create API keys in Account → API to access trading via third-party tools. Set permissions (read, trade, withdraw) and IP whitelist for security. Never share your secret key.' },
  { id: 'fiat-fees', category: 'fees', title: 'Fee Schedule', content: 'Maker and taker fees depend on your VIP level and 30-day trading volume. Maker orders (limit orders that add liquidity) have lower fees than taker orders. Check the Fee Rates page for your current tier.' },
  { id: 'vip-requirements', category: 'fees', title: 'VIP Tiers', content: 'VIP levels are updated daily based on your 30-day trading volume. Higher tiers unlock lower fees. Check Fee Rates page for volume requirements and fee discounts.' },
  { id: 'p2p-how', category: 'p2p', title: 'How P2P Trading Works', content: 'P2P allows direct crypto purchases/sales with other users via bank transfer, UPI, or other payment methods. The platform holds crypto in escrow until payment is confirmed.' },
  { id: 'p2p-dispute', category: 'p2p', title: 'P2P Disputes', content: 'If a trade has issues, either party can open a dispute. An admin will review evidence (payment proof, chat logs) and resolve it. Always keep payment receipts.' },
  { id: 'mnt-discount', category: 'fees', title: 'MNT Fee Discount', content: 'Hold MNT tokens in your account to receive a discount on trading fees. The discount is applied automatically when fee deduction in MNT is enabled in your account settings.' },
];

export default function HelpPage() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let items = HELP_ITEMS;
    if (activeCategory !== 'all') items = items.filter((i) => i.category === activeCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter((i) => i.title.toLowerCase().includes(q) || i.content.toLowerCase().includes(q));
    }
    return items;
  }, [search, activeCategory]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-2">
        <HelpCircle className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Help Center</h1>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search help topics…"
          className="h-10 w-full rounded-xl border border-border bg-card pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </div>

      {/* Category pills */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        {CATEGORIES.map((cat) => (
          <button key={cat.key} type="button" onClick={() => setActiveCategory(cat.key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              activeCategory === cat.key
                ? 'bg-primary text-primary-foreground'
                : 'border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <cat.icon className="h-3.5 w-3.5" /> {cat.label}
          </button>
        ))}
      </div>

      {/* Results count */}
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {filtered.length} topic{filtered.length !== 1 ? 's' : ''}
      </p>

      {/* FAQ accordion */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">No results found. Try a different search term.</p>
          </div>
        ) : filtered.map((item) => {
          const isOpen = expandedId === item.id;
          return (
            <div key={item.id} id={item.id} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
              <button type="button" onClick={() => setExpandedId(isOpen ? null : item.id)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors"
              >
                <span className="text-sm font-medium text-foreground">{item.title}</span>
                {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
              </button>
              {isOpen && (
                <div className="border-t border-border px-4 py-3">
                  <p className="text-xs leading-relaxed text-muted-foreground">{item.content}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-8 rounded-xl border border-border bg-card p-4 text-center shadow-sm">
        <p className="text-sm font-medium text-foreground">Still need help?</p>
        <p className="mt-1 text-xs text-muted-foreground">Contact our support team or visit the knowledge base.</p>
        <div className="mt-3 flex items-center justify-center gap-3">
          <Link href="/dashboard" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors">
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
