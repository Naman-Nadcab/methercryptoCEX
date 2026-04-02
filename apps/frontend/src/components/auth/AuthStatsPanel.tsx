'use client';

import { Wallet, Percent, Coins, Globe2, Users, CreditCard } from 'lucide-react';

interface StatItem {
  icon: React.ReactNode;
  label: string;
  value: string;
  subLabel?: string;
}

const stats: StatItem[] = [
  {
    icon: <Wallet className="w-8 h-8" />,
    label: 'Supported fiat',
    value: '60+',
    subLabel: '40+ Countries',
  },
  {
    icon: <Percent className="w-8 h-8" />,
    label: 'Fee',
    value: '0',
    subLabel: '0 Transaction fee',
  },
  {
    icon: <Coins className="w-8 h-8" />,
    label: 'Cryptos',
    value: '300+',
    subLabel: '10k+ Advertisements',
  },
];

const additionalStats = [
  { label: 'Countries', value: '40+' },
  { label: 'Payment methods', value: '100+' },
  { label: 'Platform fee', value: '0' },
  { label: 'Daily orders', value: '100k+' },
];

export default function AuthStatsPanel() {
  return (
    <div className="hidden lg:flex lg:w-1/2 bg-gray-950 relative overflow-hidden flex-col justify-center px-12 xl:px-20">
      {/* Background gradient effects */}
      <div className="absolute inset-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-purple-600/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-blue-600/20 rounded-full blur-[100px]" />
      </div>

      {/* Content */}
      <div className="relative z-10">
        {/* Headline */}
        <h1 className="text-4xl xl:text-5xl font-bold text-white leading-tight mb-4">
          Buy & sell directly with
        </h1>
        <h2 className="text-4xl xl:text-5xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent mb-12">
          P2P Trading
        </h2>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-8 mb-12">
          {stats.map((stat, index) => (
            <div key={index} className="space-y-3">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-600/20 to-blue-600/20 border border-purple-500/20 flex items-center justify-center text-purple-400">
                {stat.icon}
              </div>
              <p className="text-muted-foreground text-sm">{stat.label}</p>
              <p className="text-4xl font-bold text-white">{stat.value}</p>
              {stat.subLabel && (
                <p className="text-muted-foreground text-sm">{stat.subLabel}</p>
              )}
            </div>
          ))}
        </div>

        {/* Additional Stats */}
        <div className="grid grid-cols-2 gap-4">
          {additionalStats.map((item, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="text-2xl font-bold text-white">{item.value}</span>
              <span className="text-muted-foreground text-sm">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
