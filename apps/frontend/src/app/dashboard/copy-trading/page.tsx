'use client';

import Link from 'next/link';
import { Users, Copy, BarChart3, Shield, ArrowRight } from 'lucide-react';

const FEATURES = [
  { icon: Copy, title: 'Auto-Mirror Trades', desc: 'Automatically copy positions from top traders in real time.' },
  { icon: BarChart3, title: 'Track Performance', desc: 'View detailed PnL, win rate, and risk metrics of every trader.' },
  { icon: Shield, title: 'Risk Controls', desc: 'Set max investment, stop-loss limits, and choose your risk level.' },
];

export default function CopyTradingPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center gap-2">
        <Users className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Copy Trading</h1>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Users className="h-8 w-8 text-primary" />
          </div>
          <span className="mb-3 inline-block rounded-full border border-border bg-muted px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Coming Soon</span>
          <h2 className="text-lg font-bold text-foreground">Social Trading</h2>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            Follow experienced traders and mirror their strategies automatically. This feature is under development.
          </p>
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-lg border border-border bg-background p-3 text-center">
              <f.icon className="mx-auto mb-2 h-5 w-5 text-primary" />
              <p className="text-xs font-semibold text-foreground">{f.title}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <Link href="/trade/spot" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            Trade on Spot <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link href="/dashboard" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors">
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
