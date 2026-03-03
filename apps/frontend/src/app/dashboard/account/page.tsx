'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth';
import Link from 'next/link';
import {
  Copy,
  Check,
  Edit3,
  User,
  Users,
  Shield,
  LineChart,
  Monitor,
  Activity,
  Trash2,
  ChevronRight,
  ShieldAlert,
  Camera,
  Verified,
  AlertTriangle,
  Settings,
  Link2,
  Smartphone,
  Loader2,
  CheckCircle,
  Clock,
} from 'lucide-react';
import { getApiBaseUrl } from '@/lib/getApiUrl';

interface UserProfile {
  id: string;
  email: string;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  totp_enabled: boolean;
  sms_auth_enabled: boolean;
  passkeys_enabled: boolean;
  has_fund_password: boolean;
  kycStatus: string;
  kycLevel: number;
  passkeysCount: number;
  activeDevices: number;
  last_login_at: string | null;
  created_at: string;
}

export default function AccountInfoPage() {
  const { user, accessToken, _hasHydrated } = useAuthStore();
  const [copiedUID, setCopiedUID] = useState(false);
  const [profileData, setProfileData] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  
  const apiUrl = getApiBaseUrl();

  // Fetch comprehensive profile data
  useEffect(() => {
    const fetchProfile = async () => {
      if (!_hasHydrated || !accessToken) return;
      
      try {
        const response = await fetch(`${apiUrl}/api/v1/auth/profile`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const result = await response.json();
        if (result.success) {
          setProfileData(result.data.user);
        }
      } catch (error) {
        console.error('Failed to fetch profile:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchProfile();
  }, [accessToken, _hasHydrated]);

  // Calculate security level based on actual settings
  const calculateSecurityLevel = () => {
    if (!profileData) return { score: 0, status: 'Low', color: 'orange' };
    
    let score = 0;
    if (profileData.email) score += 15; // Email verified
    if (profileData.phone) score += 15; // Phone linked
    if (profileData.sms_auth_enabled) score += 10; // SMS auth enabled
    if (profileData.totp_enabled) score += 25; // 2FA enabled
    if (profileData.passkeysCount > 0) score += 15; // Passkeys enabled
    if (profileData.has_fund_password) score += 10; // Fund password set
    if (profileData.kycStatus === 'approved') score += 10; // KYC verified
    
    if (score >= 80) return { score, status: 'High', color: 'green' };
    if (score >= 50) return { score, status: 'Medium', color: 'yellow' };
    return { score, status: 'Low', color: 'orange' };
  };

  const security = calculateSecurityLevel();

  const getKycStatusDisplay = () => {
    if (!profileData) return { text: 'Loading...', color: 'gray', icon: Clock };
    switch (profileData.kycStatus) {
      case 'approved':
        return { text: 'Verified', color: 'green', icon: CheckCircle };
      case 'pending':
        return { text: 'Pending Review', color: 'yellow', icon: Clock };
      case 'rejected':
        return { text: 'Rejected', color: 'red', icon: AlertTriangle };
      default:
        return { text: 'Unverified', color: 'gray', icon: AlertTriangle };
    }
  };

  const kycDisplay = getKycStatusDisplay();

  const maskEmail = (email: string) => {
    if (!email) return '***@****';
    const [local, domain] = email.split('@');
    if (!domain) return '***@****';
    const maskedLocal = local.slice(0, 3) + '***';
    return `${maskedLocal}@${domain}`;
  };

  const copyUID = () => {
    if (user?.id) {
      navigator.clipboard.writeText(user.id.slice(0, 9));
      setCopiedUID(true);
      setTimeout(() => setCopiedUID(false), 2000);
    }
  };

  const formatDate = (date?: string | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const SettingRow = ({ icon: Icon, title, description, status, statusColor, action, actionLabel, actionVariant = 'default' }: {
    icon: any;
    title: string;
    description?: string;
    status?: string;
    statusColor?: string;
    action?: () => void;
    actionLabel: string;
    actionVariant?: 'default' | 'primary' | 'success';
  }) => (
    <div className="flex items-center justify-between p-5 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center">
          <Icon className="w-6 h-6 text-gray-500 dark:text-gray-400" />
        </div>
        <div>
          <h3 className="font-medium text-gray-900 dark:text-white">{title}</h3>
          {description && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4">
        {status && (
          <span className={`flex items-center gap-1.5 text-sm font-medium ${statusColor}`}>
            <span className={`w-2 h-2 rounded-full ${statusColor?.includes('green') ? 'bg-green-500' : statusColor?.includes('orange') ? 'bg-orange-500' : 'bg-gray-400'}`}></span>
            {status}
          </span>
        )}
        <button
          onClick={action}
          className={`px-5 py-2.5 text-sm font-medium rounded-xl transition-all ${
            actionVariant === 'primary'
              ? 'bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/25'
              : actionVariant === 'success'
              ? 'bg-green-500 hover:bg-green-600 text-white shadow-lg shadow-green-500/25'
              : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
          }`}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );

  return (
    <div className="p-4 lg:p-8 bg-gray-50 dark:bg-[#0b0e11] min-h-full">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Account Info</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2">Manage your profile and account settings</p>
        </div>

        {/* User Profile Card */}
        <div className="bg-white dark:bg-[#181a20] rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden mb-6">
          <div className="p-6 lg:p-8">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
              {/* Left: Avatar and Info */}
              <div className="flex items-start gap-5">
                {/* Avatar */}
                <div className="relative group">
                  <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/25">
                    {user?.avatarUrl ? (
                      <img src={user.avatarUrl} alt="Avatar" className="w-full h-full rounded-2xl object-cover" />
                    ) : (
                      <User className="w-10 h-10 text-white" />
                    )}
                  </div>
                  <button className="absolute -bottom-1 -right-1 w-8 h-8 bg-blue-500 hover:bg-blue-600 rounded-xl flex items-center justify-center transition-colors shadow-lg">
                    <Camera className="w-4 h-4 text-white" />
                  </button>
                </div>

                {/* User Details */}
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-xl font-bold text-gray-900 dark:text-white">
                      {maskEmail(user?.email || '')}
                    </span>
                    <button className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                      <Edit3 className="w-4 h-4 text-gray-400" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-6">
                    {/* UID */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500 dark:text-gray-400">UID:</span>
                      <span className="font-mono font-medium text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-lg text-sm">
                        {user?.id?.slice(0, 9) || '********'}
                      </span>
                      <button
                        onClick={copyUID}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                      >
                        {copiedUID ? (
                          <Check className="w-4 h-4 text-green-500" />
                        ) : (
                          <Copy className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                    </div>

                    {/* Last Login */}
                    <div className="flex items-center gap-2">
                      <Monitor className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-500 dark:text-gray-400">Last login:</span>
                      <span className="text-sm text-gray-900 dark:text-white">
                        {loading ? 'Loading...' : formatDate(profileData?.last_login_at)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: Security Alert - Dynamic based on security level */}
              {security.status !== 'High' ? (
                <div className="flex items-start gap-4 p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/50 rounded-xl max-w-sm">
                  <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/40 rounded-xl flex items-center justify-center flex-shrink-0">
                    <ShieldAlert className="w-6 h-6 text-orange-500" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white mb-1">Security Alert</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                      {security.status === 'Low' 
                        ? 'Your account security level is low.' 
                        : 'Improve your account security.'}
                    </p>
                    <Link 
                      href="/dashboard/security"
                      className="text-sm text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1"
                    >
                      {!profileData?.totp_enabled ? 'Set up 2FA' : 'Improve Security'} <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 rounded-xl max-w-sm">
                  <div className="w-12 h-12 bg-green-100 dark:bg-green-900/40 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Shield className="w-6 h-6 text-green-500" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white mb-1">Account Secured</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                      Your account has strong security measures enabled.
                    </p>
                    <Link 
                      href="/dashboard/security"
                      className="text-sm text-green-500 hover:text-green-600 font-medium flex items-center gap-1"
                    >
                      View Settings <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Security Level Bar */}
          <div className="px-6 lg:px-8 py-4 bg-gray-50 dark:bg-[#1e2329] border-t border-gray-100 dark:border-gray-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Security Level</span>
              <span className={`text-sm font-semibold ${
                security.color === 'green' ? 'text-green-500' : 
                security.color === 'yellow' ? 'text-yellow-500' : 'text-orange-500'
              }`}>{security.status}</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div 
                className={`h-2 rounded-full transition-all duration-500 ${
                  security.color === 'green' ? 'bg-gradient-to-r from-green-500 to-green-400' : 
                  security.color === 'yellow' ? 'bg-gradient-to-r from-yellow-500 to-yellow-400' : 
                  'bg-gradient-to-r from-orange-500 to-orange-400'
                }`} 
                style={{ width: `${security.score}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Profile Settings */}
        <div className="bg-white dark:bg-[#181a20] rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Profile Settings</h2>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            <SettingRow
              icon={Camera}
              title="Profile Picture"
              description="Personalize your account with a custom avatar"
              status="Set up"
              statusColor="text-green-500"
              actionLabel="Settings"
            />
            <SettingRow
              icon={Users}
              title="Join an Affiliate's Community"
              description="Connect with top traders and earn rewards"
              actionLabel="Join"
              actionVariant="success"
            />
            <SettingRow
              icon={Shield}
              title="Identity Verification"
              description="Complete KYC to increase withdrawal limits"
              status={kycDisplay.text}
              statusColor={
                kycDisplay.color === 'green' ? 'text-green-500' : 
                kycDisplay.color === 'yellow' ? 'text-yellow-500' : 
                kycDisplay.color === 'red' ? 'text-red-500' : 'text-gray-400'
              }
              actionLabel={profileData?.kycStatus === 'approved' ? 'View' : 'Verify Now'}
              actionVariant={profileData?.kycStatus === 'approved' ? 'default' : 'primary'}
              action={() => window.location.href = '/dashboard/identity'}
            />
          </div>
        </div>

        {/* Account Integrations */}
        <div className="bg-white dark:bg-[#181a20] rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center">
              <Link2 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Account Integrations</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Connect third-party services</p>
            </div>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            <SettingRow
              icon={Smartphone}
              title="Link Account"
              description="Connect social accounts for quick login"
              status="Not Configured"
              statusColor="text-gray-400"
              actionLabel="Settings"
              actionVariant="primary"
            />
            <SettingRow
              icon={LineChart}
              title="TradingView Alerts"
              description="Link TradingView for automated trading signals"
              actionLabel="View"
            />
          </div>
        </div>

        {/* Account Activities */}
        <div className="bg-white dark:bg-[#181a20] rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
              <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Account Activities</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Manage devices and account history</p>
            </div>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            <SettingRow
              icon={Monitor}
              title="Trusted Devices"
              description={loading ? 'Loading...' : `${profileData?.activeDevices || 1} device${(profileData?.activeDevices || 1) > 1 ? 's' : ''} currently logged in`}
              actionLabel="Manage"
            />
            <SettingRow
              icon={Activity}
              title="Login History"
              description="View recent account activity"
              actionLabel="View"
            />
            <div className="flex items-center justify-between p-5 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-xl flex items-center justify-center">
                  <Trash2 className="w-6 h-6 text-red-500" />
                </div>
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-white">Delete Account</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Permanently delete your account and data</p>
                </div>
              </div>
              <button className="px-5 py-2.5 text-sm font-medium rounded-xl bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 transition-colors">
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
