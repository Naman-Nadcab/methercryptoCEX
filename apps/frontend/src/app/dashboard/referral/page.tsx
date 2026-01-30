'use client';

import { useState, useRef } from 'react';
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
} from 'lucide-react';

type TabType = 'invite' | 'referrals';
type ActiveCard = 'earnings' | 'commissions';

export default function ReferralProgramPage() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabType>('invite');
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [activeCard, setActiveCard] = useState<ActiveCard>('earnings');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [modalCopiedCode, setModalCopiedCode] = useState(false);
  const [modalCopiedLink, setModalCopiedLink] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const referralCode = user?.id?.slice(0, 8).toUpperCase() || 'METH1234';
  const referralLink = `https://www.methereum.com/invite?ref=${referralCode}`;

  const customText = `Sign up for a Methereum account and claim exclusive rewards from the Methereum referral program! Plus, claim up to 6,135 USDT bonus at . https://www.methereum.com/invite?ref=${referralCode}`;

  // Handle mouse move on container to determine which card is active
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

  const nextSlide = () => {
    setCurrentSlide((prev) => (prev + 1) % 4);
  };

  const prevSlide = () => {
    setCurrentSlide((prev) => (prev - 1 + 4) % 4);
  };

  // Share functions
  const shareTitle = 'Join Methereum and earn crypto rewards!';
  const shareText = `Sign up for a Methereum account and claim exclusive rewards from the Methereum referral program! Plus, claim up to 6,135 USDT bonus at ${referralLink}`;

  const saveImage = async () => {
    // Create a canvas element to generate the image
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      // Background gradient
      const gradient = ctx.createLinearGradient(0, 0, 800, 1000);
      gradient.addColorStop(0, '#1a1a2e');
      gradient.addColorStop(1, '#16213e');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 800, 1000);
      
      // Add decorative circles
      ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
      ctx.beginPath();
      ctx.arc(650, 150, 150, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = 'rgba(234, 179, 8, 0.2)';
      ctx.beginPath();
      ctx.arc(150, 700, 120, 0, Math.PI * 2);
      ctx.fill();
      
      // Logo
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
      
      // Title
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 32px Arial';
      ctx.fillText('Join & Earn Rewards!', 50, 180);
      
      ctx.fillStyle = '#9ca3af';
      ctx.font = '18px Arial';
      ctx.fillText('New users can receive sign up rewards,', 50, 230);
      ctx.fillText('up to 6,135 USDT.', 50, 260);
      
      // Trophy emoji placeholder
      ctx.font = '120px Arial';
      ctx.fillText('🏆', 300, 500);
      
      // QR Code area
      ctx.fillStyle = 'rgba(55, 65, 81, 0.5)';
      ctx.beginPath();
      ctx.roundRect(50, 750, 700, 200, 15);
      ctx.fill();
      
      ctx.fillStyle = '#9ca3af';
      ctx.font = '16px Arial';
      ctx.fillText('Scan QR code and join me at Methereum!', 70, 800);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px Arial';
      ctx.fillText(`Referral Code: ${referralCode}`, 70, 840);
      
      ctx.fillStyle = '#9ca3af';
      ctx.font = '14px Arial';
      ctx.fillText(referralLink, 70, 880);
      
      // QR Code placeholder (white box)
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(620, 770, 110, 110, 10);
      ctx.fill();
      
      // Download
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
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(referralLink)}&quote=${encodeURIComponent(shareText)}`, '_blank', 'width=600,height=400');
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
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: referralLink,
        });
      } catch (err) {
        console.log('Share cancelled or failed');
      }
    } else {
      // Fallback: copy to clipboard
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
      <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 dark:from-[#0a1628] dark:via-[#0f2442] dark:to-[#0a1628] text-white py-8 px-4 lg:px-8">
        <div className="max-w-5xl mx-auto">
          {/* Title */}
          <h1 className="text-2xl lg:text-3xl font-bold mb-2">
            Invite Friends to Earn Over
          </h1>
          <h2 className="text-3xl lg:text-4xl font-bold text-yellow-400 mb-4">
            1,720 USDT and 30% Commission
          </h2>
          <p className="text-blue-200 mb-6 flex items-center gap-1">
            <span className="text-yellow-400">ℹ</span> How to get rewards
          </p>

          {/* Tabs */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setShowInviteModal(true)}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-colors ${
                activeTab === 'invite'
                  ? 'bg-white text-blue-900'
                  : 'bg-blue-800/50 text-blue-100 hover:bg-blue-700/50'
              }`}
            >
              Invite Friends
            </button>
            <Link
              href="/dashboard/referral/my-referrals"
              className={`px-6 py-2 rounded-full text-sm font-medium transition-colors ${
                activeTab === 'referrals'
                  ? 'bg-white text-blue-900'
                  : 'bg-blue-800/50 text-blue-100 hover:bg-blue-700/50'
              }`}
            >
              My Referrals
            </Link>
          </div>

          {/* Quick Links */}
          <div className="flex flex-wrap gap-4 text-sm text-blue-200">
            <span className="flex items-center gap-1 cursor-pointer hover:text-white">
              <span className="text-yellow-400">🎁</span> Invite Friends to Trade to earn rewards
            </span>
            <span className="flex items-center gap-1 cursor-pointer hover:text-white">
              <span className="text-yellow-400">📊</span> Get rewarded by referring friends to Methereum Pro
            </span>
            <span className="flex items-center gap-1 cursor-pointer hover:text-white">
              <span className="text-yellow-400">💰</span> Win from $500 Weekly Prize Pool
            </span>
          </div>
        </div>
      </div>

      {/* How to get rewards */}
      <div className="max-w-5xl mx-auto px-4 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">How to get rewards</h3>
          <span className="text-sm text-gray-500">Cumulated 76,000 USDT in Commissions</span>
        </div>

        {/* Hoverable Cards Container */}
        <div 
          ref={containerRef}
          onMouseMove={handleMouseMove}
          className="flex gap-4 mb-8"
        >
          {/* Your Earnings Card */}
          <div 
            className={`bg-gradient-to-br from-blue-600 to-blue-800 rounded-2xl p-6 text-white cursor-pointer overflow-hidden
              transition-all duration-500 ease-in-out
              ${activeCard === 'earnings' ? 'flex-[2]' : 'flex-1'}`}
          >
            <p className="text-sm text-blue-200 mb-2">Your Earnings</p>
            <p className="text-sm mb-4">
              Earn <span className="text-xl font-bold text-blue-200">$1,002</span> each when your referee completes the tasks!
            </p>
            
            {/* Expanded Content */}
            <div className={`transition-all duration-500 ease-in-out overflow-hidden
              ${activeCard === 'earnings' ? 'opacity-100 max-h-40 mt-4' : 'opacity-0 max-h-0 mt-0'}`}>
              <div className="grid grid-cols-4 gap-3">
                {/* $10 */}
                <div className="text-center">
                  <p className="text-2xl font-bold text-blue-200">$10</p>
                  <p className="text-xs text-blue-300">Bonus</p>
                  <p className="text-xs text-blue-300">for first ref user</p>
                  <p className="text-[10px] text-blue-400 mt-2">Referee claims to $100</p>
                </div>
                {/* $7 */}
                <div className="text-center">
                  <p className="text-2xl font-bold text-blue-200">$7</p>
                  <p className="text-xs text-blue-300">Bonus</p>
                  <p className="text-xs text-blue-300">for invite a user</p>
                  <p className="text-[10px] text-blue-400 mt-2">Referee earns a first deposit</p>
                </div>
                {/* $15 */}
                <div className="text-center">
                  <p className="text-2xl font-bold text-blue-200">$15</p>
                  <p className="text-xs text-blue-300">Bonus</p>
                  <p className="text-xs text-blue-300">on trading of user</p>
                  <p className="text-[10px] text-blue-400 mt-2">Referee earns $450</p>
                </div>
                {/* $1,000 */}
                <div className="text-center">
                  <p className="text-2xl font-bold text-blue-200">$1,000</p>
                  <p className="text-xs text-blue-300">Mystery Box</p>
                  <p className="text-xs text-blue-300">for each ref user</p>
                  <p className="text-[10px] text-blue-400 mt-2">Referee invests $1,000</p>
                </div>
              </div>
            </div>
            
            <p className="text-xs text-blue-300 mt-4 cursor-pointer hover:underline flex items-center gap-1">
              Learn more <ArrowRight className="w-3 h-3" />
            </p>
          </div>

          {/* Tiered Commissions Card */}
          <div 
            className={`bg-white dark:bg-[#181a20] rounded-2xl p-6 border border-gray-200 dark:border-gray-800 relative cursor-pointer overflow-hidden
              transition-all duration-500 ease-in-out
              ${activeCard === 'commissions' ? 'flex-[2]' : 'flex-1'}`}
          >
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Tiered Commissions</p>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
              The more friends you invite, the higher your commission rate, up to <span className="text-blue-500 font-bold">30%</span>!
            </p>
            
            {/* Chart */}
            <div className={`flex items-end justify-center mb-4 transition-all duration-500 ease-in-out
              ${activeCard === 'commissions' ? 'gap-8 h-32' : 'gap-4 h-20'}`}>
              <div className="flex flex-col items-center">
                <div 
                  className={`bg-gray-200 dark:bg-gray-700 rounded-t-lg transition-all duration-500 ease-in-out
                    ${activeCard === 'commissions' ? 'w-16 h-[60px]' : 'w-10 h-[40px]'}`}
                />
                <span className="text-xs text-gray-500 mt-2">20%</span>
              </div>
              <div className="flex flex-col items-center">
                <div 
                  className={`bg-gray-300 dark:bg-gray-600 rounded-t-lg transition-all duration-500 ease-in-out
                    ${activeCard === 'commissions' ? 'w-16 h-[80px]' : 'w-10 h-[55px]'}`}
                />
                <span className="text-xs text-gray-500 mt-2">25%</span>
              </div>
              <div className="flex flex-col items-center">
                <div 
                  className={`bg-blue-500 rounded-t-lg transition-all duration-500 ease-in-out
                    ${activeCard === 'commissions' ? 'w-16 h-[100px]' : 'w-10 h-[70px]'}`}
                />
                <span className="text-xs text-blue-500 font-semibold mt-2">30%</span>
              </div>
            </div>
            
            {/* Labels */}
            <div className={`flex justify-center text-xs text-gray-500 transition-all duration-500 ease-in-out
              ${activeCard === 'commissions' ? 'gap-8' : 'gap-4'}`}>
              <span>Referrals</span>
              <span>0</span>
              <span>5</span>
              <span>100</span>
            </div>

            {/* Help Icon */}
            <div className="absolute top-4 right-4">
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm cursor-pointer hover:bg-blue-600 transition-colors">
                ?
              </div>
            </div>
          </div>
        </div>

        {/* Invite More, Earn More */}
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Invite More, Earn More</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {/* Earn Card */}
          <div className="bg-white dark:bg-[#181a20] rounded-2xl p-6 border border-gray-200 dark:border-gray-800">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-xs text-blue-500 mb-1">Up to</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">$3</p>
                <p className="text-xs text-gray-500">Per Referred User</p>
              </div>
              <div className="w-16 h-16">
                <div className="w-full h-full bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-full flex items-center justify-center">
                  <Coins className="w-8 h-8 text-yellow-900" />
                </div>
              </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Invite a friend to Methereum Earn</p>
          </div>

          {/* Card Referral */}
          <div className="bg-white dark:bg-[#181a20] rounded-2xl p-6 border border-gray-200 dark:border-gray-800">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-xs text-blue-500 mb-1">Up to</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">$20</p>
                <p className="text-xs text-gray-500">Per Referred User</p>
              </div>
              <div className="w-16 h-16">
                <div className="w-full h-full bg-gradient-to-br from-gray-600 to-gray-800 rounded-lg flex items-center justify-center">
                  <CreditCard className="w-8 h-8 text-gray-300" />
                </div>
              </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Refer a friend to Methereum Card</p>
          </div>

          {/* Copy Trading */}
          <div className="bg-white dark:bg-[#181a20] rounded-2xl p-6 border border-gray-200 dark:border-gray-800">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-xs text-blue-500 mb-1">Up to</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">$665</p>
                <p className="text-xs text-gray-500">Per Referred User</p>
              </div>
              <div className="w-16 h-16">
                <div className="w-full h-full bg-gradient-to-br from-blue-400 to-blue-600 rounded-lg flex items-center justify-center">
                  <TrendingUp className="w-8 h-8 text-white" />
                </div>
              </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Refer a friend to Copy Trading</p>
          </div>
        </div>

        {/* How to Invite */}
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">How to Invite</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Step 1 */}
          <div className="text-center">
            <div className="w-20 h-20 mx-auto mb-4 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center">
              <Share2 className="w-10 h-10 text-blue-500" />
            </div>
            <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Share Your Code and Link</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              You can invite your friends to use all Methereum products with just one referral code.
            </p>
          </div>

          {/* Step 2 */}
          <div className="text-center">
            <div className="w-20 h-20 mx-auto mb-4 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center">
              <MessageCircle className="w-10 h-10 text-blue-500" />
            </div>
            <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Connect with Your Friends</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Your friends will be associated with you after they sign up.
            </p>
          </div>

          {/* Step 3 */}
          <div className="text-center">
            <div className="w-20 h-20 mx-auto mb-4 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center">
              <Gift className="w-10 h-10 text-blue-500" />
            </div>
            <h4 className="font-semibold text-gray-900 dark:text-white mb-2">Get Multiple Rewards</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Automatically get Trading Commissions, Methereum Card Rewards and Copy Trading Bonuses when your friends trade, apply for Methereum Card or start copy trading.
            </p>
          </div>
        </div>

        {/* Referral Code Section */}
        <div className="bg-white dark:bg-[#181a20] rounded-2xl p-6 border border-gray-200 dark:border-gray-800 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* My Referral Code */}
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-2">My Referral Code</label>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3">
                  <span className="text-lg font-bold text-gray-900 dark:text-white">{referralCode}</span>
                </div>
                <button
                  onClick={copyCode}
                  className="px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  {copiedCode ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* My Referral Link */}
            <div>
              <label className="block text-sm text-gray-500 dark:text-gray-400 mb-2">My Referral Link</label>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 overflow-hidden">
                  <span className="text-sm text-gray-600 dark:text-gray-300 truncate block">{referralLink}</span>
                </div>
                <button
                  onClick={copyLink}
                  className="px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  {copiedLink ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Terms & Conditions */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">TERMS & CONDITIONS</h3>
          <div className="text-sm text-gray-500 dark:text-gray-400 space-y-3">
            <p>
              1. Methereum does not conduct cryptocurrency/fiat currency exchange business in US, the Mainland of China, Hong Kong SAR, Singapore, North Korea, Russia and other regions where Methereum does not support.
            </p>
            <p>
              2. Referrers will earn commission based on the trading volume of their referees as a tiered basis. Referrers can earn up to 30% of the trading fees paid by the referees.
            </p>
            <p>
              3. Please note that commissions are calculated based on your referrees' net trading fees, minus any rebates.
              Profit-Sharing Rate multiplied by (Referees' actual trading fees - Up to 20% Referees' Fee Discounts).
              After cost: Referees earn back 0-20%.
            </p>
            <p>
              4. Eligible referees to trade One-Click Buy, P2P Trading (if you deposit more than $100 deposit in a total of $100), will receive an airdrop of $5 (bonus) in Methereum.
            </p>
            <p>
              5. Each new user can only use one (1) referral code from one (1) referrer.
            </p>
          </div>
          <button className="text-blue-500 hover:text-blue-600 text-sm mt-4 flex items-center gap-1">
            View More <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* CTA Banner */}
        <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 dark:from-[#0a1628] dark:via-[#0f2442] dark:to-[#0a1628] rounded-2xl p-8 text-center mb-8">
          <h3 className="text-xl lg:text-2xl font-bold text-white mb-4">
            Join Methereum Affiliates Program to unlock Up to 50% Commission
          </h3>
          <button className="px-8 py-3 bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-medium rounded-full transition-colors">
            Start Earning Now →
          </button>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-white dark:bg-[#0b0e11] border-t border-gray-200 dark:border-gray-800 py-12 px-4 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-8">
            {/* Logo and Social */}
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold">M</span>
                </div>
                <span className="text-xl font-bold text-gray-900 dark:text-white">Methereum</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {['f', 'x', 'ig', 'yt', 'in', 'tg', 'tk', 'rd', 'dc'].map((social, i) => (
                  <div
                    key={i}
                    className="w-8 h-8 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700"
                  >
                    <span className="text-xs text-gray-500 dark:text-gray-400">●</span>
                  </div>
                ))}
              </div>
            </div>

            {/* About */}
            <div>
              <h4 className="font-semibold mb-3 text-gray-900 dark:text-white">About</h4>
              <ul className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
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
              <h4 className="font-semibold mb-3 text-gray-900 dark:text-white">Services</h4>
              <ul className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
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
              <h4 className="font-semibold mb-3 text-gray-900 dark:text-white">Support</h4>
              <ul className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
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
              <h4 className="font-semibold mb-3 text-gray-900 dark:text-white">Products</h4>
              <ul className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Trade</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Derivatives</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Earn</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Launchpad</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">Methereum Card</li>
                <li className="hover:text-gray-900 dark:hover:text-white cursor-pointer">TradingView</li>
              </ul>
            </div>
          </div>

          {/* Copyright */}
          <div className="pt-6 border-t border-gray-200 dark:border-gray-800 flex flex-wrap items-center justify-center gap-4 text-sm text-gray-500">
            <span>© 2018-2026 Methereum.com. All rights reserved.</span>
            <Link href="/terms" className="hover:text-gray-900 dark:hover:text-white">Terms of Service</Link>
            <Link href="/privacy" className="hover:text-gray-900 dark:hover:text-white">Privacy Terms</Link>
          </div>
        </div>
      </footer>

      {/* Invite Friends Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/80"
            onClick={() => setShowInviteModal(false)}
          />
          
          {/* Modal */}
          <div className="relative bg-[#1e2026] rounded-2xl w-full max-w-[900px] max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-700 sticky top-0 bg-[#1e2026] z-10">
              <h2 className="text-xl font-semibold text-white">Invite Friends</h2>
              <button 
                onClick={() => setShowInviteModal(false)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 flex flex-col lg:flex-row gap-6">
              {/* Left Side - Carousel Card */}
              <div className="lg:w-[45%] relative flex-shrink-0">
                <div className="relative">
                  {/* Card with border */}
                  <div className="bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f0f23] rounded-2xl p-5 border border-gray-600/50 shadow-2xl overflow-hidden relative min-h-[420px] flex flex-col justify-between">
                    {/* Background decorations - Brighter */}
                    <div className="absolute inset-0">
                      <div className="absolute top-5 right-5 w-40 h-40 bg-blue-500/40 rounded-full blur-3xl" />
                      <div className="absolute bottom-32 left-5 w-32 h-32 bg-yellow-500/40 rounded-full blur-3xl" />
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-purple-500/20 rounded-full blur-3xl" />
                      {/* Sparkle dots */}
                      <div className="absolute top-20 right-20 w-1 h-1 bg-yellow-300 rounded-full animate-pulse" />
                      <div className="absolute top-32 right-32 w-1.5 h-1.5 bg-yellow-200 rounded-full animate-pulse delay-100" />
                      <div className="absolute bottom-40 left-20 w-1 h-1 bg-yellow-300 rounded-full animate-pulse delay-200" />
                    </div>

                    {/* Content */}
                    <div className="relative z-10">
                      {/* Logo */}
                      <div className="flex items-center gap-2 mb-5">
                        <div className="w-9 h-9 bg-blue-500 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/30">
                          <span className="text-white font-bold text-base">M</span>
                        </div>
                        <span className="text-white font-bold text-xl tracking-wide">Methereum</span>
                      </div>

                      {/* Title */}
                      <h3 className="text-2xl font-bold text-white mb-2">$:joinByTradeStat</h3>
                      <p className="text-gray-200 text-sm leading-relaxed">
                        New user can also receive sign up rewards, up to <span className="text-blue-400 font-bold">6,135</span> USDT.
                      </p>
                    </div>

                    {/* Trophy Image */}
                    <div className="relative z-10 flex justify-center py-4">
                      <div className="relative">
                        <div className="text-7xl drop-shadow-2xl">🏆</div>
                        <div className="absolute -top-3 -right-6 text-3xl animate-bounce">🪙</div>
                        <div className="absolute -bottom-2 -left-6 text-2xl animate-bounce delay-150">🪙</div>
                        <div className="absolute -top-1 -left-4 text-lg">✨</div>
                        <div className="absolute top-2 right-0 text-sm">✨</div>
                      </div>
                    </div>

                    {/* QR Code Section */}
                    <div className="relative z-10 bg-gray-800/70 backdrop-blur-sm rounded-xl p-4 flex items-center justify-between border border-gray-600/30">
                      <div className="flex-1 pr-3">
                        <p className="text-gray-200 text-sm mb-1">Scan QR code and join me at Methereum!</p>
                        <p className="text-white font-bold text-base">Referral Code: {referralCode}</p>
                      </div>
                      {/* QR Code - Proper pattern */}
                      <div className="w-20 h-20 bg-white rounded-lg p-1.5 flex-shrink-0 shadow-lg">
                        <svg viewBox="0 0 100 100" className="w-full h-full">
                          {/* QR Code Pattern */}
                          <rect fill="#000" x="0" y="0" width="28" height="28"/>
                          <rect fill="#fff" x="4" y="4" width="20" height="20"/>
                          <rect fill="#000" x="8" y="8" width="12" height="12"/>
                          
                          <rect fill="#000" x="72" y="0" width="28" height="28"/>
                          <rect fill="#fff" x="76" y="4" width="20" height="20"/>
                          <rect fill="#000" x="80" y="8" width="12" height="12"/>
                          
                          <rect fill="#000" x="0" y="72" width="28" height="28"/>
                          <rect fill="#fff" x="4" y="76" width="20" height="20"/>
                          <rect fill="#000" x="8" y="80" width="12" height="12"/>
                          
                          {/* Data pattern */}
                          <rect fill="#000" x="32" y="0" width="4" height="4"/>
                          <rect fill="#000" x="40" y="0" width="8" height="4"/>
                          <rect fill="#000" x="52" y="0" width="4" height="4"/>
                          <rect fill="#000" x="60" y="0" width="8" height="4"/>
                          
                          <rect fill="#000" x="32" y="8" width="4" height="4"/>
                          <rect fill="#000" x="44" y="8" width="4" height="4"/>
                          <rect fill="#000" x="56" y="8" width="8" height="4"/>
                          
                          <rect fill="#000" x="36" y="16" width="8" height="4"/>
                          <rect fill="#000" x="48" y="16" width="4" height="4"/>
                          <rect fill="#000" x="60" y="16" width="4" height="4"/>
                          
                          <rect fill="#000" x="32" y="24" width="4" height="4"/>
                          <rect fill="#000" x="40" y="24" width="12" height="4"/>
                          <rect fill="#000" x="56" y="24" width="8" height="4"/>
                          
                          <rect fill="#000" x="0" y="32" width="4" height="4"/>
                          <rect fill="#000" x="8" y="32" width="4" height="4"/>
                          <rect fill="#000" x="16" y="32" width="8" height="4"/>
                          <rect fill="#000" x="32" y="32" width="4" height="4"/>
                          <rect fill="#000" x="44" y="32" width="8" height="4"/>
                          <rect fill="#000" x="56" y="32" width="4" height="4"/>
                          <rect fill="#000" x="64" y="32" width="4" height="4"/>
                          <rect fill="#000" x="76" y="32" width="8" height="4"/>
                          <rect fill="#000" x="88" y="32" width="8" height="4"/>
                          
                          <rect fill="#000" x="0" y="40" width="4" height="4"/>
                          <rect fill="#000" x="12" y="40" width="4" height="4"/>
                          <rect fill="#000" x="24" y="40" width="4" height="4"/>
                          <rect fill="#000" x="36" y="40" width="8" height="4"/>
                          <rect fill="#000" x="48" y="40" width="4" height="4"/>
                          <rect fill="#000" x="60" y="40" width="8" height="4"/>
                          <rect fill="#000" x="72" y="40" width="4" height="4"/>
                          <rect fill="#000" x="84" y="40" width="4" height="4"/>
                          
                          <rect fill="#000" x="4" y="48" width="8" height="4"/>
                          <rect fill="#000" x="16" y="48" width="4" height="4"/>
                          <rect fill="#000" x="28" y="48" width="8" height="4"/>
                          <rect fill="#000" x="40" y="48" width="4" height="4"/>
                          <rect fill="#000" x="52" y="48" width="8" height="4"/>
                          <rect fill="#000" x="64" y="48" width="4" height="4"/>
                          <rect fill="#000" x="76" y="48" width="8" height="4"/>
                          <rect fill="#000" x="92" y="48" width="4" height="4"/>
                          
                          <rect fill="#000" x="0" y="56" width="4" height="4"/>
                          <rect fill="#000" x="8" y="56" width="8" height="4"/>
                          <rect fill="#000" x="20" y="56" width="4" height="4"/>
                          <rect fill="#000" x="32" y="56" width="8" height="4"/>
                          <rect fill="#000" x="44" y="56" width="4" height="4"/>
                          <rect fill="#000" x="56" y="56" width="4" height="4"/>
                          <rect fill="#000" x="68" y="56" width="8" height="4"/>
                          <rect fill="#000" x="80" y="56" width="4" height="4"/>
                          <rect fill="#000" x="92" y="56" width="4" height="4"/>
                          
                          <rect fill="#000" x="0" y="64" width="4" height="4"/>
                          <rect fill="#000" x="12" y="64" width="8" height="4"/>
                          <rect fill="#000" x="24" y="64" width="4" height="4"/>
                          <rect fill="#000" x="36" y="64" width="4" height="4"/>
                          <rect fill="#000" x="48" y="64" width="8" height="4"/>
                          <rect fill="#000" x="60" y="64" width="4" height="4"/>
                          <rect fill="#000" x="72" y="64" width="4" height="4"/>
                          <rect fill="#000" x="84" y="64" width="8" height="4"/>
                          
                          <rect fill="#000" x="32" y="72" width="4" height="4"/>
                          <rect fill="#000" x="44" y="72" width="8" height="4"/>
                          <rect fill="#000" x="56" y="72" width="4" height="4"/>
                          <rect fill="#000" x="68" y="72" width="4" height="4"/>
                          <rect fill="#000" x="80" y="72" width="8" height="4"/>
                          
                          <rect fill="#000" x="32" y="80" width="8" height="4"/>
                          <rect fill="#000" x="48" y="80" width="4" height="4"/>
                          <rect fill="#000" x="60" y="80" width="8" height="4"/>
                          <rect fill="#000" x="76" y="80" width="4" height="4"/>
                          <rect fill="#000" x="88" y="80" width="8" height="4"/>
                          
                          <rect fill="#000" x="36" y="88" width="4" height="4"/>
                          <rect fill="#000" x="44" y="88" width="8" height="4"/>
                          <rect fill="#000" x="56" y="88" width="4" height="4"/>
                          <rect fill="#000" x="64" y="88" width="8" height="4"/>
                          <rect fill="#000" x="80" y="88" width="4" height="4"/>
                          <rect fill="#000" x="92" y="88" width="4" height="4"/>
                          
                          <rect fill="#000" x="32" y="96" width="8" height="4"/>
                          <rect fill="#000" x="48" y="96" width="4" height="4"/>
                          <rect fill="#000" x="60" y="96" width="4" height="4"/>
                          <rect fill="#000" x="72" y="96" width="8" height="4"/>
                          <rect fill="#000" x="88" y="96" width="8" height="4"/>
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* Navigation Arrows */}
                  <button 
                    onClick={prevSlide}
                    className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-5 w-10 h-10 bg-gray-700/90 hover:bg-gray-600 rounded-full flex items-center justify-center text-white transition-colors shadow-lg border border-gray-600"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={nextSlide}
                    className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-5 w-10 h-10 bg-gray-700/90 hover:bg-gray-600 rounded-full flex items-center justify-center text-white transition-colors shadow-lg border border-gray-600"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>

                {/* Dots */}
                <div className="flex justify-center gap-2 mt-4">
                  {[0, 1, 2, 3].map((i) => (
                    <button
                      key={i}
                      onClick={() => setCurrentSlide(i)}
                      className={`w-2 h-2 rounded-full transition-all duration-300 ${
                        currentSlide === i ? 'bg-white w-4' : 'bg-gray-600 hover:bg-gray-500'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Right Side - Share Options */}
              <div className="lg:w-1/2 space-y-6">
                {/* Referral Code */}
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Referral Code</label>
                  <div className="flex items-center bg-gray-800 rounded-lg overflow-hidden">
                    <input 
                      type="text"
                      value={referralCode}
                      readOnly
                      className="flex-1 bg-transparent px-4 py-3 text-white font-medium outline-none"
                    />
                    <button 
                      onClick={copyModalCode}
                      className="p-3 text-gray-400 hover:text-white transition-colors"
                    >
                      {modalCopiedCode ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {/* Customize your text */}
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Customize your text</label>
                  <textarea
                    defaultValue={customText}
                    className="w-full h-32 bg-gray-800 rounded-lg px-4 py-3 text-gray-300 text-sm outline-none resize-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {/* Share Icons Row 1 */}
                <div className="flex justify-between">
                  <button onClick={saveImage} className="flex flex-col items-center gap-2 group">
                    <div className="w-12 h-12 bg-gray-700 hover:bg-gray-600 rounded-full flex items-center justify-center transition-colors">
                      <Download className="w-5 h-5 text-gray-300" />
                    </div>
                    <span className="text-xs text-gray-400 group-hover:text-white">Save Image</span>
                  </button>
                  <button onClick={copyModalLink} className="flex flex-col items-center gap-2 group">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${modalCopiedLink ? 'bg-green-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
                      {modalCopiedLink ? <Check className="w-5 h-5 text-white" /> : <Link2 className="w-5 h-5 text-gray-300" />}
                    </div>
                    <span className="text-xs text-gray-400 group-hover:text-white">{modalCopiedLink ? 'Copied!' : 'Copy link'}</span>
                  </button>
                  <button onClick={shareViaEmail} className="flex flex-col items-center gap-2 group">
                    <div className="w-12 h-12 bg-gray-700 hover:bg-gray-600 rounded-full flex items-center justify-center transition-colors">
                      <Mail className="w-5 h-5 text-gray-300" />
                    </div>
                    <span className="text-xs text-gray-400 group-hover:text-white">Email</span>
                  </button>
                  <button onClick={shareViaTwitter} className="flex flex-col items-center gap-2 group">
                    <div className="w-12 h-12 bg-gray-900 hover:bg-gray-800 rounded-full flex items-center justify-center transition-colors">
                      <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                      </svg>
                    </div>
                    <span className="text-xs text-gray-400 group-hover:text-white">X</span>
                  </button>
                  <button onClick={shareViaTelegram} className="flex flex-col items-center gap-2 group">
                    <div className="w-12 h-12 bg-[#0088cc] hover:bg-[#0077b5] rounded-full flex items-center justify-center transition-colors">
                      <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                      </svg>
                    </div>
                    <span className="text-xs text-gray-400 group-hover:text-white">Telegram</span>
                  </button>
                </div>

                {/* Share Icons Row 2 */}
                <div className="flex justify-between">
                  <button onClick={shareViaFacebook} className="flex flex-col items-center gap-2 group">
                    <div className="w-12 h-12 bg-[#1877f2] hover:bg-[#166fe5] rounded-full flex items-center justify-center transition-colors">
                      <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                      </svg>
                    </div>
                    <span className="text-xs text-gray-400 group-hover:text-white">Facebook</span>
                  </button>
                  <button onClick={shareViaWhatsApp} className="flex flex-col items-center gap-2 group">
                    <div className="w-12 h-12 bg-[#25d366] hover:bg-[#20bd5a] rounded-full flex items-center justify-center transition-colors">
                      <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                      </svg>
                    </div>
                    <span className="text-xs text-gray-400 group-hover:text-white">WhatsApp</span>
                  </button>
                  <button onClick={shareViaLinkedIn} className="flex flex-col items-center gap-2 group">
                    <div className="w-12 h-12 bg-[#0077b5] hover:bg-[#006699] rounded-full flex items-center justify-center transition-colors">
                      <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                      </svg>
                    </div>
                    <span className="text-xs text-gray-400 group-hover:text-white">Linkedin</span>
                  </button>
                  <button onClick={shareViaLine} className="flex flex-col items-center gap-2 group">
                    <div className="w-12 h-12 bg-[#00b900] hover:bg-[#00a000] rounded-full flex items-center justify-center transition-colors">
                      <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
                      </svg>
                    </div>
                    <span className="text-xs text-gray-400 group-hover:text-white">Line</span>
                  </button>
                  <button onClick={shareViaMore} className="flex flex-col items-center gap-2 group">
                    <div className="w-12 h-12 bg-gray-700 hover:bg-gray-600 rounded-full flex items-center justify-center transition-colors">
                      <MoreHorizontal className="w-5 h-5 text-gray-300" />
                    </div>
                    <span className="text-xs text-gray-400 group-hover:text-white">More</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
