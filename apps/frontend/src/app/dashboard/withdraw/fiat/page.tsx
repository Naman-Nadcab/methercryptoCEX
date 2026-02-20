'use client';

import Link from 'next/link';
import { ArrowLeft, Banknote } from 'lucide-react';

export default function WithdrawFiatPage() {
  return (
    <div className="max-w-xl mx-auto py-8 px-4">
      <Link
        href="/dashboard/withdraw/crypto"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Withdraw
      </Link>
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
          <Banknote className="w-7 h-7 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold text-foreground mb-2">Fiat withdrawal</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Bank withdrawals (INR, USD, etc.) are not available yet. Use crypto withdrawal to send to your wallet or another exchange.
        </p>
        <Link
          href="/dashboard/withdraw/crypto"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          Withdraw crypto instead
        </Link>
      </div>
    </div>
  );
}
