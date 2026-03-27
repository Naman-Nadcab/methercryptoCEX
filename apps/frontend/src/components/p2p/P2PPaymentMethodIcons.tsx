'use client';

import { Building2, Smartphone, Globe, CreditCard } from 'lucide-react';

const METHOD_ICONS: Record<string, { icon: typeof Building2; label: string }> = {
  'bank transfer': { icon: Building2, label: 'Bank Transfer' },
  'bank': { icon: Building2, label: 'Bank' },
  'upi': { icon: Smartphone, label: 'UPI' },
  'wise': { icon: Globe, label: 'Wise' },
  'paypal': { icon: CreditCard, label: 'PayPal' },
  'paytm': { icon: Smartphone, label: 'PayTM' },
};

function matchMethod(name: string): { icon: typeof Building2; label: string } | null {
  const key = Object.keys(METHOD_ICONS).find((k) => name.toLowerCase().includes(k));
  return key ? METHOD_ICONS[key] : null;
}

interface P2PPaymentMethodIconsProps {
  methods: string[];
  className?: string;
}

export function P2PPaymentMethodIcons({ methods, className = '' }: P2PPaymentMethodIconsProps) {
  return (
    <div className={`flex flex-wrap gap-1.5 items-center ${className}`}>
      {methods.slice(0, 4).map((m) => {
        const match = matchMethod(m);
        if (match) {
          const Icon = match.icon;
          return (
            <span
              key={m}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted/60 text-muted-foreground text-[10px] font-medium"
              title={m}
            >
              <Icon className="w-3 h-3" />
              {match.label}
            </span>
          );
        }
        return (
          <span
            key={m}
            className="px-2 py-0.5 rounded bg-muted/60 text-muted-foreground text-[10px] truncate max-w-[80px]"
            title={m}
          >
            {m}
          </span>
        );
      })}
      {methods.length > 4 && (
        <span className="text-[10px] text-muted-foreground">+{methods.length - 4}</span>
      )}
    </div>
  );
}
