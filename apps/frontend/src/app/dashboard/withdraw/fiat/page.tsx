'use client';

import Link from 'next/link';
import { Banknote, ArrowLeft, CreditCard, Building2, Globe, ArrowRight } from 'lucide-react';
import { WalletOperationsShell } from '@/components/wallet/WalletOperationsShell';
import { walletPath } from '@/lib/routes';

const PLANNED_METHODS = [
  { icon: Building2, title: 'Bank Transfer', desc: 'SEPA, SWIFT, IMPS, UPI — direct to your bank account.' },
  { icon: CreditCard, title: 'Card Withdrawal', desc: 'Withdraw to Visa/Mastercard linked to your account.' },
  { icon: Globe, title: 'Third-Party Partners', desc: 'Off-ramp via trusted payment providers in your region.' },
];

export default function WithdrawFiatPage() {
  return (
    <WalletOperationsShell
      title="Fiat withdrawal"
      description="Bank and card off-ramps are planned. Until then, use crypto withdrawal to move funds on-chain."
      headerRight={
        <Link
          href={walletPath.withdrawCrypto}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/35 hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4 rotate-180" aria-hidden />
          Crypto withdraw
        </Link>
      }
    >
      <Link
        href={walletPath.withdrawCrypto}
        className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 shrink-0" />
        Back to crypto withdraw
      </Link>

      <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Banknote className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
            Bank withdrawals (INR, USD, EUR, and more) are not available yet. They will roll out as payment partners go live.
          </p>
        </div>

        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Planned methods</h3>
        <div className="space-y-2">
          {PLANNED_METHODS.map((m) => (
            <div key={m.title} className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <m.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{m.title}</p>
                <p className="text-xs text-muted-foreground">{m.desc}</p>
              </div>
              <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Soon
              </span>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <Link
            href={walletPath.withdrawCrypto}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Withdraw crypto instead <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </WalletOperationsShell>
  );
}
