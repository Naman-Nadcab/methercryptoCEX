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
      navigator.clipboard.writeText(user.id);
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

  const SettingRow = ({ icon: Icon, title, description, status, statusColor, action, actionLabel, actionVariant = 'default', badge }: {
    icon: React.ElementType;
    title: string;
    description?: string;
    status?: string;
    statusColor?: string;
    action?: () => void;
    actionLabel: string;
    actionVariant?: 'default' | 'primary' | 'success';
    badge?: string;
  }) => (
    <div className="flex items-center justify-between p-5 hover:bg-accent/30 transition-colors">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center">
          <Icon className="w-6 h-6 text-muted-foreground" />
        </div>
        <div>
          <h3 className="font-medium text-foreground">{title}</h3>
          {description && (
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4">
        {badge && (
          <span className="px-2 py-0.5 bg-muted text-muted-foreground text-xs font-medium rounded-md">{badge}</span>
        )}
        {status && (
          <span className={`flex items-center gap-1.5 text-sm font-medium ${statusColor}`}>
            <span className={`w-2 h-2 rounded-full ${statusColor?.includes('text-buy') ? 'bg-buy' : statusColor?.includes('text-warning') ? 'bg-warning' : 'bg-muted-foreground'}`}></span>
            {status}
          </span>
        )}
        <button
          onClick={action}
          className={`px-5 py-2.5 text-sm font-medium rounded-xl transition-all ${
            actionVariant === 'primary'
              ? 'bg-primary hover:bg-primary/85 text-primary-foreground shadow-lg shadow-blue-500/25'
              : actionVariant === 'success'
              ? 'bg-buy hover:bg-buy-hover text-primary-foreground shadow-lg shadow-buy/25'
              : 'bg-accent hover:bg-accent text-foreground/80'
          }`}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );

  return (
    <div className="p-4 lg:p-8 bg-background min-h-full">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-foreground">Account Info</h1>
          <p className="text-muted-foreground mt-2">Manage your profile and account settings</p>
        </div>

        {/* User Profile Card */}
        <div className="bg-card rounded-xl border border-border overflow-hidden mb-6">
          <div className="p-6 lg:p-8">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
              {/* Left: Avatar and Info */}
              <div className="flex items-start gap-5">
                {/* Avatar */}
                <div className="relative group">
                  <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
                    {user?.avatarUrl ? (
                      <img src={user.avatarUrl} alt="Avatar" className="w-full h-full rounded-xl object-cover" />
                    ) : (
                      <User className="w-10 h-10 text-primary-foreground" />
                    )}
                  </div>
                  <button className="absolute -bottom-1 -right-1 w-8 h-8 bg-primary hover:bg-primary/85 rounded-xl flex items-center justify-center transition-colors shadow-lg">
                    <Camera className="w-4 h-4 text-primary-foreground" />
                  </button>
                </div>

                {/* User Details */}
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-xl font-bold text-foreground">
                      {maskEmail(user?.email || '')}
                    </span>
                    <button className="p-1.5 hover:bg-accent rounded-lg transition-colors">
                      <Edit3 className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-6">
                    {/* UID */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">UID:</span>
                      <span className="font-mono font-medium text-foreground bg-accent px-2 py-1 rounded-lg text-sm">
                        {user?.id?.slice(0, 9) || '********'}
                      </span>
                      <button
                        onClick={copyUID}
                        className="p-1 hover:bg-accent rounded-lg transition-colors"
                      >
                        {copiedUID ? (
                          <Check className="w-4 h-4 text-buy" />
                        ) : (
                          <Copy className="w-4 h-4 text-muted-foreground" />
                        )}
                      </button>
                    </div>

                    {/* Last Login */}
                    <div className="flex items-center gap-2">
                      <Monitor className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Last login:</span>
                      <span className="text-sm text-foreground">
                        {loading ? 'Loading...' : formatDate(profileData?.last_login_at)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: Security Alert - Dynamic based on security level */}
              {security.status !== 'High' ? (
                <div className="flex items-start gap-4 p-4 bg-warning-light border border-warning/30 rounded-xl max-w-sm">
                  <div className="w-12 h-12 bg-muted rounded-xl flex items-center justify-center flex-shrink-0">
                    <ShieldAlert className="w-6 h-6 text-warning" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Security Alert</p>
                    <p className="text-sm text-muted-foreground mb-2">
                      {security.status === 'Low' 
                        ? 'Your account security level is low.' 
                        : 'Improve your account security.'}
                    </p>
                    <Link 
                      href="/dashboard/security"
                      className="text-sm text-primary hover:text-primary/85 font-medium flex items-center gap-1"
                    >
                      {!profileData?.totp_enabled ? 'Set up 2FA' : 'Improve Security'} <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-4 p-4 bg-buy-light border border-buy/20 rounded-xl max-w-sm">
                  <div className="w-12 h-12 bg-muted rounded-xl flex items-center justify-center flex-shrink-0">
                    <Shield className="w-6 h-6 text-buy" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground mb-1">Account Secured</p>
                    <p className="text-sm text-muted-foreground mb-2">
                      Your account has strong security measures enabled.
                    </p>
                    <Link 
                      href="/dashboard/security"
                      className="text-sm text-buy hover:text-buy/90 font-medium flex items-center gap-1"
                    >
                      View Settings <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Security Level Bar */}
          <div className="px-6 lg:px-8 py-4 bg-muted border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground/80">Security Level</span>
              <span className={`text-sm font-semibold ${
                security.color === 'green' ? 'text-buy' : 
                security.color === 'yellow' ? 'text-warning' : 'text-warning'
              }`}>{security.status}</span>
            </div>
            <div className="w-full bg-accent rounded-full h-2">
              <div 
                className={`h-2 rounded-full transition-all duration-500 ${
                  security.color === 'green' ? 'bg-gradient-to-r from-buy to-buy/80' : 
                  security.color === 'yellow' ? 'bg-gradient-to-r from-warning to-warning/80' : 
                  'bg-gradient-to-r from-warning to-warning/70'
                }`} 
                style={{ width: `${security.score}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Profile Settings */}
        <div className="bg-card rounded-xl border border-border overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-lg font-semibold text-foreground">Profile Settings</h2>
          </div>
          <div className="divide-y divide-border">
            <SettingRow
              icon={Camera}
              title="Profile Picture"
              description="Personalize your account with a custom avatar"
              status="Set up"
              statusColor="text-buy"
              actionLabel="Settings"
              badge="Soon"
              action={() => alert('Coming soon')}
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
                kycDisplay.color === 'green' ? 'text-buy' : 
                kycDisplay.color === 'yellow' ? 'text-warning' : 
                kycDisplay.color === 'red' ? 'text-sell' : 'text-muted-foreground'
              }
              actionLabel={profileData?.kycStatus === 'approved' ? 'View' : 'Verify Now'}
              actionVariant={profileData?.kycStatus === 'approved' ? 'default' : 'primary'}
              action={() => window.location.href = '/dashboard/identity'}
            />
          </div>
        </div>

        {/* Account Integrations */}
        <div className="bg-card rounded-xl border border-border overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-border flex items-center gap-3">
            <div className="w-10 h-10 bg-muted rounded-xl flex items-center justify-center">
              <Link2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Account Integrations</h2>
              <p className="text-sm text-muted-foreground">Connect third-party services</p>
            </div>
          </div>
          <div className="divide-y divide-border">
            <SettingRow
              icon={Smartphone}
              title="Link Account"
              description="Connect social accounts for quick login"
              status="Not Configured"
              statusColor="text-muted-foreground"
              actionLabel="Settings"
              actionVariant="primary"
              badge="Soon"
              action={() => alert('Coming soon')}
            />
            <SettingRow
              icon={LineChart}
              title="TradingView Alerts"
              description="Link TradingView for automated trading signals"
              actionLabel="View"
              badge="Soon"
              action={() => alert('Coming soon')}
            />
          </div>
        </div>

        {/* Account Activities */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Account Activities</h2>
              <p className="text-sm text-muted-foreground">Manage devices and account history</p>
            </div>
          </div>
          <div className="divide-y divide-border">
            <SettingRow
              icon={Monitor}
              title="Trusted Devices"
              description={loading ? 'Loading...' : `${profileData?.activeDevices || 1} device${(profileData?.activeDevices || 1) > 1 ? 's' : ''} currently logged in`}
              actionLabel="Manage"
              badge="Soon"
              action={() => alert('Coming soon')}
            />
            <SettingRow
              icon={Activity}
              title="Login History"
              description="View recent account activity"
              actionLabel="View"
              badge="Soon"
              action={() => alert('Coming soon')}
            />
            <div className="flex items-center justify-between p-5 hover:bg-accent/30 transition-colors">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-sell-light rounded-xl flex items-center justify-center">
                  <Trash2 className="w-6 h-6 text-sell" />
                </div>
                <div>
                  <h3 className="font-medium text-foreground">Delete Account</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">Permanently delete your account and data</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="px-2 py-0.5 bg-muted text-muted-foreground text-xs font-medium rounded-md">Soon</span>
                <button onClick={() => alert('Coming soon')} className="px-5 py-2.5 text-sm font-medium rounded-xl bg-sell-light hover:bg-sell/20 text-destructive transition-colors">
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
