'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import {
  Copy,
  Check,
  Share2,
  Users,
  Gift,
  ArrowRight,
  Coins,
  CreditCard,
  TrendingUp,
  Link2,
  MessageCircle,
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  Mail,
  MoreHorizontal,
  Trophy,
  Sparkles,
  Star,
  Zap,
  Loader2,
} from 'lucide-react';

type ActiveCard = 'earnings' | 'commissions';

interface ReferralStats {
  referralCode: string;
  totalReferrals: number;
  totalEarnings: number;
  pendingEarnings: number;
  commissionRate: number;
}

export default function ReferralProgramPage() {
  const { user, accessToken, _hasHydrated } = useAuthStore();
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [activeCard, setActiveCard] = useState<ActiveCard>('earnings');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [modalCopiedCode, setModalCopiedCode] = useState(false);
  const [modalCopiedLink, setModalCopiedLink] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
  const appOrigin = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');

  // Fetch referral data from user referrals API (same data admin can monitor)
  useEffect(() => {
    const fetchReferralData = async () => {
      if (!_hasHydrated || !accessToken) return;
      setFetchError(null);
      try {
        const response = await fetch(`${apiUrl}/api/v1/user/referrals`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const result = await response.json();
        
        if (result.success && result.data) {
          const refCode = result.data.referralCode;
          const code = refCode?.code || user?.id?.slice(0, 8).toUpperCase() || '';
          const totalEarnings = refCode ? parseFloat(refCode.total_earnings || '0') : 0;
          const commissionRate = refCode ? parseFloat(refCode.referrer_commission_rate || '0.2') * 100 : 20;
          setStats({
            referralCode: code,
            totalReferrals: refCode?.current_referrals ?? result.data.referrals?.length ?? 0,
            totalEarnings,
            pendingEarnings: 0,
            commissionRate,
          });
        } else {
          setFetchError(result.error?.message || 'Failed to load referral data');
        }
      } catch (error) {
        console.error('Failed to fetch referral data:', error);
        setFetchError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    
    fetchReferralData();
  }, [accessToken, _hasHydrated, user?.id]);

  const referralCode = stats?.referralCode || user?.id?.slice(0, 8).toUpperCase() || 'LOADING...';
  const referralLink = `${appOrigin}/signup?ref=${referralCode}`;

  const customText = `Sign up for a Methereum account and claim exclusive rewards from the Methereum referral program! Plus, claim up to 6,135 USDT bonus at ${referralLink}`;

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const halfWidth = rect.width / 2;
    
    if (mouseX < halfWidth && activeCard !== 'earnings') {
      setActiveCard('earnings');
    } else if (mouseX >= halfWidth && activeCard !== 'commissions') {
      setActiveCard('commissions');
    }
  };

  const copyModalCode = () => {
    navigator.clipboard.writeText(referralCode);
    setModalCopiedCode(true);
    setTimeout(() => setModalCopiedCode(false), 2000);
  };

  const copyModalLink = () => {
    navigator.clipboard.writeText(referralLink);
    setModalCopiedLink(true);
    setTimeout(() => setModalCopiedLink(false), 2000);
  };

  const nextSlide = () => setCurrentSlide((prev) => (prev + 1) % 4);
  const prevSlide = () => setCurrentSlide((prev) => (prev - 1 + 4) % 4);

  const shareTitle = 'Join Methereum and earn crypto rewards!';
  const shareText = `Sign up for a Methereum account and claim exclusive rewards from the Methereum referral program! Plus, claim up to 6,135 USDT bonus at ${referralLink}`;

  const saveImage = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      const gradient = ctx.createLinearGradient(0, 0, 800, 1000);
      gradient.addColorStop(0, '#1e3a8a');
      gradient.addColorStop(1, '#1e40af');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 800, 1000);
      
      ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
      ctx.beginPath();
      ctx.arc(650, 150, 150, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
      ctx.beginPath();
      ctx.arc(150, 700, 120, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = '#3b82f6';
      ctx.beginPath();
      ctx.roundRect(50, 50, 50, 50, 10);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 30px Arial';
      ctx.fillText('M', 63, 88);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px Arial';
      ctx.fillText('Methereum', 115, 85);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 32px Arial';
      ctx.fillText('Join & Earn Rewards!', 50, 180);
      
      ctx.fillStyle = '#93c5fd';
      ctx.font = '18px Arial';
      ctx.fillText('New users can receive sign up rewards,', 50, 230);
      ctx.fillText('up to 6,135 USDT.', 50, 260);
      
      ctx.font = '120px Arial';
      ctx.fillText('🏆', 300, 500);
      
      ctx.fillStyle = 'rgba(30, 58, 138, 0.8)';
      ctx.beginPath();
      ctx.roundRect(50, 750, 700, 200, 15);
      ctx.fill();
      
      ctx.fillStyle = '#93c5fd';
      ctx.font = '16px Arial';
      ctx.fillText('Scan QR code and join me at Methereum!', 70, 800);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px Arial';
      ctx.fillText(`Referral Code: ${referralCode}`, 70, 840);
      
      ctx.fillStyle = '#93c5fd';
      ctx.font = '14px Arial';
      ctx.fillText(referralLink, 70, 880);
      
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(620, 770, 110, 110, 10);
      ctx.fill();
      
      const link = document.createElement('a');
      link.download = `methereum-referral-${referralCode}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
  };

  const shareViaEmail = () => {
    const subject = encodeURIComponent(shareTitle);
    const body = encodeURIComponent(shareText);
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
  };

  const shareViaTwitter = () => {
    const text = encodeURIComponent(shareText);
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank', 'width=600,height=400');
  };

  const shareViaTelegram = () => {
    const text = encodeURIComponent(shareText);
    window.open(`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${text}`, '_blank', 'width=600,height=400');
  };

  const shareViaFacebook = () => {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(referralLink)}`, '_blank', 'width=600,height=400');
  };

  const shareViaWhatsApp = () => {
    const text = encodeURIComponent(shareText);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const shareViaLinkedIn = () => {
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(referralLink)}`, '_blank', 'width=600,height=400');
  };

  const shareViaLine = () => {
    const text = encodeURIComponent(shareText);
    window.open(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(referralLink)}&text=${text}`, '_blank', 'width=600,height=400');
  };

  const shareViaMore = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, text: shareText, url: referralLink });
      } catch (err) {
        console.log('Share cancelled');
      }
    } else {
      navigator.clipboard.writeText(shareText);
      alert('Link copied to clipboard!');
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(referralCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0b0e11]">
      {/* Hero Section */}
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-600 via-blue-700 to-blue-800 dark:from-blue-900 dark:via-blue-800 dark:to-blue-900 text-white">
        {/* Background Pattern */}
        <div className="absolute inset-0">
          <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-72 h-72 bg-blue-400/20 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-500/10 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-6xl mx-auto px-4 lg:px-8 py-12 lg:py-16">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
            <div className="lg:max-w-xl">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full mb-6">
                <Sparkles className="w-4 h-4 text-yellow-400" />
                <span className="text-sm font-medium">Referral Program</span>
              </div>
              
              <h1 className="text-3xl lg:text-5xl font-bold mb-4 leading-tight">
                Invite Friends & Earn
                <span className="block text-yellow-400 mt-2">Up to 1,720 USDT</span>
              </h1>
              
              <p className="text-blue-100 text-lg mb-8">
                Plus earn <span className="font-bold text-white">30% commission</span> on every trade your friends make!
              </p>

              <div className="flex flex-wrap gap-4">
                <button
                  onClick={() => setShowInviteModal(true)}
                  className="px-8 py-4 bg-white text-blue-700 font-semibold rounded-xl hover:bg-blue-50 transition-all shadow-lg shadow-blue-900/30 flex items-center gap-2"
                >
                  <Share2 className="w-5 h-5" />
                  Invite Friends
                </button>
                <Link
                  href="/dashboard/referral/my-referrals"
                  className="px-8 py-4 bg-white/10 backdrop-blur-sm text-white font-semibold rounded-xl hover:bg-white/20 transition-all flex items-center gap-2 border border-white/20"
                >
                  <Users className="w-5 h-5" />
                  My Referrals
                </Link>
              </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 gap-4 lg:w-[400px]">
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
                <div className="w-12 h-12 bg-yellow-500/20 rounded-xl flex items-center justify-center mb-3">
                  <Trophy className="w-6 h-6 text-yellow-400" />
                </div>
                <p className="text-3xl font-bold">${stats ? Math.max(0, stats.totalEarnings).toFixed(0) : '0'}</p>
                <p className="text-blue-200 text-sm">Your Earnings</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
                <div className="w-12 h-12 bg-green-500/20 rounded-xl flex items-center justify-center mb-3">
                  <TrendingUp className="w-6 h-6 text-green-400" />
                </div>
                <p className="text-3xl font-bold">{stats ? Math.round(stats.commissionRate) : 20}%</p>
                <p className="text-blue-200 text-sm">Commission Rate</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
                <div className="w-12 h-12 bg-purple-500/20 rounded-xl flex items-center justify-center mb-3">
                  <Users className="w-6 h-6 text-purple-400" />
                </div>
                <p className="text-3xl font-bold">{stats?.totalReferrals ?? 0}</p>
                <p className="text-blue-200 text-sm">Your Referrals</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
                <div className="w-12 h-12 bg-blue-400/20 rounded-xl flex items-center justify-center mb-3">
                  <Coins className="w-6 h-6 text-blue-300" />
                </div>
                <p className="text-3xl font-bold">$1,720</p>
                <p className="text-blue-200 text-sm">Max Possible</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 lg:px-8 py-12">
        {fetchError && (
          <div className="mb-6 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 flex items-center justify-between">
            <p className="text-amber-800 dark:text-amber-200 text-sm">{fetchError}</p>
            <button onClick={() => window.location.reload()} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Retry</button>
          </div>
        )}
        {/* How to get rewards */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">How to Get Rewards</h2>
              <p className="text-gray-500 dark:text-gray-400 mt-1">Earn more by completing different tasks</p>
            </div>
          </div>

          {/* Cards */}
          <div 
            ref={containerRef}
            onMouseMove={handleMouseMove}
            className="flex gap-6 mb-8"
          >
            {/* Your Earnings Card */}
            <div 
              className={`bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl p-6 text-white cursor-pointer overflow-hidden shadow-xl shadow-blue-500/20
                transition-all duration-500 ease-in-out
                ${activeCard === 'earnings' ? 'flex-[2]' : 'flex-1'}`}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <Gift className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-semibold">Your Earnings</p>
                  <p className="text-blue-200 text-sm">Per referred user</p>
                </div>
              </div>
              
              <p className="text-4xl font-bold mb-2">$1,002</p>
              <p className="text-blue-200 text-sm mb-4">Maximum earnings when referee completes all tasks</p>
              
              {/* Expanded Content */}
              <div className={`transition-all duration-500 ease-in-out overflow-hidden
                ${activeCard === 'earnings' ? 'opacity-100 max-h-48 mt-4' : 'opacity-0 max-h-0 mt-0'}`}>
                <div className="grid grid-cols-4 gap-4 bg-white/10 rounded-xl p-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold">$10</p>
                    <p className="text-xs text-blue-200">First Referral</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold">$7</p>
                    <p className="text-xs text-blue-200">Per Signup</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold">$15</p>
                    <p className="text-xs text-blue-200">On Trading</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold">$970</p>
                    <p className="text-xs text-blue-200">Mystery Box</p>
                  </div>
                </div>
              </div>
              
              <button className="mt-4 text-sm text-blue-200 hover:text-white flex items-center gap-1">
                Learn more <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Tiered Commissions Card */}
            <div 
              className={`bg-white dark:bg-[#181a20] rounded-2xl p-6 border border-gray-100 dark:border-gray-800 cursor-pointer overflow-hidden shadow-lg
                transition-all duration-500 ease-in-out
                ${activeCard === 'commissions' ? 'flex-[2]' : 'flex-1'}`}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white">Tiered Commissions</p>
                  <p className="text-gray-500 text-sm">More referrals = Higher rate</p>
                </div>
              </div>
              
              <p className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Up to 30%</p>
              <p className="text-gray-500 text-sm mb-4">Commission on trading fees</p>
              
              {/* Chart */}
              <div className={`flex items-end justify-center transition-all duration-500 ease-in-out
                ${activeCard === 'commissions' ? 'gap-8 h-32' : 'gap-4 h-20'}`}>
                <div className="flex flex-col items-center">
                  <div className={`bg-gray-200 dark:bg-gray-700 rounded-t-lg transition-all duration-500 ease-in-out
                    ${activeCard === 'commissions' ? 'w-16 h-[60px]' : 'w-10 h-[40px]'}`} />
                  <span className="text-xs text-gray-500 mt-2 font-medium">20%</span>
                </div>
                <div className="flex flex-col items-center">
                  <div className={`bg-gray-300 dark:bg-gray-600 rounded-t-lg transition-all duration-500 ease-in-out
                    ${activeCard === 'commissions' ? 'w-16 h-[80px]' : 'w-10 h-[55px]'}`} />
                  <span className="text-xs text-gray-500 mt-2 font-medium">25%</span>
                </div>
                <div className="flex flex-col items-center">
                  <div className={`bg-blue-500 rounded-t-lg transition-all duration-500 ease-in-out
                    ${activeCard === 'commissions' ? 'w-16 h-[100px]' : 'w-10 h-[70px]'}`} />
                  <span className="text-xs text-blue-500 mt-2 font-semibold">30%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Invite More, Earn More */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Invite More, Earn More</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Card 1 */}
            <div className="bg-white dark:bg-[#181a20] rounded-2xl p-6 border border-gray-100 dark:border-gray-800 hover:shadow-xl transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <span className="text-xs font-medium text-blue-500 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded">Up to</span>
                  <p className="text-4xl font-bold text-gray-900 dark:text-white mt-2">$3</p>
                  <p className="text-gray-500 text-sm">Per Referred User</p>
                </div>
                <div className="w-16 h-16 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-2xl flex items-center justify-center shadow-lg shadow-yellow-500/30">
                  <Coins className="w-8 h-8 text-white" />
                </div>
              </div>
              <p className="text-gray-600 dark:text-gray-400">Invite a friend to Methereum Earn</p>
            </div>

            {/* Card 2 */}
            <div className="bg-white dark:bg-[#181a20] rounded-2xl p-6 border border-gray-100 dark:border-gray-800 hover:shadow-xl transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <span className="text-xs font-medium text-blue-500 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded">Up to</span>
                  <p className="text-4xl font-bold text-gray-900 dark:text-white mt-2">$20</p>
                  <p className="text-gray-500 text-sm">Per Referred User</p>
                </div>
                <div className="w-16 h-16 bg-gradient-to-br from-gray-600 to-gray-800 rounded-2xl flex items-center justify-center shadow-lg shadow-gray-500/30">
                  <CreditCard className="w-8 h-8 text-white" />
                </div>
              </div>
              <p className="text-gray-600 dark:text-gray-400">Refer a friend to Methereum Card</p>
            </div>

            {/* Card 3 */}
            <div className="bg-white dark:bg-[#181a20] rounded-2xl p-6 border border-gray-100 dark:border-gray-800 hover:shadow-xl transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <span className="text-xs font-medium text-blue-500 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded">Up to</span>
                  <p className="text-4xl font-bold text-gray-900 dark:text-white mt-2">$665</p>
                  <p className="text-gray-500 text-sm">Per Referred User</p>
                </div>
                <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                  <TrendingUp className="w-8 h-8 text-white" />
                </div>
              </div>
              <p className="text-gray-600 dark:text-gray-400">Refer a friend to Copy Trading</p>
            </div>
          </div>
        </div>

        {/* How to Invite */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">How to Invite</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                <Share2 className="w-10 h-10 text-white" />
              </div>
              <h3 className="font-bold text-gray-900 dark:text-white mb-2">Share Your Code</h3>
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                Share your unique referral code and link with friends via social media or direct message.
              </p>
            </div>

            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-500/30">
                <MessageCircle className="w-10 h-10 text-white" />
              </div>
              <h3 className="font-bold text-gray-900 dark:text-white mb-2">Friends Sign Up</h3>
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                Your friends sign up using your referral code and become linked to your account.
              </p>
            </div>

            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl flex items-center justify-center shadow-lg shadow-green-500/30">
                <Gift className="w-10 h-10 text-white" />
              </div>
              <h3 className="font-bold text-gray-900 dark:text-white mb-2">Earn Rewards</h3>
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                Get bonuses and commissions when your friends trade, apply for cards, or use copy trading.
              </p>
            </div>
          </div>
        </div>

        {/* Referral Code Section */}
        <div className="bg-white dark:bg-[#181a20] rounded-2xl p-8 border border-gray-100 dark:border-gray-800 mb-12">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Your Referral Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                My Referral Code
              </label>
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-gray-50 dark:bg-[#1e2329] border border-gray-200 dark:border-gray-700 rounded-xl px-5 py-4">
                  <span className="text-xl font-bold text-gray-900 dark:text-white font-mono">{referralCode}</span>
                </div>
                <button
                  onClick={copyCode}
                  className={`p-4 rounded-xl transition-all ${
                    copiedCode 
                      ? 'bg-green-500 text-white' 
                      : 'bg-blue-500 hover:bg-blue-600 text-white'
                  }`}
                >
                  {copiedCode ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
                My Referral Link
              </label>
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-gray-50 dark:bg-[#1e2329] border border-gray-200 dark:border-gray-700 rounded-xl px-5 py-4 overflow-hidden">
                  <span className="text-sm text-gray-600 dark:text-gray-300 truncate block">{referralLink}</span>
                </div>
                <button
                  onClick={copyLink}
                  className={`p-4 rounded-xl transition-all ${
                    copiedLink 
                      ? 'bg-green-500 text-white' 
                      : 'bg-blue-500 hover:bg-blue-600 text-white'
                  }`}
                >
                  {copiedLink ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* CTA Banner */}
        <div className="relative overflow-hidden bg-gradient-to-r from-blue-600 to-blue-800 rounded-2xl p-8 text-center mb-12">
          <div className="absolute inset-0">
            <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/20 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-blue-400/20 rounded-full blur-3xl" />
          </div>
          <div className="relative">
            <h3 className="text-2xl lg:text-3xl font-bold text-white mb-4">
              Become an Affiliate Partner
            </h3>
            <p className="text-blue-100 mb-6 max-w-2xl mx-auto">
              Unlock up to 50% commission rates with our Affiliates Program. Perfect for influencers and content creators.
            </p>
            <button className="px-8 py-4 bg-white text-blue-700 font-semibold rounded-xl hover:bg-blue-50 transition-all shadow-lg">
              Apply Now <ArrowRight className="w-5 h-5 inline ml-2" />
            </button>
          </div>
        </div>

        {/* Terms */}
        <div className="bg-gray-50 dark:bg-[#181a20] rounded-2xl p-6 border border-gray-100 dark:border-gray-800">
          <h3 className="font-bold text-gray-900 dark:text-white mb-4">Terms & Conditions</h3>
          <div className="text-sm text-gray-500 dark:text-gray-400 space-y-2">
            <p>• Referral rewards are subject to verification and may take up to 48 hours to process.</p>
            <p>• Commission rates are based on the total number of active referrals and their trading volume.</p>
            <p>• Each user can only use one referral code during registration.</p>
            <p>• Self-referrals are not permitted and may result in account suspension.</p>
          </div>
          <button className="mt-4 text-blue-500 hover:text-blue-600 text-sm font-medium flex items-center gap-1">
            View Full Terms <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Invite Friends Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowInviteModal(false)} />
          
          <div className="relative bg-[#1e2329] rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-gray-700 sticky top-0 bg-[#1e2329] z-10">
              <h2 className="text-xl font-bold text-white">Invite Friends</h2>
              <button 
                onClick={() => setShowInviteModal(false)}
                className="p-2 hover:bg-gray-700 rounded-xl transition-colors"
              >
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>

            <div className="p-6 flex flex-col lg:flex-row gap-8">
              {/* Left - Card Preview */}
              <div className="lg:w-[45%] relative flex-shrink-0">
                <div className="relative">
                  <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-blue-800 rounded-2xl p-6 border border-blue-500/30 shadow-xl min-h-[400px] flex flex-col justify-between">
                    <div className="absolute inset-0 rounded-2xl overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-blue-400/30 rounded-full blur-2xl" />
                      <div className="absolute bottom-0 left-0 w-24 h-24 bg-blue-300/30 rounded-full blur-2xl" />
                    </div>

                    <div className="relative z-10">
                      <div className="flex items-center gap-2 mb-6">
                        <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center shadow-lg">
                          <span className="text-white font-bold text-lg">M</span>
                        </div>
                        <span className="text-white font-bold text-xl">Methereum</span>
                      </div>

                      <h3 className="text-2xl font-bold text-white mb-2">Join & Earn Rewards!</h3>
                      <p className="text-blue-200">
                        New users receive up to <span className="text-white font-bold">6,135 USDT</span> in bonuses.
                      </p>
                    </div>

                    <div className="relative z-10 flex justify-center py-6">
                      <div className="text-7xl">🏆</div>
                    </div>

                    <div className="relative z-10 bg-blue-900/50 backdrop-blur-sm rounded-xl p-4 flex items-center justify-between">
                      <div>
                        <p className="text-blue-200 text-sm">Scan to join!</p>
                        <p className="text-white font-bold">Code: {referralCode}</p>
                      </div>
                      <div className="w-16 h-16 bg-white rounded-lg p-1">
                        <div className="w-full h-full bg-gray-200 rounded flex items-center justify-center">
                          <span className="text-[8px] text-gray-500">QR</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <button onClick={prevSlide} className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 w-10 h-10 bg-gray-700 hover:bg-gray-600 rounded-full flex items-center justify-center text-white transition-colors shadow-lg">
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button onClick={nextSlide} className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 w-10 h-10 bg-gray-700 hover:bg-gray-600 rounded-full flex items-center justify-center text-white transition-colors shadow-lg">
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex justify-center gap-2 mt-4">
                  {[0, 1, 2, 3].map((i) => (
                    <button
                      key={i}
                      onClick={() => setCurrentSlide(i)}
                      className={`w-2 h-2 rounded-full transition-all ${currentSlide === i ? 'bg-blue-500 w-6' : 'bg-gray-600'}`}
                    />
                  ))}
                </div>
              </div>

              {/* Right - Share Options */}
              <div className="flex-1 space-y-6">
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Referral Code</label>
                  <div className="flex items-center bg-gray-800 rounded-xl overflow-hidden">
                    <input type="text" value={referralCode} readOnly className="flex-1 bg-transparent px-4 py-3.5 text-white font-bold font-mono outline-none" />
                    <button onClick={copyModalCode} className="p-3.5 hover:bg-gray-700 transition-colors">
                      {modalCopiedCode ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5 text-gray-400" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-gray-400 text-sm mb-2">Customize your message</label>
                  <textarea
                    defaultValue={customText}
                    className="w-full h-28 bg-gray-800 rounded-xl px-4 py-3 text-gray-300 text-sm outline-none resize-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="grid grid-cols-5 gap-4">
                  {[
                    { icon: Download, label: 'Save', action: saveImage, color: 'bg-gray-700' },
                    { icon: Link2, label: modalCopiedLink ? 'Copied!' : 'Copy', action: copyModalLink, color: modalCopiedLink ? 'bg-green-600' : 'bg-gray-700' },
                    { icon: Mail, label: 'Email', action: shareViaEmail, color: 'bg-gray-700' },
                    { icon: () => <span className="text-lg font-bold">𝕏</span>, label: 'X', action: shareViaTwitter, color: 'bg-gray-900' },
                    { icon: MessageCircle, label: 'Telegram', action: shareViaTelegram, color: 'bg-[#0088cc]' },
                  ].map((item, i) => {
                    const Icon = item.icon as React.ComponentType<{ className?: string }>;
                    return (
                    <button key={i} onClick={item.action} className="flex flex-col items-center gap-2 group">
                      <div className={`w-12 h-12 ${item.color} hover:opacity-80 rounded-full flex items-center justify-center transition-all`}>
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                      <span className="text-xs text-gray-400 group-hover:text-white">{item.label}</span>
                    </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-5 gap-4">
                  {[
                    { icon: 'f', label: 'Facebook', action: shareViaFacebook, color: 'bg-[#1877f2]' },
                    { icon: 'w', label: 'WhatsApp', action: shareViaWhatsApp, color: 'bg-[#25d366]' },
                    { icon: 'in', label: 'LinkedIn', action: shareViaLinkedIn, color: 'bg-[#0077b5]' },
                    { icon: 'L', label: 'Line', action: shareViaLine, color: 'bg-[#00b900]' },
                    { icon: MoreHorizontal, label: 'More', action: shareViaMore, color: 'bg-gray-700' },
                  ].map((item, i) => {
                    const Icon = item.icon;
                    return (
                    <button key={i} onClick={item.action} className="flex flex-col items-center gap-2 group">
                      <div className={`w-12 h-12 ${item.color} hover:opacity-80 rounded-full flex items-center justify-center transition-all`}>
                        {typeof Icon === 'string' ? (
                          <span className="text-white font-bold">{Icon}</span>
                        ) : (
                          <Icon className="w-5 h-5 text-white" />
                        )}
                      </div>
                      <span className="text-xs text-gray-400 group-hover:text-white">{item.label}</span>
                    </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
