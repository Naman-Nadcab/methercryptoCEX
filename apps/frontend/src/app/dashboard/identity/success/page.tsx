'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, ArrowRight, Shield, Gift, Wallet, LayoutDashboard, ListOrdered, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function IdentityVerificationSuccessPage() {
  const router = useRouter();

  // Auto redirect after 5 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      router.push('/dashboard');
    }, 5000);

    return () => clearTimeout(timer);
  }, [router]);

  const nextSteps = [
    {
      title: 'Fund your account',
      description: 'Deposit crypto or fiat to start trading.',
      href: '/wallet/deposit/crypto',
      icon: Wallet,
    },
    {
      title: 'Explore the dashboard',
      description: 'Review balances, orders, and account settings.',
      href: '/dashboard',
      icon: LayoutDashboard,
    },
    {
      title: 'Trade with confidence',
      description: 'Spot and P2P are available with your verified status.',
      href: '/trade/spot',
      icon: TrendingUp,
    },
  ] as const;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <Link href="/dashboard" className="text-2xl font-bold text-foreground">
          <span className="mr-1 rounded bg-primary px-2 py-1 text-primary-foreground">M</span>
          Methereum
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-lg">
          <Card className="shadow-sm">
            <CardHeader className="space-y-6 pb-2 text-center">
              <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-buy-light ring-8 ring-buy/10">
                <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-buy/50 bg-card">
                  <Check className="h-9 w-9 text-buy" strokeWidth={2.5} />
                </div>
              </div>
              <div className="space-y-2">
                <CardTitle className="text-2xl font-bold text-foreground sm:text-3xl">
                  Verification successful
                </CardTitle>
                <CardDescription className="text-base text-muted-foreground">
                  Your identity has been verified. You now have full access to platform features that require KYC.
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="space-y-8">
              <div className="rounded-xl border border-border bg-muted/50 p-5">
                <h3 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-card text-primary ring-1 ring-border">
                    <ListOrdered className="h-4 w-4" aria-hidden />
                  </span>
                  Next steps
                </h3>
                <ul className="space-y-3">
                  {nextSteps.map(({ title, description, href, icon: Icon }) => (
                    <li key={href}>
                      <Link
                        href={href}
                        className="group flex gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/30 hover:bg-muted/30"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
                          <Icon className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0 text-left">
                          <span className="block font-medium text-foreground group-hover:text-primary">{title}</span>
                          <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-border bg-muted/40 p-5 text-left">
                <h3 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
                  <Gift className="h-5 w-5 text-primary" aria-hidden />
                  Your rewards
                </h3>
                <ul className="space-y-3">
                  <li className="flex items-center gap-3 text-muted-foreground">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-primary ring-1 ring-border">
                      <Wallet className="h-4 w-4" aria-hidden />
                    </span>
                    <span>Any applicable bonuses will be credited to your account</span>
                  </li>
                  <li className="flex items-center gap-3 text-muted-foreground">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-primary ring-1 ring-border">
                      <Shield className="h-4 w-4" aria-hidden />
                    </span>
                    <span>Increased withdrawal limits</span>
                  </li>
                  <li className="flex items-center gap-3 text-muted-foreground">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-buy-light text-buy ring-1 ring-buy/20">
                      <Check className="h-4 w-4" aria-hidden />
                    </span>
                    <span>Access to all trading features</span>
                  </li>
                </ul>
              </div>

              <div className="flex flex-col gap-3">
                <Link
                  href="/wallet/deposit/crypto"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
                >
                  Make a deposit
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link
                  href="/dashboard"
                  className="inline-flex w-full items-center justify-center rounded-xl border border-border bg-card py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  Go to dashboard
                </Link>
              </div>

              <p className="text-center text-sm text-muted-foreground">
                Redirecting to dashboard in 5 seconds…
              </p>
            </CardContent>
          </Card>
        </div>
      </main>

      <footer className="py-6 text-center text-sm text-muted-foreground">
        <p>© 2018-2026 Methereum.com. All rights reserved.</p>
      </footer>
    </div>
  );
}
