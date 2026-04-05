import { LifeBuoy } from 'lucide-react';

export default function SupportPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[var(--admin-text)]">Support Tickets</h1>
      <p className="text-[var(--admin-text-muted)]">Manage customer support tickets</p>
      <div className="flex flex-col items-center justify-center py-20 rounded-[var(--admin-radius)] border border-[var(--admin-card-border)] bg-[var(--admin-card-bg)] shadow-[var(--admin-shadow)]">
        <div className="w-14 h-14 rounded-2xl bg-[var(--admin-primary)]/10 flex items-center justify-center mb-4">
          <LifeBuoy className="w-7 h-7 text-[var(--admin-primary)]" />
        </div>
        <h2 className="text-lg font-semibold text-[var(--admin-text)]">Coming Soon</h2>
        <p className="mt-1 text-sm text-[var(--admin-text-muted)] max-w-sm text-center">
          The support ticket system is under development. You&apos;ll be able to manage customer inquiries, track response times, and view resolution metrics here.
        </p>
      </div>
    </div>
  );
}
