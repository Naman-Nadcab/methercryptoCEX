'use client';

import { Shield, ShieldOff, Lock } from 'lucide-react';

export interface APISecurityIndicatorsProps {
  ipWhitelistCount: number;
  readOnlyCount: number;
  withdrawalDisabledCount: number;
  totalKeys: number;
}

export function APISecurityIndicators({
  ipWhitelistCount,
  readOnlyCount,
  withdrawalDisabledCount,
  totalKeys,
}: APISecurityIndicatorsProps) {
  const items = [
    {
      label: 'IP whitelist enabled',
      value: `${ipWhitelistCount}/${totalKeys || 0} keys`,
      active: ipWhitelistCount > 0,
      icon: Shield,
    },
    {
      label: 'Read-only enabled',
      value: `${readOnlyCount}/${totalKeys || 0} keys`,
      active: readOnlyCount > 0,
      icon: Lock,
    },
    {
      label: 'Withdrawal disabled',
      value: `${withdrawalDisabledCount}/${totalKeys || 0} keys`,
      active: withdrawalDisabledCount > 0,
      icon: ShieldOff,
    },
  ];

  return (
    <div className="flex flex-wrap gap-3">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
              item.active
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'
            }`}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span className="font-medium">{item.label}</span>
            <span className="tabular-nums">{item.value}</span>
          </div>
        );
      })}
    </div>
  );
}
