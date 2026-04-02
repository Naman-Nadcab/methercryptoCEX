'use client';

import Link from 'next/link';
import { HelpCircle } from 'lucide-react';

const SECTIONS = [
  {
    id: 'deposit-how-to',
    title: 'How to Make a Deposit',
    content: 'Select your chain and token, generate a deposit address, and send funds from your wallet. Always include the required memo/tag for networks that support it.',
  },
  {
    id: 'deposit-recovery',
    title: 'Unsupported Deposit Recovery Procedure Rules',
    content: 'If you deposited an unsupported token or used the wrong network, contact support with your transaction ID. Recovery may take several business days and is subject to availability.',
  },
  {
    id: 'deposit-faq',
    title: 'FAQ — Crypto Deposit',
    content: 'Deposits require network confirmations. Check the required confirmations for your chain. Most deposits credit within 10–30 minutes.',
  },
  {
    id: 'deposit-memo',
    title: 'How to Recover a Deposit with Wrong or Missing Tag/Memo',
    content: 'Contact support with your transaction ID, deposit address, and the correct memo if known. Manual recovery may be possible for a fee.',
  },
  {
    id: 'self-service',
    title: 'Deposits yet to be credited',
    content: 'If your deposit has enough confirmations but is not credited, use Self-Service from the Assets History page or contact support.',
  },
  {
    id: 'deposit-withdraw-status',
    title: 'Deposit/Withdrawal Status of All Coins',
    content: 'Check the status page or Assets History for real-time deposit and withdrawal status by coin and network.',
  },
  {
    id: 'fee-rate',
    title: 'Fee Rate',
    content: 'Trading fees are displayed as maker and taker percentages. Maker orders add liquidity; taker orders remove it. Check the order form for estimated fees before placing an order.',
  },
  {
    id: 'passkeys',
    title: 'Passkeys',
    content: 'Passkeys provide passwordless, phishing-resistant sign-in using your device biometrics or security key.',
  },
  {
    id: 'vip-requirements',
    title: 'VIP Requirements',
    content: 'Your VIP level and fees update at 7AM UTC if you meet the respective requirements. Check the Fee Rates page for current VIP tiers and trading volume thresholds.',
  },
  {
    id: 'fiat-fees',
    title: 'Fiat Trading Fees',
    content: 'Fiat trading fees may differ from crypto pairs. View the Fee Rates page for the complete fee schedule by market type.',
  },
  {
    id: 'mnt-discount',
    title: 'MNT Discount',
    content: 'The MNT discount applies only to Spot trading (including fiat pairs). Hold MNT to qualify for reduced maker/taker fees.',
  },
  {
    id: 'business',
    title: 'Business Verification',
    content: 'Business verification is required for institutional or high-volume accounts. Contact support to apply.',
  },
] as const;

export default function HelpPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2 mb-8">
        <HelpCircle className="w-8 h-8 text-primary" />
        <h1 className="text-2xl font-semibold text-foreground">Help Center</h1>
      </div>
      <div className="space-y-6">
        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-24">
            <h2 className="text-lg font-medium text-foreground mb-2">{s.title}</h2>
            <p className="text-sm text-muted-foreground">{s.content}</p>
          </section>
        ))}
      </div>
      <div className="mt-12 pt-6 border-t border-border">
        <p className="text-sm text-muted-foreground">
          Need more help?{' '}
          <Link href="/dashboard" className="text-primary hover:text-primary/85 dark:hover:text-blue-400">
            Return to Dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
