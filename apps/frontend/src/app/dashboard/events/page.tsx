'use client';

import Link from 'next/link';
import { Sparkles, Gift, Trophy, Zap, Clock, ArrowRight, Bell } from 'lucide-react';

const UPCOMING = [
  { title: 'Trading Competition', desc: 'Top traders by volume win exclusive rewards. Stay tuned for launch.', icon: Trophy, color: 'text-amber-500 bg-amber-500/10' },
  { title: 'Referral Bonus Event', desc: 'Invite friends and earn boosted commissions during the event period.', icon: Gift, color: 'text-primary bg-primary/10' },
  { title: 'New Listing Airdrops', desc: 'Get free tokens when new coins are listed. Hold qualifying assets to participate.', icon: Zap, color: 'text-buy bg-buy/10' },
];

export default function EventsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Events & Promotions</h1>
      </div>

      {/* Status banner */}
      <div className="mb-6 rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
            <Clock className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">No active events right now</p>
            <p className="mt-0.5 text-xs text-muted-foreground">We're preparing exciting events for you. Enable notifications to be the first to know.</p>
          </div>
        </div>
        <button type="button" className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <Bell className="h-3.5 w-3.5" /> Enable Notifications
        </button>
      </div>

      {/* Upcoming events preview */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Coming Soon</h2>
      <div className="space-y-3">
        {UPCOMING.map((item) => (
          <div key={item.title} className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${item.color}`}>
              <item.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{item.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{item.desc}</p>
            </div>
            <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Soon</span>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="mt-6 text-center">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors">
          Back to Dashboard <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
