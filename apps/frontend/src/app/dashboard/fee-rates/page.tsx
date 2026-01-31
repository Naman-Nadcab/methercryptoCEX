'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import {
  HelpCircle,
  ChevronRight,
  TrendingUp,
  Award,
  Loader2,
  ExternalLink,
  Info,
} from 'lucide-react';

type TabType = 'trading' | 'interest';

interface FeeRate {
  maker: number;
  taker: number;
  fiatMaker?: number;
  fiatTaker?: number;
}

interface VipRequirement {
  id: string;
  title: string;
  helpText?: string;
  current: number;
  required: number;
  unit: string;
  link: string;
  linkText: string;
}

interface UserFeeData {
  vipLevel: number;
  vipLevelName: string;
  spotFees: FeeRate;
  mntDiscount: boolean;
  tradingVolume30d: number;
  totalEquity: number;
  avgEquity30d: number;
}

export default function FeeRatesPage() {
  const { accessToken } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabType>('trading');
  const [loading, setLoading] = useState(true);
  const [mntDiscountEnabled, setMntDiscountEnabled] = useState(false);
  const [feeData, setFeeData] = useState<UserFeeData>({
    vipLevel: 0,
    vipLevelName: 'Regular User',
    spotFees: { maker: 0.1, taker: 0.1, fiatMaker: 0.15, fiatTaker: 0.2 },
    mntDiscount: false,
    tradingVolume30d: 0,
    totalEquity: 0,
    avgEquity30d: 0,
  });

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  // Fetch fee rates from backend
  useEffect(() => {
    const fetchFeeRates = async () => {
      if (!accessToken) return;
      
      setLoading(true);
      try {
        const response = await fetch(`${apiUrl}/api/v1/auth/fee-rates`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const result = await response.json();
        
        if (result.success && result.data) {
          setFeeData(result.data);
          setMntDiscountEnabled(result.data.mntDiscount || false);
        }
      } catch (error) {
        console.error('Failed to fetch fee rates:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchFeeRates();
  }, [accessToken]);

  // Toggle MNT discount
  const toggleMntDiscount = async () => {
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/fee-rates/mnt-discount`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ enabled: !mntDiscountEnabled }),
      });
      const result = await response.json();
      
      if (result.success) {
        setMntDiscountEnabled(!mntDiscountEnabled);
      }
    } catch (error) {
      console.error('Failed to toggle MNT discount:', error);
    }
  };

  // Calculate discounted fees
  const getDiscountedFee = (fee: number, discountPercent: number) => {
    if (!mntDiscountEnabled) return fee;
    return fee * (1 - discountPercent / 100);
  };

  // VIP requirements for next level
  const vipRequirements: VipRequirement[] = [
    {
      id: 'spot-volume',
      title: '30-Day Spot Trading Volume (USD)',
      helpText: 'Your total spot trading volume in the last 30 days',
      current: feeData.tradingVolume30d,
      required: 1000000,
      unit: 'USD',
      link: '/dashboard/orders',
      linkText: 'Spot Trade History',
    },
    {
      id: 'total-equity',
      title: 'Total Equity (USD)',
      current: feeData.totalEquity,
      required: 100000,
      unit: 'USD',
      link: '/dashboard/assets',
      linkText: 'Wallet Balance (Earn Account)',
    },
    {
      id: 'avg-equity',
      title: '30D Avg. Equity (USD)',
      current: feeData.avgEquity30d,
      required: 100000,
      unit: 'USD',
      link: '/dashboard/assets',
      linkText: 'Wallet Balance (Earn Account)',
    },
  ];

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(num);
  };

  const formatFee = (fee: number) => {
    return fee.toFixed(4) + ' %';
  };

  // Toggle Switch Component
  const Toggle = ({ enabled, onChange }: { enabled: boolean; onChange: () => void }) => (
    <button
      onClick={onChange}
      className={`relative w-12 h-6 rounded-full transition-colors ${
        enabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all shadow ${
          enabled ? 'right-0.5' : 'left-0.5'
        }`}
      />
    </button>
  );

  // Progress Bar Component
  const ProgressBar = ({ current, required }: { current: number; required: number }) => {
    const percentage = Math.min((current / required) * 100, 100);
    return (
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-2">
        <div
          className="bg-blue-500 h-1.5 rounded-full transition-all"
          style={{ width: `${percentage}%` }}
        />
      </div>
    );
  };

  return (
    <div className="p-4 lg:p-8 bg-gray-50 dark:bg-[#0b0e11] min-h-full">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">My Fee Rates</h1>
        </div>

        {/* VIP Level Card */}
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 dark:from-[#1e2329] dark:to-[#181a20] rounded-2xl overflow-hidden mb-8 shadow-lg shadow-blue-500/20 dark:shadow-none">
          <div className="p-6 lg:p-8">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* Left: VIP Info */}
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-white/20 dark:bg-blue-500/20 rounded-full flex items-center justify-center">
                  <Award className="w-8 h-8 text-white dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-sm text-blue-100 dark:text-gray-400">My Fee Level</p>
                  <h2 className="text-2xl font-bold text-white">{feeData.vipLevelName}</h2>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-6 mt-6 border-b border-white/20 dark:border-gray-700">
              <button
                onClick={() => setActiveTab('trading')}
                className={`pb-3 text-sm font-medium transition-colors relative ${
                  activeTab === 'trading'
                    ? 'text-white'
                    : 'text-blue-200 dark:text-gray-400 hover:text-white dark:hover:text-gray-300'
                }`}
              >
                Trading Fees
                {activeTab === 'trading' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white dark:bg-blue-500" />
                )}
              </button>
              <button
                onClick={() => setActiveTab('interest')}
                className={`pb-3 text-sm font-medium transition-colors relative ${
                  activeTab === 'interest'
                    ? 'text-white'
                    : 'text-blue-200 dark:text-gray-400 hover:text-white dark:hover:text-gray-300'
                }`}
              >
                Interest Rates
                {activeTab === 'interest' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white dark:bg-blue-500" />
                )}
              </button>
            </div>
          </div>

          {/* Tab Content */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          ) : activeTab === 'trading' ? (
            <div className="px-6 lg:px-8 pb-8">
              {/* Spot Trading Fees */}
              <div className="bg-white dark:bg-[#181a20] rounded-xl p-6">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Spot</h3>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-sm text-gray-500 dark:text-gray-400">MNT 25% fee discount</span>
                      <Toggle enabled={mntDiscountEnabled} onChange={toggleMntDiscount} />
                    </div>
                  </div>
                </div>

                {/* Fee Table */}
                <div className="grid grid-cols-2 gap-8 mb-6">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Maker</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">
                      {formatFee(getDiscountedFee(feeData.spotFees.maker, mntDiscountEnabled ? 25 : 0))}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Taker</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">
                      {formatFee(getDiscountedFee(feeData.spotFees.taker, mntDiscountEnabled ? 25 : 0))}
                    </p>
                  </div>
                </div>

                {/* Fiat Pairs */}
                {feeData.spotFees.fiatMaker !== undefined && (
                  <div className="grid grid-cols-2 gap-8 mb-6 pt-4 border-t border-gray-100 dark:border-gray-800">
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Fiat Pairs Maker</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">
                        {formatFee(getDiscountedFee(feeData.spotFees.fiatMaker || 0.15, mntDiscountEnabled ? 25 : 0))}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Fiat Pairs Taker</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">
                        {formatFee(getDiscountedFee(feeData.spotFees.fiatTaker || 0.2, mntDiscountEnabled ? 25 : 0))}
                      </p>
                    </div>
                  </div>
                )}

                {/* Trade Link */}
                <Link
                  href="/trade/spot"
                  className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-sm font-medium"
                >
                  Trade Spot <ChevronRight className="w-4 h-4" />
                </Link>
              </div>

              {/* Info Notes */}
              <div className="mt-6 space-y-3 text-sm text-gray-600 dark:text-gray-400">
                <p>
                  Your VIP Level and fees will be updated at 7AM UTC if you meet the respective requirements.
                  <Link href="/vip-requirements" className="text-blue-600 dark:text-blue-400 hover:underline ml-1">
                    Check out the requirements.
                  </Link>
                </p>
                <p>
                  View Fiat Trading Fees
                  <Link href="/fiat-fees" className="text-blue-600 dark:text-blue-400 hover:underline ml-1">
                    Find out the details.
                  </Link>
                </p>
                <p>
                  The MNT discount is only applicable to Spot (incl. fiat pairs) trading.
                  <Link href="/mnt-discount" className="text-blue-600 dark:text-blue-400 hover:underline ml-1">
                    Find out the details.
                  </Link>
                </p>
              </div>
            </div>
          ) : (
            <div className="px-6 lg:px-8 pb-8">
              {/* Interest Rates Tab */}
              <div className="bg-white dark:bg-[#181a20] rounded-xl p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Spot Interest Rates</h3>
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
                  Interest rates for margin trading and borrowing are based on your VIP level.
                </p>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-gray-800">
                        <th className="text-left py-3 text-sm font-medium text-gray-500 dark:text-gray-400">Asset</th>
                        <th className="text-right py-3 text-sm font-medium text-gray-500 dark:text-gray-400">Hourly Rate</th>
                        <th className="text-right py-3 text-sm font-medium text-gray-500 dark:text-gray-400">Daily Rate</th>
                        <th className="text-right py-3 text-sm font-medium text-gray-500 dark:text-gray-400">Annual Rate (APR)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { asset: 'USDT', hourly: 0.000417, daily: 0.01, annual: 3.65 },
                        { asset: 'BTC', hourly: 0.000208, daily: 0.005, annual: 1.825 },
                        { asset: 'ETH', hourly: 0.000208, daily: 0.005, annual: 1.825 },
                        { asset: 'USDC', hourly: 0.000417, daily: 0.01, annual: 3.65 },
                      ].map((row) => (
                        <tr key={row.asset} className="border-b border-gray-50 dark:border-gray-800/50">
                          <td className="py-4 font-medium text-gray-900 dark:text-white">{row.asset}</td>
                          <td className="py-4 text-right text-gray-600 dark:text-gray-300">{row.hourly.toFixed(6)}%</td>
                          <td className="py-4 text-right text-gray-600 dark:text-gray-300">{row.daily.toFixed(4)}%</td>
                          <td className="py-4 text-right text-gray-600 dark:text-gray-300">{row.annual.toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-xs text-gray-400 mt-4">
                  * Interest rates are subject to change based on market conditions. Higher VIP levels receive preferential rates.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Enjoy Even Lower Fees Section */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Enjoy Even Lower Fees</h2>
            <HelpCircle className="w-5 h-5 text-gray-400" />
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Meet any of the following requirements to level up to{' '}
            <span className="text-blue-600 dark:text-blue-400 font-medium">VIP 1</span> and enjoy lower fee rates.
          </p>
        </div>

        {/* VIP Requirements Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {vipRequirements.map((req, index) => (
            <div key={req.id} className="relative">
              <div className="bg-white dark:bg-[#181a20] rounded-2xl border border-gray-100 dark:border-gray-800 p-6 h-full">
                <div className="flex items-start justify-between mb-4">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white pr-6">{req.title}</h3>
                  {req.helpText && (
                    <div className="group relative">
                      <HelpCircle className="w-4 h-4 text-gray-400 cursor-help" />
                      <div className="hidden group-hover:block absolute right-0 top-6 w-48 p-2 bg-gray-900 text-white text-xs rounded-lg z-10">
                        {req.helpText}
                      </div>
                    </div>
                  )}
                </div>

                <p className="text-lg text-gray-500 dark:text-gray-400 mb-2">
                  {formatNumber(req.current)}/{formatNumber(req.required)} {req.unit}
                </p>

                <ProgressBar current={req.current} required={req.required} />

                <Link
                  href={req.link}
                  className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-sm font-medium mt-4"
                >
                  {req.linkText} <ChevronRight className="w-4 h-4" />
                </Link>
              </div>

              {/* OR Badge */}
              {index < vipRequirements.length - 1 && (
                <div className="hidden md:flex absolute -right-2 top-1/2 -translate-y-1/2 z-10">
                  <span className="px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs font-medium rounded">
                    OR
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-800 pt-8">
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-gray-500 dark:text-gray-400">
            <Link href="/markets" className="hover:text-gray-900 dark:hover:text-white">
              Market Overview
            </Link>
            <Link href="/trading-fee" className="hover:text-gray-900 dark:hover:text-white">
              Trading Fee
            </Link>
            <Link href="/api" className="hover:text-gray-900 dark:hover:text-white">
              API
            </Link>
            <Link href="/help" className="hover:text-gray-900 dark:hover:text-white">
              Help Center
            </Link>
            <span>© 2024 Methereum</span>
          </div>
        </div>
      </div>
    </div>
  );
}
