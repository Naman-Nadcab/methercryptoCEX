'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import {
  Info,
  Calendar,
  ChevronDown,
  Gift,
  HelpCircle,
  FileText,
  Loader2,
} from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';

type SignupTab = 'signups' | 'fiat' | 'card' | 'earn';
type HistoryTab = 'commission' | 'task' | 'lucky';
type SpotTab = 'spot';

interface ReferralRow {
  status: string;
  total_commission_earned: string;
  created_at: string;
  username: string | null;
  email: string;
}

interface CommissionRow {
  commission_amount: string;
  commission_currency: string;
  source_type: string;
  created_at: string;
}

interface ReferralData {
  referralCode: { code: string; current_referrals: number; total_earnings: string; referrer_commission_rate: string } | null;
  referrals: ReferralRow[];
  recentCommissions: CommissionRow[];
}

export default function MyReferralsPage() {
  const { accessToken, _hasHydrated } = useAuthStore();
  const [signupTab, setSignupTab] = useState<SignupTab>('signups');
  const [historyTab, setHistoryTab] = useState<HistoryTab>('commission');
  const [spotTab, setSpotTab] = useState<SpotTab>('spot');
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!_hasHydrated || !accessToken) return;
    setFetchError(null);
    const apiUrl = getApiBaseUrl();
    fetch(`${apiUrl}/api/v1/user/referrals`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => r.json())
      .then((res) => {
        if (res.success && res.data) setData(res.data);
        else setFetchError(res.error?.message || 'Failed to load referral data');
      })
      .catch((err) => {
        console.error(err);
        setFetchError('Network error. Please try again.');
      })
      .finally(() => setLoading(false));
  }, [accessToken, _hasHydrated]);

  const refCode = data?.referralCode;
  const referrals = data?.referrals ?? [];
  const recentCommissions = data?.recentCommissions ?? [];
  const totalEarnings = refCode ? parseFloat(refCode.total_earnings || '0') : 0;
  const commissionRate = refCode ? parseFloat(refCode.referrer_commission_rate || '0.2') * 100 : 20;
  const qualifiedCount = referrals.filter((r) => r.status === 'active').length;

  const signupTabs: { id: SignupTab; label: string }[] = [
    { id: 'signups', label: 'Signups' },
    { id: 'fiat', label: 'Fiat' },
    { id: 'card', label: 'Card' },
    { id: 'earn', label: 'Earn' },
  ];

  const historyTabs: { id: HistoryTab; label: string }[] = [
    { id: 'commission', label: 'Commission History' },
    { id: 'task', label: 'Task Rewards History' },
    { id: 'lucky', label: 'Lucky Draw Prizes' },
  ];
  const spotTabs: { id: SpotTab; label: string }[] = [{ id: 'spot', label: 'Spot' }];
  const content = (
    <div>
      <div className="max-w-5xl mx-auto px-4 lg:px-8 py-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm mb-6">
          <Link href="/dashboard/referral" className="text-muted-foreground hover:text-gray-900 dark:hover:text-white">
            Referral Program
          </Link>
          <span className="text-gray-400 dark:text-gray-600">{'\u003e'}</span>
          <span className="text-primary">My Referrals</span>
        </div>

        {/* Overview */}
        <h2 className="text-xl font-semibold text-foreground mb-4">Overview</h2>
        
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : fetchError ? (
          <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-4 mb-6">
            <p className="text-amber-800 dark:text-amber-200">{fetchError}</p>
            <button onClick={() => window.location.reload()} className="mt-2 text-sm text-primary hover:underline">Retry</button>
          </div>
        ) : (
        <div>
        {/* Overview Card */}
        <div className="bg-card rounded-xl p-5 mb-6 border border-gray-200 dark:border-transparent">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-1 text-muted-foreground text-sm mb-2">
                <span>Total Commissions</span>
                <Info className="w-4 h-4" />
              </div>
              <p className="text-3xl font-bold text-foreground">{Number.isFinite(totalEarnings) ? totalEarnings.toFixed(2) : '0.00'} <span className="text-sm text-muted-foreground">USDT</span></p>
            </div>
            <div className="flex items-center gap-8 mt-4 lg:mt-0">
              <div className="text-center">
                <p className="text-muted-foreground text-sm mb-1">Sign Up</p>
                <p className="text-foreground font-semibold">{referrals.length}</p>
              </div>
              <div className="text-center">
                <p className="text-muted-foreground text-sm mb-1">Fiat Deposit</p>
                <p className="text-foreground font-semibold">—</p>
              </div>
              <div className="text-center">
                <p className="text-muted-foreground text-sm mb-1">Card</p>
                <p className="text-foreground font-semibold">—</p>
              </div>
              <div className="text-center">
                <p className="text-muted-foreground text-sm mb-1">Earn</p>
                <p className="text-foreground font-semibold">—</p>
              </div>
            </div>
          </div>
        </div>

        {/* Signup Tabs */}
        <div className="flex gap-6 mb-6">
          {signupTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSignupTab(tab.id)}
              className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
                signupTab === tab.id
                  ? 'text-foreground border-blue-500'
                  : 'text-muted-foreground border-transparent hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content - Signups */}
        {signupTab === 'signups' && (
          <>
            {/* Commission Rate Card */}
            <div className="bg-card rounded-xl p-5 mb-4 border border-gray-200 dark:border-transparent">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-1 text-muted-foreground text-sm mb-2">
                    <span>My Commission Rate</span>
                    <Info className="w-4 h-4" />
                  </div>
                  <p className="text-3xl font-bold text-primary">{Math.round(commissionRate)}%</p>
                  <div className="flex items-center gap-1 text-muted-foreground text-sm mt-3">
                    <span>Total Commission</span>
                    <Info className="w-4 h-4" />
                  </div>
                  <p className="text-xl font-semibold text-foreground">{Number.isFinite(totalEarnings) ? totalEarnings.toFixed(2) : '0.00'} <span className="text-sm text-muted-foreground">USDT</span></p>
                </div>
                <div className="mt-4 lg:mt-0">
                  <p className="text-muted-foreground text-sm mb-2">Withdrawable Balance</p>
                  <div className="flex items-center gap-3">
                    <p className="text-xl font-semibold text-foreground">{Number.isFinite(totalEarnings) ? totalEarnings.toFixed(2) : '0.00'} <span className="text-sm text-muted-foreground">USDT</span></p>
                    <button className="px-4 py-1.5 bg-transparent border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-white text-sm rounded-lg hover:bg-accent transition-colors">
                      Withdraw
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Bonus Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              {/* Total Bonus */}
              <div className="bg-card rounded-xl p-5 flex items-center justify-between border border-gray-200 dark:border-transparent">
                <div>
                  <p className="text-muted-foreground text-sm mb-2">Total Bonus</p>
                  <p className="text-2xl font-bold text-foreground">{Number.isFinite(totalEarnings) ? totalEarnings.toFixed(2) : '0.00'} <span className="text-sm text-muted-foreground">USDT</span></p>
                </div>
                <div className="text-4xl">🎁</div>
              </div>

              {/* Mystery Box */}
              <div className="bg-card rounded-xl p-5 flex items-center justify-between border border-gray-200 dark:border-transparent">
                <div>
                  <p className="text-muted-foreground text-sm mb-2">Mystery Box</p>
                  <div className="flex items-center gap-2">
                    <p className="text-2xl font-bold text-foreground">0</p>
                    <span className="px-2 py-1 bg-blue-500/20 text-primary text-xs rounded">Earned rewards</span>
                  </div>
                </div>
                <div className="text-4xl">📦</div>
              </div>
            </div>

            {/* Rewards History */}
            <h2 className="text-xl font-semibold text-foreground mb-4">Rewards History</h2>
            
            {/* History Tabs */}
            <div className="flex flex-wrap gap-2 mb-4">
              {historyTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setHistoryTab(tab.id)}
                  className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                    historyTab === tab.id
                      ? 'bg-accent text-foreground'
                      : 'bg-gray-100 dark:bg-card text-muted-foreground hover:text-gray-700 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Spot Tabs */}
            <div className="flex flex-wrap gap-4 mb-4 border-b border-border pb-2">
              {spotTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setSpotTab(tab.id)}
                  className={`text-sm pb-2 transition-colors ${
                    spotTab === tab.id
                      ? 'text-foreground border-b-2 border-gray-900 dark:border-white -mb-[10px]'
                      : 'text-muted-foreground hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Date Range Filter */}
            <div className="flex items-center gap-2 mb-6">
              <div className="flex items-center bg-gray-100 dark:bg-card rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <span>2026-01-01</span>
                <span className="mx-2 text-muted-foreground">~</span>
                <span>2026-01-30</span>
                <Calendar className="w-4 h-4 ml-2 text-gray-400" />
              </div>
            </div>

            {/* Empty State */}
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 mb-4 text-5xl">📄</div>
              <p className="text-muted-foreground mb-4">No records found.</p>
              <Link 
                href="/dashboard/referral"
                className="px-6 py-2 border border-blue-500 text-primary rounded-full hover:bg-blue-500/10 transition-colors"
              >
                Invite Friends
              </Link>
            </div>
          </>
        )}

        {/* Tab Content - Fiat */}
        {signupTab === 'fiat' && (
          <>
            {/* Fiat Stats Card */}
            <div className="bg-card rounded-xl p-5 mb-8 border border-gray-200 dark:border-transparent">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <p className="text-muted-foreground text-sm mb-2">Total Rewards</p>
                  <p className="text-2xl font-bold text-foreground">0 <span className="text-sm text-muted-foreground">USDT</span></p>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-muted-foreground text-sm mb-2">
                    <span>Tasks Completed by Friends</span>
                    <Info className="w-4 h-4" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">0</p>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-muted-foreground text-sm mb-2">
                    <span>Tasks Claimed by Friends</span>
                    <Info className="w-4 h-4" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">0</p>
                </div>
              </div>
            </div>

            {/* Rewards History */}
            <h2 className="text-xl font-semibold text-foreground mb-4">Rewards History</h2>

            {/* Empty State */}
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-20 h-20 mb-4 flex items-center justify-center">
                <div className="text-6xl">📋</div>
              </div>
              <p className="text-muted-foreground mb-4">No records found.</p>
              <Link 
                href="/dashboard/referral"
                className="px-6 py-2 border border-blue-500 text-primary rounded-full hover:bg-blue-500/10 transition-colors"
              >
                Invite Friends
              </Link>
            </div>
          </>
        )}

        {/* Tab Content - Card */}
        {signupTab === 'card' && (
          <>
            {/* Card Stats */}
            <div className="bg-card rounded-xl p-5 mb-8 border border-gray-200 dark:border-transparent">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="text-muted-foreground text-sm mb-2">Commissions</p>
                  <p className="text-2xl font-bold text-foreground">0 <span className="text-sm text-muted-foreground">USDT</span></p>
                </div>
                <div>
                  <p className="text-muted-foreground text-sm mb-2">Total Applications</p>
                  <p className="text-2xl font-bold text-foreground">0</p>
                </div>
              </div>
            </div>

            {/* Empty State */}
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-20 h-20 mb-4 flex items-center justify-center">
                <div className="text-6xl">📋</div>
              </div>
              <p className="text-muted-foreground mb-4">No records found.</p>
              <Link 
                href="/dashboard/referral"
                className="px-6 py-2 border border-blue-500 text-primary rounded-full hover:bg-blue-500/10 transition-colors"
              >
                Invite Friends
              </Link>
            </div>
          </>
        )}

        {/* Tab Content - Earn */}
        {signupTab === 'earn' && (
          <>
            {/* Earn Stats Card */}
            <div className="bg-card rounded-xl p-5 mb-8 border border-gray-200 dark:border-transparent">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="text-muted-foreground text-sm mb-2">Total Rewards</p>
                  <p className="text-2xl font-bold text-foreground">0 <span className="text-sm text-muted-foreground">USDT</span></p>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-muted-foreground text-sm mb-2">
                    <span>Tasks Completed by Friends</span>
                    <Info className="w-4 h-4" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">0</p>
                </div>
              </div>
            </div>

            {/* Rewards History */}
            <h2 className="text-xl font-semibold text-foreground mb-4">Rewards History</h2>

            {/* Empty State */}
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-20 h-20 mb-4 flex items-center justify-center">
                <div className="text-6xl">📋</div>
              </div>
              <p className="text-muted-foreground mb-4">No records found.</p>
              <Link 
                href="/dashboard/referral"
                className="px-6 py-2 border border-blue-500 text-primary rounded-full hover:bg-blue-500/10 transition-colors"
              >
                Invite Friends
              </Link>
            </div>
          </>
        )}

        {/* Referral History */}
        <h2 className="text-xl font-semibold text-foreground mb-4 mt-8">Referral History</h2>
        
        {/* Stats Card */}
        <div className="bg-card rounded-xl p-5 mb-4 border border-gray-200 dark:border-transparent">
          <div className="flex items-center gap-12">
            <div>
              <p className="text-muted-foreground text-sm mb-2">Total Friends</p>
              <p className="text-3xl font-bold text-foreground">{referrals.length}</p>
            </div>
            <div>
              <div className="flex items-center gap-1 text-muted-foreground text-sm mb-2">
                <span>Qualified Friends</span>
                <Info className="w-4 h-4" />
              </div>
              <p className="text-3xl font-bold text-foreground">{qualifiedCount}</p>
            </div>
          </div>
        </div>

        {/* Referrals table or empty */}
        {referrals.length > 0 ? (
          <div className="bg-card rounded-xl border border-gray-200 dark:border-transparent overflow-hidden mb-8">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase">Email</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase">Username</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase">Status</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase">Commission earned</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase">Joined</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="px-6 py-3 text-foreground">{r.email}</td>
                    <td className="px-6 py-3 text-muted-foreground">{r.username || '—'}</td>
                    <td className="px-6 py-3">
                      <span className={`text-xs px-2 py-1 rounded ${r.status === 'active' ? 'bg-green-500/20 text-green-500' : 'bg-amber-500/20 text-amber-500'}`}>{r.status}</span>
                    </td>
                    <td className="px-6 py-3 text-buy">${(Number(r.total_commission_earned) || 0).toFixed(2)}</td>
                    <td className="px-6 py-3 text-gray-500 text-sm">{new Date(r.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 mb-4 text-5xl">📄</div>
            <p className="text-muted-foreground mb-4">No referrals yet.</p>
            <Link href="/dashboard/referral" className="px-6 py-2 border border-blue-500 text-primary rounded-full hover:bg-blue-500/10 transition-colors">Invite Friends</Link>
          </div>
        )}

        {/* Commission History (when tab is commission) */}
        {historyTab === 'commission' && recentCommissions.length > 0 && (
          <div className="mt-6">
            <h3 className="text-lg font-semibold text-foreground mb-3">Recent commission history</h3>
            <div className="bg-card rounded-xl border border-gray-200 dark:border-transparent overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase">Source</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase">Amount</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-muted-foreground uppercase">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCommissions.map((c, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="px-6 py-3 text-foreground">{c.source_type}</td>
                      <td className="px-6 py-3 text-buy">{c.commission_amount} {c.commission_currency}</td>
                      <td className="px-6 py-3 text-gray-500 text-sm">{new Date(c.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </div>
        )}
      </div>

      {/* Help Button */}
      <button className="fixed bottom-6 right-6 w-12 h-12 bg-primary hover:bg-primary/85 text-white rounded-full shadow-lg flex items-center justify-center transition-colors z-40">
        <HelpCircle className="w-6 h-6" />
      </button>

      {/* Footer */}
      <footer className="bg-white dark:bg-background border-t border-border py-12 px-4 lg:px-8 mt-8">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-8">
            {/* Logo and Social */}
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold">M</span>
                </div>
                <span className="text-xl font-bold text-foreground">Methereum</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {['f', 'x', 'ig', 'yt', 'in', 'tg', 'tk', 'rd', 'dc'].map((social, i) => (
                  <div
                    key={i}
                    className="w-8 h-8 bg-accent rounded-full flex items-center justify-center cursor-pointer hover:bg-accent"
                  >
                    <span className="text-xs text-muted-foreground">●</span>
                  </div>
                ))}
              </div>
            </div>

            {/* About */}
            <div>
              <h4 className="font-semibold mb-3 text-foreground">About</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">About Methereum</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Meet Mantle</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Press Room</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Communities</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Announcements</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Risk Disclosure</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Whistleblower Channel</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Careers</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Islamic Account</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Fees & Transactions Overview</li>
              </ul>
            </div>

            {/* Services */}
            <div>
              <h4 className="font-semibold mb-3 text-foreground">Services</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">One-Click Buy</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">P2P Trading (0 Fees)</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">VIP Program</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Referral Program</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Institutional Services</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Listing Application</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Tax API</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Audit</li>
              </ul>
            </div>

            {/* Support */}
            <div>
              <h4 className="font-semibold mb-3 text-foreground">Support</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Submit a Request</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Help Center</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Support Hub</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">User Feedback</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Methereum Learn</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Trading Fee</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">API</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Authenticity Check</li>
              </ul>
            </div>

            {/* Products */}
            <div>
              <h4 className="font-semibold mb-3 text-foreground">Products</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Trade</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">P2P</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Earn</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Launchpad</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Methereum Card</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">TradingView</li>
              </ul>
            </div>
          </div>

          {/* Copyright */}
          <div className="pt-6 border-t border-border flex flex-wrap items-center justify-center gap-4 text-sm text-gray-500">
            <span>© 2018-2026 Methereum.com. All rights reserved.</span>
            <Link href="/terms" className="hover:text-gray-900 dark:hover:text-white">Terms of Service</Link>
            <Link href="/privacy" className="hover:text-gray-900 dark:hover:text-white">Privacy Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
  return content;
}
