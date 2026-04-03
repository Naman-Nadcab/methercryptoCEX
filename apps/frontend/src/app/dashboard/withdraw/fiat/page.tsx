'use client';

import Link from 'next/link';
import { Banknote, ArrowLeft, CreditCard, Building2, Globe, ArrowRight } from 'lucide-react';

const PLANNED_METHODS = [
  { icon: Building2, title: 'Bank Transfer', desc: 'SEPA, SWIFT, IMPS, UPI — direct to your bank account.' },
  { icon: CreditCard, title: 'Card Withdrawal', desc: 'Withdraw to Visa/Mastercard linked to your account.' },
  { icon: Globe, title: 'Third-Party Partners', desc: 'Off-ramp via trusted payment providers in your region.' },
];

export default function WithdrawFiatPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <Link href="/dashboard/withdraw/crypto" className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Withdraw
      </Link>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Banknote className="h-7 w-7 text-muted-foreground" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">Fiat Withdrawal</h1>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Bank withdrawals (INR, USD, EUR, etc.) are not available yet. This feature will be enabled once our payment partners are integrated.
          </p>
        </div>

        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Planned Methods</h3>
        <div className="space-y-2">
          {PLANNED_METHODS.map((m) => (
            <div key={m.title} className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <m.icon className="h-4.5 w-4.5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">{m.title}</p>
                <p className="text-[10px] text-muted-foreground">{m.desc}</p>
              </div>
              <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Soon</span>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <Link href="/dashboard/withdraw/crypto" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            Withdraw Crypto Instead <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
